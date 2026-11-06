@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Atlas Plancia Locale
echo.
echo === Atlas Plancia Locale (PC only) ===
echo Folder: %CD%
echo.

REM Detect zip/Temp open (Explorer only drops THIS .bat into Temp).
echo %CD% | findstr /I "\\Temp\\ AppData\\Local\\Temp" >nul
if not errorlevel 1 (
  echo [STOP] You are running from a TEMP / zip path.
  echo.
  echo Windows is NOT using your real project folder.
  echo Do this exactly:
  echo.
  echo  1. Close this window
  echo  2. Find the file: ops-Commerce-Dashboard-main.zip
  echo     ^(Downloads folder, or wherever you saved it^)
  echo  3. RIGHT-CLICK the zip - choose "Extract All..."
  echo  4. Extract to:  %USERPROFILE%\Documents\ops-Commerce-Dashboard
  echo  5. Open that folder in Explorer
  echo  6. Go to:  DEPLOY_PIANCIA\AVVIO_PC
  echo  7. Double-click start-plancia-locale.bat THERE
  echo.
  echo Path must LOOK LIKE:
  echo   %USERPROFILE%\Documents\ops-Commerce-Dashboard\DEPLOY_PIANCIA\AVVIO_PC
  echo Path must NOT contain "Temp" or ".zip".
  echo.
  pause
  exit /b 2
)

where powershell >nul 2>&1
if errorlevel 1 (
  echo [ERROR] PowerShell not found.
  pause
  exit /b 1
)

REM Prefer sibling .ps1 when present; otherwise run built-in starter (single-file).
set "PS1=%~dp0start-plancia-locale.ps1"
if exist "%PS1%" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
) else (
  echo [INFO] start-plancia-locale.ps1 not beside bat — using built-in starter.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CD%'; $ErrorActionPreference='Stop'; function Wait-Exit([int]$c,[string]$m){ Write-Host ''; Write-Host ('ERROR: '+$m) -ForegroundColor Red; Write-Host ('Exit: '+$c); Write-Host 'Press Enter...'; try{[void][Console]::ReadLine()}catch{Start-Sleep 60}; exit $c }; function Find-Root([string]$start){ $d=$start; for($i=0;$i -lt 8;$i++){ if(Test-Path -LiteralPath (Join-Path $d 'backend\package.json')){ return $d }; $p=Split-Path -Parent $d; if(-not $p -or $p -eq $d){break}; $d=$p }; $null }; $here=(Get-Location).Path; $Root=Find-Root $here; if(-not $Root){ Wait-Exit 1 'backend\package.json not found. Extract the FULL repo zip to Documents first.' }; $Backend=Join-Path $Root 'backend'; Write-Host ('Repo: '+$Root); if(-not (Get-Command node -EA SilentlyContinue)){ Wait-Exit 3 'Install Node 20+ from https://nodejs.org then retry.' }; if(-not (Get-Command npm -EA SilentlyContinue)){ Wait-Exit 4 'npm missing — reinstall Node.js' }; Write-Host ((node -v)+' / '+(npm -v)); Set-Location -LiteralPath $Backend; if(-not (Test-Path 'node_modules')){ Write-Host 'npm ci --ignore-scripts...'; npm ci --ignore-scripts; if($LASTEXITCODE -ne 0){ npm install --ignore-scripts; if($LASTEXITCODE -ne 0){ Wait-Exit 5 'npm install failed' } } }; $ex=Join-Path $Root 'DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example'; if((-not (Test-Path '.env')) -and (Test-Path $ex)){ Copy-Item -LiteralPath $ex -Destination '.env'; Write-Host 'Created .env — set SITE_PASSWORD' -ForegroundColor Yellow }; $env:HOST='127.0.0.1'; if(-not $env:PORT){$env:PORT='8787'}; if(-not $env:ATLAS_MEMORY_DIR){$env:ATLAS_MEMORY_DIR=(Join-Path $Backend 'data\agentq-memory')}; New-Item -ItemType Directory -Force -Path $env:ATLAS_MEMORY_DIR | Out-Null; Write-Host ('Open http://127.0.0.1:'+$env:PORT+' after Dashboard listening') -ForegroundColor Green; npm start; if($LASTEXITCODE -ne 0){ Wait-Exit 6 ('npm start failed '+$LASTEXITCODE) }"
)

set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo *** Failed (exit %ERR%). ***
  pause
  exit /b %ERR%
)
endlocal
