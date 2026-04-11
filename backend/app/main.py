import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import init_db
from app.routers import admin, agent, auth, cash_boxes, finance, financeiro, geral, mensalidades, packages, public, residents, senso, service_orders, superadmin, uploads, transfers
from app.routers import settings as settings_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _run_migrations()
    yield


async def _run_migrations() -> None:
    from sqlalchemy import text
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        await session.execute(text("""
            ALTER TABLE association_settings
                ADD COLUMN IF NOT EXISTS president_name        TEXT,
                ADD COLUMN IF NOT EXISTS president_signature_url TEXT,
                ADD COLUMN IF NOT EXISTS assoc_logo_url        TEXT,
                ADD COLUMN IF NOT EXISTS community_name        TEXT,
                ADD COLUMN IF NOT EXISTS proof_stock           INTEGER DEFAULT 0
        """))
        await session.execute(text("ALTER TABLE residents ADD COLUMN IF NOT EXISTS has_pests BOOLEAN"))

        # admin_master role
        await session.execute(text("""
            DO $$ BEGIN
                ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin_master';
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))

        # associations: presidente
        await session.execute(text(
            "ALTER TABLE associations ADD COLUMN IF NOT EXISTS presidente_user_id UUID REFERENCES users(id)"
        ))

        # association_settings: permitir_transferencia
        await session.execute(text(
            "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS permitir_transferencia BOOLEAN DEFAULT FALSE"
        ))

        # transactions: transfer fields
        await session.execute(text(
            "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_transfer BOOLEAN DEFAULT FALSE"
        ))
        await session.execute(text(
            "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_counterpart_id UUID"
        ))

        # migration_payments table
        await session.execute(text("""
            DO $$ BEGIN
                CREATE TYPE migration_payment_tipo AS ENUM ('mensalidade', 'acordo');
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS migration_payments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id),
                resident_id UUID NOT NULL REFERENCES residents(id),
                competencia VARCHAR(7) NOT NULL,
                tipo migration_payment_tipo NOT NULL,
                origem VARCHAR(50) NOT NULL DEFAULT 'migracao',
                created_by UUID NOT NULL REFERENCES users(id),
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_migration_payment_period UNIQUE (association_id, resident_id, competencia)
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_migration_payments_association_id ON migration_payments(association_id)"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_migration_payments_resident_id ON migration_payments(resident_id)"
        ))

        # transactions.cash_session_id nullable (saída externa)
        await session.execute(text(
            "ALTER TABLE transactions ALTER COLUMN cash_session_id DROP NOT NULL"
        ))

        # migration_payments new fields
        await session.execute(text(
            "ALTER TABLE migration_payments ADD COLUMN IF NOT EXISTS valor_pago NUMERIC(10,2)"
        ))
        await session.execute(text(
            "ALTER TABLE migration_payments ADD COLUMN IF NOT EXISTS data_pagamento DATE"
        ))

        # association_settings: delinquency_grace_days
        await session.execute(text(
            "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS delinquency_grace_days INTEGER DEFAULT 2"
        ))

        # service_orders new fields
        await session.execute(text(
            "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS assigned_to_name VARCHAR(255)"
        ))
        await session.execute(text(
            "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS energia_eletrica_data JSONB"
        ))

        # user_role: diretoria
        await session.execute(text("""
            DO $$ BEGIN
                ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'diretoria';
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))

        await session.execute(text(
            "ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS origin VARCHAR(50) DEFAULT 'Sessão de Caixa'"
        ))
        for col in [
            "manual_pix NUMERIC(12,2)",
            "manual_dinheiro NUMERIC(12,2)",
            "manual_total_bruto NUMERIC(12,2)",
            "manual_total_baixas NUMERIC(12,2)",
            "quebra_caixa NUMERIC(12,2)",
            "reviewed_by UUID REFERENCES users(id)",
        ]:
            await session.execute(text(f"ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS {col}"))

        for ddl in [
            """CREATE TABLE IF NOT EXISTS sangria_destinations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS cash_boxes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                balance NUMERIC(12,2) NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS cash_box_movements (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                cash_box_id UUID NOT NULL REFERENCES cash_boxes(id) ON DELETE CASCADE,
                amount NUMERIC(12,2) NOT NULL,
                movement_type VARCHAR(10) NOT NULL,
                description TEXT NOT NULL,
                created_by UUID REFERENCES users(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS session_transaction_reviews (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                cash_session_id UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
                transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                conferido BOOLEAN NOT NULL DEFAULT false,
                observacao TEXT,
                reviewed_by UUID REFERENCES users(id),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(cash_session_id, transaction_id)
            )""",
        ]:
            await session.execute(text(ddl))

        await session.commit()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Sistema de Gestão Comunitária — APRXM",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__, "trace": traceback.format_exc()[-1000:]},
    )


PREFIX = "/api/v1"
app.include_router(auth.router, prefix=PREFIX)
app.include_router(admin.router, prefix=PREFIX)
app.include_router(finance.router, prefix=PREFIX)
app.include_router(packages.router, prefix=PREFIX)
app.include_router(residents.router, prefix=PREFIX)
app.include_router(service_orders.router, prefix=PREFIX)
app.include_router(settings_router.router, prefix=PREFIX)
app.include_router(financeiro.router, prefix=PREFIX)
app.include_router(mensalidades.router, prefix=PREFIX)
app.include_router(geral.router, prefix=PREFIX)
app.include_router(superadmin.router, prefix=PREFIX)
app.include_router(uploads.router, prefix=PREFIX)
app.include_router(transfers.router, prefix=PREFIX)
app.include_router(public.router, prefix=PREFIX)
app.include_router(senso.router, prefix=PREFIX)
app.include_router(agent.router, prefix=PREFIX)
app.include_router(cash_boxes.router, prefix=PREFIX)


@app.get("/health", tags=["Sistema"])
async def health() -> dict:
    return {"status": "ok", "version": settings.app_version}
