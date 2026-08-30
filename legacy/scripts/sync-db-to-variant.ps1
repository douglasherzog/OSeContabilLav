# Sync the most recent DB to %APPDATA%\osecontabillav\osecontabil.db
$ErrorActionPreference = 'Stop'

function Get-LatestDb {
  param(
    [string[]]$Paths
  )
  $items = @()
  foreach ($p in $Paths) {
    if (Test-Path $p) { $items += (Get-Item $p) }
  }
  if ($items.Count -eq 0) { return $null }
  return ($items | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

$srcA = Join-Path $env:APPDATA 'OSeContabilLav\osecontabil.db'
$srcB = Join-Path $env:APPDATA 'OS e Contabil - Lav\osecontabil.db'
$latest = Get-LatestDb -Paths @($srcA, $srcB)

if (-not $latest) {
  Write-Host 'Nenhum DB candidato encontrado (origens vazias).'
  exit 2
}

$destDir = Join-Path $env:APPDATA 'osecontabillav'
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
$destDb = Join-Path $destDir 'osecontabil.db'

if (Test-Path $destDb) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $bak = "$destDb.bak-$stamp"
  Copy-Item -LiteralPath $destDb -Destination $bak -Force
  Write-Host "Backup criado: $bak"
}

Write-Host "Origem: $($latest.FullName)"
Write-Host "Destino: $destDb"
$srcResolved = (Resolve-Path -LiteralPath $latest.FullName).ProviderPath
$dstResolved = (Resolve-Path -LiteralPath $destDb -ErrorAction SilentlyContinue)
if ($dstResolved) { $dstResolved = $dstResolved.ProviderPath }
if ($srcResolved -and $dstResolved -and ($srcResolved -ieq $dstResolved)) {
  Write-Host 'Já está sincronizado (mesmo arquivo).'
} else {
  Copy-Item -LiteralPath $latest.FullName -Destination $destDb -Force
}

(Get-Item $destDb) | Select-Object FullName, Length, LastWriteTime | Format-List
Write-Host 'Concluido.'
