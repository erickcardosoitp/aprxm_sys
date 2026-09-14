"""Métricas de negócio (Prometheus), mesmo padrão já usado no erp_itp
(apps/backend/src/metrics/metrics.service.ts): agregados em TODAS as
associações, refrescados a cada 60s via loop de fundo -- não bate no
banco a cada scrape do Prometheus (que roda de 15 em 15s).

Duas categorias, por design:

1. **Totais cumulativos** (`_total`): contagem/soma desde sempre (nunca
   diminui), pra ser consultada no Grafana via `increase(metric[$__range])`.
   Isso deixa o período (hoje, 24h, 7 dias, mês, qualquer range
   arbitrário) **inteiramente a cargo do seletor de tempo do Grafana**,
   sem hardcode de "hoje"/"CURRENT_DATE" no lado do backend -- achado
   real (2026-09-14): a primeira versão desta feature usava
   `CURRENT_DATE` direto na query, então os paineis "hoje"/"24h" no
   Grafana ignoravam qualquer filtro de tempo que o usuário escolhesse
   ali, sempre mostrando o dia corrente do servidor. Mesmo funcionando
   como `Gauge` do lado do `prometheus_client` (a lib não tem um tipo
   "counter que aceita `.set()`"), o valor em si só cresce -- o
   `increase()` do PromQL funciona igual em cima disso.
2. **Snapshots de estado atual** (sem sufixo `_total`): quantidade
   *agora*, não windowed -- correto como gauge de verdade (ex.: quantas
   encomendas estão paradas agora, não quantas ficaram paradas "hoje").
   Vários destes são indicadores críticos de risco operacional, não só
   contadores informativos.
"""
import asyncio
import logging

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

logger = logging.getLogger("aprxm.metrics")

registry = CollectorRegistry()

# ── HTTP (duração/contagem por rota) — base do Apdex no Grafana ────────────
# Mesmo padrao do erp_itp (metrics.service.ts: httpDuration/httpCounter),
# buckets pensados pro threshold de Apdex T=0.5s (satisfeito <=T, tolerando
# <=4T=2s). Labels por "route" (path template, ex: /residents/{id}), nao
# path cru -- evita cardinalidade alta (um UUID por requisicao viraria uma
# serie nova cada vez).
http_request_duration_seconds = Histogram(
    "aprxm_http_request_duration_seconds",
    "Duração das requisições HTTP (segundos) — base pro Apdex no Grafana",
    ["method", "route", "status_code"],
    buckets=[0.05, 0.1, 0.2, 0.5, 1, 2, 4, 8],
    registry=registry,
)
http_requests_total = Counter(
    "aprxm_http_requests_total",
    "Total de requisições HTTP, por rota e status",
    ["method", "route", "status_code"],
    registry=registry,
)

# ── Eventos (incrementados no código, não no loop de refresh) ──────────────
# Diferente dos gauges abaixo (recalculados do zero via SQL a cada 60s),
# estes são Counters incrementados no momento exato do evento -- não dá pra
# reconstruir "tentativas de token invalido" ou "fallback do Groq" varrendo
# o estado atual do banco, só contando conforme acontece.
tokens_isencao_invalidos_total = Counter(
    "aprxm_tokens_isencao_invalidos_total", "Tentativas de uso de token de isenção de taxa inválido/expirado", registry=registry)
webauthn_falhas_total = Counter(
    "aprxm_webauthn_falhas_total", "Falhas de verificação WebAuthn (registro ou autenticação)", registry=registry)
simplifica_interacoes_total = Counter(
    "aprxm_simplifica_interacoes_total", "Interações com o agente Simplifica (chat)", registry=registry)
groq_fallback_total = Counter(
    "aprxm_groq_fallback_total", "Vezes que o chat caiu no fallback por regex (Groq indisponível/falhou)", registry=registry)
push_enviados_total = Counter(
    "aprxm_push_enviados_total", "Notificações push enviadas com sucesso", registry=registry)
push_falhas_total = Counter(
    "aprxm_push_falhas_total", "Falhas no envio de notificação push", registry=registry)

# ── Totais cumulativos (consultar via increase() no Grafana) ───────────────
moradores_cadastrados_total = Gauge(
    "aprxm_moradores_cadastrados_total", "Total histórico de moradores cadastrados (increase() pro período)", registry=registry)
encomendas_recebidas_total = Gauge(
    "aprxm_encomendas_recebidas_total", "Total histórico de encomendas recebidas (increase() pro período)", registry=registry)
os_criadas_total = Gauge(
    "aprxm_os_criadas_total", "Total histórico de ordens de serviço criadas (increase() pro período)", registry=registry)
receita_reais_total = Gauge(
    "aprxm_receita_reais_total", "Receita acumulada (transações de entrada) em reais (increase() pro período)", registry=registry)
encomendas_entregues_total = Gauge(
    "aprxm_encomendas_entregues_total", "Total histórico de encomendas entregues (increase() pro período)", registry=registry)
os_resolvidas_total = Gauge(
    "aprxm_os_resolvidas_total", "Total histórico de ordens de serviço resolvidas (increase() pro período)", registry=registry)

# ── Snapshots de estado atual ───────────────────────────────────────────────
associacoes_ativas = Gauge(
    "aprxm_associacoes_ativas", "Associações ativas no sistema", registry=registry)
moradores_ativos = Gauge(
    "aprxm_moradores_ativos", "Moradores ativos (todas as associações)", registry=registry)
moradores_suspensos = Gauge(
    "aprxm_moradores_suspensos", "Moradores com status suspenso -- indicador crítico de inadimplência/disciplina", registry=registry)
encomendas_pendentes = Gauge(
    "aprxm_encomendas_pendentes", "Encomendas aguardando retirada/notificação (status received/notified)", registry=registry)
encomendas_paradas_15d = Gauge(
    "aprxm_encomendas_paradas_15d", "Encomendas recebidas há mais de 15 dias e ainda não entregues -- indicador crítico de backlog", registry=registry)
os_abertas = Gauge(
    "aprxm_os_abertas", "Ordens de serviço pendentes ou em andamento", registry=registry)
mensalidades_vencidas = Gauge(
    "aprxm_mensalidades_vencidas", "Mensalidades com status overdue -- indicador crítico de saúde financeira", registry=registry)
caixas_abertas = Gauge(
    "aprxm_caixas_abertas", "Sessões de caixa com status open -- indicador crítico de risco operacional (caixa esquecido aberto)", registry=registry)

# ── Experiência do usuário / operação ───────────────────────────────────────
operadores_ativos_7d = Gauge(
    "aprxm_operadores_ativos_7d", "Usuários (operadores) com login nos últimos 7 dias -- adoção real do sistema", registry=registry)
tempo_medio_entrega_horas = Gauge(
    "aprxm_tempo_medio_entrega_horas", "Tempo médio entre recebimento e entrega de encomenda, últimos 30 dias (horas) -- experiência do morador", registry=registry)
tempo_medio_resolucao_os_horas = Gauge(
    "aprxm_tempo_medio_resolucao_os_horas", "Tempo médio de resolução de O.S., últimos 30 dias (horas) -- SLA de atendimento", registry=registry)

# ── Financeiro avançado ─────────────────────────────────────────────────────
taxa_inadimplencia_pct = Gauge(
    "aprxm_taxa_inadimplencia_pct", "% de mensalidades vencidas sobre o total de mensalidades geradas", registry=registry)
ticket_medio_reais = Gauge(
    "aprxm_ticket_medio_reais", "Valor médio por transação de entrada, últimos 30 dias (reais)", registry=registry)
sangrias_valor_30d_reais = Gauge(
    "aprxm_sangrias_valor_30d_reais", "Valor total de sangrias de caixa, últimos 30 dias (reais)", registry=registry)
sangrias_qtd_30d = Gauge(
    "aprxm_sangrias_qtd_30d", "Quantidade de sangrias de caixa, últimos 30 dias", registry=registry)
quebras_caixa_media_30d_reais = Gauge(
    "aprxm_quebras_caixa_media_30d_reais", "Diferença média (quebra de caixa) nas sessões fechadas, últimos 30 dias (reais) -- indicador crítico de risco", registry=registry)
tempo_medio_sessao_caixa_horas = Gauge(
    "aprxm_tempo_medio_sessao_caixa_horas", "Tempo médio entre abertura e fechamento de sessão de caixa, últimos 30 dias (horas)", registry=registry)
taxa_entrega_cobrada_pct = Gauge(
    "aprxm_taxa_entrega_cobrada_pct", "% de encomendas entregues com cobrança de taxa, últimos 30 dias", registry=registry)

# ── Comunidade avançado ──────────────────────────────────────────────────────
moradores_convidados = Gauge(
    "aprxm_moradores_convidados", "Moradores tipo 'guest' (convidado, ainda não confirmado como membro)", registry=registry)
solicitacoes_cadastro_pendentes = Gauge(
    "aprxm_solicitacoes_cadastro_pendentes", "Solicitações de atualização cadastral aguardando revisão", registry=registry)

# ── Segurança e integrações ──────────────────────────────────────────────────
webauthn_dispositivos = Gauge(
    "aprxm_webauthn_dispositivos", "Dispositivos WebAuthn (login biométrico) cadastrados -- adoção", registry=registry)
push_dispositivos = Gauge(
    "aprxm_push_dispositivos", "Dispositivos com notificação push habilitada -- adoção", registry=registry)
pix_nao_conciliados = Gauge(
    "aprxm_pix_nao_conciliados", "Transações PIX importadas ainda não conciliadas -- indicador de risco de sincronização", registry=registry)

# ── Operação avançada ─────────────────────────────────────────────────────
os_urgentes_abertas = Gauge(
    "aprxm_os_urgentes_abertas", "Ordens de serviço prioridade alta/crítica ainda pendentes ou em andamento -- crítico", registry=registry)
tempo_medio_primeira_resposta_os_horas = Gauge(
    "aprxm_tempo_medio_primeira_resposta_os_horas", "Tempo médio até o primeiro comentário em O.S., últimos 30 dias (horas)", registry=registry)
etl_ultima_duracao_segundos = Gauge(
    "aprxm_etl_ultima_duracao_segundos", "Duração da última execução do ETL (segundos)", registry=registry)

_REFRESH_INTERVAL_S = 60

_QUERIES = [
    # (gauge, sql)
    (moradores_cadastrados_total, "SELECT count(*) FROM residents"),
    (encomendas_recebidas_total, "SELECT count(*) FROM packages"),
    (os_criadas_total, "SELECT count(*) FROM service_orders"),
    (receita_reais_total, "SELECT COALESCE(sum(amount), 0) FROM transactions WHERE type = 'income'"),
    (associacoes_ativas, "SELECT count(*) FROM associations WHERE is_active = TRUE"),
    (moradores_ativos, "SELECT count(*) FROM residents WHERE status = 'active'"),
    (moradores_suspensos, "SELECT count(*) FROM residents WHERE status = 'suspended'"),
    (encomendas_pendentes, "SELECT count(*) FROM packages WHERE status IN ('received', 'notified')"),
    (encomendas_paradas_15d, "SELECT count(*) FROM packages WHERE status IN ('received', 'notified') AND received_at < NOW() - INTERVAL '15 days'"),
    (os_abertas, "SELECT count(*) FROM service_orders WHERE status IN ('pending', 'in_progress')"),
    (mensalidades_vencidas, "SELECT count(*) FROM mensalidades WHERE status = 'overdue'"),
    (caixas_abertas, "SELECT count(*) FROM cash_sessions WHERE status = 'open'"),
    (encomendas_entregues_total, "SELECT count(*) FROM packages WHERE delivered_at IS NOT NULL"),
    (os_resolvidas_total, "SELECT count(*) FROM service_orders WHERE resolved_at IS NOT NULL"),
    (operadores_ativos_7d, "SELECT count(*) FROM users WHERE last_login_at > NOW() - INTERVAL '7 days'"),
    (tempo_medio_entrega_horas,
     "SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (delivered_at - received_at))) / 3600, 0) "
     "FROM packages WHERE delivered_at IS NOT NULL AND delivered_at > NOW() - INTERVAL '30 days'"),
    (tempo_medio_resolucao_os_horas,
     "SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) / 3600, 0) "
     "FROM service_orders WHERE resolved_at IS NOT NULL AND resolved_at > NOW() - INTERVAL '30 days'"),

    # Financeiro avançado
    (taxa_inadimplencia_pct,
     "SELECT CASE WHEN count(*) = 0 THEN 0 ELSE "
     "100.0 * count(*) FILTER (WHERE status = 'overdue') / count(*) END FROM mensalidades"),
    (ticket_medio_reais,
     "SELECT COALESCE(AVG(amount), 0) FROM transactions "
     "WHERE type = 'income' AND created_at > NOW() - INTERVAL '30 days'"),
    (sangrias_valor_30d_reais,
     "SELECT COALESCE(sum(amount), 0) FROM transactions "
     "WHERE type = 'sangria' AND created_at > NOW() - INTERVAL '30 days'"),
    (sangrias_qtd_30d,
     "SELECT count(*) FROM transactions WHERE type = 'sangria' AND created_at > NOW() - INTERVAL '30 days'"),
    (quebras_caixa_media_30d_reais,
     "SELECT COALESCE(AVG(quebra_caixa), 0) FROM cash_sessions "
     "WHERE closed_at IS NOT NULL AND closed_at > NOW() - INTERVAL '30 days' AND quebra_caixa IS NOT NULL"),
    (tempo_medio_sessao_caixa_horas,
     "SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - opened_at))) / 3600, 0) FROM cash_sessions "
     "WHERE closed_at IS NOT NULL AND closed_at > NOW() - INTERVAL '30 days'"),
    (taxa_entrega_cobrada_pct,
     "SELECT CASE WHEN count(*) = 0 THEN 0 ELSE "
     "100.0 * count(*) FILTER (WHERE has_delivery_fee = TRUE) / count(*) END FROM packages "
     "WHERE delivered_at IS NOT NULL AND delivered_at > NOW() - INTERVAL '30 days'"),

    # Comunidade avançado
    (moradores_convidados, "SELECT count(*) FROM residents WHERE type = 'guest'"),
    (solicitacoes_cadastro_pendentes, "SELECT count(*) FROM resident_update_requests WHERE status = 'pending'"),

    # Segurança e integrações
    (webauthn_dispositivos, "SELECT count(*) FROM webauthn_credentials"),
    (push_dispositivos, "SELECT count(*) FROM push_subscriptions"),
    (pix_nao_conciliados, "SELECT count(*) FROM bank_statements WHERE conciliado = FALSE"),

    # Operação avançada
    (os_urgentes_abertas,
     "SELECT count(*) FROM service_orders WHERE priority IN ('high', 'critical') AND status IN ('pending', 'in_progress')"),
    (tempo_medio_primeira_resposta_os_horas,
     "SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (primeira.ts - so.created_at))) / 3600, 0) "
     "FROM service_orders so "
     "JOIN LATERAL (SELECT MIN(created_at) AS ts FROM service_order_comments WHERE service_order_id = so.id) primeira ON TRUE "
     "WHERE primeira.ts IS NOT NULL AND so.created_at > NOW() - INTERVAL '30 days'"),
    (etl_ultima_duracao_segundos,
     "SELECT COALESCE((SELECT duration_s FROM etl_runs ORDER BY started_at DESC LIMIT 1), 0)"),
]


async def _atualizar_metricas_negocio() -> None:
    from sqlalchemy import text

    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        for gauge, sql in _QUERIES:
            valor = (await session.execute(text(sql))).scalar() or 0
            gauge.set(float(valor))


async def _loop_metricas_negocio() -> None:
    while True:
        try:
            await _atualizar_metricas_negocio()
        except Exception as e:
            logger.error("[ERROR] Falha ao atualizar metricas de negocio: %s", e)
        await asyncio.sleep(_REFRESH_INTERVAL_S)


def start_metrics_loop() -> asyncio.Task:
    return asyncio.create_task(_loop_metricas_negocio())
