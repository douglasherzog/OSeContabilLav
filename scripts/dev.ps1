# Starts the dev environment even if Node/NPM are not in PATH (Windows)
# - Locates npm.cmd (or falls back to node + npm-cli.js)
# - Runs: npm run dev in the repo root
# Usage: Right-click > Run with PowerShell, or run via start-dev.cmd in project root

param(
  [string]$ProjectRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-Npm {
  $pf   = $env:ProgramFiles
  $pf86 = ${env:ProgramFiles(x86)}

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
  $searchBases = @($pf, $pf86, $local, $user) | Where-Object { $_ -and (Test-Path $_) }
  foreach ($b in $searchBases) {
    $m = Get-ChildItem -Path $b -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if ($m) { return $m }
  }
  return $null
}
  $local = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
  $user = $env:USERPROFILE

  $cands = @(
    (Join-Path $pf   'nodejs\npm.cmd'),
    (Join-Path $pf86 'nodejs\npm.cmd'),
    (Join-Path $local 'npm.cmd'),
    (Join-Path $user 'scoop\apps\nodejs\current\npm.cmd'),
    (Join-Path $env:ChocolateyInstall 'bin\npm.cmd'),
    (Join-Path $user 'nodejs\npm.cmd')
  ) | Where-Object { $_ -and (Test-Path $_) }
  $cands = @($cands)
  if ($cands -and @($cands).Count -gt 0) {
    return @{ Type='npm'; Path=$cands[0] }
  }

  # Fallback: search a bit (first match)
  $searchBases = @($pf, $pf86, $local, $user) | Where-Object { $_ -and (Test-Path $_) }
  foreach ($b in $searchBases) {
    $m = Get-ChildItem -Path $b -Filter npm.cmd -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if ($m) { return @{ Type='npm'; Path=$m } }
  }

  # Last resort: node.exe + npm-cli.js
  $nodePaths = @(
    (Join-Path $pf   'nodejs\node.exe'),
    (Join-Path $pf86 'nodejs\node.exe'),
    (Join-Path $local 'node.exe'),
    (Join-Path $user 'scoop\apps\nodejs\current\node.exe'),
    (Join-Path $env:ChocolateyInstall 'bin\node.exe'),
    (Join-Path $user 'nodejs\node.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  $nodePaths = @($nodePaths)
  if ($nodePaths -and @($nodePaths).Count -gt 0) {
    $node = $nodePaths[0]
    $nodeDir = Split-Path -Parent $node
    $npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
    if (Test-Path $npmCli) {
      return @{ Type='node+npmcli'; Node=$node; NpmCli=$npmCli }
    }
  }

  return $null
}

if (-not $PSBoundParameters.ContainsKey('ProjectRoot') -or [string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

if ($ProjectRoot) { $ProjectRoot = $ProjectRoot.Trim('"') }
Write-Host "Project root:" $ProjectRoot -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $ProjectRoot 'package.json'))) {
  Write-Error "package.json não encontrado em $ProjectRoot"
}

$npmInfo = Find-Npm
if (-not $npmInfo) {
  Write-Error "npm não encontrado em caminhos comuns. Instale Node.js ou ajuste o PATH."
}

Push-Location $ProjectRoot
try {
  if ($npmInfo.Type -eq 'npm') {
    Write-Host "Iniciando com" $npmInfo.Path -ForegroundColor Green
    $npmDir = Split-Path -Parent $npmInfo.Path
    $nodeExe = Join-Path $npmDir 'node.exe'
    $prepend = $null
    if (Test-Path $nodeExe) { $prepend = $npmDir } else { $n = Find-Node; if ($n) { $prepend = (Split-Path -Parent $n) } }
    if ($prepend) { $env:PATH = ($prepend + ';' + $env:PATH) }
    & $npmInfo.Path run dev
  } elseif ($npmInfo.Type -eq 'node+npmcli') {
    Write-Host "Iniciando com node + npm-cli.js" -ForegroundColor Green
    & $npmInfo.Node $npmInfo.NpmCli run dev
  } else {
    Write-Error "Forma de execução do npm não suportada."
  }
} finally {
  Pop-Location
}
