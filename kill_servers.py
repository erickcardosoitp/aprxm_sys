"""
APRXM — Kill all dev server processes on ports 8000-8010 and 5173-5174.
Run: python kill_servers.py
"""
import subprocess
import sys

PORTS = list(range(8000, 8010)) + [5173, 5174]

killed = []
for port in PORTS:
    result = subprocess.run(
        ["netstat", "-ano"],
        capture_output=True, text=True, errors="replace"
    )
    for line in result.stdout.splitlines():
        if f":{port} " in line and "LISTEN" in line:
            parts = line.strip().split()
            pid = parts[-1]
            r = subprocess.run(
                ["taskkill", "/PID", pid, "/F"],
                capture_output=True, text=True, errors="replace"
            )
            if "SUCCESS" in r.stdout or "sucesso" in r.stdout.lower():
                killed.append(f"PID {pid} (:{port})")

if killed:
    print("Processos encerrados:")
    for k in killed:
        print(f"  ✓ {k}")
else:
    print("Nenhum processo encontrado nas portas monitoradas.")

print("\nPronto. Agora rode:")
print("  Terminal 1: start_backend.bat")
print("  Terminal 2: start_frontend.bat")
