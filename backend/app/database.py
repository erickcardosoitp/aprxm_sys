from collections.abc import AsyncGenerator

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.config import get_settings

settings = get_settings()

_IS_NEON = "neon.tech" in settings.database_url

engine = create_async_engine(
    settings.database_url,
    echo=settings.app_env == "development",
    pool_pre_ping=True,
    # Cada instancia serverless da Vercel mantem seu proprio pool - um pool grande
    # aqui multiplica por N instancias concorrentes e estoura o limite de conexoes
    # do Neon. O pooling de verdade e feito pelo PgBouncer do Neon por tras.
    # Configuravel via DB_POOL_SIZE/DB_MAX_OVERFLOW - default seguro pro Vercel,
    # a VM (1 processo fixo) sobe via env var sem mudar codigo.
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    # Neon: SSL required + PgBouncer pooler requires prepared statements disabled.
    # Fora do Neon (ex: Postgres local de teste), ssl fica a cargo do servidor.
    # server_settings.search_path: achado real 2026-09-14 - a role neondb_owner
    # ficou sem search_path padrao (SHOW search_path retornava vazio em conexao
    # nova, mesmo com ALTER ROLE ... SET search_path = public aplicado no
    # catalogo - o pooler/PgBouncer do Neon nao propaga esse default de role
    # pras sessoes que ele multiplexa). Forcando aqui, por conexao, via
    # asyncpg diretamente (nao pelo ALTER ROLE, que se mostrou nao confiavel
    # atras do pooler) - toda query sem esse fix falhava com "relation ...
    # does not exist" / "no schema has been selected to create in".
    connect_args=(
        {"ssl": "require", "statement_cache_size": 0, "server_settings": {"search_path": "public"}}
        if _IS_NEON
        else {"statement_cache_size": 0}
    ),
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@event.listens_for(Session, "after_begin")
def _propagar_usuario_logado(session: Session, transaction, connection) -> None:
    # O gatilho set_audit_fields (migration v29) le app.user_id pra preencher
    # created_by/updated_by. set_config(..., true) vale so ate o fim da
    # transacao -- por isso reaplicado a cada BEGIN (endpoint que commita no
    # meio abre transacao nova), e nunca vaza pra outra requisicao que pegue a
    # mesma conexao do pool. Sessao sem usuario (cron/script) nao seta nada:
    # o gatilho grava NULL = "sistema".
    user_id = session.info.get("user_id")
    if user_id:
        connection.execute(text("SELECT set_config('app.user_id', :uid, true)"), {"uid": user_id})


async def init_db() -> None:
    # Import all models so SQLAlchemy metadata is fully populated before create_all
    # Todos os models — se algum ficar de fora, uma FK que aponta pra ele nao resolve
    # e o create_all quebra inteiro (NoReferencedTableError) num banco novo.
    from app.models import (  # noqa: F401
        association, bank_statement, contas_pagar, empresa, finance, mensalidade,
        migration_payment, package, painel_admin, password_reset_token,
        provisioning_run, resident, service_order, service_order_phase, settings, user,
    )

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
