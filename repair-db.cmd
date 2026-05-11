@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\repair-db.ps1" -ProjectRoot "%~dp0"
endlocal
