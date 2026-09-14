import asyncio
import mimetypes
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from azure.storage.blob import (
    BlobSasPermissions,
    BlobServiceClient,
    ContentSettings,
    generate_blob_sas,
)

from app.config import get_settings
from app.core.resilience import supabase_cb

settings = get_settings()

# SAS de leitura de validade longa (10 anos) -- padrao escolhido pra manter
# a mesma interface de hoje (banco guarda a URL completa, frontend usa
# direto) sem precisar de endpoint novo pra gerar URL assinada em tempo
# real. Container e privado (conta stitperpprod bloqueia acesso publico
# por padrao -- diferente do Supabase Storage, que era 100% publico).
SAS_VALIDITY = timedelta(days=3650)

_client: BlobServiceClient | None = None


def _get_client() -> BlobServiceClient:
    global _client
    if _client is None:
        if not settings.azure_storage_account or not settings.azure_storage_key:
            raise RuntimeError("AZURE_STORAGE_ACCOUNT e AZURE_STORAGE_KEY não configurados.")
        _client = BlobServiceClient(
            account_url=f"https://{settings.azure_storage_account}.blob.core.windows.net",
            credential=settings.azure_storage_key,
        )
    return _client


def _signed_url(blob_name: str) -> str:
    sas = generate_blob_sas(
        account_name=settings.azure_storage_account,
        container_name=settings.azure_storage_container,
        blob_name=blob_name,
        account_key=settings.azure_storage_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + SAS_VALIDITY,
    )
    return (
        f"https://{settings.azure_storage_account}.blob.core.windows.net/"
        f"{settings.azure_storage_container}/{blob_name}?{sas}"
    )


class StorageService:
    """
    Uploads files to Azure Blob Storage (container privado) e devolve URL
    assinada (SAS) de leitura, validade longa. Migrado do Supabase Storage
    em 2026-09-12 -- mesma estrutura de pastas, mesma interface publica.

    Estrutura de pastas dentro do container:
        {association_id}/{folder}/{uuid}.{ext}

    Examples:
        abc123/packages/labels/uuid.jpg
        abc123/packages/signatures/uuid.png
        abc123/financeiro/uuid.jpg
    """

    def __init__(self, association_id: str) -> None:
        self._assoc = association_id
        self._container = settings.azure_storage_container

    async def upload(self, file_bytes: bytes, filename: str, folder: str) -> str:
        """Upload raw bytes and return the signed (SAS) URL."""
        client = _get_client()
        ext = Path(filename).suffix or ".bin"
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        blob_name = f"{self._assoc}/{folder}/{uuid.uuid4().hex}{ext}"

        def _do_upload():
            blob_client = client.get_blob_client(container=self._container, blob=blob_name)
            blob_client.upload_blob(
                file_bytes,
                overwrite=True,
                content_settings=ContentSettings(content_type=content_type),
            )
            return _signed_url(blob_name)

        return await asyncio.to_thread(supabase_cb.call_sync, _do_upload)

    async def upload_base64(self, data_url: str, folder: str) -> str:
        """
        Upload a base64 data URL (e.g. from canvas signature).
        Format: data:image/png;base64,<base64data>
        """
        import base64

        header, _, b64 = data_url.partition(",")
        ext = ".png" if "png" in header else ".jpg"
        file_bytes = base64.b64decode(b64)
        return await self.upload(file_bytes, f"upload{ext}", folder)

    def delete(self, public_url: str) -> None:
        """Remove a file given its signed URL — so remove dentro da pasta da propria associacao."""
        client = _get_client()
        # Extract blob name from the signed URL (path entre o container e o "?" do SAS)
        marker = f"/{self._container}/"
        if marker not in public_url:
            return
        blob_name = public_url.split(marker, 1)[-1].split("?", 1)[0]
        # Nunca remover fora da pasta da associacao do chamador, mesmo que a URL
        # recebida tenha sido adulterada pra apontar pra outro prefixo/associacao.
        if not blob_name.startswith(f"{self._assoc}/"):
            raise ValueError("Caminho de arquivo fora do escopo desta associação.")
        client.get_blob_client(container=self._container, blob=blob_name).delete_blob()
