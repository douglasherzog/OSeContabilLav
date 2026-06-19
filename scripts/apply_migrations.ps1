$f = "c:\Users\Usuario\CascadeProjects\OSeContabilLav\electron\main.js"
$c = Get-Content $f -Raw -Encoding UTF8

# 1. Inserir bloco MIGRATIONS[] + applyMigrations() antes de createSchema()
$migrationsBlock = @'

// --- Sistema de migrations versionadas ---
// Cada entrada e aplicada exatamente uma vez, identificada pelo indice (1-based).
// O PRAGMA user_version do banco registra quantas ja foram aplicadas.
// Para adicionar uma nova migration: acrescentar ao final do array MIGRATIONS.
const MIGRATIONS = [
  // v1: colunas incrementais de OS e servicos
  () => {
    try { db.prepare("ALTER TABLE service_orders ADD COLUMN expected_at TEXT").run(); } catch(_){}
    try { db.prepare("ALTER TABLE services ADD COLUMN requires_entry INTEGER DEFAULT 0").run(); } catch(_){}
    try { db.prepare("ALTER TABLE services ADD COLUMN entry_pct REAL DEFAULT 50").run(); } catch(_){}
    try { db.prepare("ALTER TABLE os_items ADD COLUMN requires_entry INTEGER DEFAULT 0").run(); } catch(_){}
    try { db.prepare("ALTER TABLE os_items ADD COLUMN entry_pct REAL DEFAULT 50").run(); } catch(_){}
  },
  // v2: reference_month em salary_advances
  () => {
    try { db.prepare("ALTER TABLE salary_advances ADD COLUMN reference_month TEXT").run(); } catch(_){}
  },
  // v3: first_name/last_name em clients
  () => {
    try { db.prepare("ALTER TABLE clients ADD COLUMN first_name TEXT NOT NULL DEFAULT ''").run(); } catch(_){}
    try { db.prepare("ALTER TABLE clients ADD COLUMN last_name TEXT NOT NULL DEFAULT ''").run(); } catch(_){}
  },
  // v4: integracao caixa em contas a pagar/receber
  () => {
    try { db.prepare("ALTER TABLE accounts_payable ADD COLUMN recurrence_id INTEGER").run(); } catch(_){}
    try { db.prepare("ALTER TABLE accounts_payable_recurrences ADD COLUMN recurrence_type TEXT DEFAULT 'variable'").run(); } catch(_){}
    try { db.prepare("ALTER TABLE accounts_payable_recurrences ADD COLUMN installments_count INTEGER").run(); } catch(_){}
    try { db.prepare("ALTER TABLE accounts_payable ADD COLUMN source_type TEXT DEFAULT 'ap'").run(); } catch(_){}
    try { db.prepare("ALTER TABLE accounts_payable ADD COLUMN source_id INTEGER").run(); } catch(_){}
    try { db.prepare("ALTER TABLE accounts_receivable ADD COLUMN recurrence_id INTEGER").run(); } catch(_){}
    try { db.prepare("ALTER TABLE accounts_receivable_recurrences ADD COLUMN recurrence_type TEXT DEFAULT 'variable'").run(); } catch(_){}
    try { db.prepare("ALTER TABLE accounts_receivable_recurrences ADD COLUMN installments_count INTEGER").run(); } catch(_){}
    try { db.prepare("ALTER TABLE accounts_receivable ADD COLUMN source_type TEXT DEFAULT 'ar'").run(); } catch(_){}
    try { db.prepare("ALTER TABLE accounts_receivable ADD COLUMN source_id INTEGER").run(); } catch(_){}
  },
  // v5: advance_type em salary_advances + account_label em os_payments
  () => {
    try { db.prepare("ALTER TABLE salary_advances ADD COLUMN advance_type TEXT DEFAULT 'regular'").run(); } catch(_){}
    try { db.prepare("ALTER TABLE os_payments ADD COLUMN account_label TEXT").run(); } catch(_){}
  },
  // v6: normalizar metodos de pagamento nulos
  () => {
    try { db.prepare("UPDATE cash_ledger SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''").run(); } catch(_){}
    try { db.prepare("UPDATE accounts_payable SET method=COALESCE(NULLIF(TRIM(method),''),'dinheiro')").run(); } catch(_){}
    try { db.prepare("UPDATE accounts_receivable SET method=COALESCE(NULLIF(TRIM(method),''),'dinheiro')").run(); } catch(_){}
  },
  // v7: corrigir occurred_at com T e remover os_pagamentos duplicados
  () => {
    try { db.prepare("UPDATE cash_ledger SET occurred_at = REPLACE(occurred_at, 'T', ' ') WHERE occurred_at LIKE '%T%'").run(); } catch(_){}
    try { db.prepare("DELETE FROM cash_ledger WHERE category='os_pagamento' AND (source_id IS NULL OR source_type != 'os')").run(); } catch(_){}
  },
  // v8: colunas de RH em employees
  () => {
    try { db.prepare("ALTER TABLE employees ADD COLUMN admission_date TEXT").run(); } catch(_){}
    try { db.prepare("ALTER TABLE employees ADD COLUMN base_salary REAL DEFAULT 0").run(); } catch(_){}
    try { db.prepare("ALTER TABLE employees ADD COLUMN vacation_accrual_start TEXT").run(); } catch(_){}
  },
  // v9: paid_amount em salary_balance_pending
  () => {
    try { db.prepare("ALTER TABLE salary_balance_pending ADD COLUMN paid_amount REAL DEFAULT 0").run(); } catch(_){}
  },
];

function applyMigrations() {
  const current = db.pragma('user_version', { simple: true }) || 0;
  const pending = MIGRATIONS.slice(current);
  if (pending.length === 0) return;
  console.log(`[migrations] Aplicando ${pending.length} migration(s) (v${current} -> v${MIGRATIONS.length})`);
  const tx = db.transaction(() => {
    for (let i = 0; i < pending.length; i++) {
      try {
        pending[i]();
        console.log(`[migrations] v${current + i + 1} OK`);
      } catch (e) {
        console.error(`[migrations] v${current + i + 1} ERRO:`, e);
        throw e;
      }
    }
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  });
  try { tx(); } catch(e) { console.error('[migrations] Rollback:', e); }
}
// ---

'@

# Inserir antes de "function createSchema()"
$marker = "function createSchema() {"
$c = $c.Replace($marker, $migrationsBlock + $marker)

# 2. Adicionar chamada applyMigrations() logo apos payment_methods e bank_accounts (no inicio de createSchema)
$insertAfter = '  try { run("CREATE TABLE IF NOT EXISTS bank_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, bank_name TEXT, agency TEXT, account_number TEXT, active INTEGER DEFAULT 1, created_at TEXT)"); } catch(_){ }'
$c = $c.Replace($insertAfter, $insertAfter + "`r`n  applyMigrations();")

# 3. Remover os ALTER TABLEs avulsos que agora estao cobertos pelas migrations
# (do primeiro ALTER TABLE ate o fim do bloco de data migrations de clients)
$removeFrom = '  try { run("ALTER TABLE service_orders ADD COLUMN expected_at TEXT"); } catch(_){}'
$removeTo   = '  } catch(_){}' + "`r`n}"  + "`r`n`r`n" + 'ipcMain.handle("services:list"'

$startIdx = $c.IndexOf($removeFrom)
$endIdx   = $c.IndexOf('ipcMain.handle("services:list"')

if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
  $c = $c.Substring(0, $startIdx) + "`r`n}" + "`r`n`r`n" + 'ipcMain.handle("services:list"' + $c.Substring($endIdx + 'ipcMain.handle("services:list"'.Length)
  Write-Host "Bloco de ALTER TABLEs avulsos removido (chars $startIdx ate $endIdx)"
} else {
  Write-Host "AVISO: nao encontrou bloco para remover. startIdx=$startIdx endIdx=$endIdx"
}

Set-Content $f -Value $c -Encoding UTF8 -NoNewline
Write-Host "Script concluido"
