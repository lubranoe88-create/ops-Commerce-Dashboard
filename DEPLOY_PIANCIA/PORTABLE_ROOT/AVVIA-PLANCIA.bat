@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Atlas Plancia Locale
echo.
echo === Atlas Plancia Locale ===
echo Folder: %CD%
echo.
echo --- Aggiornamento da GitHub ---
REM Refresh forza-aggiornamento.ps1 first so a broken local copy cannot block startup.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $out = Join-Path -Path (Get-Location) -ChildPath 'forza-aggiornamento.ps1'; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/lubranoe88-create/ops-Commerce-Dashboard/main/DEPLOY_PIANCIA/AVVIO_PC/forza-aggiornamento.ps1' -OutFile $out; exit 0 } catch { Write-Host ('AVVISO: non ho potuto aggiornare lo script (' + $_.Exception.Message + ')') -ForegroundColor Yellow; exit 0 }"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0forza-aggiornamento.ps1"
set UPD=%ERRORLEVEL%
if %UPD% NEQ 0 (
  echo.
  echo ************************************************************
  echo  AGGIORNAMENTO FALLITO - continuo con i file locali vecchi
  echo  Per riprovare: doppio clic su FORZA-AGGIORNAMENTO.bat
  echo ************************************************************
  echo.
  timeout /t 5 >nul
) else (
  echo.
  echo ************************************************************
  echo  AGGIORNAMENTO OK oppure gia aggiornato - avvio plancia
  echo ************************************************************
  echo.
)

set "PATH=%~dp0node;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: portable Node not found in node\
  echo Re-download Plancia-Locale.zip
  pause
  exit /b 1
)

echo Node:
node -v
echo.

cd /d "%~dp0app\backend"
if not exist package.json (
  echo ERROR: app\backend\package.json missing
  pause
  exit /b 1
)

if not exist node_modules\ (
  echo First run: installing dependencies...
  call "%~dp0node\npm.cmd" ci --ignore-scripts
  if errorlevel 1 call "%~dp0node\npm.cmd" install --ignore-scripts
  if errorlevel 1 (
    echo ERROR: npm install failed. Need internet once for first install.
    pause
    exit /b 1
  )
)

set HOST=127.0.0.1
set PORT=8787
if not defined ATLAS_MEMORY_DIR set ATLAS_MEMORY_DIR=%~dp0app\backend\data\agentq-memory
if not exist "%ATLAS_MEMORY_DIR%\" mkdir "%ATLAS_MEMORY_DIR%"
set NODE_OPTIONS=

echo.
echo Wait for: Dashboard listening
echo Then open: http://127.0.0.1:8787
echo.
call "%~dp0node\npm.cmd" start
echo.
echo Server stopped.
pause
