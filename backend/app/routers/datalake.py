from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.tenant import require_admin, CurrentUser
from app.database import get_session
from app.services.datalake_service import run_full_etl

router = APIRouter(prefix="/datalake", tags=["Data Lake"])
settings = get_settings()


@router.post("/run", summary="Executar ETL completo Bronze→Silver→Gold")
async def trigger_etl(
    x_cron_secret: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
    current: CurrentUser | None = None,
) -> dict:
    """
    Executa o pipeline ETL completo e faz upload para o Cloudflare R2.
    Pode ser chamado:
    - Via cron (header X-Cron-Secret)
    - Via admin autenticado
    """
    # Autentica por cron secret OU por admin logado
    is_cron = x_cron_secret and x_cron_secret == settings.cron_secret
    if not is_cron:
        # Fallback: requer admin autenticado
        try:
            from app.core.tenant import get_current_user
            from fastapi import Request
        except Exception:
            raise HTTPException(status_code=401, detail="Não autorizado.")
        if not current:
            raise HTTPException(status_code=401, detail="Não autorizado.")

    if not settings.r2_account_id or not settings.r2_access_key_id:
        raise HTTPException(
            status_code=503,
            detail="Cloudflare R2 não configurado. Defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET_NAME nas env vars."
        )

    result = await run_full_etl(session)
    return result


@router.get("/status", summary="Verificar última exportação no R2")
async def etl_status(
    current: CurrentUser = Depends(require_admin),
) -> dict:
    """Verifica quando foi o último ETL e quais arquivos existem no R2."""
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
