@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Atlas Plancia Locale

echo.
echo ============================================================
echo  RUNNING FROM THIS PATH (read this aloud if it fails):
echo  %CD%
echo  Bat file: %~f0
echo ============================================================
echo.

echo %CD% | findstr /I "\Temp\ AppData\Local\Temp .zip" >nul
if not errorlevel 1 (
  echo [STOP] This is still a TEMP or ZIP path — NOT Documents.
  echo.
  echo You double-clicked the bat INSIDE the zip, or a Temp copy.
  echo.
  echo Do this instead:
  echo  1. Close ALL zip windows and this window
  echo  2. Delete or ignore the .zip file after extract
  echo  3. Open File Explorer address bar and type:
  echo     %%USERPROFILE%%\Documents\ops-Commerce-Dashboard
  echo  4. If you see ops-Commerce-Dashboard-main inside, open that
  echo  5. Open DEPLOY_PIANCIA then AVVIO_PC
  echo  6. Look at the address bar — it must say Documents, not Temp
  echo  7. Only then double-click start-plancia-locale.bat
  echo.
  echo Or with Git:
  echo   cd %%USERPROFILE%%\Documents
  echo   git clone https://github.com/lubranoe88-create/ops-Commerce-Dashboard.git
  echo   cd ops-Commerce-Dashboard\DEPLOY_PIANCIA\AVVIO_PC
  echo   start-plancia-locale.bat
  echo.
  goto :FAIL
)

set "REPO_ROOT=%~dp0..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"
set "BACKEND=%REPO_ROOT%\backend"
set "PKG=%BACKEND%\package.json"

echo Repo root: %REPO_ROOT%
echo Backend  : %BACKEND%
echo.

if not exist "%PKG%" (
  echo [ERROR] backend\package.json NOT FOUND.
  echo AVVIO_PC alone is not enough — need the FULL repo with backend\.
  echo Expected:
  echo   ops-Commerce-Dashboard\backend\package.json
  echo   ops-Commerce-Dashboard\DEPLOY_PIANCIA\AVVIO_PC\start-plancia-locale.bat
  goto :FAIL
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not on PATH. Install from https://nodejs.org
  goto :FAIL
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not on PATH. Reinstall Node.js.
  goto :FAIL
)
where powershell >nul 2>&1
if errorlevel 1 (
  echo [ERROR] PowerShell not found.
  goto :FAIL
)

echo Node:
node -v
npm -v
echo.
echo [INFO] LM Studio on Bionic is OPTIONAL for boot.
echo.

set "PS1=%~dp0start-plancia-locale.ps1"
if exist "%PS1%" (
  echo Launching PowerShell: %PS1%
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
) else (
  echo [WARN] ps1 missing next to bat — npm start fallback.
  pushd "%BACKEND%"
  if not exist "node_modules\" (
    echo Installing dependencies...
    call npm ci --ignore-scripts
    if errorlevel 1 call npm install --ignore-scripts
    if errorlevel 1 (
      echo [ERROR] npm install failed
      popd
      goto :FAIL
    )
  )
  if not exist ".env" if exist "%REPO_ROOT%\DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example" (
    copy /Y "%REPO_ROOT%\DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example" ".env"
  )
  set HOST=127.0.0.1
  if not defined PORT set PORT=8787
  if not defined ATLAS_MEMORY_DIR set "ATLAS_MEMORY_DIR=%BACKEND%\data\agentq-memory"
  if not exist "%ATLAS_MEMORY_DIR%\" mkdir "%ATLAS_MEMORY_DIR%"
  echo Open http://127.0.0.1:%PORT% after Dashboard listening
  call npm start
  popd
)

set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo *** exited with code %ERR% ***
  goto :FAIL
)
echo Server process ended.
pause
exit /b 0

:FAIL
echo.
echo *** FAILED — window stays open. Read RUNNING FROM path at the top. ***
pause
exit /b 1
