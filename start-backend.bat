@echo off
title OpenFolioLM - Backend
cd /d "%~dp0backend"
echo =======================================================
echo   Iniciando Backend OpenFolioLM (FastAPI + ONNX)
echo   Puerto: http://127.0.0.1:8001
echo =======================================================
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] El backend se cerro con errores. Revisa el mensaje arriba.
)
pause
