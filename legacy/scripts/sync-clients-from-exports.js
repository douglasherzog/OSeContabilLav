const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { from: path.join(process.cwd(), 'exports', 'clientes.csv'), db: '' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--from' || a === '-f') && args[i + 1]) { out.from = path.resolve(args[++i]); continue; }
    if ((a === '--db' || a === '-d') && args[i + 1]) { out.db = path.resolve(args[++i]); continue; }
  }
  if (!out.db) {
    const appData = process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming');
    out.db = path.join(appData, 'OS e Contabil - Lav', 'osecontabil.db');
  }
  return out;
}

function ensureFile(p) { if (!fs.existsSync(p)) throw new Error(`Arquivo não encontrado: ${p}`); }

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.length > 0);
  if (!lines.length) return [];
  const detectDelim = (hdr) => {
    const semi = (hdr.match(/;/g) || []).length;
    const comma = (hdr.match(/,/g) || []).length;
    return comma >= semi ? ',' : ';';
  };
  const delim = detectDelim(lines[0]);
  const parseLine = (line) => {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
      else if (ch === delim && !inQ) { out.push(cur); cur = ''; }
      else { cur += ch; }
    }
    out.push(cur);
    return out.map(v => { const t = (v ?? '').trim(); return t === '' ? null : t.replace(/^"|"$/g, ''); });
  };
  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { if (h) row[h] = cols[idx]; });
    rows.push(row);
  }
  return rows;
}

function normalizePhone(p) {
  if (!p) return '';
  const digits = String(p).replace(/\D+/g, '');
  // Remover 55 inicial se parecer DDI e sobrar 10-11 dígitos
  if (digits.startsWith('55') && digits.length > 11) {
    return digits.slice(-11);
  }
  return digits;
}

function splitName(fullName) {
  const s = (fullName || '').trim();
  if (!s) return { first_name: '', last_name: '.' };
  const parts = s.split(/\s+/);
  const first = parts[0] || s;
  const last = parts.slice(1).join(' ') || '.';
  return { first_name: first, last_name: last };
}

function nowLocal() { return new Date().toISOString().replace('Z',''); }

function getField(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function main() {
  const parsed = parseArgs();
  let { from, db } = parsed;
  // Se o arquivo padrão não existir e o usuário não especificou --from, tentar 'clients.csv'
  const defaultClientes = path.join(process.cwd(), 'exports', 'clientes.csv');
  if (from === defaultClientes && !fs.existsSync(from)) {
    const alt = path.join(process.cwd(), 'exports', 'clients.csv');
    if (fs.existsSync(alt)) {
      from = alt;
    }
  }
  ensureFile(from);
  ensureFile(db);

  console.log(`[sync] Iniciando: from=${from} db=${db}`);
  const rows = parseCsv(from);
  const cli = new Database(db);
  const getPhones = cli.prepare("SELECT phone FROM clients WHERE phone IS NOT NULL AND TRIM(phone) != ''");
  const existing = new Set();
  for (const r of getPhones.iterate()) {
    existing.add(normalizePhone(r.phone));
  }
  // Verificar se a coluna 'name' existe para inserir também quando disponível
  let hasNameCol = false;
  try {
    const cols = cli.prepare('PRAGMA table_info(clients)').all();
    hasNameCol = cols.some(c => (c.name || '').toLowerCase() === 'name');
  } catch (_) { /* ignora */ }
  const insert = hasNameCol
    ? cli.prepare('INSERT INTO clients (first_name,last_name,phone,email,address,created_at,name) VALUES (?,?,?,?,?,?,?)')
    : cli.prepare('INSERT INTO clients (first_name,last_name,phone,email,address,created_at) VALUES (?,?,?,?,?,?)');
  let added = 0, skipped = 0;

  for (const row of rows) {
    const full = getField(row, ['name','nome']) || `${getField(row,['first_name'])} ${getField(row,['last_name'])}`.trim();
    const { first_name, last_name } = splitName(full);
    const phoneSrc = getField(row, ['phone','telefone','celular','telefone1','telefone2']);
    const email = getField(row, ['email','e-mail']);
    const address = getField(row, ['address','endereco','endereço']);
    const phoneNorm = normalizePhone(phoneSrc || '');
    if (!phoneNorm) { skipped++; continue; }
    if (existing.has(phoneNorm)) { skipped++; continue; }
    try {
      if (hasNameCol) {
        insert.run(first_name || '', last_name || '.', phoneSrc || '', email || '', address || '', nowLocal(), `${first_name || ''} ${last_name || '.'}`.trim());
      } else {
        insert.run(first_name || '', last_name || '.', phoneSrc || '', email || '', address || '', nowLocal());
      }
      existing.add(phoneNorm);
      added++;
    } catch (e) {
      // ignora erros por linha e segue
    }
  }

  console.log(`[sync] clientes adicionados: ${added}, ignorados: ${skipped}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e?.stack || e?.message || e); process.exit(1); }
}
