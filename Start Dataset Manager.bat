@echo off
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0start.ps1"
if %ERRORLEVEL% NEQ 0 pause
