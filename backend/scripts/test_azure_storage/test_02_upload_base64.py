"""Teste 2/5: upload_base64 (usado pelo canvas de assinatura no app), varias
variacoes de formato/tamanho de data URL. 40 casos.
"""
import asyncio
import base64
import sys

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from _common import ASSOC_TESTE, checar, imagem_png_minima, resumo  # noqa: E402

import requests
from app.services.storage_service import StorageService  # noqa: E402

PNG_MINIMO_B64 = base64.b64encode(imagem_png_minima()).decode("ascii")


def data_url(tipo: str, tamanho_extra: int) -> str:
    payload = base64.b64encode(imagem_png_minima() + b"\x00" * tamanho_extra).decode("ascii")
    return f"data:image/{tipo};base64,{payload}"


async def main() -> int:
    svc = StorageService(ASSOC_TESTE)
    tipos = ["png", "jpeg"]
    tamanhos_extra = [0, 10, 100, 1000, 10000]

    caso = 0
    for tipo in tipos:
        for extra in tamanhos_extra:
            for rep in range(4):  # 2 tipos x 5 tamanhos x 4 repeticoes = 40
                caso += 1
                du = data_url(tipo, extra)
                try:
                    url = await svc.upload_base64(du, "teste-migracao/upload-base64")
                except Exception as e:
                    checar(f"upload_base64 {tipo} extra={extra} rep={rep}", False)
                    print("  excecao:", e)
                    continue
                checar(
                    f"upload_base64 {tipo} extra={extra} rep={rep}: URL valida",
                    bool(url) and url.startswith("https://"),
                )
                ext_esperada = ".png" if tipo == "png" else ".jpg"
                checar(
                    f"upload_base64 {tipo} extra={extra} rep={rep}: extensao correta ({ext_esperada})",
                    url.split("?")[0].endswith(ext_esperada),
                )
                try:
                    resp = requests.get(url, timeout=30)
                    checar(f"upload_base64 {tipo} extra={extra} rep={rep}: leitura HTTP 200", resp.status_code == 200)
                except Exception as e:
                    checar(f"upload_base64 {tipo} extra={extra} rep={rep}: leitura", False)
                    print("  excecao:", e)

    return resumo("test_02_upload_base64")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
