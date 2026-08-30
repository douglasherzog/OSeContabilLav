# Quick start dev: find Node and npm, set PATH, run npm run dev
param([string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
if (-not $PSBoundParameters.ContainsKey('ProjectRoot') -or [string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
if ($ProjectRoot) { $ProjectRoot = $ProjectRoot.Trim('"') }
Write-Host "Project root:" $ProjectRoot -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $ProjectRoot 'package.json'))) { Write-Error "package.json não encontrado" }

function Get-FirstExisting([string[]]$paths) {
  foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

$pf   = $env:ProgramFiles
$pf86 = ${env:ProgramFiles(x86)}
$local = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
$user = $env:USERPROFILE

$node = Get-FirstExisting @(
  (Join-Path $pf   'nodejs\node.exe'),
  (Join-Path $pf86 'nodejs\node.exe'),
  (Join-Path $local 'node.exe'),
  (Join-Path $user 'scoop\apps\nodejs\current\node.exe'),
  (Join-Path $env:ChocolateyInstall 'bin\node.exe'),
  (Join-Path $user 'nodejs\node.exe'),
  (Join-Path $user '.lmstudio\.internal\utils\node.exe')
)
if (-not $node) {
  try { $node = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source) } catch {}
}
if (-not $node) {
  try { $node = Get-ChildItem -Path $user -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName } catch {}
}
if (-not $node) { Write-Error 'Node.exe não encontrado' }
$env:PATH = ((Split-Path -Parent $node) + ';' + $env:PATH)
Write-Host ('Node: ' + $node)

$npm = Get-FirstExisting @(
  (Join-Path (Split-Path -Parent $node) 'npm.cmd'),
  (Join-Path $pf   'nodejs\npm.cmd'),
  (Join-Path $pf86 'nodejs\npm.cmd'),
  (Join-Path $local 'npm.cmd'),
  (Join-Path $user 'scoop\apps\nodejs\current\npm.cmd'),
  (Join-Path $env:ChocolateyInstall 'bin\npm.cmd'),
  (Join-Path $user 'nodejs\npm.cmd')
)
if (-not $npm) {
  try { $npm = (Get-Command npm -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source) } catch {}
}
if (-not $npm) {
  $projNpm = Join-Path $ProjectRoot '.cascade-shims\npm.cmd'
  if (Test-Path $projNpm) { $npm = $projNpm }
}
if (-not $npm) { Write-Error 'npm.cmd não encontrado' }
Write-Host ('npm: ' + $npm)

Push-Location $ProjectRoot
try {
  $env:PATH = (Join-Path $ProjectRoot '.cascade-shims') + ';' + $env:PATH
  & $npm --version
  & $npm run dev
} finally {
  Pop-Location
}
