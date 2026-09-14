"""Migracao de arquivos: Supabase Storage -> Azure Blob (container privado).

Script standalone, um-uso-so -- nao faz parte do app em producao. Ver
docs/superpowers/plans/2026-09-12-migracao-aprxm-execucao.md, Fase D.

CORRIGIDO 2026-09-13: a v1 deste script usava o SDK supabase-py, cujo
list() nao pagina automaticamente (limite de 1000 por chamada) -- isso
fez a v1 enxergar so 2.750 arquivos (204MB) quando o volume real e
13.433 arquivos (924MB). O SDK supabase-py 2.15.1 tambem rejeita o
formato novo de chave (sb_secret_/sb_publishable_), entao a v2 usa REST
puro (ver _supabase_rest.py) com paginacao real em cada nivel de pasta.

Uso:
    python scripts/migrate_storage_to_azure.py --dry-run   # so lista, nao migra nada
    python scripts/migrate_storage_to_azure.py              # migra de verdade
    python scripts/migrate_storage_to_azure.py --update-db  # migra + atualiza URLs no banco

Precisa das env vars de origem (SUPABASE_URL, SUPABASE_SERVICE_KEY --
aceita tambem a "secret key" do novo formato, sb_secret_...) e destino
(AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY, AZURE_STORAGE_CONTAINER).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _supabase_rest import SupabaseStorageREST  # noqa: E402

SAS_VALIDITY = timedelta(days=3650)
MAPPING_FILE = os.path.join(os.path.dirname(__file__), "storage_migration_mapping.json")
MAX_WORKERS = 8


def _azure_client():
    from azure.storage.blob import BlobServiceClient
    account = os.environ["AZURE_STORAGE_ACCOUNT"]
    key = os.environ["AZURE_STORAGE_KEY"]
    container = os.environ.get("AZURE_STORAGE_CONTAINER", "aprxm-midia")
    client = BlobServiceClient(
        account_url=f"https://{account}.blob.core.windows.net", credential=key,
    )
    return client, account, key, container


def signed_url(account: str, container: str, key: str, blob_name: str) -> str:
    from azure.storage.blob import BlobSasPermissions, generate_blob_sas
    sas = generate_blob_sas(
        account_name=account, container_name=container, blob_name=blob_name,
        account_key=key, permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + SAS_VALIDITY,
    )
    return f"https://{account}.blob.core.windows.net/{container}/{blob_name}?{sas}"


def _migrate_one(sb: SupabaseStorageREST, sb_bucket: str, az_client, az_account, az_key, az_container, o: dict) -> tuple[str, dict | None, str | None]:
    path = o["path"]
    try:
        from azure.storage.blob import ContentSettings
        data = sb.download(sb_bucket, path)
        content_type = o.get("mimetype") or mimetypes.guess_type(path)[0] or "application/octet-stream"
        blob_client = az_client.get_blob_client(container=az_container, blob=path)
        blob_client.upload_blob(data, overwrite=True, content_settings=ContentSettings(content_type=content_type))
        new_url = signed_url(az_account, az_container, az_key, path)
        # supabase mantem "?" no final da URL publica (query string vazia) --
        # e o que fica gravado no banco de verdade, precisa bater exato.
        old_url = f"{os.environ['SUPABASE_URL']}/storage/v1/object/public/{sb_bucket}/{path}?"
        return path, {"old_url": old_url, "new_url": new_url}, None
    except Exception as e:
        return path, None, str(e)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="so lista, nao copia nada")
    ap.add_argument("--update-db", action="store_true", help="depois de migrar, atualiza URLs no banco (precisa DATABASE_URL)")
    args = ap.parse_args()

    sb_url = os.environ["SUPABASE_URL"]
    sb_key = os.environ["SUPABASE_SERVICE_KEY"]
    sb_bucket = os.environ.get("SUPABASE_STORAGE_BUCKET", "aprxm-midia")
    sb = SupabaseStorageREST(sb_url, sb_key)

    print("Listando (com paginacao completa)...", flush=True)
    objects = sb.list_all(sb_bucket)
    total_size = sum(o["size"] for o in objects)
    print(f"Encontrados {len(objects)} arquivos, {round(total_size/1024/1024, 2)} MB no Supabase.", flush=True)

    if args.dry_run:
        for o in objects[:10]:
            print(" -", o["path"], o["size"], "bytes")
        if len(objects) > 10:
            print(f"   ... e mais {len(objects) - 10}")
        return 0

    az_client, az_account, az_key, az_container = _azure_client()

    mapping = {}
    if os.path.exists(MAPPING_FILE):
        mapping = json.load(open(MAPPING_FILE, encoding="utf-8"))
        print(f"Retomando: {len(mapping)} arquivos ja migrados antes.", flush=True)

    pending = [o for o in objects if o["path"] not in mapping]
    print(f"Faltam migrar: {len(pending)}", flush=True)

    ok, failed = 0, 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {
            ex.submit(_migrate_one, sb, sb_bucket, az_client, az_account, az_key, az_container, o): o
            for o in pending
        }
        for i, fut in enumerate(as_completed(futures), 1):
            path, result, err = fut.result()
            if result:
                mapping[path] = result
                ok += 1
            else:
                print(f"FALHA em {path}: {err}", file=sys.stderr, flush=True)
                failed += 1
            if i % 500 == 0 or i == len(pending):
                json.dump(mapping, open(MAPPING_FILE, "w", encoding="utf-8"), ensure_ascii=False)
                pct = round(100 * i / len(pending), 1)
                elapsed = time.time() - t0
                eta = round((elapsed / i) * (len(pending) - i), 1) if i else 0
                print(
                    f"{i}/{len(pending)} ({pct}%) — {ok} ok, {failed} falhas — "
                    f"{round(elapsed,1)}s decorridos, ~{eta}s restantes",
                    flush=True,
                )

    json.dump(mapping, open(MAPPING_FILE, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"Concluido: {ok} migrados, {failed} falhas. Mapeamento salvo em {MAPPING_FILE}", flush=True)

    if args.update_db:
        asyncio.run(update_database(mapping))

    return 1 if failed else 0


async def update_database(mapping: dict) -> None:
    """Atualiza as URLs no banco: troca a URL antiga (Supabase) pela nova
    (Azure+SAS) em todas as colunas conhecidas que guardam essas URLs.
    So roda com --update-db explicito -- efeito colateral real no banco."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    db_url = os.environ["DATABASE_URL"].split("?")[0]
    is_neon = "neon.tech" in db_url
    connect_args = {"ssl": "require", "statement_cache_size": 0} if is_neon else {"statement_cache_size": 0}
    engine = create_async_engine(db_url, connect_args=connect_args)

    # Colunas de texto simples (1 URL por campo) -- troca direta.
    # Lista revisada 2026-09-13: a v1 so cobria campos achados por grep de
    # nome no models/ -- faltavam association_settings, deliverers,
    # chat_messages (achados so ao rodar LIKE '%supabase.co%' em TODAS as
    # colunas text/jsonb do schema, nao so nos "obvios").
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
        ("association_settings", "president_signature_url"),
        ("association_settings", "assoc_logo_url"),
        ("deliverers", "signature_url"),
        ("chat_messages", "media_url"),
    ]

    # Colunas JSON (lista de itens com campo "url") -- precisa reescrever
    # o array inteiro, nao da pra fazer WHERE = valor simples.
    JSON_ARRAY_COLUMNS = [
        ("packages", "photo_urls"),
        ("daily_tasks", "attachment_urls"),
        ("daily_task_comments", "attachment_urls"),
    ]

    items = list(mapping.values())
    values_sql = ", ".join(f"(:o{i}, :n{i})" for i in range(len(items)))
    params = {}
    for i, urls in enumerate(items):
        params[f"o{i}"] = urls["old_url"]
        params[f"n{i}"] = urls["new_url"]
    url_map = {urls["old_url"]: urls["new_url"] for urls in items}

    async with engine.begin() as conn:
        for table, col in SIMPLE_COLUMNS:
            r = await conn.execute(text(
                f"UPDATE {table} AS t SET {col} = v.new_url "
                f"FROM (VALUES {values_sql}) AS v(old_url, new_url) "
                f"WHERE t.{col} = v.old_url"
            ), params)
            if r.rowcount:
                print(f"{table}.{col}: {r.rowcount} linha(s) atualizada(s)")

        for table, col in JSON_ARRAY_COLUMNS:
            rows = (await conn.execute(text(
                f"SELECT id, {col} FROM {table} WHERE {col} IS NOT NULL AND {col} != '[]'"
            ))).fetchall()
            updated = 0
            for row_id, arr_raw in rows:
                arr = json.loads(arr_raw) if isinstance(arr_raw, str) else arr_raw
                if not isinstance(arr, list):
                    continue
                changed = False
                new_list = []
                for item in arr:
                    if isinstance(item, dict) and "url" in item:
                        new_url = url_map.get(item.get("url", ""))
                        if new_url:
                            item = {**item, "url": new_url}
                            changed = True
                    elif isinstance(item, str):
                        new_url = url_map.get(item)
                        if new_url:
                            item = new_url
                            changed = True
                    new_list.append(item)
                if changed:
                    await conn.execute(text(
                        f"UPDATE {table} SET {col} = CAST(:arr AS jsonb) WHERE id = :id"
                    ), {"arr": json.dumps(new_list), "id": row_id})
                    updated += 1
            if updated:
                print(f"{table}.{col}: {updated} linha(s) atualizada(s)")

    await engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
