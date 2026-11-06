@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Atlas Plancia Locale
echo.
echo === Atlas Plancia Locale (PC only) ===
echo Folder: %CD%
echo.

REM Relative path only — same folder as this .bat (no absolute hardcoded path).
set "PS1=%~dp0start-plancia-locale.ps1"

where powershell >nul 2>&1
if errorlevel 1 (
  echo [ERROR] PowerShell not found on PATH.
  goto :fail
)

if not exist "%PS1%" (
  echo [ERROR] Missing file next to the .bat:
  echo   %PS1%
  echo.
  echo Cause: you opened/ran the .bat from INSIDE the zip ^(Temp folder^).
  echo Windows then copies only the .bat, not the .ps1.
  echo.
  echo FIX:
  echo 1. Close this window
  echo 2. Right-click ops-Commerce-Dashboard-main.zip - Extract All
  echo 3. Extract to Documents\ops-Commerce-Dashboard
  echo 4. Open Documents\ops-Commerce-Dashboard\DEPLOY_PIANCIA\AVVIO_PC
  echo 5. Confirm BOTH files are there:
  echo      start-plancia-locale.bat
  echo      start-plancia-locale.ps1
  echo 6. Double-click the .bat in THAT extracted folder
  echo.
  set "ERR=2"
  goto :fail
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" goto :fail
goto :eof

:fail
if not defined ERR set "ERR=1"
echo.
echo *** Start failed (exit code %ERR%). Window stays open. ***
echo After fixing, double-click this .bat again from the extracted folder.
echo.
pause
exit /b %ERR%
