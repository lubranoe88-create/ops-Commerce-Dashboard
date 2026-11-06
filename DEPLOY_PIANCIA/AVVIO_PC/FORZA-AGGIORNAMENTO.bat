@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title FORZA AGGIORNAMENTO PLANCIA
echo.
echo === FORZA AGGIORNAMENTO PLANCIA ===
echo Scarica l'ultima versione da GitHub e aggiorna i file locali.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0forza-aggiornamento.ps1" -Interactive
set ERR=%ERRORLEVEL%
echo.
if %ERR% NEQ 0 (
  echo AGGIORNAMENTO FALLITO — leggi il messaggio qui sopra.
) else (
  echo Fatto. Ora doppio clic su AVVIA-PLANCIA.
)
echo.
pause
exit /b %ERR%
