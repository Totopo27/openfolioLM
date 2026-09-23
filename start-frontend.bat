@echo off
title OpenFolioLM - Frontend
cd /d "%~dp0frontend"
echo =======================================================
echo   Iniciando Frontend OpenFolioLM (Vite + React)
echo   Puerto: http://localhost:5173
echo =======================================================
call npm run dev
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] El frontend se cerro con errores. Revisa el mensaje arriba.
)
pause
