"""Métricas de negócio (Prometheus), mesmo padrão já usado no erp_itp
(apps/backend/src/metrics/metrics.service.ts): gauges agregados em TODAS
as associações, refrescados a cada 60s via loop de fundo -- não bate no
banco a cada scrape do Prometheus (que roda de 15 em 15s).

Pedido do usuário (2026-09-14): APRXM "tem bastante movimentação" e
precisava dos mesmos indicadores de negócio que o erp_itp já tem no
Grafana (dashboard KPI BUSINESS).
"""
import asyncio
import logging

from prometheus_client import CollectorRegistry, Gauge

logger = logging.getLogger("aprxm.metrics")

registry = CollectorRegistry()

associacoes_ativas = Gauge(
    "aprxm_associacoes_ativas", "Associações ativas no sistema", registry=registry)
moradores_ativos = Gauge(
    "aprxm_moradores_ativos", "Moradores ativos (todas as associações)", registry=registry)
moradores_cadastrados_hoje = Gauge(
    "aprxm_moradores_cadastrados_hoje", "Moradores cadastrados hoje", registry=registry)
encomendas_hoje = Gauge(
    "aprxm_encomendas_hoje", "Encomendas recebidas hoje", registry=registry)
encomendas_pendentes = Gauge(
    "aprxm_encomendas_pendentes", "Encomendas aguardando retirada/notificação (status received/notified)", registry=registry)
os_abertas = Gauge(
    "aprxm_os_abertas", "Ordens de serviço pendentes ou em andamento", registry=registry)
os_criadas_hoje = Gauge(
    "aprxm_os_criadas_hoje", "Ordens de serviço criadas hoje", registry=registry)
receita_hoje_reais = Gauge(
    "aprxm_receita_hoje_reais", "Receita (transações de entrada) lançada hoje, em reais", registry=registry)

_REFRESH_INTERVAL_S = 60


async def _atualizar_metricas_negocio() -> None:
    from sqlalchemy import text

    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        assocs, mor_ativos, mor_hoje, enc_hoje, enc_pend, os_ab, os_hoje, receita = (
            (await session.execute(text(q))).scalar() or 0
            for q in [
                "SELECT count(*) FROM associations WHERE is_active = TRUE",
                "SELECT count(*) FROM residents WHERE status = 'active'",
                "SELECT count(*) FROM residents WHERE created_at::date = CURRENT_DATE",
                "SELECT count(*) FROM packages WHERE received_at::date = CURRENT_DATE",
                "SELECT count(*) FROM packages WHERE status IN ('received', 'notified')",
                "SELECT count(*) FROM service_orders WHERE status IN ('pending', 'in_progress')",
                "SELECT count(*) FROM service_orders WHERE created_at::date = CURRENT_DATE",
                "SELECT COALESCE(sum(amount), 0) FROM transactions WHERE type = 'income' AND created_at::date = CURRENT_DATE",
            ]
        )

    associacoes_ativas.set(assocs)
    moradores_ativos.set(mor_ativos)
    moradores_cadastrados_hoje.set(mor_hoje)
    encomendas_hoje.set(enc_hoje)
    encomendas_pendentes.set(enc_pend)
    os_abertas.set(os_ab)
    os_criadas_hoje.set(os_hoje)
    receita_hoje_reais.set(float(receita))


async def _loop_metricas_negocio() -> None:
    while True:
        try:
            await _atualizar_metricas_negocio()
        except Exception as e:
            logger.error("[ERROR] Falha ao atualizar metricas de negocio: %s", e)
        await asyncio.sleep(_REFRESH_INTERVAL_S)


def start_metrics_loop() -> asyncio.Task:
    return asyncio.create_task(_loop_metricas_negocio())
