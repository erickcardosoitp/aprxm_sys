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

    # ── /inicio ──────────────────────────────────────────────────────────

    async def get_inicio(self) -> dict:
        receita_mes = (await self.analytics.execute(text("""
            SELECT COALESCE(SUM(amount), 0) FROM analytics.fact_transactions
            WHERE is_income AND to_char(transaction_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM')
        """))).scalar()

        mens = (await self.analytics.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE is_paid) AS pagas,
                COUNT(*) FILTER (WHERE is_overdue) AS vencidas
            FROM analytics.fact_mensalidades
            WHERE reference_month = to_char(now(), 'YYYY-MM')
        """))).fetchone()
        pagas, vencidas = mens[0] or 0, mens[1] or 0
        total_mens = pagas + vencidas
        taxa_cobranca = round(100.0 * pagas / total_mens, 1) if total_mens else None

        inadimplente = (await self.analytics.execute(text("""
            SELECT COALESCE(SUM(amount), 0) FROM analytics.fact_inadimplencia
            WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM analytics.fact_inadimplencia)
        """))).scalar()

        moradores = (await self.analytics.execute(text("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE type = 'member') AS associados,
                COUNT(*) FILTER (WHERE type = 'dependent') AS dependentes,
                COUNT(*) FILTER (WHERE type = 'guest') AS visitantes
            FROM analytics.dim_resident
            WHERE status = 'active' AND move_out_date IS NULL
        """))).fetchone()

        pacotes = (await self.analytics.execute(text("""
            SELECT
                COUNT(*) AS recebidos,
                AVG(delivery_hours) FILTER (WHERE is_delivered) AS tempo_medio_h,
                COUNT(*) FILTER (WHERE is_pending AND received_at < now() - INTERVAL '3 days') AS parados
            FROM analytics.fact_packages
            WHERE to_char(received_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM')
        """))).fetchone()

        os_row = (await self.analytics.execute(text("""
            SELECT COUNT(*) FILTER (WHERE is_open) AS abertas,
                   COUNT(*) FILTER (WHERE is_resolved) AS fechadas
            FROM analytics.fact_service_orders
        """))).fetchone()

        caixas_abertos = (await self.session.execute(text(
            "SELECT COUNT(*) FROM cash_sessions WHERE status = 'open'"
        ))).scalar() or 0

        alertas = []
        parados = pacotes[2] or 0
        if parados > 0:
            alertas.append(f"{parados} pacotes parados há mais de 3 dias")
        if taxa_cobranca is not None and taxa_cobranca < 60:
            alertas.append(f"Taxa de cobrança {taxa_cobranca}% — abaixo de 60%")
        if caixas_abertos > 0:
            alertas.append(f"{caixas_abertos} caixas abertos sem fechamento")

        return {
            "financeiro": {
                "receita_mes_atual": float(receita_mes or 0),
                "taxa_cobranca": taxa_cobranca,
                "total_inadimplente": float(inadimplente or 0),
            },
            "moradores": {
                "total": moradores[0] or 0, "associados": moradores[1] or 0,
                "dependentes": moradores[2] or 0, "visitantes": moradores[3] or 0,
            },
            "pacotes_os": {
                "pacotes_recebidos": pacotes[0] or 0,
                "tempo_medio_entrega_dias": round(pacotes[1] / 24, 1) if pacotes[1] else None,
                "os_abertas": os_row[0] or 0, "os_fechadas": os_row[1] or 0,
            },
            "alertas": alertas,
        }

    # ── /resumo (WoW/MoM) ────────────────────────────────────────────────

    async def _wow(self, sql_current: str, sql_previous: str, executor) -> dict:
        """Compara janela de 7 dias corrente vs anterior. YoY/ToT ficam None
        ate' o painel ter historico suficiente (mesmo estado do Excel hoje)."""
        cur = (await executor(sql_current)).scalar() or 0
        prev = (await executor(sql_previous)).scalar() or 0
        delta_pct = round(100.0 * (cur - prev) / prev, 1) if prev else None
        return {"atual": float(cur), "anterior": float(prev), "wow_pct": delta_pct,
                "mom_pct": None, "yoy_pct": None, "tot_pct": None}

    async def get_resumo(self) -> dict:
        async def a(sql: str):
            return await self.analytics.execute(text(sql))

        receita = await self._wow(
            "SELECT COALESCE(SUM(amount),0) FROM analytics.fact_transactions WHERE is_income AND transaction_at >= now() - INTERVAL '7 days'",
            "SELECT COALESCE(SUM(amount),0) FROM analytics.fact_transactions WHERE is_income AND transaction_at >= now() - INTERVAL '14 days' AND transaction_at < now() - INTERVAL '7 days'",
            a,
        )
        encomendas = await self._wow(
            "SELECT COUNT(*) FROM analytics.fact_packages WHERE received_at >= now() - INTERVAL '7 days'",
            "SELECT COUNT(*) FROM analytics.fact_packages WHERE received_at >= now() - INTERVAL '14 days' AND received_at < now() - INTERVAL '7 days'",
            a,
        )
        crescimento = await self._wow(
            "SELECT COUNT(*) FROM analytics.dim_resident WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'",
            "SELECT COUNT(*) FROM analytics.dim_resident WHERE created_at >= CURRENT_DATE - INTERVAL '14 days' AND created_at < CURRENT_DATE - INTERVAL '7 days'",
            a,
        )
        tempo_entrega = await self._wow(
            "SELECT AVG(delivery_hours)/24.0 FROM analytics.fact_packages WHERE is_delivered AND delivered_at >= now() - INTERVAL '7 days'",
            "SELECT AVG(delivery_hours)/24.0 FROM analytics.fact_packages WHERE is_delivered AND delivered_at >= now() - INTERVAL '14 days' AND delivered_at < now() - INTERVAL '7 days'",
            a,
        )

        return {
            "receita_liquida": receita,
            "encomendas": encomendas,
            "crescimento": crescimento,
            "tempo_entrega": tempo_entrega,
        }
