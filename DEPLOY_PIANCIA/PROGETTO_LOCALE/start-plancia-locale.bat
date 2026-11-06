@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Atlas Plancia Locale
echo.
echo === Atlas Plancia Locale (PC only) ===
echo Folder: %CD%
echo.

where powershell >nul 2>&1
if errorlevel 1 (
  echo [ERROR] PowerShell not found on PATH.
  echo Install Windows PowerShell or use PowerShell 7, then retry.
  goto :fail
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-plancia-locale.ps1"
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" goto :fail
goto :eof

:fail
echo.
echo *** Start failed (exit code %ERR%). Window stays open so you can read the message above. ***
echo After fixing, double-click this .bat again.
echo.
pause
exit /b %ERR%
