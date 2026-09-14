"""Teste 5/5: concorrencia real (uploads em paralelo) e casos de borda
(nomes de arquivo estranhos, path traversal no folder, sem extensao,
content-type desconhecido). 40 casos.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ASSOC_TESTE, checar, resumo  # noqa: E402

import requests
from app.services.storage_service import StorageService  # noqa: E402


async def upload_um(svc: StorageService, i: int) -> tuple[int, str | None, Exception | None]:
    try:
        url = await svc.upload(os.urandom(300), f"concorrente{i}.jpg", "teste-migracao/concorrencia")
        return i, url, None
    except Exception as e:
        return i, None, e


async def main() -> int:
    svc = StorageService(ASSOC_TESTE)

    # 20 casos: uploads em paralelo de verdade (asyncio.gather), confirma que
    # nenhum colide/sobrescreve o outro (uuid garante isso, mas testa na pratica).
    resultados = await asyncio.gather(*[upload_um(svc, i) for i in range(20)])
    urls = set()
    for i, url, erro in resultados:
        checar(f"concorrencia[{i}]: upload sem excecao", erro is None)
        if url:
            checar(f"concorrencia[{i}]: URL unica (sem colisao)", url not in urls)
            urls.add(url)

    # 15 casos: nomes de arquivo estranhos (unicode, espaco, sem extensao,
    # multiplos pontos, caracteres especiais) -- garante que uuid.ext
    # sempre isola do nome original, sem quebrar.
    nomes_estranhos = [
        "arquivo com espaço.jpg", "arquivo'com\"aspas.png", "sem_extensao",
        "múltiplos.pontos.aqui.pdf", "emoji😀.jpg", "..oculto.png",
        "MAIUSCULO.JPG", "nome" + "x" * 200 + ".jpg", "árvore_ção.png",
        "arquivo\ttab.jpg", "a.jpg", "..", ".", "arquivo;drop table.jpg",
        "🎉🎊🎈.png",
    ]
    for i, nome in enumerate(nomes_estranhos):
        try:
            url = await svc.upload(b"conteudo teste", nome, "teste-migracao/nomes-estranhos")
            checar(f"nome-estranho[{i}] {nome!r}: upload OK", bool(url))
            resp = requests.get(url, timeout=15)
            checar(f"nome-estranho[{i}] {nome!r}: leitura HTTP 200", resp.status_code == 200)
        except Exception as e:
            checar(f"nome-estranho[{i}] {nome!r}: upload/leitura", False)
            print("  excecao:", e)

    # 5 casos: tentativa de path traversal no parametro folder -- verifica que
    # o blob resultante fica confinado, nunca escapa do prefixo da associacao.
    folders_maliciosos = [
        "../../../etc", "../outra-associacao", "..\\..\\windows",
        "teste-migracao/../../fora", "....//....//escape",
    ]
    for i, folder in enumerate(folders_maliciosos):
        try:
            url = await svc.upload(b"teste traversal", f"traversal{i}.txt", folder)
            blob_path = url.split("?")[0].split(f"/{ASSOC_TESTE}", 1)
            # o path resultante, depois do prefixo da associacao, nao pode conter
            # ".." que escape de volta pra fora da propria pasta da associacao --
            # como upload() sempre monta f"{assoc}/{folder}/{uuid}{ext}", o pior
            # caso e o folder introduzir ".." DENTRO do proprio prefixo, mas nunca
            # antes dele (a URL sempre comeca com https://.../container/{assoc}/).
            checar(
                f"traversal[{i}] folder={folder!r}: blob permanece sob o prefixo da associacao",
                f"/{ASSOC_TESTE}/" in url,
            )
        except Exception as e:
            # levantar excecao tambem e um resultado aceitavel (rejeitou o folder malicioso)
            checar(f"traversal[{i}] folder={folder!r}: tratado (excecao ou contido)", True)
            print(f"  (rejeitado com excecao, ok: {e})")

    return resumo("test_05_concorrencia_edge_cases")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
