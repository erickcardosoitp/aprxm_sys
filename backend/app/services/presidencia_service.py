"""
Service do painel da presidencia — le do data warehouse dedicado
(projeto Neon "aprxm-analytics"), nunca escreve. Consome as tabelas gold
reais produzidas por datalake_service.build_gold() (nomes em portugues,
ver docs/superpowers/plans/2026-08-01-etl-empresa-aware-plan.md) — nao
existe schema "analytics.*" nesse projeto, as tabelas ficam no schema
public padrao (mesmo destino que _write_gold_sync grava).

Ver docs/superpowers/specs/2026-08-01-painel-presidencia-design.md.
"""
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

_dw_engine: AsyncEngine | None = None
_DwSessionLocal: async_sessionmaker[AsyncSession] | None = None


def _dw_async_url() -> str:
    url = settings.datawarehouse_db_url
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    # Neon copia sslmode/channel_binding na querystring (formato libpq) --
    # asyncpg nao aceita esses kwargs via connect(), ssl ja e' setado
    # explicitamente via connect_args abaixo.
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def get_dw_engine() -> AsyncEngine:
    """Engine async lazy, separada da engine principal — aponta pro projeto
    aprxm-analytics (data warehouse dedicado, OLAP), nao pro banco operacional."""
    global _dw_engine, _DwSessionLocal
    if _dw_engine is None:
        _dw_engine = create_async_engine(
            _dw_async_url(),
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=3,
            connect_args={"ssl": "require", "statement_cache_size": 0},
        )
        _DwSessionLocal = async_sessionmaker(
            bind=_dw_engine, class_=AsyncSession, expire_on_commit=False,
        )
    return _dw_engine


async def get_dw_session() -> AsyncSession:
    """Dependency FastAPI: sessao read-only pro data warehouse."""
    get_dw_engine()
    assert _DwSessionLocal is not None
    async with _DwSessionLocal() as session:
        yield session


class PresidenciaService:
    def __init__(self, session: AsyncSession, dw: AsyncSession) -> None:
        self.session = session   # banco operacional (etl_runs, cash_sessions, etc.)
        self.dw = dw             # aprxm-analytics (tabelas gold, pt-BR)

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

    async def dw_reachable(self) -> bool:
        try:
            await self.dw.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    # ── /inicio ──────────────────────────────────────────────────────────

    async def get_inicio(self, unidade: str | None = None) -> dict:
        unidade_filter = "AND nome_associacao = :unidade" if unidade else ""
        params = {"unidade": unidade} if unidade else {}

        receita_mes = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(receita_total), 0) FROM receita_diaria
            WHERE to_char(data, 'YYYY-MM') = to_char(now(), 'YYYY-MM') {unidade_filter}
        """), params)).scalar()

        cob = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(pagas), 0), COALESCE(SUM(total), 0)
            FROM taxa_cobranca WHERE to_char(mes, 'YYYY-MM') = to_char(now(), 'YYYY-MM') {unidade_filter}
        """), params)).fetchone()
        pagas, total_cob = cob[0] or 0, cob[1] or 0
        taxa_cobranca = round(100.0 * pagas / total_cob, 1) if total_cob else None

        inadimplente = (await self.dw.execute(text(
            f"SELECT COALESCE(SUM(valor_devido), 0) FROM relatorio_inadimplencia WHERE 1=1 {unidade_filter}"
        ), params)).scalar()

        moradores = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(total_ativos),0), COALESCE(SUM(associados),0),
                   COALESCE(SUM(dependentes),0), COALESCE(SUM(visitantes),0)
            FROM panorama_moradores WHERE 1=1 {unidade_filter}
        """), params)).fetchone()

        pacotes = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(recebidos),0), AVG(media_dias_permanencia)
            FROM encomendas_mensal WHERE mes = to_char(now(), 'YYYY-MM') {unidade_filter}
        """), params)).fetchone()

        parados = (await self.dw.execute(text(
            f"SELECT COALESCE(SUM(paradas_3d), 0) FROM encomendas_paradas WHERE 1=1 {unidade_filter}"
        ), params)).scalar() or 0

        os_row = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(abertas),0), COALESCE(SUM(fechadas),0)
            FROM ordens_servico_mensal WHERE mes = to_char(now(), 'YYYY-MM') {unidade_filter}
        """), params)).fetchone()

        caixas_unidade_filter = "AND a.name = :unidade" if unidade else ""
        caixas_abertos = (await self.session.execute(text(f"""
            SELECT COUNT(*) FROM cash_sessions cs
            JOIN associations a ON a.id = cs.association_id
            WHERE cs.status = 'open' {caixas_unidade_filter}
        """), params)).scalar() or 0

        alertas = []
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
                "tempo_medio_entrega_dias": round(pacotes[1], 1) if pacotes[1] else None,
                "os_abertas": os_row[0] or 0, "os_fechadas": os_row[1] or 0,
            },
            "alertas": alertas,
        }

    # ── /resumo (WoW) ────────────────────────────────────────────────────
    # Reaproveita os rollups semanais que o proprio ETL ja fecha (exclui a
    # semana em andamento) -- pega as 2 semanas mais recentes de cada tabela
    # e compara, em vez de recalcular janela por now()-7d.

    async def _wow_semanal(self, table: str, agg_sql: str) -> dict:
        rows = (await self.dw.execute(text(f"""
            SELECT semana, {agg_sql} AS valor
            FROM {table}
            GROUP BY semana
            ORDER BY semana DESC
            LIMIT 2
        """))).fetchall()
        cur = float(rows[0][1]) if len(rows) > 0 and rows[0][1] is not None else 0.0
        prev = float(rows[1][1]) if len(rows) > 1 and rows[1][1] is not None else 0.0
        delta_pct = round(100.0 * (cur - prev) / prev, 1) if prev else None
        return {"atual": cur, "anterior": prev, "wow_pct": delta_pct,
                "mom_pct": None, "yoy_pct": None, "tot_pct": None}

    async def get_resumo(self) -> dict:
        receita = await self._wow_semanal("receita_semanal", "SUM(saldo_liquido)")
        encomendas = await self._wow_semanal("pacotes_semanal", "SUM(recebidos)")
        crescimento = await self._wow_semanal("crescimento_associados_semanal", "SUM(novos)")
        tempo_entrega = await self._wow_semanal("pacotes_semanal", "AVG(media_dias_permanencia)")

        return {
            "receita_liquida": receita,
            "encomendas": encomendas,
            "crescimento": crescimento,
            "tempo_entrega": tempo_entrega,
        }
