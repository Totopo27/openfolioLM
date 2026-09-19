@echo off
title OpenFolioLM Launcher
echo ========================================================
echo   Lanzando OpenFolioLM (Backend y Frontend)
echo ========================================================
echo.
start "OpenFolioLM Backend" cmd /c "%~dp0start-backend.bat"
timeout /t 2 /nobreak >nul
start "OpenFolioLM Frontend" cmd /c "%~dp0start-frontend.bat"
echo Servidores iniciados en ventanas separadas.
echo Abri tu navegador en: http://localhost:5173
echo.
pause
