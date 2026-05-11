# Repairs/ensures schema and seeds for payment_methods and bank_accounts directly in the SQLite DB
# Uses existing migration script scripts/migrate-payment-methods.js
# This script finds a Node runtime and runs the migration.

param(
  [string]$ProjectRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-Node {
  $pf   = $env:ProgramFiles
  $pf86 = ${env:ProgramFiles(x86)}
  $local = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
  $user = $env:USERPROFILE
  $cands = @(
    (Join-Path $pf   'nodejs\node.exe'),
    (Join-Path $pf86 'nodejs\node.exe'),
    (Join-Path $local 'node.exe'),
    (Join-Path $user 'scoop\apps\nodejs\current\node.exe'),
    (Join-Path $env:ChocolateyInstall 'bin\node.exe'),
    (Join-Path $user 'nodejs\node.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  $cands = @($cands)
  if ($cands -and @($cands).Count -gt 0) { return $cands[0] }
  # Fallback search
  $searchBases = @($pf, $pf86, $local, $user) | Where-Object { $_ -and (Test-Path $_) }
  foreach ($b in $searchBases) {
    $m = Get-ChildItem -Path $b -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if ($m) { return $m }
  }
  return $null
}

if (-not $PSBoundParameters.ContainsKey('ProjectRoot') -or [string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

if ($ProjectRoot) { $ProjectRoot = $ProjectRoot.Trim('"') }
Write-Host "Project root:" $ProjectRoot -ForegroundColor Cyan
$node = Find-Node
if (-not $node) { Write-Error "Node.js não encontrado. Instale ou ajuste o PATH." }

$scriptPath = Join-Path $ProjectRoot 'scripts\migrate-payment-methods.js'
if (-not (Test-Path $scriptPath)) { Write-Error "Script de migração não encontrado: $scriptPath" }

Push-Location $ProjectRoot
try {
  Write-Host "Executando migração com:" $node $scriptPath -ForegroundColor Green
  & $node $scriptPath
} finally {
  Pop-Location
}
