"""Teste 3/5: delete() -- confirma que o arquivo some de verdade depois de
deletado, e que a trava de escopo (nunca deletar fora da pasta da propria
associacao) continua funcionando. 40 casos.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ASSOC_TESTE, checar, resumo  # noqa: E402

import requests
from app.services.storage_service import StorageService  # noqa: E402

OUTRA_ASSOC = "bbbbbbbb-0002-0002-0002-000000000002"


async def main() -> int:
    svc = StorageService(ASSOC_TESTE)

    # 35 casos: upload -> delete -> confirma que sumiu
    for i in range(35):
        conteudo = os.urandom(500)
        url = await svc.upload(conteudo, f"del{i}.bin", "teste-migracao/delete")
        checar(f"delete[{i}]: upload previo OK", bool(url))

        try:
            svc.delete(url)
            checar(f"delete[{i}]: delete() nao levantou excecao", True)
        except Exception as e:
            checar(f"delete[{i}]: delete() nao levantou excecao", False)
            print("  excecao:", e)
            continue

        try:
            resp = requests.get(url.split("?")[0], timeout=15)  # sem SAS -- deve falhar de qualquer forma
            resp_com_sas = requests.get(url, timeout=15)
            checar(f"delete[{i}]: URL nao resolve mais (com SAS antigo)", resp_com_sas.status_code >= 400)
        except Exception as e:
            checar(f"delete[{i}]: confirmar remocao", False)
            print("  excecao:", e)

    # 5 casos: tentativa de delete fora do escopo da propria associacao -- deve
    # levantar ValueError (protecao contra URL adulterada), nunca deletar de fato.
    for i in range(5):
        url_falsa = (
            f"https://stitperpprod.blob.core.windows.net/aprxm-midia/"
            f"{OUTRA_ASSOC}/packages/labels/arquivo-de-outra-associacao-{i}.jpg?sv=x"
        )
        try:
            svc.delete(url_falsa)
            checar(f"escopo[{i}]: delete fora do escopo levantou ValueError", False)
        except ValueError:
            checar(f"escopo[{i}]: delete fora do escopo levantou ValueError", True)
        except Exception as e:
            checar(f"escopo[{i}]: delete fora do escopo levantou ValueError (exato)", False)
            print("  excecao inesperada:", type(e).__name__, e)

    return resumo("test_03_delete")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
