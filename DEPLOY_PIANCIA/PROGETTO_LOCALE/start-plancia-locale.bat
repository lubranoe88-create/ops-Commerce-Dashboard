@echo off
setlocal EnableExtensions

REM Write last-run.txt FIRST so Emilio can read it even if the window flashes.
set "LOG=%~dp0last-run.txt"
> "%LOG%" echo ===== LAST RUN =====
>> "%LOG%" echo time=%DATE% %TIME%
>> "%LOG%" echo bat=%~f0
>> "%LOG%" echo folder=%~dp0
>> "%LOG%" echo arg1=%~1

REM Force a kept-open console (fixes instant-close / unreadable flash).
if /I not "%~1"=="KEEPOPEN" (
  >> "%LOG%" echo action=relaunch_cmd_k
  start "Atlas Plancia Locale" cmd /k call "%~f0" KEEPOPEN
  exit /b 0
)

echo.
echo ============================================================
echo  RUNNING BAT FILE:
echo  %~f0
echo  BAT FOLDER:
echo  %~dp0
echo  LOG FILE:
echo  %LOG%
echo ============================================================
echo.
echo A log is always written to last-run.txt in this folder.
echo If you cannot read the window, open last-run.txt and read it aloud.
echo.

echo %~dp0 | findstr /I "\\Temp\\ AppData\\Local\\Temp .zip" >nul
if not errorlevel 1 (
  echo ############################################################
  echo # STOP - TEMP OR ZIP COPY
  echo ############################################################
  >> "%LOG%" echo error=TEMP_OR_ZIP_PATH
  >> "%LOG%" echo detail=%~dp0
  goto FAIL
)

cd /d "%~dp0"
if errorlevel 1 (
  echo [ERROR] Cannot cd to bat folder
  >> "%LOG%" echo error=CD_FAILED
  goto FAIL
)

>> "%LOG%" echo cd=%CD%
echo Current directory now: %CD%
echo.

set "REPO_ROOT=%~dp0..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"
set "BACKEND=%REPO_ROOT%\backend"
set "PKG=%BACKEND%\package.json"

echo Repo root: %REPO_ROOT%
echo Backend  : %BACKEND%
>> "%LOG%" echo repo=%REPO_ROOT%
>> "%LOG%" echo backend=%BACKEND%
echo.

if not exist "%PKG%" (
  echo [ERROR] backend\package.json NOT FOUND.
  >> "%LOG%" echo error=BACKEND_MISSING
  >> "%LOG%" echo expected=%PKG%
  goto FAIL
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not on PATH. Install https://nodejs.org
  echo After install, CLOSE this window, open a NEW Explorer window, run the bat again.
  >> "%LOG%" echo error=NODE_NOT_ON_PATH
  >> "%LOG%" echo hint=Reboot or open new Explorer after Node install so PATH updates
  goto FAIL
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not on PATH. Reinstall Node.js.
  >> "%LOG%" echo error=NPM_NOT_ON_PATH
  goto FAIL
)

where powershell >nul 2>&1
if errorlevel 1 (
  echo [ERROR] PowerShell not found.
  >> "%LOG%" echo error=POWERSHELL_MISSING
  goto FAIL
)

echo Node:
node -v
npm -v
>> "%LOG%" echo node_ok=
node -v >> "%LOG%" 2>&1
npm -v >> "%LOG%" 2>&1
echo.
echo [INFO] LM Studio on Bionic is OPTIONAL for boot.
echo.

set "PS1=%~dp0start-plancia-locale.ps1"
if exist "%PS1%" (
  echo Launching: %PS1%
  >> "%LOG%" echo action=powershell_ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
) else (
  echo [WARN] ps1 missing - npm start fallback.
  >> "%LOG%" echo action=npm_fallback
  pushd "%BACKEND%"
  if not exist "node_modules\" (
    echo Installing dependencies...
    call npm ci --ignore-scripts
    if errorlevel 1 call npm install --ignore-scripts
    if errorlevel 1 (
      echo [ERROR] npm install failed
      >> "%LOG%" echo error=NPM_INSTALL_FAILED
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
  >> "%LOG%" echo action=npm_start
  call npm start
  popd
)

set "ERR=%ERRORLEVEL%"
>> "%LOG%" echo exit_code=%ERR%
if not "%ERR%"=="0" (
  echo *** process exited with code %ERR% ***
  >> "%LOG%" echo error=PROCESS_EXIT_%ERR%
  goto FAIL
)
echo Server process ended.
>> "%LOG%" echo status=SERVER_ENDED
goto END

:FAIL
echo.
echo *** FAILED ***
echo Open this file and read it aloud:
echo   %LOG%
echo.
>> "%LOG%" echo status=FAILED
timeout /t 15 >nul

:END
echo.
echo Log written to:
echo   %LOG%
echo.
pause
