@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\autostart.ps1" -Disable
pause
