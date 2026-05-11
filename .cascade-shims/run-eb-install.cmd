@echo off
setlocal
set "PATH=%~dp0;%PATH%"
set "NODE_EXE=%LOCALAPPDATA%\node20\node-v20.11.1-win-x64\node.exe"
set "EB_CLI=%CD%\node_modules\electron-builder\out\cli\cli.js"
"%NODE_EXE%" "%EB_CLI%" install-app-deps
endlocal
