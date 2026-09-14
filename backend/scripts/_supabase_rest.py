"""Cliente REST minimo pro Supabase Storage -- bypassa o SDK oficial
(supabase-py 2.15.1 rejeita o formato novo de chave sb_secret_/sb_publishable_).
Usa so requests, paginacao correta (list() do SDK e da API tem limite de
1000 por chamada -- precisa loopar com offset ate a resposta vir menor
que o limite)."""
import requests


class SupabaseStorageREST:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/")
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def list_all(self, bucket: str, prefix: str = "") -> list[dict]:
        """Lista recursivamente TODOS os arquivos (nao pastas) sob prefix,
        paginando corretamente em cada nivel."""
        out = []
        offset = 0
        page_size = 1000
        entries = []
        while True:
            r = requests.post(
                f"{self.base}/storage/v1/object/list/{bucket}",
                headers=self.headers,
                json={"prefix": prefix, "limit": page_size, "offset": offset},
                timeout=30,
            )
            r.raise_for_status()
            page = r.json()
            entries.extend(page)
            offset += len(page)
            if len(page) < page_size:
                break
        for item in entries:
            name = item.get("name")
            path = f"{prefix}/{name}" if prefix else name
            meta = item.get("metadata")
            if meta is None:
                out.extend(self.list_all(bucket, path))
            else:
                out.append({"path": path, "size": meta.get("size", 0), "mimetype": meta.get("mimetype")})
        return out

    def download(self, bucket: str, path: str) -> bytes:
        r = requests.get(f"{self.base}/storage/v1/object/{bucket}/{path}", headers=self.headers, timeout=60)
        r.raise_for_status()
        return r.content
