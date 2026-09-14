"""Teste 1/5: upload de arquivos variados (extensao/tamanho/conteudo),
confirma URL assinada valida e conteudo batendo byte a byte. 40 casos.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ASSOC_TESTE, checar, resumo  # noqa: E402

import requests
from app.services.storage_service import StorageService  # noqa: E402

EXTENSOES = [".jpg", ".jpeg", ".png", ".pdf", ".txt", ".csv", ".webp", ".gif", ".xlsx", ".bin"]
TAMANHOS = [0, 1, 100, 1024, 1024 * 1024]  # 0 byte ate 1MB


async def main() -> int:
    svc = StorageService(ASSOC_TESTE)
    caso = 0
    for ext in EXTENSOES:
        for tamanho in TAMANHOS:
            caso += 1
            if caso > 40:
                break
            conteudo = os.urandom(tamanho) if tamanho else b""
            nome = f"teste{ext}"
            try:
                url = await svc.upload(conteudo, nome, "teste-migracao/upload-variado")
            except Exception as e:
                checar(f"upload {ext} ({tamanho} bytes)", False)
                print("  excecao:", e)
                continue
            checar(f"upload {ext} ({tamanho} bytes) retornou URL", bool(url) and url.startswith("https://"))

            try:
                resp = requests.get(url, timeout=30)
                checar(f"leitura {ext} ({tamanho} bytes): HTTP 200", resp.status_code == 200)
                checar(f"leitura {ext} ({tamanho} bytes): conteudo bate", resp.content == conteudo)
            except Exception as e:
                checar(f"leitura {ext} ({tamanho} bytes)", False)
                print("  excecao:", e)

    return resumo("test_01_upload_variado")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
