/* Migration: centralized payment methods and bank accounts, backfills, and minor column additions */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function nowLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER DEFAULT 1,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      bank_name TEXT,
      agency TEXT,
      account_number TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT
    );
  `);
  try { db.exec(`ALTER TABLE os_payments ADD COLUMN account_label TEXT`); } catch(_) {}
  try { db.exec(`ALTER TABLE salary_advances ADD COLUMN method TEXT`); } catch(_) {}
  try { db.exec(`ALTER TABLE salary_advances ADD COLUMN account_label TEXT`); } catch(_) {}
}

function seedDefaults(db) {
  const methods = ['dinheiro','pix','boleto','transferência','débito','crédito'];
  const ins = db.prepare(`INSERT OR IGNORE INTO payment_methods (name, active, created_at) VALUES (?,?,?)`);
  for (const m of methods) ins.run(m, 1, nowLocal());
  const hasCaixa = db.prepare(`SELECT id FROM bank_accounts WHERE label=? LIMIT 1`).get('Caixa');
  if (!hasCaixa) {
    db.prepare(`INSERT INTO bank_accounts (label, bank_name, agency, account_number, active, created_at) VALUES (?,?,?,?,?,?)`)
      .run('Caixa','Caixa','', '', 1, nowLocal());
  }
}

function backfills(db) {
  try { db.exec(`UPDATE cash_ledger SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''`); } catch(_) {}
  try { db.exec(`UPDATE accounts_payable SET method=COALESCE(NULLIF(TRIM(method),''),'dinheiro')`); } catch(_) {}
  try { db.exec(`UPDATE accounts_receivable SET method=COALESCE(NULLIF(TRIM(method),''),'dinheiro')`); } catch(_) {}
}

function migrateOne(dbPath) {
  const exists = fs.existsSync(dbPath);
  if (!exists) return { dbPath, skipped: true };
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const tx = db.transaction(() => {
    ensureSchema(db);
    seedDefaults(db);
    backfills(db);
  });
  tx();
  const info = db.prepare(`SELECT COUNT(1) as n FROM payment_methods`).get();
  db.close();
  return { dbPath, skipped: false, methods: info.n };
}

function run() {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || process.env.HOME || 'C:/Users', 'AppData', 'Roaming');
  const candidates = [
    path.join(appData, 'OS e Contabil - Lav', 'osecontabil.db'),
    path.join(appData, 'OSeContabilLav', 'osecontabil.db'),
    path.join(appData, 'osecontabillav', 'osecontabil.db'),
  ];
  const results = candidates.map(migrateOne);
  console.log('Migration results:', results);
}

if (require.main === module) run();
