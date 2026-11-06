@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Atlas Plancia Locale
echo.
echo === Atlas Plancia Locale ===
echo Se l'aggiornamento fallisce vedrai un messaggio ROSSO qui sotto.
echo Per forzare l'update: doppio clic su FORZA-AGGIORNAMENTO.bat
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-plancia.ps1"
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 (
  echo.
  echo AVVIO TERMINATO CON ERRORE %ERR%
  pause
)
exit /b %ERR%
