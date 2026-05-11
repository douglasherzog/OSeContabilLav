$ErrorActionPreference = 'Stop'

# 1) Corrigir PostCSS para CommonJS
$postcssJs  = Join-Path $PSScriptRoot '..\postcss.config.js'
$postcssCjs = Join-Path $PSScriptRoot '..\postcss.config.cjs'
$commonJs = @'
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
'@
if (Test-Path $postcssJs) {
  Set-Content -Path $postcssJs -Value $commonJs -Encoding UTF8
}
Set-Content -Path $postcssCjs -Value $commonJs -Encoding UTF8

# 2) Garantir Node 20 portátil
$nodeBase = Join-Path $env:LOCALAPPDATA 'node20'
$nodeDir  = Join-Path $nodeBase 'node-v20.11.1-win-x64'
$nodeExe  = Join-Path $nodeDir  'node.exe'
if (-not (Test-Path $nodeExe)) {
  New-Item -ItemType Directory -Path $nodeBase -Force | Out-Null
  $zip = Join-Path $nodeBase 'node-v20.11.1-win-x64.zip'
  $url = 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip'
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip
  } catch {
    # Bypass TLS temporário
    $old = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    Invoke-WebRequest -Uri $url -OutFile $zip
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $old
  }
  Expand-Archive -LiteralPath $zip -DestinationPath $nodeBase -Force
}

# 3) Preparar PATH e shim de npm
$shimDir = Join-Path $PSScriptRoot '..\.cascade-shims'
New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
$npmShim = Join-Path $shimDir 'npm.cmd'
$npmCli  = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
$npmShimContent = @"
@echo off
setlocal
set "NODE_EXE=$nodeExe"
set "NPM_CLI=$npmCli"
"%NODE_EXE%" "%NPM_CLI%" %*
endlocal
"@
Set-Content -Path $npmShim -Value $npmShimContent -Encoding ASCII

$env:PATH = "$nodeDir;$shimDir;$env:PATH"

# 4) Variáveis de ambiente para rebuild nativo
$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
$env:GYP_MSVS_VERSION            = '2022'
$env:npm_config_msvs_version     = '2022'
$env:VSINSTALLDIR                = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools'
$env:npm_config_build_from_source= 'true'

# 5) Rebuild deps nativas do Electron (better-sqlite3)
try {
  & $nodeExe (Resolve-Path (Join-Path $PSScriptRoot '..\node_modules\electron-builder\out\cli\cli.js')) install-app-deps
} catch {
  # Tentativa direta com npm rebuild
  & $nodeExe $npmCli rebuild better-sqlite3 --build-from-source --msvs_version=2022
}

# 6) Build do frontend
& $nodeExe (Resolve-Path (Join-Path $PSScriptRoot '..\node_modules\vite\bin\vite.js')) build

# 7) Build do instalador
& $nodeExe (Resolve-Path (Join-Path $PSScriptRoot '..\node_modules\electron-builder\out\cli\cli.js'))

# 8) Provisionar banco de produção
& $nodeExe (Resolve-Path (Join-Path $PSScriptRoot '..\scripts\fetch-hetzner-exports.js'))
& $nodeExe (Resolve-Path (Join-Path $PSScriptRoot '..\scripts\build-prod-db-from-csv.js')) --from exports --out prod.db

# 9) Copiar prod.db para as pastas do app
$dest1 = Join-Path $env:APPDATA 'OSeContabilLav\osecontabil.db'
$dest2 = Join-Path $env:APPDATA 'OS e Contabil - Lav\osecontabil.db'
foreach ($d in @($dest1,$dest2)) {
  if (Test-Path $d) {
    Copy-Item $d ($d + '.bak_' + (Get-Date -Format yyyyMMddHHmmss)) -ErrorAction SilentlyContinue
  }
  Copy-Item (Join-Path $PSScriptRoot '..\prod.db') $d -Force -ErrorAction SilentlyContinue
}

Write-Host 'DONE: Build + Provision finalizados.'
