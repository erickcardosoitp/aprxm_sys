"""ETL nativo — invocado pelo cron do sistema operacional (ver docs/superpowers/plans/2026-09-12-migracao-aprxm-execucao.md, Fase A).

Nao reimplementa nada do pipeline: so troca o disparo de HTTP (Vercel cron
-> /api/v1/datalake/run) por invocacao direta de processo.

Uso: python -m app.jobs.run_etl
"""
import asyncio
import sys

from app.database import AsyncSessionLocal
from app.services.datalake_service import run_full_etl


async def main() -> int:
    async with AsyncSessionLocal() as session:
        try:
            result = await run_full_etl(session, triggered_by="cron-nativo")
            print(result)
            # run_full_etl captura suas proprias excecoes fatais e retorna
            # {"status": "failed", ...} em vez de relancar (ja envia alerta
            # por e-mail e grava em etl_runs por conta propria) - sem este
            # check, exit_code sempre era 0 aqui, mascarando falhas reais no
            # tarefas-timing/aprxm-etl.jsonl (achado real: 2026-09-14, ciclo
            # das 12h falhou de verdade mas ficou registrado como sucesso).
            return 1 if result.get("status") == "failed" else 0
        except Exception as e:
            print(f"ETL falhou: {e}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
