@echo off
title OpenFolioLM - Backend
cd /d "%~dp0backend"
echo =======================================================
echo   Iniciando Backend OpenFolioLM (FastAPI + ONNX)
echo =======================================================
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
pause
