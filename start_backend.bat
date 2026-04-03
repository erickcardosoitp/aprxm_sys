@echo off
echo Encerrando instancias anteriores...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 "') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul
cd /d C:\aprxm_sass\backend
echo Iniciando APRXM Backend...
python kill_servers.py
timeout /t 2 /nobreak >nul
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
