"""Dispatcher dos crons nativos (ver docs/superpowers/plans/2026-09-12-migracao-aprxm-execucao.md, Fase B).

Nao reimplementa nenhuma logica: cada job abaixo e a mesma funcao chamada
pela rota HTTP correspondente (mantida so para disparo manual/debug).

Uso: python -m app.jobs.run_cron <job>
Jobs: vacuum | mensalidade-generate | mensalidade-overdue | crm-scoring |
      demands-reminders | daily-tasks-reminders
"""
import asyncio
import sys

from app.database import AsyncSessionLocal


async def _vacuum() -> dict:
    from app.routers.ti import run_vacuum_job
    return await run_vacuum_job()


async def _mensalidade_generate(session) -> dict:
    from app.routers.mensalidades import cron_generate_job
    return await cron_generate_job(session)


async def _mensalidade_overdue(session) -> dict:
    from app.routers.mensalidades import cron_check_overdue_job
    return await cron_check_overdue_job(session)


async def _crm_scoring(session) -> dict:
    from app.services.scoring_service import run_scoring_all
    return await run_scoring_all(session)


async def _sync_pix(session) -> dict:
    from app.routers.admin import cron_sync_pix_job
    return await cron_sync_pix_job(session)


async def _demands_reminders() -> dict:
    from app.routers.demands import trigger_reminders_job
    return await trigger_reminders_job()


async def _daily_tasks_reminders() -> dict:
    from app.routers.daily_tasks import trigger_task_reminders_job
    return await trigger_task_reminders_job()


# Jobs sem sessao propria (abrem a sessao internamente, via AsyncSessionLocal)
NO_SESSION_JOBS = {
    "vacuum": _vacuum,
    "demands-reminders": _demands_reminders,
    "daily-tasks-reminders": _daily_tasks_reminders,
}

# Jobs que recebem a sessao de fora
SESSION_JOBS = {
    "mensalidade-generate": _mensalidade_generate,
    "mensalidade-overdue": _mensalidade_overdue,
    "crm-scoring": _crm_scoring,
    "sync-pix": _sync_pix,
}


async def main(job: str) -> int:
    try:
        if job in NO_SESSION_JOBS:
            result = await NO_SESSION_JOBS[job]()
        elif job in SESSION_JOBS:
            async with AsyncSessionLocal() as session:
                result = await SESSION_JOBS[job](session)
        else:
            all_jobs = sorted({*NO_SESSION_JOBS, *SESSION_JOBS})
            print(f"Job desconhecido: {job!r}. Válidos: {', '.join(all_jobs)}", file=sys.stderr)
            return 2
        print(result)
        return 0
    except Exception as e:
        print(f"Job {job!r} falhou: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Uso: python -m app.jobs.run_cron <job>", file=sys.stderr)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
