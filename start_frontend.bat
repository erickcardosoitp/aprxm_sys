@echo off
echo Encerrando instancias Vite anteriores...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 "') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5174 "') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul
cd /d C:\aprxm_sass\frontend
echo Iniciando APRXM Frontend na porta 5173...
npm run dev
