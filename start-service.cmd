@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1"
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
