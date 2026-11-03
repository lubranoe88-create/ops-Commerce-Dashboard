@echo off
REM Wrapper Windows: avvia lo script PowerShell con policy di processo.
setlocal
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-llama-server.ps1" %*
exit /b %ERRORLEVEL%
