@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM Log ONLY to TEMP. Writing into OneDrive Documents causes Accesso negato spam.
set "LOG=%TEMP%\plancia-avvio-last-run.txt"
> "%LOG%" (
  echo ===== LAST RUN =====
  echo time=%DATE% %TIME%
  echo bat=%~f0
  echo folder=%~dp0
)

echo.
echo ============================================================
echo  RUNNING BAT FILE:
echo  %~f0
echo  BAT FOLDER:
echo  %~dp0
echo  LOG FILE (Temp only):
echo  %LOG%
echo ============================================================
echo.

echo %~dp0 | findstr /I "OneDrive \\Documents\\" >nul
if not errorlevel 1 (
  echo [WARN] Project is under Documents/OneDrive.
  echo OneDrive often blocks npm with Accesso negato.
  echo Best fix: move the whole folder to:
  echo   C:\Atlas\ops-Commerce-Dashboard-main
  echo then run:
  echo   C:\Atlas\ops-Commerce-Dashboard-main\DEPLOY_PIANCIA\AVVIO_PC\start-plancia-locale.bat
  echo.
  >> "%LOG%" echo warn=ONEDRIVE_OR_DOCUMENTS_PATH
)

echo %~dp0 | findstr /I "\\Temp\\ AppData\\Local\\Temp .zip" >nul
if not errorlevel 1 (
  echo [STOP] TEMP/zip path. Extract to C:\Atlas instead.
  >> "%LOG%" echo error=TEMP_OR_ZIP
  goto FAIL
)

set "REPO_ROOT=%~dp0..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"
set "BACKEND=%REPO_ROOT%\backend"
set "PKG=%BACKEND%\package.json"

echo Repo root: %REPO_ROOT%
echo Backend  : %BACKEND%
>> "%LOG%" echo repo=%REPO_ROOT%
echo.

if not exist "%PKG%" (
  echo [ERROR] backend\package.json NOT FOUND
  >> "%LOG%" echo error=BACKEND_MISSING
  goto FAIL
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not on PATH. https://nodejs.org
  >> "%LOG%" echo error=NODE_NOT_ON_PATH
  goto FAIL
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not on PATH
  >> "%LOG%" echo error=NPM_NOT_ON_PATH
  goto FAIL
)

echo Node:
node -v
npm -v
>> "%LOG%" echo node_version=
node -v >> "%LOG%" 2>&1
echo.

if not defined ATLAS_MEMORY_DIR set "ATLAS_MEMORY_DIR=%LOCALAPPDATA%\AtlasPlancia\agentq-memory"
if not exist "%ATLAS_MEMORY_DIR%\" mkdir "%ATLAS_MEMORY_DIR%" 2>nul
echo Memory dir: %ATLAS_MEMORY_DIR%
>> "%LOG%" echo memory=%ATLAS_MEMORY_DIR%

set "HOST=127.0.0.1"
if not defined PORT set "PORT=8787"

pushd "%BACKEND%"
if errorlevel 1 (
  echo [ERROR] Cannot enter backend folder
  >> "%LOG%" echo error=PUSHD_BACKEND_FAILED
  goto FAIL
)

if not exist "node_modules\" (
  echo Installing dependencies into backend\node_modules ...
  echo If Accesso negato appears, MOVE the repo to C:\Atlas and retry.
  call npm ci --ignore-scripts
  if errorlevel 1 call npm install --ignore-scripts
  if errorlevel 1 (
    echo [ERROR] npm install failed - likely OneDrive. Move repo to C:\Atlas\
    >> "%LOG%" echo error=NPM_INSTALL_FAILED
    popd
    goto FAIL
  )
)

if not exist ".env" if exist "%REPO_ROOT%\DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example" (
  copy /Y "%REPO_ROOT%\DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example" ".env" >nul 2>&1
)

echo.
echo [INFO] LM Studio optional for boot.
echo Wait for: Dashboard listening
echo Then open: http://127.0.0.1:%PORT%
echo.
>> "%LOG%" echo action=npm_start
call npm start
set "ERR=%ERRORLEVEL%"
popd

>> "%LOG%" echo exit_code=%ERR%
if not "%ERR%"=="0" (
  echo *** npm start exited %ERR% ***
  >> "%LOG%" echo error=NPM_START_%ERR%
  goto FAIL
)
echo Server ended.
>> "%LOG%" echo status=OK_ENDED
goto END

:FAIL
echo.
echo *** FAILED ***
echo Read this log aloud:
echo   %LOG%
echo.
echo Quick fix for Accesso negato:
echo  1. Move folder to C:\Atlas\ops-Commerce-Dashboard-main
echo  2. Right-click bat - Properties - Unblock - Apply
echo  3. Run bat from C:\Atlas\...\AVVIO_PC
echo.
>> "%LOG%" echo status=FAILED
timeout /t 20

:END
echo.
echo Log: %LOG%
pause
