@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title FORZA AGGIORNAMENTO PLANCIA
echo.
echo === FORZA AGGIORNAMENTO PLANCIA ===
echo Scarico lo script aggiornato da GitHub (sostituisce eventuali copie rotte)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $out = Join-Path -Path (Get-Location) -ChildPath 'forza-aggiornamento.ps1'; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/lubranoe88-create/ops-Commerce-Dashboard/main/DEPLOY_PIANCIA/AVVIO_PC/forza-aggiornamento.ps1' -OutFile $out; Write-Host 'Script OK.' -ForegroundColor Green; exit 0 } catch { Write-Host ('ERRORE download: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
if errorlevel 1 (
  echo.
  echo Download fallito. Serve internet.
  echo Link ZIP: https://github.com/lubranoe88-create/ops-Commerce-Dashboard/releases/download/plancia-locale-pack/Plancia-Locale.zip
  pause
  exit /b 1
)

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
