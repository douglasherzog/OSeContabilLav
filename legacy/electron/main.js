const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const BetterSqlite3 = require("better-sqlite3");
const { today, nowLocal, monthStart, monthEnd, monthStartFromStr, extractMonth, isInMonth } = require("./dateHelpers");
const { computeVacationAmounts } = require("./calc/vacation");
const registerServicos      = require('./handlers/servicos');
const registerOS            = require('./handlers/os');
const registerCaixa         = require('./handlers/caixa');
const registerFuncionarios  = require('./handlers/funcionarios');
const registerConfiguracoes = require('./handlers/configuracoes');
const registerDashboard     = require('./handlers/dashboard');

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
// Parametrização do servidor de desenvolvimento (padrão porta 3000)
const DEV_HOST = process.env.DEV_HOST || 'localhost';
const DEV_PORT = process.env.PORT || process.env.DEV_PORT || '3000';
const DEV_URL = process.env.DEV_URL || `http://${DEV_HOST}:${DEV_PORT}`;
let db;

const __appDataBase = app.getPath("appData");
try { app.setName("OS e Contabil - Lav"); } catch(_) {}
try { app.setPath("userData", path.join(__appDataBase, "OS e Contabil - Lav")); } catch(_) {}

// Logging básico em arquivo para diagnóstico de estabilidade
let __logFilePath = null;
function getLogFilePath() {
  if (__logFilePath) return __logFilePath;
  try {
    const base = app.getPath("userData");
    __logFilePath = path.join(base, "logs", "main.log");
    try { fs.mkdirSync(path.dirname(__logFilePath), { recursive: true }); } catch(_) {}
    return __logFilePath;
  } catch (_) {
    __logFilePath = path.join(process.cwd(), "main.log");
    return __logFilePath;
  }
}


function logLine(level, message, meta) {
  const time = new Date().toISOString();
  const line = JSON.stringify({ time, level, message, meta }) + "\n";
  try { fs.appendFileSync(getLogFilePath(), line, { encoding: "utf-8" }); } catch(_) {}
  if (level === "error" || level === "warn") {
    console.error(`[${level}]`, message, meta || "");
  } else {
    console.log(`[${level}]`, message, meta || "");
  }
}

process.on("uncaughtException", (err) => {
  logLine("error", "uncaughtException", { message: err?.message, stack: err?.stack });
});
process.on("unhandledRejection", (reason) => {
  logLine("error", "unhandledRejection", { reason: String(reason), stack: reason?.stack });
});

let autoUpdater = null;
try {
  const updaterModule = require('electron-updater');
  autoUpdater = updaterModule.autoUpdater;
  autoUpdater.logger = {
    info:  (m) => logLine('info',  '[updater] ' + m),
    warn:  (m) => logLine('warn',  '[updater] ' + m),
    error: (m) => logLine('error', '[updater] ' + m),
  };
  autoUpdater.autoDownload = false;
} catch(_) {}

app.on("render-process-gone", (_event, _webContents, details) => {
  logLine("error", "render-process-gone", details || {});
});
app.on("child-process-gone", (_event, details) => {
  logLine("error", "child-process-gone", details || {});
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

function saveDb() { invalidateDashboardCache(); }

function run(sql, params = []) { db.prepare(sql).run(params); }

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS || 200);
function all(sql, params = []) {
  const started = Date.now();
  try { return db.prepare(sql).all(params); }
  catch(e) { console.error("SQL error:", sql, e); return []; }
  finally {
    const elapsed = Date.now() - started;
    if (elapsed > SLOW_QUERY_MS) logLine("warn", "slow-query", { ms: elapsed, sql });
  }
}

function get(sql, params = []) {
  const started = Date.now();
  try { return db.prepare(sql).get(params) || null; }
  catch(e){ console.error("SQL error:", sql, e); return null; }
  finally {
    const elapsed = Date.now() - started;
    if (elapsed > SLOW_QUERY_MS) logLine("warn", "slow-query", { ms: elapsed, sql });
  }
}

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

//  Sistema de migrations versionadas 
// Cada entrada é aplicada exatamente uma vez, identificada pelo índice (1-based).
// O PRAGMA user_version do banco registra quantas já foram aplicadas.
// Para adicionar uma nova migration: acrescentar ao final do array.
const MIGRATIONS = [
  // v1: colunas incrementais de OS e serviços
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
  // v4: integração caixa em contas a pagar/receber
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
  // v6: normalizar métodos de pagamento nulos no caixa e contas
  () => {
    try { db.prepare("UPDATE cash_ledger SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''").run(); } catch(_){}
    try { db.prepare("UPDATE accounts_payable SET method=COALESCE(NULLIF(TRIM(method),''),'dinheiro')").run(); } catch(_){}
    try { db.prepare("UPDATE accounts_receivable SET method=COALESCE(NULLIF(TRIM(method),''),'dinheiro')").run(); } catch(_){}
  },
  // v7: corrigir occurred_at com 'T' e sincronizar os_payments órfãos no caixa
  () => {
    try { db.prepare("UPDATE cash_ledger SET occurred_at = REPLACE(occurred_at, 'T', ' ') WHERE occurred_at LIKE '%T%'").run(); } catch(_){}
    try { db.prepare("DELETE FROM cash_ledger WHERE category='os_pagamento' AND (source_id IS NULL OR source_type != 'os')").run(); } catch(_){}
  },
  // v8: colunas admission_date, base_salary, vacation_accrual_start em employees
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
// 

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS service_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER UNIQUE, client_id INTEGER, title TEXT, status TEXT DEFAULT "aberta", total REAL DEFAULT 0, paid REAL DEFAULT 0, payment_status TEXT DEFAULT "em_aberto", note TEXT, assigned_to TEXT, expected_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS os_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, description TEXT NOT NULL, quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0, total REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS os_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, amount REAL NOT NULL, method TEXT DEFAULT "dinheiro", when_type TEXT DEFAULT "retirada", payment_date TEXT, note TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS cash_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, amount REAL NOT NULL, method TEXT, account_label TEXT, category TEXT DEFAULT "manual", description TEXT, source_type TEXT DEFAULT "manual", source_id INTEGER, created_at TEXT);
    CREATE TABLE IF NOT EXISTS accounts_payable (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, category TEXT DEFAULT "geral", amount REAL DEFAULT 0, due_date TEXT, status TEXT DEFAULT "pendente", paid_at TEXT, method TEXT, account_label TEXT, note TEXT, created_at TEXT, recurrence_id INTEGER);
    CREATE TABLE IF NOT EXISTS accounts_payable_recurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      category TEXT DEFAULT "geral",
      amount REAL DEFAULT 0,
      note TEXT,
      start_date TEXT NOT NULL,
      interval_value INTEGER DEFAULT 1,
      interval_unit TEXT DEFAULT 'month',
      end_date TEXT,
      next_due_date TEXT NOT NULL,
      recurrence_type TEXT DEFAULT 'variable',
      installments_count INTEGER,
      active INTEGER DEFAULT 1,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS accounts_receivable (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, category TEXT DEFAULT "geral", amount REAL DEFAULT 0, due_date TEXT, status TEXT DEFAULT "pendente", received_at TEXT, method TEXT, account_label TEXT, note TEXT, created_at TEXT, recurrence_id INTEGER);
    CREATE TABLE IF NOT EXISTS accounts_receivable_recurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      category TEXT DEFAULT "geral",
      amount REAL DEFAULT 0,
      note TEXT,
      start_date TEXT NOT NULL,
      interval_value INTEGER DEFAULT 1,
      interval_unit TEXT DEFAULT 'month',
      end_date TEXT,
      next_due_date TEXT NOT NULL,
      recurrence_type TEXT DEFAULT 'variable',
      installments_count INTEGER,
      active INTEGER DEFAULT 1,
      created_at TEXT
    );
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
  applyMigrations();
}


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

const __dashboardCache = { ts: 0, data: null };
function invalidateDashboardCache() { __dashboardCache.ts = 0; __dashboardCache.data = null; }

async function createWindow() {
  const { version } = require('../package.json');
  const win = new BrowserWindow({
    width:1280, height:800, minWidth:900, minHeight:600,
    webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false},
    title:`OS e Contabil — Lavanderia v${version}`
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    logLine("error", "webcontents-render-gone", details || {});
  });
  win.on("unresponsive", () => {
    logLine("warn", "window-unresponsive", { url: win.webContents?.getURL?.() || "" });
  });
  win.on("responsive", () => {
    logLine("info", "window-responsive", { url: win.webContents?.getURL?.() || "" });
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logLine("error", "did-fail-load", { errorCode, errorDescription, validatedURL });
  });

  ipcMain.handle('app:version', () => require('../package.json').version);
  ipcMain.handle('app:open-logs', () => { try { shell.showItemInFolder(getLogFilePath()); } catch(_){} });
  ipcMain.handle('app:check-update', async () => {
    if (!autoUpdater || isDev) return { status: 'dev' };
    try { await autoUpdater.checkForUpdates(); return { status: 'checking' }; } catch(e) { return { status: 'error', message: String(e.message||e) }; }
  });
  ipcMain.handle('app:install-update', () => { if (autoUpdater) autoUpdater.downloadUpdate(); });

  if (autoUpdater && !isDev) {
    autoUpdater.on('update-available', (info) => { win.webContents.send('update-available', info); });
    autoUpdater.on('update-downloaded', (info) => { win.webContents.send('update-downloaded', info); });
    autoUpdater.on('error', (err) => { win.webContents.send('update-error', String(err.message||err)); });
    autoUpdater.on('download-progress', (p) => { win.webContents.send('update-progress', p); });
    autoUpdater.checkForUpdates().catch(() => {});
  }

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

function autoBackup() {
  try {
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) return;
    const backupDir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(backupDir, `osecontabil_${stamp}.db`);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(dbPath, dest);
      logLine('info', 'auto-backup', { dest });
    }
    // Manter apenas os últimos 7 backups
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('osecontabil_') && f.endsWith('.db'))
      .sort();
    if (files.length > 7) {
      files.slice(0, files.length - 7).forEach(f => {
        try { fs.unlinkSync(path.join(backupDir, f)); } catch(_) {}
      });
    }
  } catch (e) {
    logLine('warn', 'auto-backup-failed', { error: String(e.message || e) });
  }
}
app.whenReady().then(async () => {
  autoBackup();
  await initDb();
  // Registrar handlers IPC modulares
  const ctx = { run, all, get, insert, nowLocal, today, monthStart, saveDb, getDbPath, dialog,
    normalizeMethod, defaultAccountFor, invalidateDashboardCache,
    getNextMonth, getPreviousMonth, getLastDayOfMonth,
    computeVacationAmounts, autoClosePreviousMonth };
  registerServicos(ipcMain, ctx);
  registerOS(ipcMain, ctx);
  const dashboardModule = registerDashboard(ipcMain, ctx);
  // Usar o invalidate do módulo dashboard como a função canônica de invalidação
  if (dashboardModule?.invalidate) ctx.invalidateDashboardCache = dashboardModule.invalidate;
  registerCaixa(ipcMain, ctx);
  registerFuncionarios(ipcMain, ctx);
  registerConfiguracoes(ipcMain, ctx);
  // Optional one-off reset: preserve clients/services and clear OS/Caixa/AP/AR
  if (process.env.RESET_FINANCE === '1') {
    try {
      run("DELETE FROM cash_ledger");
      run("DELETE FROM os_payments");
      run("DELETE FROM os_items");
      run("DELETE FROM service_orders");
      try { run("DELETE FROM accounts_payable"); } catch(_){ }
      try { run("DELETE FROM accounts_receivable"); } catch(_){ }
      try { run("VACUUM"); } catch(_){ }
      saveDb();
      console.log('[reset] Banco reiniciado: OS, pagamentos, itens, caixa, AP/AR limpos. Clientes e serviços preservados.');
    } catch (e) {
      console.error('[reset] Falha ao reiniciar base:', e);
    }
    app.quit();
    return;
  }
  await createWindow();
  app.on("activate", () => {if(BrowserWindow.getAllWindows().length===0) createWindow();});
});
app.on("window-all-closed", () => {if(process.platform!=="darwin") app.quit();});
