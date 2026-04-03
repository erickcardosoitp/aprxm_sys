import mimetypes
import uuid
from pathlib import Path

from supabase import Client, create_client  # type: ignore

from app.config import get_settings

settings = get_settings()

_client: Client | None = None


def _get_client() -> Client:
    global _client
    if _client is None:
        if not settings.supabase_url or not settings.supabase_service_key:
            raise RuntimeError("SUPABASE_URL e SUPABASE_SERVICE_KEY não configurados.")
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
    return _client


class StorageService:
    """
    Uploads files to Supabase Storage and returns public URLs.

    Folder structure inside the bucket:
        {association_id}/{folder}/{uuid}.{ext}

    Examples:
        abc123/packages/label/uuid.jpg
        abc123/packages/signature/uuid.png
        abc123/finance/receipts/uuid.jpg
    """

    def __init__(self, association_id: str) -> None:
        self._assoc = association_id
        self._bucket = settings.supabase_storage_bucket

    def upload(self, file_bytes: bytes, filename: str, folder: str) -> str:
        """Upload raw bytes and return the public URL."""
        client = _get_client()
        ext = Path(filename).suffix or ".bin"
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        storage_path = f"{self._assoc}/{folder}/{uuid.uuid4().hex}{ext}"

        client.storage.from_(self._bucket).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": content_type, "upsert": "true"},
        )

        return client.storage.from_(self._bucket).get_public_url(storage_path)

    def upload_base64(self, data_url: str, folder: str) -> str:
        """
        Upload a base64 data URL (e.g. from canvas signature).
        Format: data:image/png;base64,<base64data>
        """
        import base64

        header, _, b64 = data_url.partition(",")
        ext = ".png" if "png" in header else ".jpg"
        file_bytes = base64.b64decode(b64)
        return self.upload(file_bytes, f"upload{ext}", folder)

    def delete(self, public_url: str) -> None:
        """Remove a file given its public URL."""
        client = _get_client()
        # Extract storage path from public URL
        marker = f"/object/public/{self._bucket}/"
        if marker in public_url:
            storage_path = public_url.split(marker)[-1]
            client.storage.from_(self._bucket).remove([storage_path])
