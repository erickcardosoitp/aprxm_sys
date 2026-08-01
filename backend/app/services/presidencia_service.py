"""
Service do painel da presidencia — le do Neon Analytics (dim_/fact_), nunca escreve.
Ver docs/superpowers/specs/2026-08-01-painel-presidencia-design.md.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

_analytics_engine: AsyncEngine | None = None
_AnalyticsSessionLocal: async_sessionmaker[AsyncSession] | None = None


def _analytics_async_url() -> str:
    url = settings.analytics_db_url
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def get_analytics_engine() -> AsyncEngine:
    """Engine async lazy, separada da engine principal — aponta pro projeto
    aprxm-analytics (OLAP), nao pro banco operacional."""
    global _analytics_engine, _AnalyticsSessionLocal
    if _analytics_engine is None:
        _analytics_engine = create_async_engine(
            _analytics_async_url(),
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=3,
            connect_args={"ssl": "require", "statement_cache_size": 0},
        )
        _AnalyticsSessionLocal = async_sessionmaker(
            bind=_analytics_engine, class_=AsyncSession, expire_on_commit=False,
        )
    return _analytics_engine


async def get_analytics_session() -> AsyncSession:
    """Dependency FastAPI: sessao read-only pro Neon Analytics."""
    get_analytics_engine()
    assert _AnalyticsSessionLocal is not None
    async with _AnalyticsSessionLocal() as session:
        yield session


class PresidenciaService:
    def __init__(self, session: AsyncSession, analytics: AsyncSession) -> None:
        self.session = session          # banco operacional (etl_runs, etc.)
        self.analytics = analytics      # aprxm-analytics (dim_/fact_)

    async def freshness(self) -> dict:
        """generated_at/stale baseados no ultimo etl_run — mesma logica pra
        todo endpoint do painel, nao recalcula em cada um."""
        row = (await self.session.execute(text(
            "SELECT status, completed_at FROM etl_runs "
            "WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1"
        ))).fetchone()
        if not row:
            return {"generated_at": None, "stale": True}
        status_, completed_at = row
        return {
            "generated_at": completed_at.isoformat() if completed_at else None,
            "stale": status_ != "success",
        }

    async def analytics_reachable(self) -> bool:
        try:
            await self.analytics.execute(text("SELECT 1"))
            return True
        except Exception:
            return False
