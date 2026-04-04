from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse

from app.core.tenant import CurrentUser, get_current_user
from app.services.storage_service import StorageService

router = APIRouter(prefix="/uploads", tags=["Uploads"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("", summary="Upload de arquivo para Supabase Storage")
async def upload_file(
    folder: str = Form(...),
    file: UploadFile = File(...),
    current: CurrentUser = Depends(get_current_user),
) -> JSONResponse:
    if file.content_type not in ALLOWED_TYPES:
        return JSONResponse(status_code=400, content={"detail": "Tipo de arquivo não permitido."})

    file_bytes = await file.read()
    if len(file_bytes) > MAX_SIZE_BYTES:
        return JSONResponse(status_code=400, content={"detail": "Arquivo muito grande (máx. 10 MB)."})

    svc = StorageService(str(current.association_id))
    url = svc.upload(file_bytes, file.filename or "upload.jpg", folder)
    return JSONResponse({"url": url})


@router.post("/base64", summary="Upload de base64 (assinatura canvas)")
async def upload_base64(
    body: dict,
    current: CurrentUser = Depends(get_current_user),
) -> JSONResponse:
    data_url: str = body.get("data_url", "")
    folder: str = body.get("folder", "signatures")

    if not data_url.startswith("data:image/"):
        return JSONResponse(status_code=400, content={"detail": "data_url inválido."})

    # Limit base64 size (~2MB decoded)
    if len(data_url) > 2_800_000:
        return JSONResponse(status_code=400, content={"detail": "Imagem muito grande."})

    svc = StorageService(str(current.association_id))
    url = svc.upload_base64(data_url, folder)
    return JSONResponse({"url": url})
