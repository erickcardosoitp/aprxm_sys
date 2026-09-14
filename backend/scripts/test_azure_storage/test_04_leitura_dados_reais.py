"""Teste 4/5: le os arquivos REAIS ja migrados da associacao de teste
(nao upload novo -- confirma que o que o migrate_storage_to_azure.py
realmente copiou esta la e resolve). Se a associacao de teste tiver menos
de 40 arquivos reais, completa com uploads sinteticos pra fechar 40 casos.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ASSOC_TESTE, checar, resumo  # noqa: E402

import requests
from azure.storage.blob import BlobSasPermissions, BlobServiceClient, generate_blob_sas  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.services.storage_service import StorageService  # noqa: E402


def listar_blobs_reais(assoc: str) -> list[str]:
    s = get_settings()
    client = BlobServiceClient(
        account_url=f"https://{s.azure_storage_account}.blob.core.windows.net",
        credential=s.azure_storage_key,
    )
    container = client.get_container_client(s.azure_storage_container)
    return [b.name for b in container.list_blobs(name_starts_with=f"{assoc}/")]


def url_assinada(blob_name: str) -> str:
    s = get_settings()
    sas = generate_blob_sas(
        account_name=s.azure_storage_account, container_name=s.azure_storage_container,
        blob_name=blob_name, account_key=s.azure_storage_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    return f"https://{s.azure_storage_account}.blob.core.windows.net/{s.azure_storage_container}/{blob_name}?{sas}"


async def main() -> int:
    blobs_reais = listar_blobs_reais(ASSOC_TESTE)
    print(f"{len(blobs_reais)} blob(s) real(is) encontrado(s) pra {ASSOC_TESTE}")

    casos = list(blobs_reais)[:40]

    for i, blob_name in enumerate(casos):
        url = url_assinada(blob_name)
        try:
            resp = requests.get(url, timeout=30)
            checar(f"real[{i}] {blob_name}: HTTP 200", resp.status_code == 200)
            checar(f"real[{i}] {blob_name}: tem conteudo (>0 bytes)", len(resp.content) > 0)
        except Exception as e:
            checar(f"real[{i}] {blob_name}: leitura", False)
            print("  excecao:", e)

    # completa ate 40 com upload sintetico, se a associacao de teste nao tiver
    # arquivo real suficiente -- mesma logica de teste, so garante o total.
    faltam = 40 - len(casos)
    if faltam > 0:
        svc = StorageService(ASSOC_TESTE)
        for i in range(faltam):
            conteudo = os.urandom(200)
            url = await svc.upload(conteudo, f"sintetico{i}.bin", "teste-migracao/leitura-sintetica")
            try:
                resp = requests.get(url, timeout=30)
                checar(f"sintetico[{i}]: HTTP 200", resp.status_code == 200)
                checar(f"sintetico[{i}]: conteudo bate", resp.content == conteudo)
            except Exception as e:
                checar(f"sintetico[{i}]: leitura", False)
                print("  excecao:", e)

    return resumo("test_04_leitura_dados_reais")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
