@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\quick-start-dev.ps1" -ProjectRoot "%~dp0"
endlocal
