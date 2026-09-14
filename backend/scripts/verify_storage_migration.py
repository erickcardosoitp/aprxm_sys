"""Verificacao pos-migracao: garante que nenhum arquivo/referencia se
perdeu na migracao Supabase Storage -> Azure Blob.

Roda DEPOIS de migrate_storage_to_azure.py --update-db ter terminado.
So leitura -- nao altera nada no banco nem no storage.

Checa 3 coisas:
  1. Nenhuma coluna text/jsonb do schema ainda referencia supabase.co
     (varredura generica, nao so nas colunas "conhecidas" -- foi assim
     que achamos colunas que a v1 do mapeamento tinha deixado passar).
  2. Toda URL do Azure gravada no banco realmente resolve (HTTP 200) --
     nao so "deveria ter copiado", confirma de verdade, um GET por URL.
  3. Contagem bate: total de blobs no Azure vs. total de arquivos unicos
     referenciados no banco (pode haver blobs sem referencia -- registro
     deletado no meio do caminho, ok; o problema seria o contrario:
     referencia no banco sem blob correspondente).

Uso:
    python scripts/verify_storage_migration.py

Precisa de DATABASE_URL, AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY,
AZURE_STORAGE_CONTAINER no ambiente.
"""
from __future__ import annotations

import asyncio
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))


async def _get_engine():
    from sqlalchemy.ext.asyncio import create_async_engine
    db_url = os.environ["DATABASE_URL"].split("?")[0]
    is_neon = "neon.tech" in db_url
    connect_args = {"ssl": "require", "statement_cache_size": 0} if is_neon else {"statement_cache_size": 0}
    return create_async_engine(db_url, connect_args=connect_args)


async def check_no_supabase_leftover(engine) -> list[str]:
    """1. Varre TODAS as colunas text/jsonb do schema public por
    'supabase.co'. Retorna lista de "tabela.coluna: N linhas" pros que
    ainda tiverem, vazio se tudo limpo."""
    from sqlalchemy import text
    problems = []
    async with engine.begin() as conn:
        cols = (await conn.execute(text("""
            SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json')
        """))).fetchall()
        for table, col in cols:
            try:
                r = (await conn.execute(text(
                    f"SELECT COUNT(*) FROM {table} WHERE {col}::text LIKE :pat"
                ), {"pat": "%supabase.co%"})).scalar()
            except Exception:
                continue
            if r:
                problems.append(f"{table}.{col}: {r} linha(s) ainda com URL do Supabase")
    return problems


async def collect_azure_urls(engine) -> set[str]:
    """Coleta toda URL azure blob.core.windows.net referenciada em
    qualquer coluna text/jsonb do schema."""
    from sqlalchemy import text
    import re
    urls = set()
    url_re = re.compile(r"https://[a-z0-9]+\.blob\.core\.windows\.net/[^\s\"'\\]+")
    async with engine.begin() as conn:
        cols = (await conn.execute(text("""
            SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json')
        """))).fetchall()
        for table, col in cols:
            try:
                rows = (await conn.execute(text(
                    f"SELECT {col}::text FROM {table} WHERE {col}::text LIKE :pat"
                ), {"pat": "%blob.core.windows.net%"})).fetchall()
            except Exception:
                continue
            for (val,) in rows:
                urls.update(url_re.findall(val or ""))
    return urls


def check_url_resolves(url: str) -> tuple[str, bool, str]:
    try:
        r = requests.head(url, timeout=15, allow_redirects=True)
        if r.status_code == 405:  # alguns storages nao aceitam HEAD
            r = requests.get(url, timeout=15, stream=True)
        ok = r.status_code == 200
        return url, ok, str(r.status_code)
    except Exception as e:
        return url, False, str(e)


def count_azure_blobs() -> int:
    account = os.environ["AZURE_STORAGE_ACCOUNT"]
    key = os.environ["AZURE_STORAGE_KEY"]
    container = os.environ.get("AZURE_STORAGE_CONTAINER", "aprxm-midia")
    from azure.storage.blob import BlobServiceClient
    client = BlobServiceClient(account_url=f"https://{account}.blob.core.windows.net", credential=key)
    return sum(1 for _ in client.get_container_client(container).list_blobs())


async def _gather_db_checks() -> tuple[list[str], set[str]]:
    engine = await _get_engine()
    problems = await check_no_supabase_leftover(engine)
    urls = await collect_azure_urls(engine)
    await engine.dispose()
    return problems, urls


def main() -> int:
    print("=== 1. Varredura de URLs residuais do Supabase no banco ===")
    problems, urls = asyncio.run(_gather_db_checks())
    if problems:
        print("PROBLEMA: ainda existem referencias ao Supabase:")
        for p in problems:
            print(" -", p)
    else:
        print("OK: nenhuma referencia a supabase.co em nenhuma coluna do banco.")

    print("\n=== 2. Testando se cada URL do Azure no banco realmente resolve ===")
    print(f"{len(urls)} URL(s) unica(s) do Azure encontradas no banco.")
    failed = []
    with ThreadPoolExecutor(max_workers=16) as ex:
        futures = [ex.submit(check_url_resolves, u) for u in urls]
        for i, fut in enumerate(as_completed(futures), 1):
            url, ok, status = fut.result()
            if not ok:
                failed.append((url, status))
            if i % 500 == 0 or i == len(urls):
                print(f"{i}/{len(urls)} testadas ({len(failed)} falhas ate agora)", flush=True)
    if failed:
        print(f"\nPROBLEMA: {len(failed)} URL(s) do banco NAO resolvem (arquivo sumido/nao migrado):")
        for url, status in failed[:20]:
            print(" -", status, url)
        if len(failed) > 20:
            print(f"   ... e mais {len(failed) - 20}")
    else:
        print("OK: todas as URLs do banco resolvem (HTTP 200).")

    print("\n=== 3. Contagem: blobs no Azure vs. referenciados no banco ===")
    total_blobs = count_azure_blobs()
    print(f"Blobs no Azure: {total_blobs}")
    print(f"URLs unicas referenciadas no banco: {len(urls)}")
    if len(urls) > total_blobs:
        print("PROBLEMA: banco referencia mais arquivos do que existem no Azure -- impossivel, investigar.")
    else:
        print(f"OK: {total_blobs - len(urls)} blob(s) no Azure sem referencia direta no banco (normal -- "
              f"registro deletado, ou arquivo orfao antigo do Supabase).")

    return 1 if (problems or failed or len(urls) > total_blobs) else 0


if __name__ == "__main__":
    sys.exit(main())
