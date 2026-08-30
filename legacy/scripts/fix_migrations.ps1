$f = "c:\Users\Usuario\CascadeProjects\OSeContabilLav\electron\main.js"
$lines = Get-Content $f -Encoding UTF8

# --- Passo 1: localizar e remover o primeiro bloco duplicado MIGRATIONS (o mais curto, linhas ~369-451) ---
$firstStart = -1
$firstEnd   = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($firstStart -lt 0 -and $lines[$i] -match "^// --- Sistema de migrations versionadas ---$") {
    $firstStart = $i
  }
  if ($firstStart -ge 0 -and $firstEnd -lt 0 -and $lines[$i] -match "^// ---$" -and $i -gt $firstStart) {
    $firstEnd = $i
    break
  }
}
Write-Host "Primeiro bloco MIGRATIONS: linha $($firstStart+1) ate $($firstEnd+1)"

if ($firstStart -ge 0 -and $firstEnd -ge 0) {
  $lines = $lines[0..($firstStart-1)] + $lines[($firstEnd+1)..($lines.Count-1)]
  Write-Host "Primeiro bloco removido"
} else {
  Write-Host "AVISO: primeiro bloco nao encontrado"
}

# Reler apos remocao
Set-Content $f -Value $lines -Encoding UTF8
$lines = Get-Content $f -Encoding UTF8

# --- Passo 2: remover chamada dupla de applyMigrations() dentro de createSchema() ---
# Manter apenas a PRIMEIRA ocorrencia dentro de createSchema
$inSchema = $false
$applyCount = 0
$linesToRemove = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match "^function createSchema\(\)") { $inSchema = $true }
  if ($inSchema -and $lines[$i] -match "^\s+applyMigrations\(\);") {
    $applyCount++
    if ($applyCount -gt 1) { $linesToRemove += $i }
  }
  if ($inSchema -and $lines[$i] -match "^ipcMain\.handle") { $inSchema = $false }
}
Write-Host "Chamadas duplicadas de applyMigrations a remover: $($linesToRemove.Count)"
$lines = $lines | Where-Object { $lines.IndexOf($_) -notin $linesToRemove }

# Reler
Set-Content $f -Value $lines -Encoding UTF8
$lines = Get-Content $f -Encoding UTF8

# --- Passo 3: remover ALTER TABLEs avulsos remanescentes dentro de createSchema() ---
# Sao os try { run("ALTER TABLE ... que estao apos o bloco de indices e antes do fim de createSchema
$alterPatterns = @(
  '  try { run("ALTER TABLE service_orders ADD COLUMN expected_at TEXT"); } catch(_){}',
  '  try { run("ALTER TABLE services ADD COLUMN requires_entry INTEGER DEFAULT 0"); } catch(_){}',
  '  try { run("ALTER TABLE services ADD COLUMN entry_pct REAL DEFAULT 50"); } catch(_){}',
  '  try { run("ALTER TABLE os_items ADD COLUMN requires_entry INTEGER DEFAULT 0"); } catch(_){}',
  '  try { run("ALTER TABLE os_items ADD COLUMN entry_pct REAL DEFAULT 50"); } catch(_){}',
  '  try { run("ALTER TABLE salary_advances ADD COLUMN reference_month TEXT"); } catch(_){}',
  '  try { run("ALTER TABLE clients ADD COLUMN first_name TEXT NOT NULL DEFAULT ''''"); } catch(_){}',
  '  try { run("ALTER TABLE clients ADD COLUMN last_name TEXT NOT NULL DEFAULT ''''"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_payable ADD COLUMN recurrence_id INTEGER"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_payable_recurrences ADD COLUMN recurrence_type TEXT DEFAULT ''variable''"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_payable_recurrences ADD COLUMN installments_count INTEGER"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_payable ADD COLUMN source_type TEXT DEFAULT ''ap''"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_payable ADD COLUMN source_id INTEGER"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_receivable ADD COLUMN recurrence_id INTEGER"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_receivable_recurrences ADD COLUMN recurrence_type TEXT DEFAULT ''variable''"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_receivable_recurrences ADD COLUMN installments_count INTEGER"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_receivable ADD COLUMN source_type TEXT DEFAULT ''ar''"); } catch(_){}',
  '  try { run("ALTER TABLE accounts_receivable ADD COLUMN source_id INTEGER"); } catch(_){}',
  '  try { run("ALTER TABLE os_payments ADD COLUMN account_label TEXT"); } catch(_){ }',
  '  try { run("UPDATE cash_ledger SET method=''dinheiro'' WHERE method IS NULL OR TRIM(method)=''''"); } catch(_){ }',
  '  try { run("UPDATE accounts_payable SET method=COALESCE(NULLIF(TRIM(method),''''),''dinheiro'')"); } catch(_){ }',
  '  try { run("UPDATE accounts_receivable SET method=COALESCE(NULLIF(TRIM(method),''''),''dinheiro'')"); } catch(_){ }'
)

$removed = 0
$newLines = @()
foreach ($line in $lines) {
  $skip = $false
  foreach ($pat in $alterPatterns) {
    if ($line.TrimEnd() -eq $pat.TrimEnd()) { $skip = $true; $removed++; break }
  }
  if (-not $skip) { $newLines += $line }
}
Write-Host "ALTER TABLEs avulsos removidos: $removed"

Set-Content $f -Value $newLines -Encoding UTF8
Write-Host "Script concluido"
