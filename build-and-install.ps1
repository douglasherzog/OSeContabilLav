# build-and-install.ps1
# Compila o app Electron e executa o instalador gerado
# Uso: clique direito > "Executar com PowerShell"  ou  .\build-and-install.ps1

Set-StrictMode -Off
$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Ok($msg) {
    Write-Host "    OK: $msg" -ForegroundColor Green
}

function Fail($msg) {
    Write-Host ""
    Write-Host "ERRO: $msg" -ForegroundColor Red
    Write-Host "Pressione Enter para fechar..." -ForegroundColor Yellow
    Read-Host | Out-Null
    exit 1
}

# ---------- 1. Verificar Node / npm ----------
Step "Verificando Node.js e npm..."
try {
    $nodeVer = node --version 2>&1
    $npmVer  = npm  --version 2>&1
    Ok "Node $nodeVer  /  npm $npmVer"
} catch {
    Fail "Node.js nao encontrado. Instale em https://nodejs.org"
}

# ---------- 2. npm install ----------
Step "Instalando dependencias (npm install)..."
Push-Location $ProjectDir
try {
    npm install --prefer-offline 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { Fail "npm install falhou (exit $LASTEXITCODE)" }
    Ok "Dependencias instaladas"
} finally { Pop-Location }

# ---------- 3. npm run build ----------
Step "Compilando React + gerando instalador (npm run build)..."
Push-Location $ProjectDir
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail "npm run build falhou (exit $LASTEXITCODE)" }
    Ok "Build concluido"
} finally { Pop-Location }

# ---------- 4. Localizar o .exe gerado ----------
Step "Localizando instalador gerado..."
$distDir = Join-Path $ProjectDir "dist-electron"
$exe = Get-ChildItem -Path $distDir -Filter "*.exe" -ErrorAction SilentlyContinue |
       Where-Object { $_.Name -notmatch "blockmap" } |
       Sort-Object LastWriteTime -Descending |
       Select-Object -First 1

if (-not $exe) { Fail "Nenhum .exe encontrado em $distDir" }
Ok "Instalador: $($exe.FullName)"

# ---------- 5. Fechar o app se estiver rodando ----------
Step "Verificando se o app esta aberto..."
$appProc = Get-Process -Name "OS e Contabil - Lavanderia" -ErrorAction SilentlyContinue
if (-not $appProc) {
    $appProc = Get-Process | Where-Object { $_.MainWindowTitle -match "OS e Contabil" -or $_.ProcessName -match "osecontabil" } -ErrorAction SilentlyContinue
}
if ($appProc) {
    Write-Host "    App detectado (PID $($appProc.Id)) - encerrando antes de instalar..." -ForegroundColor Yellow
    $appProc | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Ok "App encerrado"
} else {
    Ok "App nao estava rodando"
}

# ---------- 6. Executar o instalador ----------
Step "Iniciando instalador..."
Write-Host "    $($exe.FullName)" -ForegroundColor White
Start-Process -FilePath $exe.FullName -Wait

Write-Host ""
Write-Host "Instalacao concluida." -ForegroundColor Green
Write-Host "Pressione Enter para fechar..." -ForegroundColor Yellow
Read-Host | Out-Null
