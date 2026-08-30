const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { from: 'exports', out: 'prod.db' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from' && args[i + 1]) { out.from = args[++i]; continue; }
    if (a === '--out' && args[i + 1]) { out.out = args[++i]; continue; }
  }
  return out;
}

async function initDb() {
  const initSqlJs = require('sql.js');
  const wasmPath = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  return new SQL.Database();
}

function run(db, sql, params = []) { db.run(sql, params); }

function createSchema(db) {
  run(db, `CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, created_at TEXT, name TEXT);`);
  run(db, `CREATE TABLE IF NOT EXISTS service_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER UNIQUE, client_id INTEGER, title TEXT, status TEXT DEFAULT "aberta", total REAL DEFAULT 0, paid REAL DEFAULT 0, payment_status TEXT DEFAULT "em_aberto", note TEXT, assigned_to TEXT, expected_at TEXT, created_at TEXT, updated_at TEXT);`);
  run(db, `CREATE TABLE IF NOT EXISTS os_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, description TEXT NOT NULL, quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0, total REAL DEFAULT 0, requires_entry INTEGER DEFAULT 0, entry_pct REAL DEFAULT 50);`);
  run(db, `CREATE TABLE IF NOT EXISTS os_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, amount REAL NOT NULL, method TEXT DEFAULT "dinheiro", when_type TEXT DEFAULT "retirada", payment_date TEXT, note TEXT, created_at TEXT);`);
  run(db, `CREATE TABLE IF NOT EXISTS cash_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, amount REAL NOT NULL, method TEXT, account_label TEXT, category TEXT DEFAULT "manual", description TEXT, source_type TEXT DEFAULT "manual", source_id INTEGER, created_at TEXT);`);
  run(db, `CREATE TABLE IF NOT EXISTS accounts_payable (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, category TEXT DEFAULT "geral", amount REAL DEFAULT 0, due_date TEXT, status TEXT DEFAULT "pendente", paid_at TEXT, method TEXT, account_label TEXT, note TEXT, created_at TEXT, source_type TEXT DEFAULT 'ap', source_id INTEGER);`);
  run(db, `CREATE TABLE IF NOT EXISTS accounts_receivable (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, category TEXT DEFAULT "geral", amount REAL DEFAULT 0, due_date TEXT, status TEXT DEFAULT "pendente", received_at TEXT, method TEXT, account_label TEXT, note TEXT, created_at TEXT, source_type TEXT DEFAULT 'ar', source_id INTEGER);`);
  run(db, `CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, category TEXT DEFAULT "geral", unit_price REAL DEFAULT 0, unit TEXT DEFAULT "un", active INTEGER DEFAULT 1, created_at TEXT);`);
  run(db, `CREATE TABLE IF NOT EXISTS cash_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT);`);
  run(db, `CREATE TABLE IF NOT EXISTS ap_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT);`);
  run(db, `CREATE TABLE IF NOT EXISTS ar_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT);`);
}

function parseCsv(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.length > 0);
  if (!lines.length) return null;
  const detectDelim = (hdr) => {
    const semi = (hdr.match(/;/g) || []).length;
    const comma = (hdr.match(/,/g) || []).length;
    return comma >= semi ? ',' : ';';
  };
  const delim = detectDelim(lines[0]);
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === delim && !inQ) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(v => {
      const t = v.trim();
      if (t === '') return null;
      return t;
    });
  };
  const headers = parseLine(lines[0]).map(h => h ? h.replace(/^"|"$/g, '') : h);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { if (h) row[h] = cols[idx]; });
    rows.push(row);
  }
  return rows;
}

function insertFromCsv(db, dir) {
  const join = (...p) => path.join(dir, ...p);
  const nowLocal = () => new Date().toISOString().replace('Z', '');
  const val = (v, d = null) => (v === undefined ? d : v);
  const num = (v, d = 0) => {
    if (v === undefined || v === null || v === '') return d;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : d;
  };

  const clientes = parseCsv(join('clientes.csv'));
  if (clientes) {
    for (const row of clientes) {
      const full = val(row.name, '')?.toString().trim() || '';
      const parts = full.split(/\s+/);
      const firstName = val(row.first_name, parts[0] || full || '');
      const lastName = val(row.last_name, parts.slice(1).join(' ') || '.');
      run(db, "INSERT OR IGNORE INTO clients (first_name,last_name,phone,email,address,created_at,name) VALUES (?,?,?,?,?,?,?)", [
        val(firstName, ''),
        val(lastName, '.'),
        val(row.phone, ''),
        val(row.email, ''),
        val(row.address, ''),
        val(row.created_at, nowLocal()),
        full || `${firstName} ${lastName}`.trim()
      ]);
    }
  }

  const servicos = parseCsv(join('servicos.csv'));
  if (servicos) {
    for (const row of servicos) {
      const active = row?.active == null ? 1 : ((String(row.active).toLowerCase() === 'true' || String(row.active) === '1') ? 1 : 0);
      const price = num(row.unit_price ?? row.price, 0);
      run(db, "INSERT OR IGNORE INTO services (name,description,category,unit_price,unit,active,created_at) VALUES (?,?,?,?,?,?,?)", [
        val(row.name, ''),
        val(row.description, ''),
        val(row.category, 'geral'),
        price,
        val(row.unit, 'un'),
        active,
        val(row.created_at, nowLocal())
      ]);
    }
  }

  const os = parseCsv(join('os.csv'));
  if (os) {
    for (const row of os) {
      run(db, "INSERT OR IGNORE INTO service_orders (number,title,status,total,payment_status,note,created_at) VALUES (?,?,?,?,?,?,?)", [
        num(row.number, null),
        val(row.title, ''),
        val(row.status, 'aberta'),
        num(row.total, 0),
        val(row.payment_status, 'em_aberto'),
        val(row.note, ''),
        val(row.created_at, nowLocal())
      ]);
    }
  }

  const caixa = parseCsv(join('caixa.csv'));
  if (caixa) {
    for (const row of caixa) {
      run(db, "INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type) VALUES (?,?,?,?,?,?,?)", [
        val(row.occurred_at, nowLocal()),
        num(row.amount, 0),
        val(row.method, ''),
        val(row.account_label, ''),
        val(row.category, 'manual'),
        val(row.description, ''),
        val(row.source_type, 'manual')
      ]);
    }
  }

  const ap = parseCsv(join('ap.csv'));
  if (ap) {
    for (const row of ap) {
      run(db, "INSERT OR IGNORE INTO accounts_payable (description,category,amount,due_date,status,note) VALUES (?,?,?,?,?,?)", [
        val(row.description, ''),
        val(row.category, 'geral'),
        num(row.amount, 0),
        val(row.due_date, null),
        val(row.status, 'pendente'),
        val(row.note, '')
      ]);
    }
  }

  const ar = parseCsv(join('ar.csv'));
  if (ar) {
    for (const row of ar) {
      run(db, "INSERT OR IGNORE INTO accounts_receivable (description,category,amount,due_date,status,note) VALUES (?,?,?,?,?,?)", [
        val(row.description, ''),
        val(row.category, 'geral'),
        num(row.amount, 0),
        val(row.due_date, null),
        val(row.status, 'pendente'),
        val(row.note, '')
      ]);
    }
  }
}

(async () => {
  const { from, out } = parseArgs();
  const absFrom = path.isAbsolute(from) ? from : path.join(process.cwd(), from);
  if (!fs.existsSync(absFrom)) { console.error('Diretório de CSVs não encontrado:', absFrom); process.exit(1); }
  const db = await initDb();
  createSchema(db);
  insertFromCsv(db, absFrom);
  const data = db.export();
  const outPath = path.isAbsolute(out) ? out : path.join(process.cwd(), out);
  fs.writeFileSync(outPath, Buffer.from(data));
  console.log('Banco gerado em', outPath);
})();
