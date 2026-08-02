"""
Service do painel da presidencia — le do data warehouse dedicado
(projeto Neon "aprxm-analytics"), nunca escreve. Consome as tabelas gold
reais produzidas por datalake_service.build_gold() (nomes em portugues,
ver docs/superpowers/plans/2026-08-01-etl-empresa-aware-plan.md) — nao
existe schema "analytics.*" nesse projeto, as tabelas ficam no schema
public padrao (mesmo destino que _write_gold_sync grava).

Ver docs/superpowers/specs/2026-08-01-painel-presidencia-design.md.
"""
from datetime import date
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()


def _shift_yyyymm(yyyymm: str, delta_meses: int) -> str:
    ano, mes = (int(p) for p in yyyymm.split("-"))
    total = ano * 12 + (mes - 1) + delta_meses
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _ultimos_meses_yyyymm(n: int, ate: str | None = None) -> list[str]:
    """Lista de 'YYYY-MM' dos ultimos n meses a partir de `ate` (ou do mes
    atual se omitido), incluindo o proprio `ate`."""
    if ate:
        ano, mes = (int(p) for p in ate.split("-"))
    else:
        hoje = date.today()
        ano, mes = hoje.year, hoje.month
    meses = []
    for _ in range(n):
        meses.append(f"{ano:04d}-{mes:02d}")
        mes -= 1
        if mes == 0:
            mes = 12
            ano -= 1
    return meses

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

    async def _metricas_periodo(self, meses: list[str], unidade_filter: str, unidade: str | None) -> dict:
        """Metricas com dimensao de mes (comparaveis entre periodos) -- usado
        pro periodo atual e pro periodo anterior (comparativo dos cards)."""
        params = {"unidade": unidade, "meses": meses} if unidade else {"meses": meses}

        receita_mes = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(receita_total), 0) FROM receita_diaria
            WHERE to_char(data, 'YYYY-MM') = ANY(:meses) {unidade_filter}
        """), params)).scalar()

        cob = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(pagas), 0), COALESCE(SUM(total), 0), COALESCE(SUM(vencidas), 0),
                   COALESCE(SUM(valor_vencido), 0)
            FROM taxa_cobranca WHERE to_char(mes, 'YYYY-MM') = ANY(:meses) {unidade_filter}
        """), params)).fetchone()
        pagas, total_cob, vencidas, valor_vencido = cob[0] or 0, cob[1] or 0, cob[2] or 0, cob[3] or 0
        taxa_cobranca = round(100.0 * pagas / total_cob, 1) if total_cob else None
        retencao_pct = round(100.0 * pagas / (pagas + vencidas), 1) if (pagas + vencidas) else None

        pacotes = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(recebidos),0), AVG(media_dias_permanencia)
            FROM encomendas_mensal WHERE mes = ANY(:meses) {unidade_filter}
        """), params)).fetchone()

        os_row = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(abertas),0), COALESCE(SUM(fechadas),0)
            FROM ordens_servico_mensal WHERE mes = ANY(:meses) {unidade_filter}
        """), params)).fetchone()

        return {
            "receita": float(receita_mes or 0),
            "taxa_cobranca": taxa_cobranca,
            "mensalidades_pagas": int(pagas),
            "mensalidades_vencidas": int(vencidas),
            "valor_vencido": float(valor_vencido),
            "taxa_retencao": retencao_pct,
            "pacotes_recebidos": int(pacotes[0] or 0),
            "tempo_medio_entrega_dias": round(pacotes[1], 1) if pacotes[1] else None,
            "os_abertas": int(os_row[0] or 0),
            "os_fechadas": int(os_row[1] or 0),
        }

    async def _breakdown_por_unidade(self, meses: list[str]) -> dict:
        """Quebra por associacao das metricas do Inicio -- so' roda quando
        'Todos' esta selecionado (unidade=None), pra mostrar Congonha vs
        Vaz Lobo dentro de cada card."""
        params = {"meses": meses}

        receita = (await self.dw.execute(text("""
            SELECT nome_associacao, COALESCE(SUM(receita_total), 0)
            FROM receita_diaria WHERE to_char(data, 'YYYY-MM') = ANY(:meses)
            GROUP BY nome_associacao
        """), params)).fetchall()

        cob = (await self.dw.execute(text("""
            SELECT nome_associacao, COALESCE(SUM(pagas),0), COALESCE(SUM(total),0),
                   COALESCE(SUM(vencidas),0), COALESCE(SUM(valor_vencido),0)
            FROM taxa_cobranca WHERE to_char(mes, 'YYYY-MM') = ANY(:meses)
            GROUP BY nome_associacao
        """), params)).fetchall()

        pacotes = (await self.dw.execute(text("""
            SELECT nome_associacao, COALESCE(SUM(recebidos),0)
            FROM encomendas_mensal WHERE mes = ANY(:meses)
            GROUP BY nome_associacao
        """), params)).fetchall()

        os_rows = (await self.dw.execute(text("""
            SELECT nome_associacao, COALESCE(SUM(fechadas),0)
            FROM ordens_servico_mensal WHERE mes = ANY(:meses)
            GROUP BY nome_associacao
        """), params)).fetchall()

        moradores = (await self.dw.execute(text("""
            SELECT nome_associacao, COALESCE(SUM(total_ativos),0)
            FROM panorama_moradores GROUP BY nome_associacao
        """))).fetchall()

        inadimplencia_agora = (await self.dw.execute(text("""
            SELECT nome_associacao, COALESCE(SUM(valor_devido),0)
            FROM relatorio_inadimplencia GROUP BY nome_associacao
        """))).fetchall()

        # Associacoes orfas/inativas (fora do mapeamento ativo) aparecem com
        # nome_associacao NULL nos gold -- nao sao Congonha/Vaz Lobo, entram
        # no total geral mas nao viram um 3o grupo fantasma no breakdown.
        out: dict[str, dict] = {}
        for nome, receita_v in receita:
            if not nome: continue
            out.setdefault(nome, {})["receita"] = float(receita_v or 0)
        for nome, pagas, total, vencidas, valor_vencido in cob:
            if not nome: continue
            d = out.setdefault(nome, {})
            d["taxa_cobranca"] = round(100.0 * pagas / total, 1) if total else None
            d["mensalidades_pagas"] = int(pagas)
            d["mensalidades_vencidas"] = int(vencidas)
            d["taxa_retencao"] = round(100.0 * pagas / (pagas + vencidas), 1) if (pagas + vencidas) else None
        for nome, valor_devido in inadimplencia_agora:
            if not nome: continue
            out.setdefault(nome, {})["total_inadimplente"] = float(valor_devido or 0)
        for nome, recebidos in pacotes:
            if not nome: continue
            out.setdefault(nome, {})["pacotes_recebidos"] = int(recebidos or 0)
        for nome, fechadas in os_rows:
            if not nome: continue
            out.setdefault(nome, {})["os_fechadas"] = int(fechadas or 0)
        for nome, total_ativos in moradores:
            if not nome: continue
            out.setdefault(nome, {})["moradores_total"] = int(total_ativos or 0)
        return out

    async def get_inicio(self, unidade: str | None = None, periodo: str = "mes", ate: str | None = None) -> dict:
        unidade_filter = "AND nome_associacao = :unidade" if unidade else ""
        meses_atras = {"mes": 1, "trimestre": 3, "semestre": 6, "ano": 12}.get(periodo, 1)
        meses_alvo = _ultimos_meses_yyyymm(meses_atras, ate)
        meses_anteriores = _ultimos_meses_yyyymm(meses_atras, _shift_yyyymm(meses_alvo[-1], -1))
        params = {"unidade": unidade, "meses": meses_alvo} if unidade else {"meses": meses_alvo}

        atual = await self._metricas_periodo(meses_alvo, unidade_filter, unidade)
        anterior = await self._metricas_periodo(meses_anteriores, unidade_filter, unidade)
        por_unidade = await self._breakdown_por_unidade(meses_alvo) if unidade is None else None

        # Inadimplencia = total em aberto AGORA (snapshot, so' filtra por
        # unidade) -- nao por periodo, senao "mes atual" sempre mostra ~0
        # (mensalidade do mes ainda nao venceu). Diferente de
        # mensalidades_vencidas/taxa_retencao acima, que sao propositalmente
        # escopadas ao periodo selecionado.
        inadimplente_agora = (await self.dw.execute(text(
            f"SELECT COALESCE(SUM(valor_devido), 0) FROM relatorio_inadimplencia WHERE 1=1 {unidade_filter}"
        ), params)).scalar()

        moradores = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(total_ativos),0), COALESCE(SUM(associados),0),
                   COALESCE(SUM(dependentes),0), COALESCE(SUM(visitantes),0)
            FROM panorama_moradores WHERE 1=1 {unidade_filter}
        """), params)).fetchone()

        parados = (await self.dw.execute(text(
            f"SELECT COALESCE(SUM(paradas_3d), 0) FROM encomendas_paradas WHERE 1=1 {unidade_filter}"
        ), params)).scalar() or 0

        caixas_unidade_filter = "AND a.name = :unidade" if unidade else ""
        caixas_abertos = (await self.session.execute(text(f"""
            SELECT COUNT(*) FROM cash_sessions cs
            JOIN associations a ON a.id = cs.association_id
            WHERE cs.status = 'open' {caixas_unidade_filter}
        """), params)).scalar() or 0

        alertas = []
        if parados > 0:
            alertas.append(f"{parados} pacotes parados há mais de 3 dias")
        if atual["taxa_cobranca"] is not None and atual["taxa_cobranca"] < 60:
            alertas.append(f"Taxa de cobrança {atual['taxa_cobranca']}% — abaixo de 60%")
        if caixas_abertos > 0:
            alertas.append(f"{caixas_abertos} caixas abertos sem fechamento")

        return {
            "financeiro": {
                "receita_mes_atual": atual["receita"],
                "receita_mes_anterior": anterior["receita"],
                "taxa_cobranca": atual["taxa_cobranca"],
                "taxa_cobranca_anterior": anterior["taxa_cobranca"],
                "total_inadimplente": float(inadimplente_agora or 0),
                "mensalidades_pagas": atual["mensalidades_pagas"],
                "mensalidades_pagas_anterior": anterior["mensalidades_pagas"],
                "mensalidades_vencidas": atual["mensalidades_vencidas"],
                "mensalidades_vencidas_anterior": anterior["mensalidades_vencidas"],
                "taxa_retencao": atual["taxa_retencao"],
                "taxa_retencao_anterior": anterior["taxa_retencao"],
            },
            "moradores": {
                "total": int(moradores[0] or 0), "associados": int(moradores[1] or 0),
                "dependentes": int(moradores[2] or 0), "visitantes": int(moradores[3] or 0),
            },
            "pacotes_os": {
                "pacotes_recebidos": atual["pacotes_recebidos"],
                "pacotes_recebidos_anterior": anterior["pacotes_recebidos"],
                "tempo_medio_entrega_dias": atual["tempo_medio_entrega_dias"],
                "os_abertas": atual["os_abertas"],
                "os_fechadas": atual["os_fechadas"],
                "os_fechadas_anterior": anterior["os_fechadas"],
            },
            "alertas": alertas,
            "por_unidade": por_unidade,
        }

    # ── /resumo (WoW) ────────────────────────────────────────────────────
    # Reaproveita os rollups semanais que o proprio ETL ja fecha (exclui a
    # semana em andamento) -- pega as 2 semanas mais recentes de cada tabela
    # e compara, em vez de recalcular janela por now()-7d.

    async def _wow_semanal(self, table: str, agg_sql: str, n_semanas: int = 8) -> dict:
        """Serie das ultimas N semanas (pro mini-grafico de tendencia) + WoW
        calculado sobre as 2 mais recentes."""
        rows = (await self.dw.execute(text(f"""
            SELECT semana, {agg_sql} AS valor
            FROM {table}
            GROUP BY semana
            ORDER BY semana DESC
            LIMIT :n
        """), {"n": n_semanas})).fetchall()
        rows = list(reversed(rows))  # cronologico (mais antiga primeiro) pro grafico
        serie = [
            {"label": r[0].strftime("%d/%m"), "value": float(r[1]) if r[1] is not None else 0.0}
            for r in rows
        ]
        cur = serie[-1]["value"] if len(serie) >= 1 else 0.0
        prev = serie[-2]["value"] if len(serie) >= 2 else 0.0
        delta_pct = round(100.0 * (cur - prev) / prev, 1) if prev else None
        return {
            "atual": cur, "anterior": prev, "wow_pct": delta_pct,
            "mom_pct": None, "yoy_pct": None, "tot_pct": None,
            "serie": serie,
        }

    async def _mom_mensal(self, table: str, agg_sql: str, n_meses: int = 6) -> dict:
        """Mesmo formato de _wow_semanal, mas por mes -- pra metricas que sao
        mensais por natureza (pagamento se espalha no mes todo, olhar semana
        isolada da' fatia pequena e sem sentido). Decisao do usuario 2026-08-01."""
        rows = (await self.dw.execute(text(f"""
            SELECT mes, {agg_sql} AS valor
            FROM {table}
            GROUP BY mes
            ORDER BY mes DESC
            LIMIT :n
        """), {"n": n_meses})).fetchall()
        rows = list(reversed(rows))
        serie = [
            {"label": r[0].strftime("%m/%Y"), "value": float(r[1]) if r[1] is not None else 0.0}
            for r in rows
        ]
        cur = serie[-1]["value"] if len(serie) >= 1 else 0.0
        prev = serie[-2]["value"] if len(serie) >= 2 else 0.0
        delta_pct = round(100.0 * (cur - prev) / prev, 1) if prev else None
        return {
            "atual": cur, "anterior": prev, "wow_pct": delta_pct,
            "mom_pct": delta_pct, "yoy_pct": None, "tot_pct": None,
            "serie": serie,
        }

    async def get_resumo(self) -> dict:
        receita = await self._wow_semanal("receita_semanal", "SUM(saldo_liquido)")
        encomendas = await self._wow_semanal("pacotes_semanal", "SUM(recebidos)")
        crescimento = await self._wow_semanal("crescimento_associados_semanal", "SUM(novos)")
        tempo_entrega = await self._wow_semanal("pacotes_semanal", "AVG(media_dias_permanencia)")
        # taxa de cobranca/retencao sao mensais por natureza -- MoM, nao WoW
        # (semana isolada mede so' uma fatia do mes, numero pequeno e ruidoso)
        taxa_cobranca = await self._mom_mensal("taxa_cobranca", "SUM(pagas)::float / NULLIF(SUM(total), 0) * 100")
        inadimplencia = await self._mom_mensal("taxa_cobranca", "SUM(valor_vencido)")
        retencao = await self._mom_mensal("taxa_cobranca", "SUM(pagas)::float / NULLIF(SUM(pagas) + SUM(vencidas), 0) * 100")
        tarefas_no_prazo = await self._wow_semanal("tarefas_semanal", "AVG(pct_no_prazo)")
        score_operadores = await self._wow_semanal("score_operador_semanal", "AVG(score)")

        return {
            "receita_liquida": receita,
            "encomendas": encomendas,
            "crescimento": crescimento,
            "tempo_entrega": tempo_entrega,
            "taxa_cobranca": taxa_cobranca,
            "inadimplencia": inadimplencia,
            "retencao": retencao,
            "tarefas_no_prazo": tarefas_no_prazo,
            "score_operadores": score_operadores,
        }
