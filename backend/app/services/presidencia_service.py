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


_PISO_MES = "2026-03"  # antes disso e' so' handful de acordos retroativos
                       # pre-lancamento (2-3 moradores), nao operacao real --
                       # decisao do usuario 2026-08-02.


def _ultimos_meses_yyyymm(n: int, ate: str | None = None) -> list[str]:
    """Lista de 'YYYY-MM' dos ultimos n meses a partir de `ate` (ou do mes
    atual se omitido), incluindo o proprio `ate`. Nunca volta antes de
    _PISO_MES."""
    if ate:
        ano, mes = (int(p) for p in ate.split("-"))
    else:
        hoje = date.today()
        ano, mes = hoje.year, hoje.month
    meses = []
    for _ in range(n):
        chave = f"{ano:04d}-{mes:02d}"
        if chave < _PISO_MES:
            break
        meses.append(chave)
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
    def __init__(self, session: AsyncSession, dw: AsyncSession, empresa_id=None) -> None:
        self.session = session   # banco operacional (etl_runs, cash_sessions, etc.)
        self.dw = dw             # aprxm-analytics (tabelas gold, pt-BR)
        # Isolamento multi-empresa: sem isso, no dia em que uma 2a empresa
        # entrar na plataforma, o painel da presidencia da Sapê passaria a
        # misturar dados de outra empresa (as gold tables sao compartilhadas,
        # so' tem a coluna empresa_id como fronteira). None = sem camada
        # empresa (conta legacy) -- nao filtra, mesmo fallback usado em
        # app/core/tenant.py.
        self.empresa_id = str(empresa_id) if empresa_id else None
        self._empresa_filter = "AND empresa_id = :empresa_id" if self.empresa_id else ""

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
        if self.empresa_id:
            params["empresa_id"] = self.empresa_id

        receita_mes = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(receita_total), 0) FROM receita_diaria
            WHERE to_char(data, 'YYYY-MM') = ANY(:meses) {unidade_filter} {self._empresa_filter}
        """), params)).scalar()

        cob = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(pagas), 0), COALESCE(SUM(total), 0), COALESCE(SUM(vencidas), 0),
                   COALESCE(SUM(valor_vencido), 0)
            FROM taxa_cobranca WHERE to_char(mes, 'YYYY-MM') = ANY(:meses) {unidade_filter} {self._empresa_filter}
        """), params)).fetchone()
        pagas, total_cob, vencidas, valor_vencido = cob[0] or 0, cob[1] or 0, cob[2] or 0, cob[3] or 0
        taxa_cobranca = round(100.0 * pagas / total_cob, 1) if total_cob else None
        retencao_pct = round(100.0 * pagas / (pagas + vencidas), 1) if (pagas + vencidas) else None

        pacotes = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(recebidos),0), AVG(media_dias_permanencia)
            FROM encomendas_mensal WHERE mes = ANY(:meses) {unidade_filter} {self._empresa_filter}
        """), params)).fetchone()

        os_row = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(abertas),0), COALESCE(SUM(fechadas),0)
            FROM ordens_servico_mensal WHERE mes = ANY(:meses) {unidade_filter} {self._empresa_filter}
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
        if self.empresa_id:
            params["empresa_id"] = self.empresa_id

        receita = (await self.dw.execute(text(f"""
            SELECT nome_associacao, COALESCE(SUM(receita_total), 0)
            FROM receita_diaria WHERE to_char(data, 'YYYY-MM') = ANY(:meses) {self._empresa_filter}
            GROUP BY nome_associacao
        """), params)).fetchall()

        cob = (await self.dw.execute(text(f"""
            SELECT nome_associacao, COALESCE(SUM(pagas),0), COALESCE(SUM(total),0),
                   COALESCE(SUM(vencidas),0), COALESCE(SUM(valor_vencido),0)
            FROM taxa_cobranca WHERE to_char(mes, 'YYYY-MM') = ANY(:meses) {self._empresa_filter}
            GROUP BY nome_associacao
        """), params)).fetchall()

        pacotes = (await self.dw.execute(text(f"""
            SELECT nome_associacao, COALESCE(SUM(recebidos),0)
            FROM encomendas_mensal WHERE mes = ANY(:meses) {self._empresa_filter}
            GROUP BY nome_associacao
        """), params)).fetchall()

        os_rows = (await self.dw.execute(text(f"""
            SELECT nome_associacao, COALESCE(SUM(fechadas),0)
            FROM ordens_servico_mensal WHERE mes = ANY(:meses) {self._empresa_filter}
            GROUP BY nome_associacao
        """), params)).fetchall()

        moradores = (await self.dw.execute(text(f"""
            SELECT nome_associacao, COALESCE(SUM(total_ativos),0)
            FROM panorama_moradores WHERE 1=1 {self._empresa_filter} GROUP BY nome_associacao
        """), params)).fetchall()

        inadimplencia_agora = (await self.dw.execute(text(f"""
            SELECT nome_associacao, COALESCE(SUM(valor_devido),0)
            FROM relatorio_inadimplencia WHERE 1=1 {self._empresa_filter} GROUP BY nome_associacao
        """), params)).fetchall()

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
        meses_anteriores = (
            _ultimos_meses_yyyymm(meses_atras, _shift_yyyymm(meses_alvo[-1], -1))
            if meses_alvo else []
        )
        params = {"unidade": unidade, "meses": meses_alvo} if unidade else {"meses": meses_alvo}
        if self.empresa_id:
            params["empresa_id"] = self.empresa_id

        atual = await self._metricas_periodo(meses_alvo, unidade_filter, unidade)
        anterior = await self._metricas_periodo(meses_anteriores, unidade_filter, unidade)
        por_unidade = await self._breakdown_por_unidade(meses_alvo) if unidade is None else None

        # Inadimplencia = total em aberto AGORA (snapshot, so' filtra por
        # unidade) -- nao por periodo, senao "mes atual" sempre mostra ~0
        # (mensalidade do mes ainda nao venceu). Diferente de
        # mensalidades_vencidas/taxa_retencao acima, que sao propositalmente
        # escopadas ao periodo selecionado.
        inadimplente_agora = (await self.dw.execute(text(
            f"SELECT COALESCE(SUM(valor_devido), 0) FROM relatorio_inadimplencia WHERE 1=1 {unidade_filter} {self._empresa_filter}"
        ), params)).scalar()

        moradores = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(total_ativos),0), COALESCE(SUM(associados),0),
                   COALESCE(SUM(dependentes),0), COALESCE(SUM(visitantes),0)
            FROM panorama_moradores WHERE 1=1 {unidade_filter} {self._empresa_filter}
        """), params)).fetchone()

        parados = (await self.dw.execute(text(
            f"SELECT COALESCE(SUM(paradas_3d), 0) FROM encomendas_paradas WHERE 1=1 {unidade_filter} {self._empresa_filter}"
        ), params)).scalar() or 0

        caixas_unidade_filter = "AND a.name = :unidade" if unidade else ""
        caixas_empresa_filter = "AND a.empresa_id = :empresa_id" if self.empresa_id else ""
        caixas_abertos = (await self.session.execute(text(f"""
            SELECT COUNT(*) FROM cash_sessions cs
            JOIN associations a ON a.id = cs.association_id
            WHERE cs.status = 'open' {caixas_unidade_filter} {caixas_empresa_filter}
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

    @staticmethod
    def _mes_label(mes) -> str:
        """`mes` vem como TEXT 'YYYY-MM' na maioria das gold tables, mas como
        TIMESTAMP em taxa_cobranca -- aceita os dois formatos."""
        if hasattr(mes, "strftime"):
            return mes.strftime("%m/%Y")
        s = str(mes)
        if len(s) >= 7 and s[4] == "-":
            return f"{s[5:7]}/{s[0:4]}"
        return s

    async def _mom_mensal(
        self, table: str, agg_sql: str, unidade: str | None = None, n_meses: int = 6,
        ate: str | None = None,
    ) -> dict:
        """Todo indicador do Resumo e' mensal por natureza (pagamento/tarefa/
        crescimento se espalha no mes todo, olhar semana isolada da' fatia
        pequena e sem sentido) -- comparacao e' sempre mes atual vs mes
        anterior, `n_meses` so' controla quantos pontos aparecem no
        mini-grafico de tendencia. Decisao do usuario 2026-08-01.
        `ate` (YYYY-MM) ancora a janela -- sem isso a navegacao de periodo no
        header (goPrev/goNext) nao tinha efeito nenhum aqui."""
        meses = _ultimos_meses_yyyymm(n_meses, ate)
        # taxa_cobranca.mes e receita_diaria.mes sao TIMESTAMP, as demais gold
        # tables sao TEXT 'YYYY-MM'
        mes_expr = "to_char(mes, 'YYYY-MM')" if table in ("taxa_cobranca", "receita_diaria") else "mes"
        unidade_filter = "AND nome_associacao = :unidade" if unidade else ""
        params = {"meses": meses, "unidade": unidade} if unidade else {"meses": meses}
        if self.empresa_id:
            params["empresa_id"] = self.empresa_id
        rows = (await self.dw.execute(text(f"""
            SELECT {mes_expr} AS mes_key, {agg_sql} AS valor
            FROM {table}
            WHERE {mes_expr} = ANY(:meses) {unidade_filter} {self._empresa_filter}
            GROUP BY {mes_expr}
            ORDER BY {mes_expr}
        """), params)).fetchall()
        serie = [
            {"label": self._mes_label(r[0]), "value": float(r[1]) if r[1] is not None else 0.0}
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

    async def get_resumo(
        self, unidade: str | None = None, periodo: str = "mes", ate: str | None = None,
    ) -> dict:
        n_meses = {"mes": 6, "trimestre": 9, "semestre": 12, "ano": 24}.get(periodo, 6)

        receita = await self._mom_mensal("receita_diaria", "SUM(receita_total)", unidade, n_meses, ate)
        encomendas = await self._mom_mensal("encomendas_mensal", "SUM(recebidos)", unidade, n_meses, ate)
        crescimento = await self._mom_mensal("moradores_mensal", "SUM(associados) - LAG(SUM(associados)) OVER (ORDER BY mes)", unidade, n_meses, ate)
        tempo_entrega = await self._mom_mensal("encomendas_mensal", "AVG(media_dias_permanencia)", unidade, n_meses, ate)
        taxa_cobranca = await self._mom_mensal("taxa_cobranca", "SUM(pagas)::float / NULLIF(SUM(total), 0) * 100", unidade, n_meses, ate)
        inadimplencia = await self._mom_mensal("taxa_cobranca", "SUM(vencidas)::float / NULLIF(SUM(total), 0) * 100", unidade, n_meses, ate)
        retencao = await self._mom_mensal("taxa_cobranca", "SUM(pagas)::float / NULLIF(SUM(pagas) + SUM(vencidas), 0) * 100", unidade, n_meses, ate)
        tarefas_no_prazo = await self._mom_mensal("tarefas_mensal", "AVG(pct_no_prazo)", unidade, n_meses, ate)
        score_operadores = await self._mom_mensal("score_operador_mensal", "AVG(score)", unidade, n_meses, ate)

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

    # ── helpers comuns as telas de detalhe (Financeiro/Moradores/... ) ──────

    def _janela(self, periodo: str, ate: str | None) -> tuple[list[str], dict]:
        meses_atras = {"mes": 1, "trimestre": 3, "semestre": 6, "ano": 12}.get(periodo, 1)
        meses = _ultimos_meses_yyyymm(meses_atras, ate)
        params = {"meses": meses}
        if self.empresa_id:
            params["empresa_id"] = self.empresa_id
        return meses, params

    def _params_unidade(self, params: dict, unidade: str | None) -> tuple[dict, str]:
        p = dict(params)
        unidade_filter = "AND nome_associacao = :unidade" if unidade else ""
        if unidade:
            p["unidade"] = unidade
        return p, unidade_filter

    # ── /financeiro ──────────────────────────────────────────────────────

    async def get_financeiro(self, unidade: str | None = None, periodo: str = "mes", ate: str | None = None) -> dict:
        meses, base_params = self._janela(periodo, ate)
        params, unidade_filter = self._params_unidade(base_params, unidade)
        ef = self._empresa_filter

        margem = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(receita_total),0), COALESCE(SUM(despesa_total),0), COALESCE(SUM(saldo_liquido),0)
            FROM margem_mensal WHERE mes = ANY(:meses) {unidade_filter} {ef}
        """), params)).fetchone()
        receita, despesa, saldo = float(margem[0] or 0), float(margem[1] or 0), float(margem[2] or 0)

        meses_anteriores = _ultimos_meses_yyyymm(len(meses), _shift_yyyymm(meses[-1], -1)) if meses else []
        params_ant = dict(params, meses=meses_anteriores)
        margem_ant = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(receita_total),0) FROM margem_mensal WHERE mes = ANY(:meses) {unidade_filter} {ef}
        """), params_ant)).scalar()
        receita_anterior = float(margem_ant or 0)

        runway = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(saldo_atual),0), MIN(runway_semanas)
            FROM runway_financeiro WHERE 1=1 {unidade_filter} {ef}
        """), params)).fetchone()

        inadimplente = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(valor_devido),0), COUNT(*) FROM relatorio_inadimplencia WHERE 1=1 {unidade_filter} {ef}
        """), params)).fetchone()

        recuperacao = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(valor_recuperada),0), COALESCE(SUM(valor_nunca_recuperada),0),
                   COALESCE(SUM(valor_parcelamento),0), AVG(taxa_recuperacao_pct)
            FROM recuperacao_inadimplencia WHERE 1=1 {unidade_filter} {ef}
        """), params)).fetchone()

        aging_rows = (await self.dw.execute(text(f"""
            SELECT faixa, COALESCE(SUM(qtd),0), COALESCE(SUM(valor),0)
            FROM aging_inadimplencia WHERE 1=1 {unidade_filter} {ef}
            GROUP BY faixa ORDER BY faixa
        """), params)).fetchall()

        sangria_rows = (await self.dw.execute(text(f"""
            SELECT motivo, COALESCE(SUM(ocorrencias),0), COALESCE(SUM(valor),0)
            FROM motivos_sangria WHERE to_char(mes,'YYYY-MM') = ANY(:meses) {unidade_filter} {ef}
            GROUP BY motivo ORDER BY 3 DESC LIMIT 8
        """), params)).fetchall()

        quebras = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(com_quebra),0), COALESCE(SUM(total_quebra),0), COALESCE(SUM(com_diferenca),0)
            FROM quebras_caixa WHERE 1=1 {unidade_filter} {ef}
        """), params)).fetchone()

        quebras_detalhe_rows = (await self.dw.execute(text(f"""
            SELECT semana, nome_operador, nome_associacao, total, com_quebra, com_diferenca, total_quebra, total_diferenca, pct_diferenca
            FROM quebras_caixa WHERE (com_quebra > 0 OR com_diferenca > 0) {unidade_filter} {ef}
            ORDER BY semana DESC, total_quebra DESC LIMIT 50
        """), params)).fetchall()

        # Serie diaria -- base pro Grafico de Faturamento, Faturamento por
        # produto, Calendario de calor e a tabela dia x produto (todos usam a
        # mesma granularidade, ver spec 2026-08-01-painel-presidencia-design.md §3)
        serie_rows = (await self.dw.execute(text(f"""
            SELECT data, SUM(receita_total), SUM(despesa_total), SUM(saldo_liquido),
                   SUM(mensalidade), SUM(taxa_entrega), SUM(comprovante_residencia), SUM(outras_receitas)
            FROM receita_diaria WHERE to_char(data,'YYYY-MM') = ANY(:meses) {unidade_filter} {ef}
            GROUP BY data ORDER BY data
        """), params)).fetchall()

        comparativo_rows = (await self.dw.execute(text(f"""
            SELECT nome_associacao, SUM(receita_total), SUM(despesa_total), SUM(saldo_liquido)
            FROM margem_mensal WHERE mes = ANY(:meses) {ef}
            GROUP BY nome_associacao
        """), base_params)).fetchall()
        cob_comparativo_rows = (await self.dw.execute(text(f"""
            SELECT nome_associacao, SUM(pagas), SUM(total)
            FROM taxa_cobranca WHERE to_char(mes,'YYYY-MM') = ANY(:meses) {ef}
            GROUP BY nome_associacao
        """), base_params)).fetchall()
        cob_por_nome = {r[0]: (r[1] or 0, r[2] or 0) for r in cob_comparativo_rows}

        return {
            "receita_total": receita, "despesa_total": despesa, "saldo_liquido": saldo,
            "receita_total_anterior": receita_anterior,
            "margem_pct": round(100.0 * saldo / receita, 1) if receita else None,
            "saldo_caixa": float(runway[0] or 0), "runway_semanas": float(runway[1]) if runway and runway[1] is not None else None,
            "total_inadimplente": float(inadimplente[0] or 0), "qtd_inadimplentes": int(inadimplente[1] or 0),
            "recuperacao": {
                "valor_recuperada": float(recuperacao[0] or 0), "valor_nunca_recuperada": float(recuperacao[1] or 0),
                "valor_parcelamento": float(recuperacao[2] or 0),
                "taxa_recuperacao_pct": round(recuperacao[3], 1) if recuperacao and recuperacao[3] is not None else None,
            },
            "aging": [{"faixa": r[0], "qtd": int(r[1] or 0), "valor": float(r[2] or 0)} for r in aging_rows],
            "motivos_sangria": [{"motivo": r[0], "ocorrencias": int(r[1] or 0), "valor": float(r[2] or 0)} for r in sangria_rows],
            "quebras_caixa": {
                "com_quebra": int(quebras[0] or 0), "valor_total": float(quebras[1] or 0), "com_diferenca": int(quebras[2] or 0),
                "detalhe": [
                    {
                        "semana": r[0].strftime("%d/%m/%Y") if r[0] else None, "operador": r[1], "associacao": r[2],
                        "total_sessoes": int(r[3] or 0), "com_quebra": int(r[4] or 0), "com_diferenca": int(r[5] or 0),
                        "valor_quebra": float(r[6] or 0), "valor_diferenca": float(r[7] or 0),
                        "pct_diferenca": round(r[8], 1) if r[8] is not None else None,
                    }
                    for r in quebras_detalhe_rows
                ],
            },
            "serie_diaria": [
                {
                    "data": r[0].strftime("%Y-%m-%d") if r[0] else None,
                    "receita_total": float(r[1] or 0), "despesa_total": float(r[2] or 0), "saldo_liquido": float(r[3] or 0),
                    "mensalidade": float(r[4] or 0), "taxa_entrega": float(r[5] or 0),
                    "comprovante_residencia": float(r[6] or 0), "outras_receitas": float(r[7] or 0),
                }
                for r in serie_rows
            ],
            "comparativo_unidades": [
                {
                    "nome_associacao": r[0],
                    "receita_total": float(r[1] or 0), "despesa_total": float(r[2] or 0), "saldo_liquido": float(r[3] or 0),
                    "margem_pct": round(100.0 * (r[3] or 0) / r[1], 1) if r[1] else None,
                    "taxa_cobranca_pct": (
                        round(100.0 * cob_por_nome[r[0]][0] / cob_por_nome[r[0]][1], 1)
                        if r[0] in cob_por_nome and cob_por_nome[r[0]][1] else None
                    ),
                }
                for r in comparativo_rows if r[0]
            ],
        }

    # ── /moradores ───────────────────────────────────────────────────────

    async def get_moradores(self, unidade: str | None = None) -> dict:
        # Tela informacional (snapshot) -- nao usa o filtro global de periodo do
        # header, so' unidade. Crescimento sempre mostra a serie completa
        # disponivel (piso em _PISO_MES ja limita o inicio real).
        meses = _ultimos_meses_yyyymm(24, None)
        base_params = {"meses": meses}
        if self.empresa_id:
            base_params["empresa_id"] = self.empresa_id
        params, unidade_filter = self._params_unidade(base_params, unidade)
        ef = self._empresa_filter

        panorama = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(total_ativos),0), COALESCE(SUM(associados),0), COALESCE(SUM(dependentes),0),
                   COALESCE(SUM(visitantes),0), COALESCE(SUM(sem_internet),0), COALESCE(SUM(novos_mes),0)
            FROM panorama_moradores WHERE 1=1 {unidade_filter} {ef}
        """), params)).fetchone()

        cresc_rows = (await self.dw.execute(text(f"""
            SELECT mes, SUM(associados) FROM moradores_mensal WHERE mes = ANY(:meses) {unidade_filter} {ef}
            GROUP BY mes ORDER BY mes
        """), params)).fetchall()

        # meses_sem_pagar so' e' preenchido se ha' pagamento anterior (cutoff de
        # 6 meses sem pagar) -- lancamento foi em 03-2026, ainda nao existe
        # ninguem "parou de pagar ha 6 meses". Hoje a lista e' 100% quem nunca
        # pagou nenhuma mensalidade (ultimo_pagamento NULL), nao "churn" classico.
        churn_rows = (await self.dw.execute(text(f"""
            SELECT nome_completo, nome_associacao, meses_sem_pagar, ultimo_pagamento
            FROM churn_associados WHERE 1=1 {unidade_filter} {ef}
            ORDER BY ultimo_pagamento ASC NULLS FIRST, nome_completo LIMIT 15
        """), params)).fetchall()

        censo_rows = (await self.dw.execute(text(f"""
            SELECT rua, SUM(total), SUM(associados), SUM(visitantes), SUM(com_problemas), SUM(sem_internet)
            FROM censo_por_rua WHERE 1=1 {unidade_filter} {ef}
            GROUP BY rua ORDER BY SUM(total) DESC LIMIT 15
        """), params)).fetchall()

        # Ultimos 60 dias de entrada de visitantes (bar chart diario fino do spec)
        visitantes_dia_rows = (await self.dw.execute(text(f"""
            SELECT dia, SUM(novos_visitantes) FROM novos_visitantes_diario
            WHERE dia >= CURRENT_DATE - INTERVAL '60 days' {unidade_filter} {ef}
            GROUP BY dia ORDER BY dia
        """), params)).fetchall()

        # Qualidade de cadastro: dado de "agora", vem do OPERACIONAL (nao gold) --
        # decisao do spec §Achados: qualidade nao e' historico, e' estado atual.
        qual_unidade_filter = "AND a.name = :unidade" if unidade else ""
        qual_empresa_filter = "AND a.empresa_id = :empresa_id" if self.empresa_id else ""
        qual = (await self.session.execute(text(f"""
            SELECT
              COUNT(*) FILTER (WHERE r.type='member' AND (r.cpf IS NULL OR r.cpf='')) AS membros_sem_cpf,
              COUNT(*) FILTER (WHERE r.type='member') AS membros,
              COUNT(*) FILTER (WHERE r.phone_primary IS NULL OR r.phone_primary='') AS sem_telefone,
              COUNT(*) FILTER (WHERE r.address_cep IS NULL OR r.address_cep='') AS sem_cep,
              COUNT(*) AS total
            FROM residents r
            JOIN associations a ON a.id = r.association_id
            WHERE r.status = 'active' {qual_unidade_filter} {qual_empresa_filter}
        """), params)).fetchone()
        membros_sem_cpf, membros, sem_telefone, sem_cep, total_ativos = (
            qual[0] or 0, qual[1] or 0, qual[2] or 0, qual[3] or 0, qual[4] or 0,
        )

        return {
            "total": int(panorama[0] or 0), "associados": int(panorama[1] or 0),
            "dependentes": int(panorama[2] or 0), "visitantes": int(panorama[3] or 0),
            "sem_internet": int(panorama[4] or 0), "novos_mes": int(panorama[5] or 0),
            "novos_visitantes_dia": [
                {"label": r[0].strftime("%d/%m") if hasattr(r[0], "strftime") else str(r[0]), "value": int(r[1] or 0)}
                for r in visitantes_dia_rows
            ],
            "qualidade_cadastro": {
                "com_cpf_pct": round(100.0 * (membros - membros_sem_cpf) / membros, 1) if membros else None,
                "com_telefone_pct": round(100.0 * (total_ativos - sem_telefone) / total_ativos, 1) if total_ativos else None,
                "com_cep_pct": round(100.0 * (total_ativos - sem_cep) / total_ativos, 1) if total_ativos else None,
                "membros_sem_cpf": int(membros_sem_cpf),
                "sem_telefone": int(sem_telefone),
                "sem_cep": int(sem_cep),
            },
            "crescimento_serie": [
                {"label": self._mes_label(r[0]), "value": int(r[1] or 0)} for r in cresc_rows
            ],
            "churn": [
                {"nome": r[0], "associacao": r[1], "meses_sem_pagar": r[2], "ultimo_pagamento": r[3].isoformat() if r[3] else None}
                for r in churn_rows
            ],
            "por_rua": [
                {"rua": r[0], "total": int(r[1] or 0), "associados": int(r[2] or 0), "visitantes": int(r[3] or 0),
                 "com_problemas": int(r[4] or 0), "sem_internet": int(r[5] or 0)}
                for r in censo_rows
            ],
        }

    # ── /mensalidades ────────────────────────────────────────────────────

    async def get_mensalidades(self, unidade: str | None = None, periodo: str = "mes", ate: str | None = None) -> dict:
        meses, base_params = self._janela(periodo, ate)
        params, unidade_filter = self._params_unidade(base_params, unidade)
        ef = self._empresa_filter

        cob = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(pagas),0), COALESCE(SUM(total),0), COALESCE(SUM(vencidas),0),
                   COALESCE(SUM(acordos),0), COALESCE(SUM(valor_vencido),0)
            FROM taxa_cobranca WHERE to_char(mes,'YYYY-MM') = ANY(:meses) {unidade_filter} {ef}
        """), params)).fetchone()
        pagas, total, vencidas, acordos, valor_vencido = (cob[0] or 0, cob[1] or 0, cob[2] or 0, cob[3] or 0, cob[4] or 0)

        recuperacao = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(valor_recuperada),0), COALESCE(SUM(valor_nunca_recuperada),0),
                   COALESCE(SUM(valor_parcelamento),0), AVG(taxa_recuperacao_pct)
            FROM recuperacao_inadimplencia WHERE 1=1 {unidade_filter} {ef}
        """), params)).fetchone()

        devedores = (await self.dw.execute(text(f"""
            SELECT nome_completo, nome_associacao, tipo, rua, meses_atraso, valor_devido
            FROM relatorio_inadimplencia WHERE 1=1 {unidade_filter} {ef}
            ORDER BY valor_devido DESC LIMIT 15
        """), params)).fetchall()

        por_rua = (await self.dw.execute(text(f"""
            SELECT rua, SUM(total), SUM(pagas), SUM(vencidas), SUM(valor_total)
            FROM cobranca_por_rua WHERE to_char(mes,'YYYY-MM') = ANY(:meses) {unidade_filter} {ef}
            GROUP BY rua ORDER BY SUM(valor_total) DESC LIMIT 15
        """), params)).fetchall()

        return {
            "pagas": int(pagas), "total": int(total), "vencidas": int(vencidas), "acordos": int(acordos),
            "valor_vencido": float(valor_vencido),
            "taxa_cobranca_pct": round(100.0 * pagas / total, 1) if total else None,
            "recuperacao": {
                "valor_recuperada": float(recuperacao[0] or 0), "valor_nunca_recuperada": float(recuperacao[1] or 0),
                "valor_parcelamento": float(recuperacao[2] or 0),
                "taxa_recuperacao_pct": round(recuperacao[3], 1) if recuperacao and recuperacao[3] is not None else None,
            },
            "devedores": [
                {"nome": r[0], "associacao": r[1], "tipo": r[2], "rua": r[3], "meses_atraso": r[4], "valor_devido": float(r[5] or 0)}
                for r in devedores
            ],
            "por_rua": [
                {"rua": r[0], "total": int(r[1] or 0), "pagas": int(r[2] or 0), "vencidas": int(r[3] or 0), "valor_total": float(r[4] or 0)}
                for r in por_rua
            ],
        }

    # ── /pacotes ─────────────────────────────────────────────────────────

    async def get_pacotes(self, unidade: str | None = None, periodo: str = "mes", ate: str | None = None) -> dict:
        meses, base_params = self._janela(periodo, ate)
        params, unidade_filter = self._params_unidade(base_params, unidade)
        ef = self._empresa_filter

        enc = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(recebidos),0), COALESCE(SUM(entregues),0), COALESCE(SUM(devolvidos),0),
                   COALESCE(SUM(pendentes),0), AVG(media_dias_permanencia)
            FROM encomendas_mensal WHERE mes = ANY(:meses) {unidade_filter} {ef}
        """), params)).fetchone()

        paradas = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(paradas_3d),0), COALESCE(SUM(paradas_7d),0)
            FROM encomendas_paradas WHERE 1=1 {unidade_filter} {ef}
        """), params)).fetchone()

        ranking = (await self.dw.execute(text(f"""
            SELECT nome_morador, tipo_morador, rua, nome_associacao, total_encomendas, media_horas_espera, entregues, pendentes_agora
            FROM ranking_encomendas_morador WHERE 1=1 {unidade_filter} {ef}
            ORDER BY total_encomendas DESC LIMIT 15
        """), params)).fetchall()

        por_rua = (await self.dw.execute(text(f"""
            SELECT rua, SUM(total), SUM(moradores_distintos), AVG(media_espera)
            FROM encomendas_por_rua WHERE 1=1 {unidade_filter} {ef}
            GROUP BY rua ORDER BY SUM(total) DESC LIMIT 15
        """), params)).fetchall()

        return {
            "recebidos": int(enc[0] or 0), "entregues": int(enc[1] or 0), "devolvidos": int(enc[2] or 0),
            "pendentes": int(enc[3] or 0), "tempo_medio_dias": round(enc[4], 1) if enc[4] is not None else None,
            "paradas_3d": int(paradas[0] or 0), "paradas_7d": int(paradas[1] or 0),
            "ranking_moradores": [
                {"nome": r[0], "tipo": r[1], "rua": r[2], "associacao": r[3], "total": int(r[4] or 0),
                 "media_horas_espera": round(r[5], 1) if r[5] is not None else None, "entregues": int(r[6] or 0), "pendentes_agora": int(r[7] or 0)}
                for r in (ranking or [])
            ],
            "por_rua": [
                {"rua": r[0], "total": int(r[1] or 0), "moradores_distintos": int(r[2] or 0),
                 "media_espera_horas": round(r[3], 1) if r[3] is not None else None}
                for r in por_rua
            ],
        }

    # ── /os (ordens de servico) ──────────────────────────────────────────

    async def get_os(self, unidade: str | None = None, periodo: str = "mes", ate: str | None = None) -> dict:
        meses, base_params = self._janela(periodo, ate)
        params, unidade_filter = self._params_unidade(base_params, unidade)
        ef = self._empresa_filter

        os_row = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(abertas),0), COALESCE(SUM(fechadas),0), COALESCE(SUM(pendentes),0)
            FROM ordens_servico_mensal WHERE mes = ANY(:meses) {unidade_filter} {ef}
        """), params)).fetchone()

        serie_rows = (await self.dw.execute(text(f"""
            SELECT mes, SUM(abertas), SUM(fechadas) FROM ordens_servico_mensal
            WHERE mes = ANY(:meses) {unidade_filter} {ef} GROUP BY mes ORDER BY mes
        """), params)).fetchall()

        sla_rows = (await self.dw.execute(text(f"""
            SELECT tipo_morador, SUM(entregues), AVG(media_horas_espera)
            FROM sla_por_tipo WHERE 1=1 {unidade_filter} {ef}
            GROUP BY tipo_morador
        """), params)).fetchall()

        return {
            "abertas": int(os_row[0] or 0), "fechadas": int(os_row[1] or 0), "pendentes": int(os_row[2] or 0),
            "serie": [
                {"label": self._mes_label(r[0]), "abertas": int(r[1] or 0), "fechadas": int(r[2] or 0)} for r in serie_rows
            ],
            "sla_por_tipo": [
                {"tipo": r[0], "entregues": int(r[1] or 0), "media_horas_espera": round(r[2], 1) if r[2] is not None else None}
                for r in sla_rows
            ],
        }

    # ── /operadores ──────────────────────────────────────────────────────

    async def get_operadores(self, unidade: str | None = None, periodo: str = "mes", ate: str | None = None) -> dict:
        meses, base_params = self._janela(periodo, ate)
        params, unidade_filter = self._params_unidade(base_params, unidade)
        ef = self._empresa_filter

        ranking = (await self.dw.execute(text(f"""
            SELECT nome_operador, AVG(score), SUM(estornos), SUM(tarefas_atraso), SUM(entregas)
            FROM score_operador_mensal WHERE mes = ANY(:meses) {unidade_filter} {ef}
            GROUP BY nome_operador ORDER BY AVG(score) DESC
        """), params)).fetchall()

        desempenho = (await self.dw.execute(text(f"""
            SELECT nome_completo, SUM(sessoes), SUM(encomendas_recebidas), SUM(encomendas_entregues)
            FROM desempenho_operador WHERE 1=1 {unidade_filter} {ef}
            GROUP BY nome_completo ORDER BY SUM(sessoes) DESC LIMIT 15
        """), params)).fetchall()

        feedback = (await self.dw.execute(text(f"""
            SELECT nome_operador, SUM(feedback_qtd) FROM feedback_operador WHERE 1=1 {unidade_filter} {ef}
            GROUP BY nome_operador ORDER BY SUM(feedback_qtd) DESC
        """), params)).fetchall()

        return {
            "score_medio": round(sum(r[1] or 0 for r in ranking) / len(ranking), 1) if ranking else None,
            "ranking": [
                {"nome": r[0], "score": round(r[1], 1) if r[1] is not None else None, "estornos": int(r[2] or 0),
                 "tarefas_atraso": int(r[3] or 0), "entregas": int(r[4] or 0)}
                for r in ranking
            ],
            "desempenho": [
                {"nome": r[0], "sessoes": int(r[1] or 0), "encomendas_recebidas": int(r[2] or 0), "encomendas_entregues": int(r[3] or 0)}
                for r in desempenho
            ],
            "feedback": [{"nome": r[0], "qtd": int(r[1] or 0)} for r in feedback],
        }

    # ── /senso ───────────────────────────────────────────────────────────

    async def get_senso(self, unidade: str | None = None, periodo: str = "mes", ate: str | None = None) -> dict:
        meses, base_params = self._janela(periodo, ate)
        params, unidade_filter = self._params_unidade(base_params, unidade)
        ef = self._empresa_filter

        rows = (await self.dw.execute(text(f"""
            SELECT rua, SUM(total), SUM(associados), SUM(visitantes), SUM(com_pragas), SUM(sem_internet), SUM(com_problemas)
            FROM censo_por_rua WHERE 1=1 {unidade_filter} {ef}
            GROUP BY rua ORDER BY SUM(total) DESC
        """), params)).fetchall()

        totais = (await self.dw.execute(text(f"""
            SELECT COALESCE(SUM(total),0), COALESCE(SUM(com_pragas),0), COALESCE(SUM(sem_internet),0), COALESCE(SUM(com_problemas),0)
            FROM censo_por_rua WHERE 1=1 {unidade_filter} {ef}
        """), params)).fetchone()

        return {
            "total_moradores": int(totais[0] or 0), "com_pragas": int(totais[1] or 0),
            "sem_internet": int(totais[2] or 0), "com_problemas": int(totais[3] or 0),
            "por_rua": [
                {"rua": r[0], "total": int(r[1] or 0), "associados": int(r[2] or 0), "visitantes": int(r[3] or 0),
                 "com_pragas": int(r[4] or 0), "sem_internet": int(r[5] or 0), "com_problemas": int(r[6] or 0)}
                for r in rows
            ],
        }
