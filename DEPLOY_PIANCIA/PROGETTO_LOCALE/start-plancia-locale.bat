@echo off
setlocal EnableExtensions

echo.
echo ============================================================
echo  RUNNING BAT FILE:
echo  %~f0
echo  BAT FOLDER:
echo  %~dp0
echo ============================================================
echo.
echo If this window closes instantly, you are not running this new bat.
echo Re-download main from GitHub, Extract All to Documents, delete the zip.
echo.

REM Big Temp/zip warning using the bat's own folder (%~dp0), not explorer address bar.
echo %~dp0 | findstr /I "\\Temp\\ AppData\\Local\\Temp .zip" >nul
if not errorlevel 1 (
  echo ############################################################
  echo # STOP - TEMP OR ZIP COPY
  echo # Windows launched the bat from inside the zip / Temp.
  echo # This is NOT your Documents copy.
  echo ############################################################
  echo.
  echo Fix:
  echo  1. Close zip windows
  echo  2. Extract All to %USERPROFILE%\Documents\ops-Commerce-Dashboard
  echo  3. Delete or close the .zip
  echo  4. Open Documents folder in Explorer - address bar must say Documents
  echo  5. Open DEPLOY_PIANCIA\AVVIO_PC
  echo  6. Double-click start-plancia-locale.bat there
  echo.
  goto FAIL
)

cd /d "%~dp0"
if errorlevel 1 (
  echo [ERROR] Cannot cd to bat folder: %~dp0
  goto FAIL
)

echo Current directory now: %CD%
echo.

set "REPO_ROOT=%~dp0..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"
set "BACKEND=%REPO_ROOT%\backend"
set "PKG=%BACKEND%\package.json"

echo Repo root: %REPO_ROOT%
echo Backend  : %BACKEND%
echo.

if not exist "%PKG%" (
  echo [ERROR] backend\package.json NOT FOUND.
  echo AVVIO_PC needs the FULL repo next to it:
  echo   ops-Commerce-Dashboard\backend\package.json
  echo   ops-Commerce-Dashboard\DEPLOY_PIANCIA\AVVIO_PC\
  goto FAIL
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not on PATH. Install https://nodejs.org
  goto FAIL
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not on PATH. Reinstall Node.js.
  goto FAIL
)
where powershell >nul 2>&1
if errorlevel 1 (
  echo [ERROR] PowerShell not found.
  goto FAIL
)

echo Node:
node -v
npm -v
echo.
echo [INFO] LM Studio on Bionic is OPTIONAL for boot.
echo.

set "PS1=%~dp0start-plancia-locale.ps1"
if exist "%PS1%" (
  echo Launching: %PS1%
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
) else (
  echo [WARN] ps1 missing - using npm start fallback.
  pushd "%BACKEND%"
  if not exist "node_modules\" (
    echo Installing dependencies...
    call npm ci --ignore-scripts
    if errorlevel 1 call npm install --ignore-scripts
    if errorlevel 1 (
      echo [ERROR] npm install failed
      popd
      goto FAIL
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
  echo *** process exited with code %ERR% ***
  goto FAIL
)
echo Server process ended.
goto END

:FAIL
echo.
echo *** FAILED - read RUNNING BAT FILE path at the top ***
echo.

:END
echo.
pause
endlocal
