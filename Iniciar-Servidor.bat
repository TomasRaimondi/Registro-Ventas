@echo off
title Registro de Ventas - Servidor
cd /d "%~dp0"
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
echo.
echo El servidor se detuvo.
pause
