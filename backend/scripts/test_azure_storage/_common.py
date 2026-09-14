"""Helpers compartilhados pelos 5 scripts de teste funcional do StorageService
(Azure Blob). Roda contra a conta REAL, na pasta isolada da associacao de
teste -- nunca toca dado de producao de verdade.

Precisa das env vars AZURE_STORAGE_ACCOUNT/KEY/CONTAINER no ambiente (mesmas
usadas pelo app e pelo script de migracao).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# app/services/storage_service.py so precisa dessas 3 env vars pra funcionar
# (nao precisa de DATABASE_URL/SECRET_KEY, mas get_settings() do app exige --
# preenche com placeholder pra nao quebrar o import).
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:x@localhost/x")
os.environ.setdefault("SECRET_KEY", "x")

ASSOC_TESTE = "aaaaaaaa-0001-0001-0001-000000000001"

PASSOU = 0
FALHOU = 0
FALHAS: list[str] = []


def checar(descricao: str, condicao: bool) -> None:
    global PASSOU, FALHOU
    if condicao:
        PASSOU += 1
    else:
        FALHOU += 1
        FALHAS.append(descricao)
        print(f"FALHOU: {descricao}")


def resumo(nome_script: str) -> int:
    total = PASSOU + FALHOU
    print(f"\n=== {nome_script}: {PASSOU}/{total} passou ===")
    if FALHOU:
        print(f"{FALHOU} falha(s):")
        for f in FALHAS:
            print(" -", f)
    return 1 if FALHOU else 0


def imagem_png_minima() -> bytes:
    """PNG 1x1 pixel valido, minimo, pra testes de upload_base64 sem precisar
    de Pillow."""
    import base64
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
