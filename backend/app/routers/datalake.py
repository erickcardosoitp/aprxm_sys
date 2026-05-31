from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.tenant import require_admin, CurrentUser, get_current_user
from app.database import get_session
from app.services.datalake_service import run_full_etl

router = APIRouter(prefix="/datalake", tags=["Data Lake"])
settings = get_settings()


@router.post("/run", summary="Executar ETL (cron — incremental automático)")
async def trigger_etl_cron(
    x_cron_secret: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Chamado pelo Vercel Cron. 1ª execução = full, demais = incremental."""
    if not x_cron_secret or x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=401, detail="Cron secret inválido.")
    if not settings.r2_account_id:
        raise HTTPException(status_code=503, detail="R2 não configurado.")
    return await run_full_etl(session)


@router.post("/run/manual", summary="Executar ETL manualmente (admin)")
async def trigger_etl_manual(
    force_full: bool = False,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_admin),
) -> dict:
    """
    Disparo manual por admin autenticado.
    force_full=true: ignora metadata e faz carga completa (útil após migração).
    """
    if not settings.r2_account_id:
        raise HTTPException(status_code=503, detail="R2 não configurado.")
    return await run_full_etl(session, force_full=force_full)


@router.get("/status", summary="Status da última exportação no R2")
async def etl_status(
    current: CurrentUser = Depends(require_admin),
) -> dict:
    """Lista arquivos gold/ no bucket e quando foi o último ETL."""
    import boto3
    from botocore.exceptions import ClientError

    if not settings.r2_account_id:
        return {"configured": False, "message": "R2 não configurado"}

    try:
        client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
        )
        gold = client.list_objects_v2(Bucket=settings.r2_bucket_name, Prefix="gold/latest/")
        files = [
            {
                "key": o["Key"],
                "size_kb": round(o["Size"] / 1024, 1),
                "last_modified": o["LastModified"].isoformat(),
            }
            for o in gold.get("Contents", [])
        ]
        return {
            "configured": True,
            "bucket": settings.r2_bucket_name,
            "gold_files": files,
            "last_export": files[0]["last_modified"] if files else None,
        }
    except ClientError as e:
        return {"configured": True, "error": str(e)}
