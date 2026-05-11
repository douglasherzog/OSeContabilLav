const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const BetterSqlite3 = require("better-sqlite3");
const { today, nowLocal, monthStart, monthEnd, monthStartFromStr, extractMonth, isInMonth } = require("./dateHelpers");
const { computeVacationAmounts } = require("./calc/vacation");

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
// Parametrização do servidor de desenvolvimento (padrão porta 3000)
const DEV_HOST = process.env.DEV_HOST || 'localhost';
const DEV_PORT = process.env.PORT || process.env.DEV_PORT || '3000';
const DEV_URL = process.env.DEV_URL || `http://${DEV_HOST}:${DEV_PORT}`;
let db;

const __appDataBase = app.getPath("appData");
try { app.setName("OS e Contabil - Lav"); } catch(_) {}
try { app.setPath("userData", path.join(__appDataBase, "OS e Contabil - Lav")); } catch(_) {}

// Utilitário: reparar/criar schema e seeds idempotentes
ipcMain.handle("db:repair", () => {
  try {
    createSchema();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

// Normalizar unidades 'peca' -> 'peça' no catálogo de serviços
ipcMain.handle("db:normalize_units", () => {
  try {
    const before = get("SELECT COUNT(1) as n FROM services WHERE unit='peca'")?.n || 0;
    run("UPDATE services SET unit='peça' WHERE unit='peca'");
    const after = get("SELECT COUNT(1) as n FROM services WHERE unit='peca'")?.n || 0;
    return { ok: true, updated: before - after };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

function getDbPath() {
  return path.join(app.getPath("userData"), "osecontabil.db");
}

async function initDb() {
  const dbPath = getDbPath();
  try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch(_){ }
  if (!fs.existsSync(dbPath)) {
    const base = app.getPath("appData");
    const cands = [
      path.join(base, "osecontabillav", "osecontabil.db"),
      path.join(base, "OSeContabilLav", "osecontabil.db"),
    ];
    for (const c of cands) {
      try { if (fs.existsSync(c)) { fs.copyFileSync(c, dbPath); break; } } catch(_){ }
    }
  }
  // Abre/cria base SQLite em disco
  db = new BetterSqlite3(dbPath);
  // Configurações recomendadas para desktop
  try { db.pragma('journal_mode = WAL'); } catch(_) {}
  try { db.pragma('synchronous = NORMAL'); } catch(_) {}
  createSchema();
  // Seed categorias manuais padrão (após schema criado)
  const SYSTEM_CATS = ['aluguel','agua_luz','fornecedor','salario','material','transporte','outros'];
  for (const cat of SYSTEM_CATS) {
    try { run("INSERT OR IGNORE INTO cash_categories (name,created_at) VALUES (?,?)", [cat, nowLocal()]); } catch(_){}
  }
  console.log("DB em:", dbPath);
  
  // Migrações simples de schema
  try {
    // Garantir coluna paid_amount em salary_balance_pending
    const cols = all("PRAGMA table_info(salary_balance_pending)");
    const hasPaidAmount = Array.isArray(cols) && cols.some(c => String(c.name) === 'paid_amount');
    if (!hasPaidAmount) {
      console.log('[migrate] Adicionando coluna paid_amount em salary_balance_pending');
      run("ALTER TABLE salary_balance_pending ADD COLUMN paid_amount REAL DEFAULT 0", []);
    }
    // Garantir colunas admission_date e base_salary em employees
    const empCols = all("PRAGMA table_info(employees)");
    const hasAdmission = Array.isArray(empCols) && empCols.some(c => String(c.name) === 'admission_date');
    const hasBase = Array.isArray(empCols) && empCols.some(c => String(c.name) === 'base_salary');
    const hasVacStart = Array.isArray(empCols) && empCols.some(c => String(c.name) === 'vacation_accrual_start');
    if (!hasAdmission) {
      console.log('[migrate] Adicionando coluna admission_date em employees');
      run("ALTER TABLE employees ADD COLUMN admission_date TEXT", []);
    }
    if (!hasBase) {
      console.log('[migrate] Adicionando coluna base_salary em employees');
      run("ALTER TABLE employees ADD COLUMN base_salary REAL DEFAULT 0", []);
    }
    if (!hasVacStart) {
      console.log('[migrate] Adicionando coluna vacation_accrual_start em employees');
      run("ALTER TABLE employees ADD COLUMN vacation_accrual_start TEXT", []);
    }
  } catch (e) {
    console.warn('[migrate] Falha ao verificar/aplicar migração salary_balance_pending.paid_amount:', e);
  }
  
  // Fechamento automático de mês: verificar se o mês anterior foi fechado
  autoClosePreviousMonth();
}

// Função automática para fechar mês anterior se estivermos no próximo mês
function autoClosePreviousMonth() {
  const todayStr = today();
  const currentMonth = todayStr.slice(0, 7);
  const prevMonth = getPreviousMonth(currentMonth);
  
  // Consolidar déficit do mês anterior como pendência registrada no mês atual (idempotente por funcionário/mês)
  // Não fazemos retorno antecipado baseado no prevMonth; validamos por funcionário no currentMonth.
  
  // Buscar funcionários com adiantamentos no mês anterior
  const employeesWithAdvances = all(`
    SELECT DISTINCT employee_id 
    FROM salary_advances 
    WHERE reference_month=? OR strftime('%Y-%m', date)=?
  `, [prevMonth, prevMonth]);
  
  if (employeesWithAdvances.length === 0) {
    console.log(`[autoClosePreviousMonth] Nenhum adiantamento encontrado para ${prevMonth}`);
    return;
  }
  
  console.log(`[autoClosePreviousMonth] Fechando mês ${prevMonth} -> registrando pendências em ${currentMonth} (${employeesWithAdvances.length} funcionários)`);
  
  // Para cada funcionário, criar saldo pendente
  for (const emp of employeesWithAdvances) {
    if (!emp.employee_id) continue;
    const employee = get("SELECT name FROM employees WHERE id=?", [emp.employee_id]);
    if (!employee) continue;
    
    // Calcular total de adiantamentos do mês
    const advances = all("SELECT COALESCE(SUM(amount), 0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR strftime('%Y-%m', date)=?)", [emp.employee_id, prevMonth, prevMonth]);
    const totalAdvances = advances[0]?.total || 0;
    
    // Obter salário do funcionário no mês
    const salary = getEmployeeSalaryAtMonth(emp.employee_id, prevMonth);
    if (!salary || salary <= 0) {
      console.log(`[autoClosePreviousMonth] Salário inválido para ${employee.name}: ${salary}, pulando`);
      continue;
    }
    
    // Calcular saldo pendente (déficit) do mês anterior
    const pendingBalance = salary - totalAdvances;
    
    // Idempotência: manter no máximo 1 pendência 'pending' para employee_id + currentMonth
    const existing = get("SELECT id FROM salary_balance_pending WHERE employee_id=? AND reference_month=? AND status='pending'", [emp.employee_id, currentMonth]);
    if (pendingBalance > 0) {
      if (existing?.id) {
        run("UPDATE salary_balance_pending SET amount=? WHERE id=?", [pendingBalance, existing.id]);
        console.log(`[autoClosePreviousMonth] Saldo pendente atualizado (${currentMonth}): ${employee.name} - R$ ${pendingBalance.toFixed(2)}`);
      } else {
        insert("INSERT INTO salary_balance_pending (employee_id, reference_month, amount, paid_amount, status, created_at) VALUES (?,?,?,?,?,?)",
          [emp.employee_id, currentMonth, pendingBalance, 0, 'pending', nowLocal()]);
        console.log(`[autoClosePreviousMonth] Saldo pendente criado (${currentMonth}): ${employee.name} - R$ ${pendingBalance.toFixed(2)}`);
      }
    } else if (existing?.id) {
      // Sem déficit: remover eventual pendência em aberto desse mês
      run("DELETE FROM salary_balance_pending WHERE id=?", [existing.id]);
    }
  }
  
  saveDb();
}

// Função auxiliar: obter mês anterior no formato YYYY-MM
function getPreviousMonth(month) {
  const year = parseInt(month.slice(0, 4));
  const monthNum = parseInt(month.slice(5, 7));
  
  if (monthNum === 1) {
    return `${year - 1}-12`;
  } else {
    return `${year}-${String(monthNum - 1).padStart(2, '0')}`;
  }
}

// Função auxiliar: obter próximo mês no formato YYYY-MM
function getNextMonth(month) {
  const year = parseInt(month.slice(0, 4));
  const monthNum = parseInt(month.slice(5, 7));
  
  if (monthNum === 12) {
    return `${year + 1}-01`;
  } else {
    return `${year}-${String(monthNum + 1).padStart(2, '0')}`;
  }
}

// Função auxiliar: obter último dia de um mês
function getLastDayOfMonth(month) {
  const year = parseInt(month.slice(0, 4));
  const monthNum = parseInt(month.slice(5, 7));
  return new Date(year, monthNum, 0).getDate();
}

function saveDb() { /* better-sqlite3 persiste automaticamente */ }

function run(sql, params = []) { db.prepare(sql).run(params); }

function all(sql, params = []) {
  try { return db.prepare(sql).all(params); }
  catch(e) { console.error("SQL error:", sql, e); return []; }
}

function get(sql, params = []) { try { return db.prepare(sql).get(params) || null; } catch(e){ console.error("SQL error:", sql, e); return null; } }

function insert(sql, params = []) {
  try {
    const info = db.prepare(sql).run(params);
    return info?.lastInsertRowid;
  } catch(e) {
    console.error("SQL insert error:", sql, e);
    return undefined;
  }
}

const DEFAULT_PAYMENT_METHOD = 'dinheiro';
function normalizeMethod(m) {
  const v = (m||'').toString().trim().toLowerCase();
  if (!v) return DEFAULT_PAYMENT_METHOD;
  const row = get("SELECT name FROM payment_methods WHERE name=? AND active=1 LIMIT 1", [v]);
  return row?.name || DEFAULT_PAYMENT_METHOD;
}
function defaultAccountFor(method, provided) {
  if (provided && String(provided).trim()) return provided;
  return method === 'dinheiro' ? 'Caixa' : '';
}

async function probeUrl(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    try {
      const isHttps = url.startsWith('https://');
      const lib = isHttps ? https : http;
      const req = lib.get(url, (res) => {
        // Considera 2xx-4xx como "servidor respondeu" (vite responde 200)
        if (res && res.statusCode && res.statusCode < 500) {
          res.resume();
          resolve(true);
        } else {
          resolve(false);
        }
      });
      req.on('error', () => resolve(false));
      req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch(_){} resolve(false); });
    } catch(_) { resolve(false); }
  });
}

async function waitForDevServer() {
  const baseHost = DEV_HOST || 'localhost';
  const basePort = Number(DEV_PORT || 3000);
  const candidates = [];
  // Prioriza DEV_URL explícita
  if (process.env.DEV_URL) candidates.push(process.env.DEV_URL);
  // Em seguida a combinação base
  candidates.push(`http://${baseHost}:${basePort}`);
  // Tenta portas conhecidas 3000..3010
  for (let p = 3000; p <= 3010; p++) {
    const u = `http://${baseHost}:${p}`;
    if (!candidates.includes(u)) candidates.push(u);
  }
  const startedAt = Date.now();
  const maxWaitMs = 60000; // até 60s
  while (Date.now() - startedAt < maxWaitMs) {
    for (const u of candidates) {
      const ok = await probeUrl(u);
      if (ok) return u;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  // Se nada responder, retorna DEV_URL mesmo assim
  return DEV_URL;
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS service_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER UNIQUE, client_id INTEGER, title TEXT, status TEXT DEFAULT "aberta", total REAL DEFAULT 0, paid REAL DEFAULT 0, payment_status TEXT DEFAULT "em_aberto", note TEXT, assigned_to TEXT, expected_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS os_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, description TEXT NOT NULL, quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0, total REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS os_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, amount REAL NOT NULL, method TEXT DEFAULT "dinheiro", when_type TEXT DEFAULT "retirada", payment_date TEXT, note TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS cash_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, amount REAL NOT NULL, method TEXT, account_label TEXT, category TEXT DEFAULT "manual", description TEXT, source_type TEXT DEFAULT "manual", source_id INTEGER, created_at TEXT);
    CREATE TABLE IF NOT EXISTS accounts_payable (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, category TEXT DEFAULT "geral", amount REAL DEFAULT 0, due_date TEXT, status TEXT DEFAULT "pendente", paid_at TEXT, method TEXT, account_label TEXT, note TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS accounts_receivable (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, category TEXT DEFAULT "geral", amount REAL DEFAULT 0, due_date TEXT, status TEXT DEFAULT "pendente", received_at TEXT, method TEXT, account_label TEXT, note TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, category TEXT DEFAULT "geral", unit_price REAL DEFAULT 0, unit TEXT DEFAULT "un", active INTEGER DEFAULT 1, created_at TEXT);
    CREATE TABLE IF NOT EXISTS cash_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT);
    CREATE TABLE IF NOT EXISTS ap_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT);
    CREATE TABLE IF NOT EXISTS ar_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT);
    CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT DEFAULT 'integral', admission_date TEXT, active INTEGER DEFAULT 1, created_at TEXT);
    CREATE TABLE IF NOT EXISTS employee_salaries (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, salary REAL NOT NULL, start_date TEXT NOT NULL, end_date TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS salary_advances (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, advance_type TEXT DEFAULT 'regular', amount REAL NOT NULL, date TEXT NOT NULL, note TEXT, source_id INTEGER, reference_month TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS vacation_records (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, days_taken INTEGER DEFAULT 0, days_remaining INTEGER DEFAULT 30, buyout_days INTEGER DEFAULT 0, notes TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS thirteen_salary (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, year INTEGER NOT NULL, first_installment REAL DEFAULT 0, first_installment_paid_at TEXT, second_installment REAL DEFAULT 0, second_installment_paid_at TEXT, total REAL DEFAULT 0, created_at TEXT);
    CREATE TABLE IF NOT EXISTS salary_balance_pending (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, reference_month TEXT NOT NULL, amount REAL NOT NULL, paid_amount REAL DEFAULT 0, status TEXT DEFAULT 'pending', created_at TEXT);
    CREATE TABLE IF NOT EXISTS company_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS payroll_closings (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, reference_month TEXT NOT NULL, net_amount REAL NOT NULL, advances_applied REAL NOT NULL, to_pay REAL NOT NULL, cash_ledger_id INTEGER, note TEXT, method TEXT, account_label TEXT, created_at TEXT, updated_at TEXT, UNIQUE(employee_id, reference_month));
  `);
  try { run("CREATE TABLE IF NOT EXISTS payment_methods (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1, created_at TEXT)"); } catch(_){ }
  try { run("CREATE TABLE IF NOT EXISTS bank_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, bank_name TEXT, agency TEXT, account_number TEXT, active INTEGER DEFAULT 1, created_at TEXT)"); } catch(_){ }
  try { run("ALTER TABLE service_orders ADD COLUMN expected_at TEXT"); } catch(_){}
  try { run("ALTER TABLE services ADD COLUMN requires_entry INTEGER DEFAULT 0"); } catch(_){}
  try { run("ALTER TABLE services ADD COLUMN entry_pct REAL DEFAULT 50"); } catch(_){}
  try { run("ALTER TABLE os_items ADD COLUMN requires_entry INTEGER DEFAULT 0"); } catch(_){}
  try { run("ALTER TABLE os_items ADD COLUMN entry_pct REAL DEFAULT 50"); } catch(_){}
  try { run("ALTER TABLE salary_advances ADD COLUMN reference_month TEXT"); } catch(_){}
  try { run("ALTER TABLE clients ADD COLUMN first_name TEXT NOT NULL DEFAULT ''"); } catch(_){}
  try { run("ALTER TABLE clients ADD COLUMN last_name TEXT NOT NULL DEFAULT ''"); } catch(_){}
  // Adicionar campos para integração Caixa em Contas a Pagar/Receber
  try { run("ALTER TABLE accounts_payable ADD COLUMN source_type TEXT DEFAULT 'ap'"); } catch(_){}
  try { run("ALTER TABLE accounts_payable ADD COLUMN source_id INTEGER"); } catch(_){}
  try { run("ALTER TABLE accounts_receivable ADD COLUMN source_type TEXT DEFAULT 'ar'"); } catch(_){}
  try { run("ALTER TABLE accounts_receivable ADD COLUMN source_id INTEGER"); } catch(_){}
  // Seed dados da empresa (só insere se não existir)
  const companyDefaults = [
    ['name',       'Lavanderia Senhor dos Passos'],
    ['legal_name', 'Herzog Comercial LTDA'],
    ['cnpj',       '13.453.061/0001-56'],
    ['address',    'Rua Senhor dos Passos, 155'],
    ['neighborhood','Centro'],
    ['city',       'Rio Pardo'],
    ['state',      'RS'],
    ['phone1',     '(51) 99663-6056'],
    ['phone2',     '(51) 98021-4882'],
    ['email',      ''],
    ['website',    ''],
  ];
  for (const [key, value] of companyDefaults) {
    run("INSERT OR IGNORE INTO company_settings (key, value) VALUES (?, ?)", [key, value]);
  }
  try {
    const pm = ['dinheiro','pix','boleto','transferência','débito','crédito'];
    for (const name of pm) { insert("INSERT OR IGNORE INTO payment_methods (name, active, created_at) VALUES (?,?,?)", [name, 1, nowLocal()]); }
  } catch(_){ }
  try {
    const hasCaixa = get("SELECT id FROM bank_accounts WHERE label=? LIMIT 1", ['Caixa']);
    if (!hasCaixa) insert("INSERT INTO bank_accounts (label, bank_name, agency, account_number, active, created_at) VALUES (?,?,?,?,?,?)", ['Caixa','Caixa','', '', 1, nowLocal()]);
  } catch(_){ }
  // Migration: adicionar coluna advance_type se não existir
  try {
    const hasColumn = all("PRAGMA table_info(salary_advances)").some(c => c.name === 'advance_type');
    if (!hasColumn) {
      console.log("[migration] adicionando coluna advance_type...");
      run("ALTER TABLE salary_advances ADD COLUMN advance_type TEXT DEFAULT 'regular'");
      console.log("[migration] coluna advance_type adicionada");
    }
  } catch (e) { console.error("[migration] erro ao adicionar advance_type:", e); }
  try { run("ALTER TABLE os_payments ADD COLUMN account_label TEXT"); } catch(_){ }
  try { run("UPDATE cash_ledger SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''"); } catch(_){ }
  try { run("UPDATE accounts_payable SET method=COALESCE(NULLIF(TRIM(method),''),'dinheiro')"); } catch(_){ }
  try { run("UPDATE accounts_receivable SET method=COALESCE(NULLIF(TRIM(method),''),'dinheiro')"); } catch(_){ }

  // Migration retroativa: lançar no caixa os pagamentos de OS que ainda não têm lançamento
  try {
    console.log("[migration] verificando os_payments sem lançamento no caixa...");
    const orphans = all(`
      SELECT p.*, so.number as os_number, c.name as client_name
      FROM os_payments p
      LEFT JOIN service_orders so ON so.id = p.order_id
      LEFT JOIN clients c ON c.id = so.client_id
      WHERE NOT EXISTS (
        SELECT 1 FROM cash_ledger cl WHERE cl.source_type='os' AND cl.source_id=p.id
      )
    `);
    console.log(`[migration] ${orphans.length} pagamento(s) sem lançamento encontrado(s)`);
    for (const p of orphans) {
      const desc = `OS #${p.os_number||p.order_id} — ${p.client_name||'cliente'}`;
      const occurredAt = (p.payment_date || (p.created_at||nowLocal()).slice(0,10)) + ' ' + (p.created_at||nowLocal()).slice(11,16);
      insert("INSERT INTO cash_ledger (occurred_at,amount,method,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
        [occurredAt, p.amount, p.method||'dinheiro', 'os_pagamento', desc, 'os', p.id, nowLocal()]);
    }
    console.log(`[migration] caixa sincronizado.`);
    // Corrigir occurred_at com 'T' para espaço nos registros existentes
    run("UPDATE cash_ledger SET occurred_at = REPLACE(occurred_at, 'T', ' ') WHERE occurred_at LIKE '%T%'");
    // Remover lançamentos de os_pagamento sem source_id (criados pelo frontend antigo, agora duplicados)
    run("DELETE FROM cash_ledger WHERE category='os_pagamento' AND (source_id IS NULL OR source_type != 'os')");
  } catch(e){ console.error("[migration] erro:", e); }
  // Migration: remover prefixo "Lavagem " dos serviços e capitalizar primeira letra
  try {
    const svcs = all("SELECT id, name FROM services WHERE name LIKE 'Lavagem %' OR name LIKE 'lavagem %'");
    for (const s of svcs) {
      const stripped = s.name.replace(/^[Ll]avagem\s+/i, '');
      const capitalized = stripped.charAt(0).toUpperCase() + stripped.slice(1);
      run("UPDATE services SET name=? WHERE id=?", [capitalized, s.id]);
    }
    // Remover prefixo "De " dos serviços
    const svcs2 = all("SELECT id, name FROM services WHERE name LIKE 'De %' OR name LIKE 'de %'");
    for (const s of svcs2) {
      const stripped = s.name.replace(/^[Dd]e\s+/i, '');
      const capitalized = stripped.charAt(0).toUpperCase() + stripped.slice(1);
      run("UPDATE services SET name=? WHERE id=?", [capitalized, s.id]);
    }
    // Capitalizar todos os demais que comecem com minúscula
    const others = all("SELECT id, name FROM services WHERE name GLOB '[a-z]*'");
    for (const s of others) {
      const capitalized = s.name.charAt(0).toUpperCase() + s.name.slice(1);
      run("UPDATE services SET name=? WHERE id=?", [capitalized, s.id]);
    }
  } catch(_){}
  // Migrar dados antigos: se first_name vazio, dividir name na primeira espaço
  try {
    const old = all("SELECT id, name FROM clients WHERE (first_name IS NULL OR first_name='') AND name IS NOT NULL");
    for (const c of old) {
      const parts = (c.name || '').trim().split(/\s+/);
      const fn = parts[0] || c.name;
      const ln = parts.slice(1).join(' ') || '.';
      run("UPDATE clients SET first_name=?, last_name=? WHERE id=?", [fn, ln, c.id]);
    }
  } catch(_){}
}

ipcMain.handle("services:list", (_, includeInactive) => {
  const sql = includeInactive
    ? "SELECT * FROM services ORDER BY category ASC, name ASC"
    : "SELECT * FROM services WHERE active=1 ORDER BY category ASC, name ASC";
  return all(sql);
});
ipcMain.handle("services:create", (_, d) => {
  const id = insert("INSERT INTO services (name,description,category,unit_price,unit,active,requires_entry,entry_pct,created_at) VALUES (?,?,?,?,?,1,?,?,?)", [d.name, d.description||null, d.category||"geral", d.unit_price||0, d.unit||"un", d.requires_entry?1:0, d.entry_pct||50, nowLocal()]);
  return get("SELECT * FROM services WHERE id=?", [id]);
});
ipcMain.handle("services:update", (_, {id,...d}) => {
  run("UPDATE services SET name=?,description=?,category=?,unit_price=?,unit=?,active=?,requires_entry=?,entry_pct=? WHERE id=?", [d.name, d.description||null, d.category||"geral", d.unit_price||0, d.unit||"un", d.active??1, d.requires_entry?1:0, d.entry_pct||50, id]);
  return get("SELECT * FROM services WHERE id=?", [id]);
});
ipcMain.handle("services:delete", (_, id) => {
  run("DELETE FROM services WHERE id=?", [id]);
  return {ok:true};
});

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // Remove DDI 55 se presente e sobrar >= 10 dígitos
  let d = digits;
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  // Agora deve ter DDD (2) + número (8 ou 9 dígitos) = 10 ou 11
  if (d.length === 11) return `+55${d}`; // celular: DDD + 9 dígitos
  if (d.length === 10) return `+55${d}`; // fixo: DDD + 8 dígitos
  // Se já continha DDI diferente, devolve só os dígitos com +
  return `+${digits}`;
}

ipcMain.handle("clients:list", () => {
  const rows = all("SELECT *, (first_name || ' ' || last_name) as name FROM clients ORDER BY first_name ASC, last_name ASC");
  return rows;
});
ipcMain.handle("os:list_assigned", () => {
  return all("SELECT DISTINCT assigned_to as name FROM service_orders WHERE assigned_to IS NOT NULL AND assigned_to != '' ORDER BY assigned_to ASC");
});
ipcMain.handle("clients:list_with_os", () => {
  return all(`SELECT DISTINCT c.id, (c.first_name || ' ' || c.last_name) as name, c.phone
    FROM clients c INNER JOIN service_orders so ON so.client_id = c.id
    ORDER BY c.first_name ASC, c.last_name ASC`);
});
ipcMain.handle("clients:create", (_, d) => {
  const phone = normalizePhone(d.phone);
  const id = insert("INSERT INTO clients (first_name,last_name,phone,email,address,created_at) VALUES (?,?,?,?,?,?)", [d.first_name, d.last_name, phone, d.email||null, d.address||null, nowLocal()]);
  const row = get("SELECT *, (first_name || ' ' || last_name) as name FROM clients WHERE id=?", [id]);
  return row;
});
ipcMain.handle("clients:update", (_, {id,...d}) => {
  const phone = normalizePhone(d.phone);
  run("UPDATE clients SET first_name=?,last_name=?,phone=?,email=?,address=? WHERE id=?", [d.first_name, d.last_name, phone, d.email||null, d.address||null, id]);
  return get("SELECT *, (first_name || ' ' || last_name) as name FROM clients WHERE id=?", [id]);
});
ipcMain.handle("clients:delete", (_, id) => {
  run("DELETE FROM clients WHERE id=?", [id]);
  return {ok:true};
});
ipcMain.handle("clients:get_os", (_, client_id) => {
  return all("SELECT * FROM service_orders WHERE client_id=? ORDER BY created_at DESC", [client_id]);
});
ipcMain.handle("db:backup", async () => {
  const result = await dialog.showSaveDialog({ defaultPath: `osecontabil_backup_${today()}.db`, filters: [{name:'SQLite DB',extensions:['db']}] });
  if(result.canceled) return {ok:false};
  fs.copyFileSync(getDbPath(), result.filePath);
  return {ok:true, path: result.filePath};
});

ipcMain.handle("os:list", (_, f={}) => {
  let sql = `SELECT so.*,
    c.name as client_name,
    COALESCE((SELECT SUM(amount) FROM os_payments WHERE order_id=so.id),0) as paid,
    so.total - COALESCE((SELECT SUM(amount) FROM os_payments WHERE order_id=so.id),0) as remaining
    FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id WHERE 1=1`;
  const p = [];
  if(f.statuses && f.statuses.length>0){sql+=` AND so.status IN (${f.statuses.map(()=>'?').join(',')})`;p.push(...f.statuses);}
  else if(f.status){sql+=" AND so.status=?";p.push(f.status);}
  if(f.date_from){sql+=" AND (so.created_at IS NULL OR so.created_at>=?)";p.push(f.date_from);}
  if(f.date_to){sql+=" AND (so.created_at IS NULL OR so.created_at<=?)";p.push(f.date_to+" 23:59:59");}
  if(f.q){const l="%"+f.q+"%";sql+=" AND (c.name LIKE ? OR CAST(so.number AS TEXT) LIKE ? OR so.note LIKE ?)";p.push(l,l,l);}
  if(f.client){const l="%"+f.client+"%";sql+=" AND c.name LIKE ?";p.push(l);}
  if(f.total_min!=null&&f.total_min!==''){sql+=" AND so.total>=?";p.push(parseFloat(f.total_min));}
  if(f.total_max!=null&&f.total_max!==''){sql+=" AND so.total<=?";p.push(parseFloat(f.total_max));}
  if(f.remaining_only){sql+=" AND (so.total - COALESCE((SELECT SUM(amount) FROM os_payments WHERE order_id=so.id),0)) > 0.01";}
  if(f.assigned_to){const l="%"+f.assigned_to+"%";sql+=" AND so.assigned_to LIKE ?";p.push(l);}
  sql+=" ORDER BY so.created_at DESC, so.id DESC";
  return all(sql,p);
});
ipcMain.handle("os:get", (_, id) => {
  const o = get("SELECT so.*, c.name as client_name, c.phone as client_phone FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id WHERE so.id=?", [id]);
  if(!o) return null;
  o.items = all("SELECT * FROM os_items WHERE order_id=?", [id]);
  o.payments = all("SELECT * FROM os_payments WHERE order_id=? ORDER BY created_at ASC", [id]);
  return o;
});
ipcMain.handle("os:create", (_, d) => {
  const mx = get("SELECT MAX(number) as m FROM service_orders");
  const num = (mx?.m||0)+1;
  const n = nowLocal();
  const id = insert("INSERT INTO service_orders (number,client_id,status,total,note,assigned_to,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", [num,d.client_id||null,d.status||"aberta",d.total||0,d.note||null,d.assigned_to||null,n,n]);
  return get("SELECT * FROM service_orders WHERE id=?", [id]);
});
ipcMain.handle("os:update", (_, {id,...d}) => {
  run("UPDATE service_orders SET status=?,total=?,note=?,assigned_to=?,created_at=?,updated_at=? WHERE id=?", [d.status||"aberta",d.total||0,d.note||null,d.assigned_to||null,d.created_at||nowLocal(),nowLocal(),id]);
  return get("SELECT * FROM service_orders WHERE id=?", [id]);
});
ipcMain.handle("os:delete", (_, id) => {
  const payments = all("SELECT id FROM os_payments WHERE order_id=?", [id]);
  payments.forEach(p => run("DELETE FROM cash_ledger WHERE source_type='os' AND source_id=?", [p.id]));
  run("DELETE FROM os_payments WHERE order_id=?",[id]);
  run("DELETE FROM os_items WHERE order_id=?",[id]);
  run("DELETE FROM service_orders WHERE id=?",[id]);
  return {ok:true};
});
ipcMain.handle("os:add_payment", (_, d) => {
  const m = normalizeMethod(d.method);
  const acc = defaultAccountFor(m, d.account_label||'');
  if (m !== 'dinheiro' && !String(acc).trim()) { return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' }; }
  const payment_id = insert("INSERT INTO os_payments (order_id,amount,method,account_label,when_type,payment_date,note) VALUES (?,?,?,?,?,?,?)", [d.order_id,d.amount,m,acc,d.when_type||"retirada",d.payment_date||null,d.note||null]);
  const paid = get("SELECT COALESCE(SUM(amount),0) as s FROM os_payments WHERE order_id=?", [d.order_id])?.s||0;
  const o = get("SELECT so.*,c.name as client_name FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id WHERE so.id=?", [d.order_id]);
  const rem = Math.max(0,(o?.total||0)-paid);
  run("UPDATE service_orders SET paid=?,payment_status=? WHERE id=?", [paid, rem<=0.01?"quitado":"em_aberto", d.order_id]);
  const desc = `OS #${o?.number||d.order_id} — ${o?.client_name||'cliente'}`;
  const occurredAt = (d.payment_date||nowLocal().slice(0,10)) + ' ' + nowLocal().slice(11,16);
  insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [occurredAt,d.amount,m,acc,"os_pagamento",desc,"os",payment_id,nowLocal()]);
  return {ok:true};
});
ipcMain.handle("os:update_payment", (_, d) => {
  const m = normalizeMethod(d.method);
  const acc = defaultAccountFor(m, d.account_label||'');
  if (m !== 'dinheiro' && !String(acc).trim()) { return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' }; }
  run("UPDATE os_payments SET amount=?,method=?,account_label=?,when_type=?,payment_date=?,note=? WHERE id=?", [d.amount,m,acc,d.when_type||"retirada",d.payment_date||null,d.note||null,d.payment_id]);
  const order_id = get("SELECT order_id FROM os_payments WHERE id=?", [d.payment_id])?.order_id;
  if (order_id) {
    const paid = get("SELECT COALESCE(SUM(amount),0) as s FROM os_payments WHERE order_id=?", [order_id])?.s||0;
    const o = get("SELECT total FROM service_orders WHERE id=?", [order_id]);
    const rem = Math.max(0,(o?.total||0)-paid);
    run("UPDATE service_orders SET paid=?,payment_status=? WHERE id=?", [paid, rem<=0.01?"quitado":"em_aberto", order_id]);
  }
  const occurredAt = (d.payment_date||nowLocal().slice(0,10)) + ' ' + nowLocal().slice(11,16);
  run("UPDATE cash_ledger SET occurred_at=?,amount=?,method=?,account_label=?,description=? WHERE source_type='os' AND source_id=?", [occurredAt,d.amount,m,acc,d.description||null,d.payment_id]);
  return {ok:true};
});
ipcMain.handle("os:add_item", (_, d) => {
  const tot = (d.quantity||1)*(d.unit_price||0);
  const svc = get("SELECT requires_entry,entry_pct FROM services WHERE name=? AND active=1 LIMIT 1", [d.description]);
  const reqEntry = d.requires_entry ?? svc?.requires_entry ?? 0;
  const entPct = d.entry_pct ?? svc?.entry_pct ?? 50;
  insert("INSERT INTO os_items (order_id,description,quantity,unit_price,total,requires_entry,entry_pct) VALUES (?,?,?,?,?,?,?)", [d.order_id,d.description,d.quantity||1,d.unit_price||0,tot,reqEntry?1:0,entPct]);
  const s = get("SELECT COALESCE(SUM(total),0) as s FROM os_items WHERE order_id=?", [d.order_id])?.s||0;
  run("UPDATE service_orders SET total=? WHERE id=?", [s,d.order_id]);
  return {ok:true};
});
ipcMain.handle("os:delete_item", (_, {item_id, order_id}) => {
  run("DELETE FROM os_items WHERE id=?", [item_id]);
  const s = get("SELECT COALESCE(SUM(total),0) as s FROM os_items WHERE order_id=?", [order_id])?.s||0;
  run("UPDATE service_orders SET total=? WHERE id=?", [s, order_id]);
  const paid = get("SELECT COALESCE(SUM(amount),0) as s FROM os_payments WHERE order_id=?", [order_id])?.s||0;
  const rem = Math.max(0, s - paid);
  run("UPDATE service_orders SET payment_status=? WHERE id=?", [rem<=0.01?"quitado":"em_aberto", order_id]);
  return {ok:true};
});
ipcMain.handle("os:delete_payment", (_, {payment_id, order_id}) => {
  run("DELETE FROM os_payments WHERE id=?", [payment_id]);
  run("DELETE FROM cash_ledger WHERE source_type='os' AND source_id=?", [payment_id]);
  const paid = get("SELECT COALESCE(SUM(amount),0) as s FROM os_payments WHERE order_id=?", [order_id])?.s||0;
  const o = get("SELECT total FROM service_orders WHERE id=?", [order_id]);
  const rem = Math.max(0, (o?.total||0) - paid);
  run("UPDATE service_orders SET paid=?,payment_status=? WHERE id=?", [paid, rem<=0.01?"quitado":"em_aberto", order_id]);
  return {ok:true};
});

ipcMain.handle("caixa:list", (_, f={}) => {
  let sql="SELECT * FROM cash_ledger WHERE 1=1"; const p=[];
  if(f.date_from){sql+=" AND DATE(occurred_at)>=?";p.push(f.date_from);}
  if(f.date_to){sql+=" AND DATE(occurred_at)<=?";p.push(f.date_to);}
  if(f.category){sql+=" AND category=?";p.push(f.category);}
  sql+=" ORDER BY occurred_at DESC,id DESC"; return all(sql,p);
});
// Categorias do caixa manual
const RESERVED_CATS = ['os_pagamento','ap_pagamento','ar_recebimento','manual'];
ipcMain.handle("caixa:categories:list", () => all("SELECT name FROM cash_categories ORDER BY name ASC").map(r => r.name));
ipcMain.handle("caixa:categories:create", (_, name) => {
  if (!name || RESERVED_CATS.includes(name)) return {ok:false, error:'Nome reservado ou inválido'};
  try { insert("INSERT OR IGNORE INTO cash_categories (name,created_at) VALUES (?,?)", [name.trim().toLowerCase().replace(/\s+/g,'_'), nowLocal()]); } catch(_){}
  return {ok:true};
});
ipcMain.handle("caixa:categories:delete", (_, name) => {
  run("DELETE FROM cash_categories WHERE name=?", [name]);
  return {ok:true};
});
// Categorias de Contas a Pagar
ipcMain.handle("ap:categories:list", () => all("SELECT name FROM ap_categories ORDER BY name ASC").map(r => r.name));
ipcMain.handle("ap:categories:create", (_, name) => {
  if (!name) return {ok:false, error:'Nome inválido'};
  try { insert("INSERT OR IGNORE INTO ap_categories (name,created_at) VALUES (?,?)", [name.trim().toLowerCase().replace(/\s+/g,'_'), nowLocal()]); } catch(_){}
  return {ok:true};
});
ipcMain.handle("ap:categories:delete", (_, name) => {
  run("DELETE FROM ap_categories WHERE name=?", [name]);
  return {ok:true};
});
// Categorias de Contas a Receber
ipcMain.handle("ar:categories:list", () => all("SELECT name FROM ar_categories ORDER BY name ASC").map(r => r.name));
ipcMain.handle("ar:categories:create", (_, name) => {
  if (!name) return {ok:false, error:'Nome inválido'};
  try { insert("INSERT OR IGNORE INTO ar_categories (name,created_at) VALUES (?,?)", [name.trim().toLowerCase().replace(/\s+/g,'_'), nowLocal()]); } catch(_){}
  return {ok:true};
});
ipcMain.handle("ar:categories:delete", (_, name) => {
  run("DELETE FROM ar_categories WHERE name=?", [name]);
  return {ok:true};
});
ipcMain.handle("caixa:create", (_, d) => { const m=normalizeMethod(d.method); const acc=defaultAccountFor(m,d.account_label||null); if(m!=="dinheiro" && !String(acc).trim()){ return {error:'Selecione uma conta/banco quando o método de pagamento não for dinheiro.'}; } const id=insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type) VALUES (?,?,?,?,?,?,?)",[d.occurred_at,d.amount,m,acc,d.category||"manual",d.description||null,"manual"]); return get("SELECT * FROM cash_ledger WHERE id=?",[id]); });
ipcMain.handle("caixa:update", (_, {id,...d}) => { const m=normalizeMethod(d.method); const acc=defaultAccountFor(m,d.account_label||null); if(m!=="dinheiro" && !String(acc).trim()){ return {error:'Selecione uma conta/banco quando o método de pagamento não for dinheiro.'}; } run("UPDATE cash_ledger SET occurred_at=?,amount=?,method=?,account_label=?,category=?,description=? WHERE id=?",[d.occurred_at,d.amount,m,acc,d.category,d.description||null,id]); return get("SELECT * FROM cash_ledger WHERE id=?",[id]); });
ipcMain.handle("caixa:delete", (_, id) => { run("DELETE FROM cash_ledger WHERE id=?",[id]); return {ok:true}; });

ipcMain.handle("ap:list", (_, f={}) => { let sql="SELECT * FROM accounts_payable WHERE 1=1"; const p=[]; if(f.status){sql+=" AND status=?";p.push(f.status);} if(f.date_from){sql+=" AND due_date>=?";p.push(f.date_from);} if(f.date_to){sql+=" AND due_date<=?";p.push(f.date_to);} sql+=" ORDER BY due_date ASC,id DESC"; return all(sql,p); });
ipcMain.handle("ap:create", (_, d) => { const id=insert("INSERT INTO accounts_payable (description,category,amount,due_date,note) VALUES (?,?,?,?,?)",[d.description,d.category||"geral",d.amount,d.due_date||null,d.note||null]); return get("SELECT * FROM accounts_payable WHERE id=?",[id]); });
ipcMain.handle("ap:update", (_, {id,...d}) => {
  const old = get("SELECT * FROM accounts_payable WHERE id=?",[id]);
  let cashId = null;
  // Se estiver marcando como paga, criar lançamento no caixa
  if (d.status === 'paga' && old?.status !== 'paga') {
    // Salvar no formato ISO para o filtro DATE() funcionar, fmtDateTime converte na exibição
    let occurredAt = d.paid_at;
    const now = new Date();
    if (!occurredAt || occurredAt.length <= 10) {
      const datePart = occurredAt || nowLocal().slice(0, 10);
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      occurredAt = `${datePart}T${hours}:${minutes}`;
    } else if (!occurredAt.includes('T')) {
      // Se já veio como brasileiro DD/MM/YYYY HH:mm, converter para ISO
      const [datePart, timePart] = occurredAt.split(' ');
      const [day, month, year] = datePart.split('/');
      const [hours, minutes] = timePart.split(':');
      occurredAt = `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    const m = normalizeMethod(d.method);
    const acc = defaultAccountFor(m, d.account_label || '');
    if (m !== 'dinheiro' && !String(acc).trim()) {
      return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
    }
    cashId = insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
      occurredAt,
      -(d.amount || 0),
      m,
      acc,
      d.category || 'contas',
      `Conta: ${d.description}`,
      'ap',
      id,
      nowLocal()
    ]);
    run("UPDATE accounts_payable SET source_type='ap', source_id=? WHERE id=?",[cashId,id]);
    saveDb();
  }
  // Se estiver reabrindo (voltando para pendente), remover lançamento do caixa
  else if (d.status === 'pendente' && old?.status === 'paga') {
    if (old?.source_id) {
      run("DELETE FROM cash_ledger WHERE id=?",[old.source_id]);
    }
    run("UPDATE accounts_payable SET source_type='ap', source_id=NULL WHERE id=?",[id]);
    saveDb();
  }
  const updMethod = d.method != null ? normalizeMethod(d.method) : (old?.method || null);
  const updAccount = defaultAccountFor(updMethod || 'dinheiro', (d.account_label != null ? d.account_label : (old?.account_label || '')));
  run("UPDATE accounts_payable SET description=?,category=?,amount=?,due_date=?,note=?,status=?,paid_at=?,method=?,account_label=? WHERE id=?",[d.description,d.category,d.amount,d.due_date||null,d.note||null,d.status,d.paid_at||null,updMethod,updAccount,id]);
  saveDb();
  return get("SELECT * FROM accounts_payable WHERE id=?",[id]);
});
ipcMain.handle("ap:delete", (_, id) => { run("DELETE FROM accounts_payable WHERE id=?",[id]); return {ok:true}; });

ipcMain.handle("ar:list", (_, f={}) => { let sql="SELECT * FROM accounts_receivable WHERE 1=1"; const p=[]; if(f.status){sql+=" AND status=?";p.push(f.status);} if(f.date_from){sql+=" AND due_date>=?";p.push(f.date_from);} if(f.date_to){sql+=" AND due_date<=?";p.push(f.date_to);} sql+=" ORDER BY due_date ASC,id DESC"; return all(sql,p); });
ipcMain.handle("ar:create", (_, d) => { const id=insert("INSERT INTO accounts_receivable (description,category,amount,due_date,note) VALUES (?,?,?,?,?)",[d.description,d.category||"geral",d.amount,d.due_date||null,d.note||null]); return get("SELECT * FROM accounts_receivable WHERE id=?",[id]); });
ipcMain.handle("ar:update", (_, {id,...d}) => {
  const old = get("SELECT * FROM accounts_receivable WHERE id=?",[id]);
  // Se estiver marcando como recebida, criar lançamento no caixa
  if (d.status === 'recebida' && old?.status !== 'recebida') {
    // Salvar no formato ISO para o filtro DATE() funcionar, fmtDateTime converte na exibição
    let occurredAt = d.received_at;
    const now = new Date();
    if (!occurredAt || occurredAt.length <= 10) {
      const datePart = occurredAt || nowLocal().slice(0, 10);
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      occurredAt = `${datePart}T${hours}:${minutes}`;
    } else if (!occurredAt.includes('T')) {
      // Se já veio como brasileiro DD/MM/YYYY HH:mm, converter para ISO
      const [datePart, timePart] = occurredAt.split(' ');
      const [day, month, year] = datePart.split('/');
      const [hours, minutes] = timePart.split(':');
      occurredAt = `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    const m = normalizeMethod(d.method);
    const acc = defaultAccountFor(m, d.account_label || '');
    if (m !== 'dinheiro' && !String(acc).trim()) {
      return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
    }
    const cashId = insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
      occurredAt,
      d.amount || 0, // valor positivo (entrada)
      m,
      acc,
      d.category || 'contas',
      `Recebimento: ${d.description}`,
      'ar',
      id,
      nowLocal()
    ]);
    run("UPDATE accounts_receivable SET source_type='ar', source_id=? WHERE id=?",[cashId,id]);
    saveDb();
  }
  // Se estiver reabrindo (voltando para pendente), remover lançamento do caixa
  else if (d.status === 'pendente' && old?.status === 'recebida') {
    if (old?.source_id) {
      run("DELETE FROM cash_ledger WHERE id=?",[old.source_id]);
    }
    run("UPDATE accounts_receivable SET source_type='ar', source_id=NULL WHERE id=?",[id]);
    saveDb();
  }
  const updMethod2 = d.method != null ? normalizeMethod(d.method) : (old?.method || null);
  const updAccount2 = defaultAccountFor(updMethod2 || 'dinheiro', (d.account_label != null ? d.account_label : (old?.account_label || '')));
  run("UPDATE accounts_receivable SET description=?,category=?,amount=?,due_date=?,note=?,status=?,received_at=?,method=?,account_label=? WHERE id=?",[d.description,d.category,d.amount,d.due_date||null,d.note||null,d.status,d.received_at||null,updMethod2,updAccount2,id]);
  saveDb();
  return get("SELECT * FROM accounts_receivable WHERE id=?",[id]);
});
ipcMain.handle("ar:delete", (_, id) => { run("DELETE FROM accounts_receivable WHERE id=?",[id]); return {ok:true}; });

// Função auxiliar: obter salário vigente em uma data específica
function getSalaryAtDate(employeeId, dateStr) {
  // Primeiro tentar buscar no histórico de salários
  const salary = get(`
    SELECT salary FROM employee_salaries 
    WHERE employee_id=? 
    AND start_date <= ? 
    AND (end_date IS NULL OR end_date >= ?)
    ORDER BY start_date DESC 
    LIMIT 1
  `, [employeeId, dateStr, dateStr]);
  
  if (salary?.salary) return salary.salary;

  // Se não encontrar: verificar se a data é anterior ao primeiro salário cadastrado
  const first = get("SELECT MIN(start_date) as min_start FROM employee_salaries WHERE employee_id=?", [employeeId]);
  if (first?.min_start && dateStr < first.min_start) {
    // Antes do primeiro salário: considerar 0
    return 0;
  }

  // Caso contrário, usar o salário base atual (cobre lacunas posteriores)
  const employee = get("SELECT base_salary FROM employees WHERE id=?", [employeeId]);
  return employee?.base_salary || 0;
}

// Função auxiliar: obter salário atual (último vigente)
function getCurrentSalary(employeeId) {
  // Usar base_salary direto da tabela employees (simplificado)
  const employee = get("SELECT base_salary FROM employees WHERE id=?", [employeeId]);
  return employee?.base_salary || 0;
}

// Função auxiliar: obter salário de um funcionário em um mês específico
function getEmployeeSalaryAtMonth(employeeId, month) {
  // Usar o salário vigente na última data do mês consultado
  const lastDay = getLastDayOfMonth(month);
  const referenceDate = `${month}-${String(lastDay).padStart(2, '0')}`;
  return getSalaryAtDate(employeeId, referenceDate);
}

// Recalcular reference_month de adiantamentos quando o salário é alterado
function recalculateAdvanceReferenceMonths(employeeId, month) {
  const currentSalary = getEmployeeSalaryAtMonth(employeeId, month);
  if (!currentSalary || currentSalary <= 0) {
    console.log(`[recalculateAdvanceReferenceMonths] Salário inválido para funcionário ${employeeId} no mês ${month}: ${currentSalary}`);
    return;
  }
  const nextMonth = getNextMonth(month);
  // Buscar adiantamentos regulares ordenados por data
  const allAdvances = all(
    "SELECT * FROM salary_advances WHERE employee_id=? AND (reference_month=? OR strftime('%Y-%m', date)=?) AND (advance_type='regular' OR advance_type IS NULL) ORDER BY date ASC, id ASC",
    [employeeId, month, month]
  );

  let runningTotal = 0;
  let carryAmount = 0;

  for (const adv of allAdvances) {
    const amount = adv.amount || 0;
    if (runningTotal >= currentSalary) {
      // Já completo: tudo que vier vai para o próximo mês
      if (adv.reference_month !== nextMonth) {
        run("UPDATE salary_advances SET reference_month=? WHERE id=?", [nextMonth, adv.id]);
      }
      continue;
    }

    // Ainda há espaço no mês atual
    if (runningTotal + amount <= currentSalary) {
      // Cabe inteiro no mês
      if (adv.reference_month !== month) {
        run("UPDATE salary_advances SET reference_month=? WHERE id=?", [month, adv.id]);
      }
      runningTotal += amount;
    } else {
      // Vai ultrapassar: dividir em duas partes
      const amountWithin = Math.max(0, currentSalary - runningTotal);
      const extra = Math.max(0, amount - amountWithin);

      if (amountWithin > 0) {
        // Manter parte que completa o salário no mês atual
        if (adv.reference_month !== month || Math.abs((adv.amount||0) - amountWithin) > 0.009) {
          run("UPDATE salary_advances SET reference_month=?, amount=? WHERE id=?", [month, amountWithin, adv.id]);
        }
        runningTotal = currentSalary;
      } else {
        // Nenhum espaço restante: mover tudo para próximo mês
        if (adv.reference_month !== nextMonth) {
          run("UPDATE salary_advances SET reference_month=? WHERE id=?", [nextMonth, adv.id]);
        }
      }
      carryAmount += extra;
    }
  }

  // Upsert do ajuste no próximo mês com o total do excesso acumulado
  const carryoverNote = `Ajuste: excesso de adiantamentos de ${month}`;
  const existingCarry = get(
    "SELECT id, amount FROM salary_advances WHERE employee_id=? AND reference_month=? AND advance_type='regular' AND note=?",
    [employeeId, nextMonth, carryoverNote]
  );

  // Se o salário AUMENTOU e há espaço em 'month', podemos recompor parte do ajuste do próximo mês
  const fillNeeded = Math.max(0, currentSalary - runningTotal);
  if (fillNeeded > 0.009 && existingCarry?.amount > 0.009) {
    const pull = Math.min(fillNeeded, existingCarry.amount || 0);
    if (pull > 0.009) {
      const recompositionNote = `Ajuste: recomposição de excesso de ${month}`;
      // Upsert de uma recomposição idempotente no mês atual, sem movimentar caixa
      const existingRecomp = get(
        "SELECT id FROM salary_advances WHERE employee_id=? AND reference_month=? AND advance_type='regular' AND note=?",
        [employeeId, month, recompositionNote]
      );
      if (existingRecomp?.id) {
        run("UPDATE salary_advances SET amount=?, date=? WHERE id=?", [pull, today(), existingRecomp.id]);
      } else {
        insert(
          "INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)",
          [employeeId, 'regular', pull, today(), recompositionNote, 0, month, nowLocal()]
        );
      }
      // Reduzir/zerar o ajuste do próximo mês
      const remaining = (existingCarry.amount || 0) - pull;
      if (remaining > 0.009) {
        run("UPDATE salary_advances SET amount=?, date=? WHERE id=?", [remaining, today(), existingCarry.id]);
      } else {
        run("DELETE FROM salary_advances WHERE id=?", [existingCarry.id]);
      }
      // Atualizar acumuladores locais
      runningTotal += pull;
    }
  }
  if (carryAmount > 0.009) {
    const todayStr2 = today();
    if (existingCarry?.id) {
      if (Math.abs((existingCarry.amount||0) - carryAmount) > 0.009) {
        run("UPDATE salary_advances SET amount=?, date=? WHERE id=?", [carryAmount, todayStr2, existingCarry.id]);
      }
    } else {
      insert(
        "INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)",
        [employeeId, 'regular', carryAmount, todayStr2, carryoverNote, 0, nextMonth, nowLocal()]
      );
    }
  } else if (existingCarry?.id) {
    // Se não há excesso novo e já tratamos recomposição acima, garantir remoção se necessário (quando zerou)
    const stillHas = get(
      "SELECT amount FROM salary_advances WHERE id=?",
      [existingCarry.id]
    )?.amount || 0;
    if (stillHas <= 0.009) {
      run("DELETE FROM salary_advances WHERE id=?", [existingCarry.id]);
    }
  }

  saveDb();
}

// Funcionários
ipcMain.handle("employees:list", () => {
  const employees = all("SELECT * FROM employees WHERE active=1 ORDER BY name ASC");
  // Adicionar salário atual a cada funcionário
  return employees.map(emp => ({
    ...emp,
    base_salary: getCurrentSalary(emp.id)
  }));
});
ipcMain.handle("employees:create", (_, d) => {
  // Garantir que admission_date seja armazenada como data (YYYY-MM-DD)
  const admission = d.admission_date ? String(d.admission_date).slice(0,10) : null;
  const vacStart = d.vacation_accrual_start ? String(d.vacation_accrual_start).slice(0,10) : null;
  const base = d.base_salary || 0;
  const id = insert(
    "INSERT INTO employees (name,type,active,admission_date,vacation_accrual_start,base_salary,created_at) VALUES (?,?,?,?,?,?,?)",
    [d.name, d.type||'integral', 1, admission, vacStart, base, nowLocal()]
  );
  // Criar primeiro registro de salário (histórico)
  if (base > 0) {
    insert("INSERT INTO employee_salaries (employee_id,salary,start_date,created_at) VALUES (?,?,?,?)",
      [id, base, d.start_date || nowLocal().slice(0,10), nowLocal()]);
  }
  saveDb();
  const emp = get("SELECT * FROM employees WHERE id=?",[id]);
  return { ...emp, base_salary: getCurrentSalary(id) };
});
ipcMain.handle("employees:update", (_, {id,...d}) => {
  console.log('[employees:update] id:', id, 'd:', JSON.stringify(d));
  console.log('[employees:update] d.name:', d.name, 'd.type:', d.type, 'd.active:', d.active);
  console.log('[employees:update] d.base_salary:', d.base_salary, 'd.start_date:', d.start_date);
  
  // Buscar funcionário atual para obter valores padrão
  const currentEmp = get("SELECT * FROM employees WHERE id=?",[id]);
  if (!currentEmp) return {error:'Funcionário não encontrado'};
  
  // Tentar atualizar admission_date e vacation_accrual_start se fornecidos, ignorar erro se coluna não existir
  try {
    run("UPDATE employees SET name=?,type=?,active=?,base_salary=?,admission_date=?, vacation_accrual_start=? WHERE id=?",
      [d.name, d.type, d.active !== undefined ? d.active : currentEmp.active, d.base_salary !== undefined ? d.base_salary : currentEmp.base_salary, d.admission_date || currentEmp.admission_date, d.vacation_accrual_start || currentEmp.vacation_accrual_start, id]);
  } catch (e) {
    // Se falhar por coluna não existir, tentar sem admission_date
    run("UPDATE employees SET name=?,type=?,active=?,base_salary=? WHERE id=?",
      [d.name, d.type, d.active !== undefined ? d.active : currentEmp.active, d.base_salary !== undefined ? d.base_salary : currentEmp.base_salary, id]);
  }
  
  // Se mudou o salário, criar novo registro no histórico
  if (d.base_salary !== undefined && d.start_date) {
    console.log('[employees:update] Criando novo registro de salário');
    // Fechar salário anterior
    run("UPDATE employee_salaries SET end_date=? WHERE employee_id=? AND end_date IS NULL", 
      [d.start_date, id]);
    // Criar novo salário
    insert("INSERT INTO employee_salaries (employee_id,salary,start_date,created_at) VALUES (?,?,?,?)", 
      [id, d.base_salary, d.start_date, nowLocal()]);
    
    // Recalcular reference_month de adiantamentos do mês do novo salário
    const month = d.start_date.slice(0, 7);
    console.log('[employees:update] month:', month);
    if (month && month.length === 7) {
      recalculateAdvanceReferenceMonths(id, month);
      // Também recalcular o mês seguinte para refletir imediatamente o ajuste/carry
      try { const nm = getNextMonth(month); if (nm) recalculateAdvanceReferenceMonths(id, nm); } catch(_) {}
    }
  }
  saveDb();
  const emp = get("SELECT * FROM employees WHERE id=?",[id]);
  return { ...emp, base_salary: getCurrentSalary(id) };
});

ipcMain.handle("employees:delete", (_, id) => {
  run("UPDATE employees SET active=0 WHERE id=?",[id]);
  saveDb();
  return {ok:true};
});
ipcMain.handle("employees:salary_history", (_, {employee_id}) => {
  const history = all("SELECT * FROM employee_salaries WHERE employee_id=? ORDER BY start_date DESC", [employee_id]);
  const currentEmp = get("SELECT base_salary FROM employees WHERE id=?", [employee_id]);
  
  // Incluir o salário atual como primeiro item do histórico
  if (currentEmp && currentEmp.base_salary) {
    const today = nowLocal().slice(0, 10);
    return [
      {
        id: 0, // ID fictício para o salário atual
        employee_id: employee_id,
        salary: currentEmp.base_salary,
        start_date: today,
        end_date: null,
        created_at: nowLocal(),
        is_current: true // Flag para identificar como salário atual
      },
      ...history
    ];
  }
  
  return history;
});
ipcMain.handle("employees:recalculate_advances", (_, {employee_id, month}) => {
  if (!employee_id || !month) return {error:'employee_id e month são obrigatórios'};
  recalculateAdvanceReferenceMonths(employee_id, month);
  return {ok:true};
});

// Adiantamentos de salário (integrados com Caixa)
ipcMain.handle("salary_advances:list", (_, {employee_id, month}) => {
  let sql = "SELECT * FROM salary_advances WHERE 1=1";
  const params = [];
  if (employee_id) { sql += " AND employee_id=?"; params.push(employee_id); }
  if (month) { sql += " AND (reference_month=? OR strftime('%Y-%m', date)=?)"; params.push(month, month); }
  sql += " ORDER BY date DESC";
  return all(sql, params);
});
ipcMain.handle("salary_advances:create", (_, d) => {
  // Nova regra:
  // - Lançamentos para o próximo mês só são permitidos quando o mês corrente estiver exatamente completo
  // - O usuário deve selecionar o próximo mês no campo de data, MAS o registro deve sair do caixa com a DATA DE HOJE
  // - O mês de referência do adiantamento será o mês selecionado (atual ou próximo), nunca auto-empurrado

  const todayStr = today();
  const currentMonth = todayStr.slice(0, 7);
  const selectedMonth = (d.date || todayStr).slice(0, 7);
  const nextMonth = getNextMonth(currentMonth);

  // A data efetiva do pagamento (caixa e campo date) é sempre hoje
  const effectiveDate = todayStr;

  // Determinar reference_month conforme a regra
  let referenceMonth = selectedMonth;

  if (d.advance_type === 'regular' || !d.advance_type) {
    // Regra: no novo mês, antes de lançar adiantamentos regulares, não pode haver saldo pendente em aberto desse mês
    if (selectedMonth === currentMonth) {
      const pendingRow = get("SELECT SUM(amount - COALESCE(paid_amount,0)) AS remaining FROM salary_balance_pending WHERE employee_id=? AND reference_month=? AND status='pending'", [d.employee_id, currentMonth]);
      const remainingPending = pendingRow?.remaining || 0;
      if (remainingPending > 0.009) {
        return { error: `Existe saldo pendente de R$ ${remainingPending.toFixed(2)} do mês anterior. Quite esse saldo antes de lançar adiantamentos deste mês.` };
      }
    }
    // Saldo do mês corrente para validar "exatamente completo"
    const currentSalary = getEmployeeSalaryAtMonth(d.employee_id, currentMonth);
    const currentTotal = (all(
      "SELECT COALESCE(SUM(amount), 0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR strftime('%Y-%m', date)=?) AND (advance_type='regular' OR advance_type IS NULL)",
      [d.employee_id, currentMonth, currentMonth]
    )[0]?.total || 0);
    const isSalaryPaidCompletely = Math.abs(currentTotal - currentSalary) < 0.01;

    if (selectedMonth === currentMonth) {
      referenceMonth = currentMonth;
    } else if (selectedMonth === nextMonth) {
      if (!isSalaryPaidCompletely) {
        return { error: `Só é permitido lançar adiantamentos para o próximo mês quando o salário de ${currentMonth} estiver exatamente completo.` };
      }
      referenceMonth = nextMonth;
    } else {
      return { error: 'Só é permitido lançar adiantamentos no mês atual ou no próximo mês.' };
    }

    // Validação contra o salário do mês de referência
    const refMonthTotal = (all(
      "SELECT COALESCE(SUM(amount), 0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR strftime('%Y-%m', date)=?) AND (advance_type='regular' OR advance_type IS NULL)",
      [d.employee_id, referenceMonth, referenceMonth]
    )[0]?.total || 0);
    const monthSalary = getEmployeeSalaryAtMonth(d.employee_id, referenceMonth);
    if (refMonthTotal + (d.amount || 0) > monthSalary) {
      const available = Math.max(0, monthSalary - refMonthTotal);
      return { error: `Valor excede o saldo disponível do mês ${referenceMonth}. Saldo restante: R$ ${available.toFixed(2)}` };
    }
  }

  // Criar lançamento no caixa automaticamente (ocorre hoje)
  const typeLabel = { 'regular': 'Adiantamento', 'ferias': 'Férias', 'decimo_primeira': 'Décimo 1ª', 'decimo_segunda': 'Décimo 2ª' };
  const desc = `${typeLabel[d.advance_type] || 'Adiantamento'}: ${d.employee_name}`;
  const m = normalizeMethod(d.method);
  const acc = defaultAccountFor(m, d.account_label || '');
  if (m !== 'dinheiro' && !String(acc).trim()) {
    return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
  }
  const cashId = insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
    effectiveDate + 'T12:00:00',
    -(d.amount || 0),
    m,
    acc,
    d.advance_type === 'ferias' ? 'ferias' : d.advance_type?.startsWith('decimo') ? 'decimo_terceiro' : 'adiantamento_salario',
    desc,
    'salary_advance',
    0,
    nowLocal()
  ]);

  // Persistir adiantamento com a data de hoje e o mês de referência calculado
  const id = insert(
    "INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)",
    [d.employee_id, d.advance_type || 'regular', d.amount, effectiveDate, d.note || null, cashId, referenceMonth, nowLocal()]
  );
  saveDb();
  return get("SELECT * FROM salary_advances WHERE id=?", [id]);
});
ipcMain.handle("salary_advances:delete", (_, id) => {
  const adv = get("SELECT * FROM salary_advances WHERE id=?",[id]);
  if (adv?.source_id) {
    run("DELETE FROM cash_ledger WHERE id=?",[adv.source_id]);
  }
  run("DELETE FROM salary_advances WHERE id=?",[id]);
  saveDb();
  return {ok:true};
});
ipcMain.handle("salary_advances:balance", (_, {employee_id, month}) => {
  // Calcula saldo a pagar usando o salário vigente no período consultado
  const emp = get("SELECT * FROM employees WHERE id=?",[employee_id]);
  if (!emp) return {error:'Funcionário não encontrado'};
  
  // Pegar o último dia do mês consultado para verificar salário vigente
  const [year, mon] = month.split('-');
  const lastDayOfMonth = new Date(parseInt(year), parseInt(mon), 0).getDate();
  const referenceDate = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
  
  const baseSalary = getSalaryAtDate(employee_id, referenceDate);
  
  // Separar adiantamentos regulares de férias e décimo
  // Usar reference_month para determinar a qual mês o adiantamento pertence
  const regularAdvances = get("SELECT SUM(amount) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND advance_type='regular'",[employee_id, month, month])?.total || 0;
  const vacationAdvances = get("SELECT SUM(amount) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND advance_type='ferias'",[employee_id, month, month])?.total || 0;
  const thirteenAdvances = get("SELECT SUM(amount) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND advance_type LIKE 'decimo%'",[employee_id, month, month])?.total || 0;
  
  const totalAdvances = regularAdvances + vacationAdvances + thirteenAdvances;
  const balance = baseSalary - regularAdvances;
  
  return { 
    employee: { ...emp, base_salary: baseSalary }, 
    regular_advances: regularAdvances,
    vacation_advances: vacationAdvances,
    thirteen_advances: thirteenAdvances,
    total_advances: totalAdvances, 
    balance: balance, 
    month: month 
  };
});

// Fechamento da Folha: prévia
ipcMain.handle("payroll:closing:preview", (_, { employee_id, month, net_amount }) => {
  if (!employee_id || !month) return { error: 'employee_id e month são obrigatórios' };
  const emp = get("SELECT id, name FROM employees WHERE id=?", [employee_id]);
  if (!emp) return { error: 'Funcionário não encontrado' };
  const net = parseFloat(net_amount) || 0;
  const regularAdvances = get("SELECT COALESCE(SUM(amount),0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND (advance_type='regular' OR advance_type IS NULL)", [employee_id, month, month])?.total || 0;
  const toPay = Math.max(0, +(net - regularAdvances).toFixed(2));
  return { employee: emp, month, net_amount: +net.toFixed(2), advances_applied: +regularAdvances.toFixed(2), to_pay: toPay };
});

// Fechamento da Folha: efetivar (idempotente por funcionário+mês)
ipcMain.handle("payroll:close", (_, d) => {
  const { employee_id, month, net_amount, method, account_label, note } = d || {};
  if (!employee_id || !month) return { error: 'employee_id e month são obrigatórios' };
  const emp = get("SELECT id, name FROM employees WHERE id=?", [employee_id]);
  if (!emp) return { error: 'Funcionário não encontrado' };
  const prev = get("SELECT * FROM payroll_closings WHERE employee_id=? AND reference_month=?", [employee_id, month]);

  const preview = ipcMain._events && ipcMain._events["payroll:closing:preview"]
    ? { ...(ipcMain.listeners? {} : {}), ...{} } // no-op to satisfy linter
    : null;
  const regularAdvances = get("SELECT COALESCE(SUM(amount),0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND (advance_type='regular' OR advance_type IS NULL)", [employee_id, month, month])?.total || 0;
  const net = parseFloat(net_amount) || 0;
  const toPay = Math.max(0, +(net - regularAdvances).toFixed(2));

  const occurredAt = today() + 'T12:00:00';
  const desc = `Fechamento Folha ${month}: ${emp.name} (líquido - adiantamentos)`;

  let cashId = prev?.cash_ledger_id || null;
  const m = normalizeMethod(method);
  const acc = defaultAccountFor(m, account_label || '');
  if (m !== 'dinheiro' && !String(acc).trim()) {
    return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
  }
  if (cashId) {
    // Atualizar lançamento anterior
    run("UPDATE cash_ledger SET occurred_at=?, amount=?, method=?, account_label=?, category=?, description=?, source_type=?, created_at=? WHERE id=?", [
      occurredAt,
      -toPay,
      m,
      acc,
      'folha_pagamento',
      desc,
      'payroll_closing',
      nowLocal(),
      cashId
    ]);
  } else {
    // Inserir novo lançamento
    cashId = insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
      occurredAt,
      -toPay,
      m,
      acc,
      'folha_pagamento',
      desc,
      'payroll_closing',
      0,
      nowLocal()
    ]);
  }

  const nowStr = nowLocal();
  if (prev?.id) {
    run("UPDATE payroll_closings SET net_amount=?, advances_applied=?, to_pay=?, cash_ledger_id=?, note=?, method=?, account_label=?, updated_at=? WHERE id=?", [
      net,
      regularAdvances,
      toPay,
      cashId,
      note || null,
      m,
      acc,
      nowStr,
      prev.id
    ]);
  } else {
    insert("INSERT INTO payroll_closings (employee_id,reference_month,net_amount,advances_applied,to_pay,cash_ledger_id,note,method,account_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
      employee_id,
      month,
      net,
      regularAdvances,
      toPay,
      cashId,
      note || null,
      m,
      acc,
      nowStr,
      nowStr
    ]);
  }
  saveDb();
  return { ok: true, employee: emp, month, net_amount: +net.toFixed(2), advances_applied: +regularAdvances.toFixed(2), to_pay: toPay, cash_ledger_id: cashId };
});

// Férias - calcular saldo disponível
ipcMain.handle("vacation:balance", (_, {employee_id}) => {
  const emp = get("SELECT * FROM employees WHERE id=?",[employee_id]);
  if (!emp) return {error:'Funcionário não encontrado'};
  const accrualStartStr = emp.vacation_accrual_start || emp.admission_date;
  if (!accrualStartStr) return {error:'Defina data de admissão ou início do contador de férias'};
  
  // Calcular períodos aquisitivos completos (a partir de vacation_accrual_start se existir)
  const admission = new Date(accrualStartStr);
  const today = new Date();
  const yearsWorked = Math.floor((today - admission) / (365.25 * 24 * 60 * 60 * 1000));
  
  // Buscar férias já tiradas
  const takenVacations = all("SELECT * FROM vacation_records WHERE employee_id=? ORDER BY period_start DESC", [employee_id]);
  const totalDaysTaken = takenVacations.reduce((sum, v) => sum + (v.days_taken || 0), 0);
  const totalDaysBuyout = takenVacations.reduce((sum, v) => sum + (v.buyout_days || 0), 0);
  
  // Direito: 30 dias por período aquisitivo completo
  const totalEntitled = yearsWorked * 30;
  const remainingDays = Math.max(0, totalEntitled - totalDaysTaken - totalDaysBuyout);
  const vencidoDays = Math.max(0, remainingDays - 30); // Acumulado além do período atual
  
  return {
    employee: emp,
    years_worked: yearsWorked,
    total_entitled: totalEntitled,
    total_taken: totalDaysTaken,
    total_buyout: totalDaysBuyout,
    remaining_days: remainingDays,
    vencido_days: vencidoDays,
    vacation_history: takenVacations
  };
});

// Prévia de férias (sem gravar): calcula Base (dias/30), 1/3 e Total com salário vigente no início
ipcMain.handle("vacation:preview", (_, d) => {
  if (!d?.employee_id || !d?.period_start || !d?.period_end) return { error: 'Parâmetros obrigatórios faltando' };
  const salaryAtStart = getSalaryAtDate(d.employee_id, d.period_start) || 0;
  try {
    const r = computeVacationAmounts(d.period_start, d.period_end, salaryAtStart, d.include_one_third !== false);
    const reference_month = (d.period_start || today()).slice(0,7);
    return { ...r, salary_at_start: salaryAtStart, reference_month };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

// Registrar férias: calcula Base (pro rata por dias) e 1/3, lança 1 movimento no caixa e 1 registro em salary_advances (tipo 'ferias').
ipcMain.handle("vacation:register", (_, d) => {
  const emp = get("SELECT * FROM employees WHERE id=?", [d.employee_id]);
  if (!emp) return { error: 'Funcionário não encontrado' };
  if (!d.period_start || !d.period_end) return { error: 'Informe período de férias (início e fim).' };

  // Cálculo de dias (inclusivo)
  const start = new Date(d.period_start);
  const end = new Date(d.period_end);
  if (!(start instanceof Date) || isNaN(start) || !(end instanceof Date) || isNaN(end) || end < start) {
    return { error: 'Período de férias inválido.' };
  }
  const msPerDay = 24*60*60*1000;
  const days = Math.floor((end - start) / msPerDay) + 1;

  // Salário vigente no início do período e cálculo com função compartilhada
  const salaryAtStart = getSalaryAtDate(d.employee_id, d.period_start) || 0;
  const calc = computeVacationAmounts(d.period_start, d.period_end, salaryAtStart, d.include_one_third !== false);
  const baseAmount = calc.base;
  const oneThird = calc.one_third;
  const total = calc.total;

  const effectiveDate = today();
  const referenceMonth = (d.reference_month && d.reference_month.length === 7)
    ? d.reference_month
    : (d.period_start || effectiveDate).slice(0,7);

  // Lançamento no caixa (total)
  const desc = `Férias: ${emp.name || ('Funcionário #' + d.employee_id)}`;
  const m = normalizeMethod(d.method);
  const acc = defaultAccountFor(m, d.account_label || '');
  if (m !== 'dinheiro' && !String(acc).trim()) {
    return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
  }
  const cashId = insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [effectiveDate + 'T12:00:00', -total, m, acc, 'ferias', desc, 'salary_advance', 0, nowLocal()]
  );

  // Registro resumido em salary_advances (não consome teto do mês no saldo atual)
  const note = `Férias ${d.period_start} a ${d.period_end} — Base R$ ${baseAmount.toFixed(2)}${oneThird>0?`, 1/3 R$ ${oneThird.toFixed(2)}`:''}`;
  const advId = insert(
    "INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)",
    [d.employee_id, 'ferias', total, effectiveDate, note, cashId, referenceMonth, nowLocal()]
  );

  // Registrar no histórico de férias
  insert("INSERT INTO vacation_records (employee_id, period_start, period_end, days_taken, buyout_days, notes, created_at) VALUES (?,?,?,?,?,?,?)",
    [d.employee_id, d.period_start, d.period_end, days, d.buyout_days || 0, d.notes || null, nowLocal()]
  );

  saveDb();
  return { id: advId, amount: total, base_amount: baseAmount, one_third: oneThird, reference_month: referenceMonth };
});

// Cálculo do 13º: acumula 1/12 por mês trabalhado (>15 dias) com salário vigente no fim do mês
ipcMain.handle("thirteenth:calculate", (_, { employee_id, year }) => {
  const emp = get("SELECT * FROM employees WHERE id=?", [employee_id]);
  if (!emp) return { error: 'Funcionário não encontrado' };
  const y = year || new Date().getFullYear();
  const isCurrentYear = y === new Date().getFullYear();
  const lastMonth = isCurrentYear ? (new Date().getMonth() + 1) : 12; // 1..12

  // Data de admissão
  const admission = emp.admission_date ? new Date(emp.admission_date) : null;

  let accrued = 0;
  for (let m = 1; m <= lastMonth; m++) {
    const monthStr = `${y}-${String(m).padStart(2,'0')}`;
    const lastDay = new Date(y, m, 0).getDate();
    const refDate = `${monthStr}-${String(lastDay).padStart(2,'0')}`;

    // Regra dos >15 dias trabalhados no mês
    let eligible = true;
    if (admission) {
      const monthStart = new Date(y, m-1, 1);
      const monthEnd = new Date(y, m-1, lastDay);
      if (admission > monthEnd) eligible = false; // ainda não admitido
      else if (admission >= monthStart && admission <= monthEnd) {
        // Contar dias trabalhados no mês
        const workedDays = (monthEnd - admission) / (24*60*60*1000) + 1;
        if (workedDays <= 15.0) eligible = false;
      }
    }
    if (!eligible) continue;

    const sal = getSalaryAtDate(employee_id, refDate) || 0;
    accrued += sal / 12.0;
  }

  // Total já pago no ano (parcelas com advance_type LIKE 'decimo%')
  const paidRow = get(
    "SELECT COALESCE(SUM(amount),0) AS paid FROM salary_advances WHERE employee_id=? AND (strftime('%Y', date)=? OR substr(COALESCE(reference_month,''),1,4)=?) AND advance_type LIKE 'decimo%'",
    [employee_id, String(y), String(y)]
  );
  const paid = paidRow?.paid || 0;
  const remaining = Math.max(0, +(accrued - paid).toFixed(2));
  return { employee: { id: emp.id, name: emp.name }, year: y, accrued: +accrued.toFixed(2), paid: +paid.toFixed(2), remaining };
});

// Pagamento do 13º: registra no caixa e em salary_advances com advance_type decimo_primeira/decimo_segunda
ipcMain.handle("thirteenth:pay", (_, d) => {
  const emp = get("SELECT * FROM employees WHERE id=?", [d.employee_id]);
  if (!emp) return { error: 'Funcionário não encontrado' };
  if (!d.amount || d.amount <= 0) return { error: 'Informe um valor válido' };
  const effectiveDate = d.date || today();
  const y = (effectiveDate || today()).slice(0,4);
  const refMonth = `${y}-12`;
  const type = d.installment_type || d.advance_type || 'decimo_primeira';

  const desc = `${type === 'decimo_segunda' ? '13º 2ª' : '13º 1ª'}: ${emp.name || ('Funcionário #' + d.employee_id)}`;
  const m = normalizeMethod(d.method);
  const acc = defaultAccountFor(m, d.account_label || '');
  if (m !== 'dinheiro' && !String(acc).trim()) {
    return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
  }
  const cashId = insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [effectiveDate + 'T12:00:00', -(d.amount || 0), m, acc, 'decimo_terceiro', desc, 'salary_advance', 0, nowLocal()]
  );

  const advId = insert(
    "INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)",
    [d.employee_id, type, d.amount, effectiveDate, d.note || null, cashId, refMonth, nowLocal()]
  );
  saveDb();
  return get("SELECT * FROM salary_advances WHERE id=?", [advId]);
});

ipcMain.handle("import:csv", async (_, {table}) => {
  const result = await dialog.showOpenDialog({filters:[{name:"CSV",extensions:["csv"]}],properties:["openFile"]});
  if(result.canceled) return {ok:false,message:"Cancelado"};
  try {
    const content = fs.readFileSync(result.filePaths[0],"utf-8");
    const lines = content.split("\n").filter(l=>l.trim());
    const headers = lines[0].split(";").map(h=>h.trim().replace(/^"|"$/g,""));
    let count=0;
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(";").map(c=>c.trim().replace(/^"|"$/g,"")||null);
      const row={};headers.forEach((h,idx)=>{row[h]=cols[idx];});
      try {
        if(table==="os") insert("INSERT OR IGNORE INTO service_orders (number,title,status,total,payment_status,note,created_at) VALUES (?,?,?,?,?,?,?)",[row.number,row.title,row.status||"aberta",row.total||0,row.payment_status||"em_aberto",row.note,row.created_at]);
        else if(table==="caixa") insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type) VALUES (?,?,?,?,?,?,?)",[row.occurred_at,row.amount||0,row.method,row.account_label,row.category||"manual",row.description,row.source_type||"manual"]);
        else if(table==="ap") insert("INSERT OR IGNORE INTO accounts_payable (description,category,amount,due_date,status,note) VALUES (?,?,?,?,?,?)",[row.description,row.category||"geral",row.amount||0,row.due_date,row.status||"pendente",row.note]);
        else if(table==="ar") insert("INSERT OR IGNORE INTO accounts_receivable (description,category,amount,due_date,status,note) VALUES (?,?,?,?,?,?)",[row.description,row.category||"geral",row.amount||0,row.due_date,row.status||"pendente",row.note]);
        else if(table==="clientes") {
          const full = (row.name || '').trim();
          const parts = full.split(/\s+/);
          const firstName = row.first_name || parts[0] || full || '';
          const lastName = row.last_name || parts.slice(1).join(' ') || '.';
          // Se coluna 'name' existir no schema, manter também
          try { run("ALTER TABLE clients ADD COLUMN name TEXT", []); } catch(_){ }
          insert("INSERT OR IGNORE INTO clients (first_name,last_name,phone,email,address,created_at) VALUES (?,?,?,?,?,?)",
            [firstName, lastName, row.phone || '', row.email || '', row.address || '', row.created_at || nowLocal()]);
          // Atualizar coluna name se existir
          try {
            const lastId = get("SELECT last_insert_rowid() as id")?.id;
            if (lastId) run("UPDATE clients SET name=? WHERE id=?", [full || (`${firstName} ${lastName}`.trim()), lastId]);
          } catch(_) { }
        }
        else if(table==="servicos") {
          insert("INSERT OR IGNORE INTO services (name,description,category,unit_price,unit,active,created_at) VALUES (?,?,?,?,?,?,?)",
            [row.name, row.description || '', row.category || 'geral', parseFloat(row.unit_price || row.price || 0) || 0, row.unit || 'un', (row.active==null?1:(String(row.active).toLowerCase()==='true'||String(row.active)==='1'?1:0)), row.created_at || nowLocal()]);
        }
        count++;
      } catch(e){}
    }
    return {ok:true,count};
  } catch(e) { return {ok:false,message:String(e)}; }
});

ipcMain.handle("db:path", () => getDbPath());

ipcMain.handle("db:cleanup_duplicates", () => {
  // Remover duplicatas de contas a pagar (mesma descrição, valor, data, status)
  run(`DELETE FROM accounts_payable WHERE id NOT IN (
    SELECT MIN(id) FROM accounts_payable GROUP BY description, amount, due_date, status
  )`);
  const apDeleted = get("SELECT changes() as c")?.c || 0;
  // Remover duplicatas de contas a receber
  run(`DELETE FROM accounts_receivable WHERE id NOT IN (
    SELECT MIN(id) FROM accounts_receivable GROUP BY description, amount, due_date, status
  )`);
  const arDeleted = get("SELECT changes() as c")?.c || 0;
  saveDb();
  return { ok: true, apDeleted, arDeleted };
});

ipcMain.handle("dashboard:summary", () => {
  const todayStr = today();
  const monthStr = monthStart();

  const osAberta = get("SELECT COUNT(*) as c FROM service_orders WHERE status NOT IN ('entregue')")?.c || 0;
  const osHoje = get("SELECT COUNT(*) as c FROM service_orders WHERE DATE(created_at)=?", [todayStr])?.c || 0;
  const receitaMes = get("SELECT COALESCE(SUM(amount),0) as s FROM cash_ledger WHERE amount>0 AND DATE(occurred_at)>=?", [monthStr])?.s || 0;
  const saidaMes = get("SELECT COALESCE(SUM(amount),0) as s FROM cash_ledger WHERE amount<0 AND DATE(occurred_at)>=?", [monthStr])?.s || 0;
  const saldoMes = receitaMes + saidaMes;
  const apVencidas = get("SELECT COUNT(*) as c FROM accounts_payable WHERE status='pendente' AND due_date<?", [todayStr])?.c || 0;
  const apPendente = get("SELECT COALESCE(SUM(amount),0) as s FROM accounts_payable WHERE status='pendente'")?.s || 0;
  const arPendente = get("SELECT COALESCE(SUM(amount),0) as s FROM accounts_receivable WHERE status='pendente'")?.s || 0;
  const totalClientes = get("SELECT COUNT(*) as c FROM clients")?.c || 0;
  const osPorStatus = all("SELECT status, COUNT(*) as c FROM service_orders GROUP BY status");
  const receitaSemana = get("SELECT COALESCE(SUM(amount),0) as s FROM cash_ledger WHERE amount>0 AND DATE(occurred_at)>=date(?,'weekday 0','-6 days')", [todayStr])?.s || 0;
  const ultimasOS = all("SELECT so.*, c.name as client_name FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id ORDER BY so.created_at DESC LIMIT 5");
  const osProntas = all(`SELECT so.id, so.number, so.created_at, so.total,
    COALESCE((SELECT SUM(amount) FROM os_payments WHERE order_id=so.id),0) as paid,
    c.name as client_name, c.phone as client_phone
    FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id
    WHERE so.status='pronta' ORDER BY so.created_at ASC`);
  const apVencendo7 = get("SELECT COUNT(*) as c FROM accounts_payable WHERE status='pendente' AND due_date>=? AND due_date<=date(?,'+7 days')", [todayStr, todayStr])?.c || 0;

  return { osAberta, osHoje, receitaMes, saidaMes: Math.abs(saidaMes), saldoMes, apVencidas, apPendente, arPendente, totalClientes, osPorStatus, receitaSemana, ultimasOS, osProntas, apVencendo7 };
});

ipcMain.handle("company:get", () => {
  const rows = all("SELECT key, value FROM company_settings");
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
});
ipcMain.handle("company:update", (_, data) => {
  for (const [key, value] of Object.entries(data)) {
    run("INSERT INTO company_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value ?? '']);
  }
  return { ok: true };
});

ipcMain.handle("payment_methods:list", () => {
  return all("SELECT name, active FROM payment_methods ORDER BY name ASC");
});
ipcMain.handle("payment_methods:create", (_, {name, active}) => {
  if (!name) return { ok:false, error:'Nome inválido' };
  try { insert("INSERT OR IGNORE INTO payment_methods (name,active,created_at) VALUES (?,?,?)", [String(name).trim().toLowerCase(), active?1:1, nowLocal()]); } catch(_){ }
  return { ok:true };
});
ipcMain.handle("payment_methods:update", (_, {name, active}) => {
  if (!name) return { ok:false, error:'Nome inválido' };
  run("UPDATE payment_methods SET active=? WHERE name=?", [active?1:0, String(name).trim().toLowerCase()]);
  return { ok:true };
});
ipcMain.handle("payment_methods:delete", (_, {name}) => {
  if (!name) return { ok:false, error:'Nome inválido' };
  run("UPDATE payment_methods SET active=0 WHERE name=?", [String(name).trim().toLowerCase()]);
  return { ok:true };
});

ipcMain.handle("bank_accounts:list", () => {
  return all("SELECT * FROM bank_accounts WHERE active=1 ORDER BY label ASC");
});
ipcMain.handle("bank_accounts:create", (_, d) => {
  if (!d?.label) return { ok:false, error:'Label inválido' };
  const id = insert("INSERT INTO bank_accounts (label, bank_name, agency, account_number, active, created_at) VALUES (?,?,?,?,?,?)", [d.label, d.bank_name||null, d.agency||null, d.account_number||null, 1, nowLocal()]);
  return get("SELECT * FROM bank_accounts WHERE id=?", [id]);
});
ipcMain.handle("bank_accounts:update", (_, {id, ...d}) => {
  run("UPDATE bank_accounts SET label=?, bank_name=?, agency=?, account_number=?, active=? WHERE id=?", [d.label, d.bank_name||null, d.agency||null, d.account_number||null, d.active?1:0, id]);
  return get("SELECT * FROM bank_accounts WHERE id=?", [id]);
});
ipcMain.handle("bank_accounts:delete", (_, id) => {
  run("UPDATE bank_accounts SET active=0 WHERE id=?", [id]);
  return { ok:true };
});

ipcMain.handle("dashboard:ready_count", () => {
  return get("SELECT COUNT(*) as c FROM service_orders WHERE status='pronta'")?.c || 0;
});

ipcMain.handle("ap:overdue_count", () => {
  const todayStr = today();
  return get("SELECT COUNT(*) as c FROM accounts_payable WHERE status='pendente' AND due_date<?", [todayStr])?.c || 0;
});

// Handlers para saldos pendentes de salário
ipcMain.handle("salary_pending:list", (_, { employee_id, status }) => {
  let sql = "SELECT p.*, e.name as employee_name FROM salary_balance_pending p JOIN employees e ON p.employee_id = e.id WHERE 1=1";
  const params = [];
  if (employee_id) { sql += " AND p.employee_id=?"; params.push(employee_id); }
  if (status) { sql += " AND p.status=?"; params.push(status); }
  sql += " ORDER BY p.reference_month DESC, p.created_at DESC";
  return all(sql, params);
});

ipcMain.handle("salary_pending:create", (_, d) => {
  const id = insert("INSERT INTO salary_balance_pending (employee_id, reference_month, amount, status, created_at) VALUES (?,?,?,?,?)", 
    [d.employee_id, d.reference_month, d.amount, d.status || 'pending', nowLocal()]);
  saveDb();
  return get("SELECT * FROM salary_balance_pending WHERE id=?",[id]);
});

ipcMain.handle("salary_pending:pay", (_, { id, amount, method, account_label, create_ap }) => {
  const pending = get("SELECT * FROM salary_balance_pending WHERE id=?", [id]);
  if (!pending) return { error: "Saldo pendente não encontrado" };
  if (pending.status === 'paid') return { error: "Saldo já foi quitado" };
  
  const payAmount = amount || (pending.amount - (pending.paid_amount || 0));
  const remainingBefore = pending.amount - (pending.paid_amount || 0);
  
  if (payAmount > remainingBefore) {
    return { error: `Valor excede o saldo. Falta pagar: ${remainingBefore}` };
  }
  
  const newPaidAmount = (pending.paid_amount || 0) + payAmount;
  const remaining = pending.amount - newPaidAmount;
  const isFullyPaid = remaining <= 0;
  
  const now = nowLocal();
  const today = today();
  const m = normalizeMethod(method);
  const acc = defaultAccountFor(m, account_label || '');
  if (m !== 'dinheiro' && !String(acc).trim()) {
    return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
  }
  
  // Criar lançamento no caixa
  const cashId = insert("INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
    today + 'T12:00:00',
    -(payAmount || 0),
    m,
    acc,
    'saldo_salario_anterior',
    `Pagamento parcial saldo ${pending.reference_month}: ${get("SELECT name FROM employees WHERE id=?", [pending.employee_id])?.name} (R$${payAmount} de R$${pending.amount})`,
    'salary_pending',
    id,
    now
  ]);
  
  // Atualizar paid_amount e status
  run("UPDATE salary_balance_pending SET paid_amount=?, status=? WHERE id=?", 
    [newPaidAmount, isFullyPaid ? 'paid' : 'pending', id]);
  
  // Se solicitado, criar conta a pagar também
  if (create_ap) {
    insert("INSERT INTO accounts_payable (description, category, amount, due_date, status, paid_at, method, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
      `Saldo salário ${pending.reference_month} - Parcial`,
      'folha_pagamento',
      payAmount,
      today,
      'paga',
      now,
      m,
      `Funcionário ID: ${pending.employee_id} - Pago: ${payAmount} de ${pending.amount}`,
      now
    ]);
  }
  
  saveDb();
  return { 
    ok: true, 
    cash_id: cashId, 
    paid_amount: payAmount, 
    total_paid: newPaidAmount,
    remaining: remaining,
    is_fully_paid: isFullyPaid
  };
});

ipcMain.handle("salary_pending:delete", (_, id) => {
  const pending = get("SELECT * FROM salary_balance_pending WHERE id=?", [id]);
  if (pending?.status === 'paid') {
    // Remover lançamento do caixa
    const cashEntry = get("SELECT id FROM cash_ledger WHERE source_type='salary_pending' AND source_id=?", [id]);
    if (cashEntry) {
      run("DELETE FROM cash_ledger WHERE id=?", [cashEntry.id]);
    }
  }
  run("DELETE FROM salary_balance_pending WHERE id=?", [id]);
  saveDb();
  return { ok: true };
});

// Handler de teste para simular fechamento automático (para testes)
ipcMain.handle("debug:auto_close_month", () => {
  autoClosePreviousMonth();
  return { ok: true, message: "Fechamento automático executado" };
});

// Debug: limpar inconsistências de salário para um funcionário e mês
ipcMain.handle("debug:cleanup_salary_month", (_, { employee_id, month }) => {
  if (!employee_id || !month) return { ok: false, message: "Parâmetros inválidos" };
  const prev = getPreviousMonth(month);

  // Calcular salário e total de adiantamentos regulares do mês anterior
  const salary = getEmployeeSalaryAtMonth(employee_id, prev);
  const totalAdvances = get(
    "SELECT COALESCE(SUM(amount),0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND (advance_type='regular' OR advance_type IS NULL)",
    [employee_id, prev, prev]
  )?.total || 0;

  const excess = Math.max(0, totalAdvances - salary);
  const deficit = Math.max(0, salary - totalAdvances);

  const carryNote = `Ajuste: excesso de adiantamentos de ${prev}`;
  const existingCarry = get(
    "SELECT id FROM salary_advances WHERE employee_id=? AND reference_month=? AND advance_type='regular' AND note=?",
    [employee_id, month, carryNote]
  );

  let actions = { removedPendings: 0, updatedPending: false, removedCarry: false, updatedCarry: false, createdCarry: false };

  if (excess > 0.009) {
    // Excesso: garantir ajuste e remover pendências desse mês
    const pendings = all("SELECT id FROM salary_balance_pending WHERE employee_id=? AND reference_month=? AND status='pending'", [employee_id, month]);
    for (const p of pendings) { run("DELETE FROM salary_balance_pending WHERE id=?", [p.id]); actions.removedPendings++; }
    if (existingCarry?.id) {
      run("UPDATE salary_advances SET amount=?, date=? WHERE id=?", [excess, today(), existingCarry.id]);
      actions.updatedCarry = true;
    } else {
      insert(
        "INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)",
        [employee_id, 'regular', excess, today(), carryNote, 0, month, nowLocal()]
      );
      actions.createdCarry = true;
    }
  } else if (deficit > 0.009) {
    // Déficit: garantir pendência e remover ajuste
    if (existingCarry?.id) { run("DELETE FROM salary_advances WHERE id=?", [existingCarry.id]); actions.removedCarry = true; }
    const existPending = get("SELECT id FROM salary_balance_pending WHERE employee_id=? AND reference_month=? AND status='pending'", [employee_id, month]);
    if (existPending?.id) {
      run("UPDATE salary_balance_pending SET amount=? WHERE id=?", [deficit, existPending.id]);
      actions.updatedPending = true;
    } else {
      insert("INSERT INTO salary_balance_pending (employee_id, reference_month, amount, paid_amount, status, created_at) VALUES (?,?,?,?,?,?)",
        [employee_id, month, deficit, 0, 'pending', nowLocal()]);
    }
  } else {
    // Sem excesso nem déficit: remover ambos se existirem
    const pendings = all("SELECT id FROM salary_balance_pending WHERE employee_id=? AND reference_month=? AND status='pending'", [employee_id, month]);
    for (const p of pendings) { run("DELETE FROM salary_balance_pending WHERE id=?", [p.id]); actions.removedPendings++; }
    if (existingCarry?.id) { run("DELETE FROM salary_advances WHERE id=?", [existingCarry.id]); actions.removedCarry = true; }
  }

  // Também garantir que o próprio mês esteja recalculado e capado ao salário
  try { recalculateAdvanceReferenceMonths(employee_id, month); } catch(e){ console.warn('[cleanup] recalc month error', e); }
  saveDb();
  return { ok: true, salary, totalAdvances, excess, deficit, actions };
});

// Debug: resetar pendências e ajustes de um funcionário (para testes)
ipcMain.handle("debug:reset_salary_state", (_, { employee_id }) => {
  if (!employee_id) return { ok: false, message: "employee_id obrigatório" };
  run("DELETE FROM salary_balance_pending WHERE employee_id=?", [employee_id]);
  const pendDeleted = get("SELECT changes() as c")?.c || 0;
  run("DELETE FROM salary_advances WHERE employee_id=? AND note LIKE 'Ajuste: excesso de adiantamentos %'", [employee_id]);
  const adjDeleted = get("SELECT changes() as c")?.c || 0;
  saveDb();
  return { ok: true, pendDeleted, adjDeleted };
});

async function createWindow() {
  const win = new BrowserWindow({
    width:1280, height:800, minWidth:900, minHeight:600,
    webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false},
    title:"OS e Contabil  Lavanderia"
  });
  if(isDev){
    const url = await waitForDevServer();
    if (url && /^https?:\/\//.test(url)) {
      await win.loadURL(url + '/#/dashboard');
    } else {
      // Fallback seguro: carrega build local se o dev server não respondeu
      await win.loadFile(path.join(__dirname, "../dist/index.html"));
    }
    try { win.webContents.openDevTools(); } catch(_) {}
  }
  else win.loadFile(path.join(__dirname,"../dist/index.html"));
}

app.whenReady().then(async () => {
  await initDb();
  await createWindow();
  app.on("activate", () => {if(BrowserWindow.getAllWindows().length===0) createWindow();});
});
app.on("window-all-closed", () => {if(process.platform!=="darwin") app.quit();});
