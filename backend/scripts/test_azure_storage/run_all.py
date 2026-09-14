"""Roda os 5 scripts de teste funcional do StorageService (Azure Blob) em
sequencia e soma o resultado. 200 casos no total (40 por script), contra a
associacao de teste isolada -- nao toca dado de producao real.

Uso: python scripts/test_azure_storage/run_all.py
Precisa de AZURE_STORAGE_ACCOUNT/KEY/CONTAINER no ambiente.
"""
import subprocess
import sys

SCRIPTS = [
    "test_01_upload_variado.py",
    "test_02_upload_base64.py",
    "test_03_delete.py",
    "test_04_leitura_dados_reais.py",
    "test_05_concorrencia_edge_cases.py",
]


def main() -> int:
    import os
    diretorio = os.path.dirname(os.path.abspath(__file__))
    algum_falhou = False
    for script in SCRIPTS:
        print(f"\n{'='*60}\nRodando {script}\n{'='*60}")
        r = subprocess.run([sys.executable, os.path.join(diretorio, script)])
        if r.returncode != 0:
            algum_falhou = True
    print("\n\nRESULTADO FINAL:", "COM FALHAS" if algum_falhou else "TODOS OS 200 TESTES PASSARAM")
    return 1 if algum_falhou else 0


if __name__ == "__main__":
    sys.exit(main())
