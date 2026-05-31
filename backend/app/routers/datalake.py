from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.tenant import require_admin, CurrentUser
from app.database import get_session
from app.services.datalake_service import run_full_etl

router = APIRouter(prefix="/datalake", tags=["Data Lake"])
settings = get_settings()


@router.post("/run", summary="ETL pipeline (cron — incremental automático)")
async def trigger_etl_cron(
    x_cron_secret: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not x_cron_secret or x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=401, detail="Cron secret inválido.")
    if not settings.r2_account_id:
        raise HTTPException(status_code=503, detail="R2 não configurado.")
    return await run_full_etl(session, triggered_by="cron")


@router.post("/run/manual", summary="Disparar ETL manualmente (admin)")
async def trigger_etl_manual(
    force_full: bool = False,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_admin),
) -> dict:
    if not settings.r2_account_id:
        raise HTTPException(status_code=503, detail="R2 não configurado.")
    return await run_full_etl(session, force_full=force_full, triggered_by=current.role)


@router.get("/runs", summary="Histórico de execuções do pipeline")
async def list_runs(
    limit: int = Query(default=20, le=100),
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_admin),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT id, run_date, mode, status, started_at, completed_at,
               duration_s, bronze_rows, silver_rows, gold_files,
               neon_kb, error_msg, triggered_by
        FROM etl_runs
        ORDER BY started_at DESC
        LIMIT :lim
    """), {"lim": limit})).fetchall()
    return [dict(r._mapping) for r in rows]


@router.get("/runs/{run_id}", summary="Detalhe de uma execução com tasks")
async def get_run(
    run_id: str,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_admin),
) -> dict:
    run = (await session.execute(text("""
        SELECT id, run_date, mode, status, started_at, completed_at,
               duration_s, bronze_rows, silver_rows, gold_files,
               neon_kb, error_msg, triggered_by
        FROM etl_runs WHERE id = :rid
    """), {"rid": run_id})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run não encontrado.")

    tasks = (await session.execute(text("""
        SELECT task_name, status, started_at, completed_at,
               duration_s, rows_in, rows_out, detail
        FROM etl_task_runs
        WHERE run_id = :rid
        ORDER BY started_at ASC
    """), {"rid": run_id})).fetchall()

    return {
        **dict(run._mapping),
        "tasks": [dict(t._mapping) for t in tasks],
    }


@router.get("/status", summary="Status dos arquivos no R2 + última execução")
async def etl_status(
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not settings.r2_account_id:
        return {"configured": False, "message": "R2 não configurado"}

    import boto3
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )

    def _list(prefix: str) -> list[dict]:
        try:
            resp = client.list_objects_v2(Bucket=settings.r2_bucket_name, Prefix=prefix)
            return [
                {"key": o["Key"], "size_kb": round(o["Size"]/1024, 1),
                 "last_modified": o["LastModified"].isoformat()}
                for o in resp.get("Contents", [])
            ]
        except Exception:
            return []

    # Ultima execucao do banco
    last_run_db = (await session.execute(text("""
        SELECT id, run_date, mode, status, started_at, completed_at,
               duration_s, bronze_rows, silver_rows, gold_files, neon_kb, error_msg
        FROM etl_runs ORDER BY started_at DESC LIMIT 1
    """))).fetchone()

    # Metadata do R2
    try:
        import json, io
        meta_obj = client.get_object(Bucket=settings.r2_bucket_name, Key="_metadata/last_run.json")
        metadata = json.loads(meta_obj["Body"].read())
    except Exception:
        metadata = {}

    return {
        "configured":   True,
        "bucket":       settings.r2_bucket_name,
        "metadata":     metadata,
        "last_run_db":  dict(last_run_db._mapping) if last_run_db else None,
        "gold_files":   _list("gold/latest/"),
        "bronze_tables":_list("bronze/current/"),
        "silver_today": _list(f"silver/{__import__('datetime').date.today().isoformat()}/"),
    }
