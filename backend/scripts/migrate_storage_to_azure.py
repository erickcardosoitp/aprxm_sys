"""Migracao de arquivos: Supabase Storage -> Azure Blob (container privado).

Script standalone, um-uso-so -- nao faz parte do app em producao. Ver
docs/superpowers/plans/2026-09-12-migracao-aprxm-execucao.md, Fase D.

Uso:
    python scripts/migrate_storage_to_azure.py --dry-run   # so lista, nao migra nada
    python scripts/migrate_storage_to_azure.py              # migra de verdade
    python scripts/migrate_storage_to_azure.py --update-db  # migra + atualiza URLs no banco

Precisa das env vars de origem (SUPABASE_URL, SUPABASE_SERVICE_KEY,
SUPABASE_STORAGE_BUCKET) e destino (AZURE_STORAGE_ACCOUNT,
AZURE_STORAGE_KEY, AZURE_STORAGE_CONTAINER) no ambiente -- nao le do
config.py do app de proposito, ja que o app depois de migrado nao tem
mais as vars do Supabase.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SAS_VALIDITY = timedelta(days=3650)
MAPPING_FILE = os.path.join(os.path.dirname(__file__), "storage_migration_mapping.json")


def _supabase_client():
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key), os.environ.get("SUPABASE_STORAGE_BUCKET", "aprxm-midia")


def _azure_client():
    from azure.storage.blob import BlobServiceClient
    account = os.environ["AZURE_STORAGE_ACCOUNT"]
    key = os.environ["AZURE_STORAGE_KEY"]
    container = os.environ.get("AZURE_STORAGE_CONTAINER", "aprxm-midia")
    client = BlobServiceClient(
        account_url=f"https://{account}.blob.core.windows.net", credential=key,
    )
    return client, account, key, container


def list_all_objects(client, bucket: str, prefix: str = "") -> list[dict]:
    """Lista recursivamente todos os arquivos (nao pastas) do bucket."""
    out = []
    items = client.storage.from_(bucket).list(prefix, {"limit": 1000})
    for item in items:
        name = item.get("name")
        path = f"{prefix}/{name}" if prefix else name
        meta = item.get("metadata")
        if meta is None:
            out.extend(list_all_objects(client, bucket, path))
        else:
            out.append({"path": path, "size": meta.get("size", 0), "mimetype": meta.get("mimetype")})
    return out


def signed_url(account: str, container: str, key: str, blob_name: str) -> str:
    from azure.storage.blob import BlobSasPermissions, generate_blob_sas
    sas = generate_blob_sas(
        account_name=account, container_name=container, blob_name=blob_name,
        account_key=key, permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + SAS_VALIDITY,
    )
    return f"https://{account}.blob.core.windows.net/{container}/{blob_name}?{sas}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="so lista, nao copia nada")
    ap.add_argument("--update-db", action="store_true", help="depois de migrar, atualiza URLs no banco (precisa DATABASE_URL)")
    args = ap.parse_args()

    sb_client, sb_bucket = _supabase_client()
    objects = list_all_objects(sb_client, sb_bucket)
    total_size = sum(o["size"] for o in objects)
    print(f"Encontrados {len(objects)} arquivos, {round(total_size/1024/1024, 2)} MB no Supabase.")

    if args.dry_run:
        for o in objects[:10]:
            print(" -", o["path"], o["size"], "bytes")
        if len(objects) > 10:
            print(f"   ... e mais {len(objects) - 10}")
        return 0

    az_client, az_account, az_key, az_container = _azure_client()
    sb_base = f"{os.environ['SUPABASE_URL']}/storage/v1/object/public/{sb_bucket}/"

    mapping = {}
    if os.path.exists(MAPPING_FILE):
        mapping = json.load(open(MAPPING_FILE, encoding="utf-8"))
        print(f"Retomando: {len(mapping)} arquivos ja migrados antes.")

    ok, failed = 0, 0
    t0 = time.time()
    for i, o in enumerate(objects, 1):
        path = o["path"]
        if path in mapping:
            continue
        try:
            data = sb_client.storage.from_(sb_bucket).download(path)
            content_type = o.get("mimetype") or mimetypes.guess_type(path)[0] or "application/octet-stream"
            blob_client = az_client.get_blob_client(container=az_container, blob=path)
            from azure.storage.blob import ContentSettings
            blob_client.upload_blob(data, overwrite=True, content_settings=ContentSettings(content_type=content_type))
            new_url = signed_url(az_account, az_container, az_key, path)
            old_url = sb_base + path
            mapping[path] = {"old_url": old_url, "new_url": new_url}
            ok += 1
        except Exception as e:
            print(f"FALHA em {path}: {e}", file=sys.stderr)
            failed += 1

        if i % 100 == 0 or i == len(objects):
            json.dump(mapping, open(MAPPING_FILE, "w", encoding="utf-8"), ensure_ascii=False)
            print(f"{i}/{len(objects)} processados ({ok} ok, {failed} falhas) — {round(time.time()-t0,1)}s")

    json.dump(mapping, open(MAPPING_FILE, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"Concluido: {ok} migrados, {failed} falhas. Mapeamento salvo em {MAPPING_FILE}")

    if args.update_db:
        asyncio.run(update_database(mapping))

    return 1 if failed else 0


async def update_database(mapping: dict) -> None:
    """Atualiza as URLs no banco: troca a URL antiga (Supabase) pela nova
    (Azure+SAS) em todas as colunas conhecidas que guardam essas URLs.
    So roda com --update-db explicito -- efeito colateral real no banco."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    db_url = os.environ["DATABASE_URL"]
    engine = create_async_engine(db_url, connect_args={"statement_cache_size": 0} if "neon.tech" in db_url else {})

    # Colunas de texto simples (1 URL por campo) -- troca direta.
    SIMPLE_COLUMNS = [
        ("associations", "logo_url"),
        ("transactions", "receipt_photo_url"),
        ("transactions", "approval_signature_url"),
        ("mensalidades", "payment_proof_url"),
        ("migration_payments", "proof_url"),
        ("packages", "signature_url"),
        ("packages", "deliverer_signature_url"),
        ("packages", "proof_of_residence_url"),
        ("packages", "recipient_id_photo_url"),
        ("packages", "owner_id_photo_url"),
        ("packages", "picker_id_photo_url"),
        ("residents", "photo_url"),
        ("residents", "proof_of_payment_url"),
        ("service_orders", "pdf_url"),
        ("users", "avatar_url"),
    ]

    async with engine.begin() as conn:
        for table, col in SIMPLE_COLUMNS:
            total = 0
            for path, urls in mapping.items():
                r = await conn.execute(text(
                    f"UPDATE {table} SET {col} = :new_url WHERE {col} = :old_url"
                ), {"new_url": urls["new_url"], "old_url": urls["old_url"]})
                total += r.rowcount
            if total:
                print(f"{table}.{col}: {total} linha(s) atualizada(s)")

        # packages.photo_urls e JSON (lista de {url, label, taken_at}) -- precisa
        # reescrever o array inteiro, nao da pra fazer WHERE = valor simples.
        rows = (await conn.execute(text(
            "SELECT id, photo_urls FROM packages WHERE photo_urls IS NOT NULL AND photo_urls != '[]'"
        ))).fetchall()
        updated = 0
        for pkg_id, photo_urls_raw in rows:
            photo_urls = json.loads(photo_urls_raw) if isinstance(photo_urls_raw, str) else photo_urls_raw
            changed = False
            new_list = []
            for item in photo_urls:
                url = item.get("url", "")
                match = next((m for m in mapping.values() if m["old_url"] == url), None)
                if match:
                    item = {**item, "url": match["new_url"]}
                    changed = True
                new_list.append(item)
            if changed:
                await conn.execute(text(
                    "UPDATE packages SET photo_urls = CAST(:photo_urls AS jsonb) WHERE id = :id"
                ), {"photo_urls": json.dumps(new_list), "id": pkg_id})
                updated += 1
        if updated:
            print(f"packages.photo_urls: {updated} linha(s) atualizada(s)")

    await engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
