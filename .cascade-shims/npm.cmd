@echo off
setlocal
set "NODE_EXE=C:\Users\Usuario\AppData\Local\node20\node-v20.11.1-win-x64\node.exe"
set "NPM_CLI=C:\Users\Usuario\AppData\Local\node20\node-v20.11.1-win-x64\node_modules\npm\bin\npm-cli.js"
"%NODE_EXE%" "%NPM_CLI%" %*
endlocal
