@echo off
title OpenFolioLM Launcher
echo ========================================================
echo         OpenFolioLM - Iniciando Servicios
echo ========================================================
echo.

echo [1/2] Iniciando Backend en ventana separada (Puerto 8001)...
start "OpenFolioLM Backend" "%~dp0start-backend.bat"

echo [2/2] Iniciando Frontend en ventana separada (Puerto 5173)...
timeout /t 3 /nobreak >nul
start "OpenFolioLM Frontend" "%~dp0start-frontend.bat"

timeout /t 2 /nobreak >nul
echo.
echo ========================================================
echo   Backend:  http://127.0.0.1:8001
echo   Frontend: http://localhost:5173
echo ========================================================
echo.
echo Abriendo aplicacion en el navegador...
start http://localhost:5173

exit /b 0
