$f = "c:\Users\Usuario\CascadeProjects\OSeContabilLav\electron\main.js"
$lines = Get-Content $f -Encoding UTF8

# --- Passo 1: remover bloco de migrations avulsas em initDb() (linhas 147-175) ---
# Localizar "  // Migracoes simples de schema" e o "  } catch (e) {" correspondente + linha de warn
$removeStart = -1
$removeEnd   = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($removeStart -lt 0 -and $lines[$i] -match "^\s+// Migra") { $removeStart = $i }
  if ($removeStart -ge 0 -and $removeEnd -lt 0 -and $lines[$i] -match "^\s+\} catch \(e\) \{" -and $i -gt $removeStart) {
    # A proxima linha deve ser o console.warn e a seguinte o fechamento
    if ($i+2 -lt $lines.Count -and $lines[$i+1] -match "console\.warn.*migrate" -and $lines[$i+2] -match "^\s+\}") {
      $removeEnd = $i + 2
      break
    }
  }
}
Write-Host "Bloco initDb migrations: linha $($removeStart+1) ate $($removeEnd+1)"
if ($removeStart -ge 0 -and $removeEnd -ge 0) {
  $lines = $lines[0..($removeStart-1)] + $lines[($removeEnd+1)..($lines.Count-1)]
  Write-Host "Bloco removido"
} else {
  Write-Host "AVISO: bloco nao encontrado"
}

Set-Content $f -Value $lines -Encoding UTF8
$lines = Get-Content $f -Encoding UTF8

# --- Passo 2: dentro de createSchema(), deixar applyMigrations() apenas APOS bank_accounts ---
# Remover a chamada na linha logo apos o db.exec(...) e manter apenas a que vem apos bank_accounts
$inSchema = $false
$applyLines = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match "^function createSchema") { $inSchema = $true }
  if ($inSchema -and $lines[$i].Trim() -eq "applyMigrations();") { $applyLines += $i }
  if ($inSchema -and $lines[$i] -match "^ipcMain\.handle") { $inSchema = $false }
}
Write-Host "applyMigrations() encontrada nas linhas: $($applyLines | ForEach-Object { $_+1 })"

# Remover TODAS e re-inserir apenas apos bank_accounts
$linesToDrop = $applyLines
$newLines = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($i -in $linesToDrop) { continue }
  $newLines += $lines[$i]
  # Inserir applyMigrations() logo apos a linha de bank_accounts
  if ($lines[$i] -match 'try \{ run\("CREATE TABLE IF NOT EXISTS bank_accounts') {
    $newLines += "  applyMigrations();"
  }
}
Write-Host "applyMigrations() reposicionada"

Set-Content $f -Value $newLines -Encoding UTF8
Write-Host "Script concluido"
