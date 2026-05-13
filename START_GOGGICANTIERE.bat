@echo off
cd /d "%~dp0"
title Goggicantiere Startserver
echo Starte Goggicantiere...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
echo.
echo Fenster kann geschlossen werden.
pause
