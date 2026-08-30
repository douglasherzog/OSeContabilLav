const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const Database = require('better-sqlite3');

function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = {
    sshHost: process.env.HETZNER_HOST || '46.62.225.96',
    sshUser: process.env.HETZNER_USER || 'root',
    sshPort: Number(process.env.HETZNER_PORT || 22),
    sshPass: process.env.HETZNER_SSH_PASSWORD || '',
    sshKey: process.env.HETZNER_SSH_KEY || '',
    forceDb: process.env.PG_DB || '',
    forceSchema: process.env.PG_SCHEMA || 'public',
    forceTable: process.env.PG_TABLE || '',
    localDb: '',
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--ssh-host' && args[i+1]) { cfg.sshHost = args[++i]; continue; }
    if (a === '--ssh-user' && args[i+1]) { cfg.sshUser = args[++i]; continue; }
    if (a === '--ssh-port' && args[i+1]) { cfg.sshPort = Number(args[++i]); continue; }
    if ((a === '--ssh-pass' || a === '--ssh-password') && args[i+1]) { cfg.sshPass = args[++i]; continue; }
    if (a === '--ssh-key' && args[i+1]) { cfg.sshKey = args[++i]; continue; }
    if (a === '--db' && args[i+1]) { cfg.forceDb = args[++i]; continue; }
    if (a === '--schema' && args[i+1]) { cfg.forceSchema = args[++i]; continue; }
    if (a === '--table' && args[i+1]) { cfg.forceTable = args[++i]; continue; }
    if ((a === '--local-db' || a === '--sqlite') && args[i+1]) { cfg.localDb = path.resolve(args[++i]); continue; }
  }
  if (!cfg.localDb) {
    const appData = process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming');
    cfg.localDb = path.join(appData, 'OS e Contabil - Lav', 'osecontabil.db');
  }
  return cfg;
}

function ensureFile(p) { if (!fs.existsSync(p)) throw new Error(`Arquivo não encontrado: ${p}`); }

function execRemote(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', (code) => {
        if (code === 0) resolve({ out, errOut, code });
        else reject(new Error(errOut || out || `Remote command failed with code ${code}`));
      }).on('data', (data) => { out += data.toString(); })
        .stderr.on('data', (data) => { errOut += data.toString(); });
    });
  });
}

async function connectSsh(cfg) {
  const conn = new Client();
  const connectCfg = { host: cfg.sshHost, port: cfg.sshPort, username: cfg.sshUser };
  if (cfg.sshKey) connectCfg.privateKey = fs.readFileSync(cfg.sshKey);
  else if (cfg.sshPass) connectCfg.password = cfg.sshPass;
  else throw new Error('Forneça --ssh-pass ou --ssh-key');
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject).connect(connectCfg);
  });
  return conn;
}

async function listDatabases(conn) {
  const cmd = "sudo -u postgres psql -t -A -c \"SELECT datname FROM pg_database WHERE datistemplate=false;\"";
  const res = await execRemote(conn, `bash -lc ${JSON.stringify(cmd)}`);
  return res.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

async function findPhoneTables(conn, db) {
  const q = [
    "SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE lower(column_name) IN ('phone','telefone','celular','telefone1','telefone2') ORDER BY table_schema, table_name;"
  ];
  const cmd = `sudo -u postgres psql -d ${db} -t -A -F '|' -c ${JSON.stringify(q[0])}`;
  const res = await execRemote(conn, `bash -lc ${JSON.stringify(cmd)}`);
  const lines = res.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const tables = new Map();
  for (const line of lines) {
    const [schema, table, col] = line.split('|');
    const key = `${schema}.${table}`;
    if (!tables.has(key)) tables.set(key, { schema, table, phoneCols: new Set(), cols: new Set() });
    tables.get(key).phoneCols.add(col);
  }
  // enrich with all columns to help mapping
  for (const key of tables.keys()) {
    const { schema, table } = tables.get(key);
    const cmdCols = `sudo -u postgres psql -d ${db} -t -A -F '|' -c ${JSON.stringify(`SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}'`)}`;
    const resCols = await execRemote(conn, `bash -lc ${JSON.stringify(cmdCols)}`);
    const linesCols = resCols.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const l of linesCols) {
      const [cname] = l.split('|');
      tables.get(key).cols.add(cname);
    }
  }
  return Array.from(tables.values());
}

function pickBestTable(candidates) {
  // prefer tables with name/nome and at least one phone col
  let best = null;
  for (const t of candidates) {
    const cols = t.cols;
    const hasName = cols.has('name') || cols.has('nome') || cols.has('first_name') || cols.has('last_name');
    const score = (hasName ? 10 : 0) + t.phoneCols.size;
    if (!best || score > best.score) best = { ...t, score };
  }
  return best;
}

function mapColumns(cols) {
  const get = (...names) => names.find(n => cols.has(n)) || null;
  return {
    name: get('name','nome'),
    first_name: get('first_name','primeiro_nome'),
    last_name: get('last_name','sobrenome'),
    phone: get('celular','telefone','phone','telefone1','telefone2'),
    email: get('email','e_mail','e-mail'),
    address: get('address','endereco','endereço'),
  };
}

async function fetchRows(conn, db, schema, table, mapping) {
  const parts = [];
  if (mapping.name) parts.push(`${mapping.name} AS name`);
  if (mapping.first_name) parts.push(`${mapping.first_name} AS first_name`);
  if (mapping.last_name) parts.push(`${mapping.last_name} AS last_name`);
  if (mapping.phone) parts.push(`${mapping.phone} AS phone`);
  if (mapping.email) parts.push(`${mapping.email} AS email`);
  if (mapping.address) parts.push(`${mapping.address} AS address`);
  if (!mapping.phone) throw new Error('Não foi encontrada coluna de telefone na tabela selecionada.');
  const select = `SELECT ${parts.join(', ')} FROM ${schema}.${table} WHERE ${mapping.phone} IS NOT NULL AND ${mapping.phone} <> ''`;
  const cmd = `sudo -u postgres psql -d ${db} -t -A -F '|' -c ${JSON.stringify(select)}`;
  const res = await execRemote(conn, `bash -lc ${JSON.stringify(cmd)}`);
  const lines = res.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const headers = parts.map(p => p.split(' AS ')[1]);
  const rows = lines.map(line => {
    const cols = line.split('|');
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = cols[i] ?? '';
    return obj;
  });
  return rows;
}

function normalizePhone(p) {
  if (!p) return '';
  const digits = String(p).replace(/\D+/g, '');
  if (digits.startsWith('55') && digits.length > 11) return digits.slice(-11);
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

function upsertIntoLocal(localDbPath, rows) {
  ensureFile(localDbPath);
  const cli = new Database(localDbPath);
  const getPhones = cli.prepare("SELECT phone FROM clients WHERE phone IS NOT NULL AND TRIM(phone) != ''");
  const existing = new Set();
  for (const r of getPhones.iterate()) existing.add(normalizePhone(r.phone));
  let hasNameCol = false;
  try { hasNameCol = cli.prepare('PRAGMA table_info(clients)').all().some(c => (c.name||'').toLowerCase()==='name'); } catch {}
  const insert = hasNameCol
    ? cli.prepare('INSERT INTO clients (first_name,last_name,phone,email,address,created_at,name) VALUES (?,?,?,?,?,?,?)')
    : cli.prepare('INSERT INTO clients (first_name,last_name,phone,email,address,created_at) VALUES (?,?,?,?,?,?)');

  let added = 0, skipped = 0;
  for (const r of rows) {
    const full = r.name || `${r.first_name || ''} ${r.last_name || ''}`.trim();
    const { first_name, last_name } = splitName(full);
    const phoneNorm = normalizePhone(r.phone || '');
    if (!phoneNorm) { skipped++; continue; }
    if (existing.has(phoneNorm)) { skipped++; continue; }
    try {
      if (hasNameCol) insert.run(first_name || '', last_name || '.', r.phone || '', r.email || '', r.address || '', nowLocal(), `${first_name || ''} ${last_name || '.'}`.trim());
      else insert.run(first_name || '', last_name || '.', r.phone || '', r.email || '', r.address || '', nowLocal());
      existing.add(phoneNorm);
      added++;
    } catch { /* continue */ }
  }
  return { added, skipped };
}

async function main() {
  const cfg = parseArgs();
  console.log('[sync-pg] Conectando ao servidor via SSH...');
  const conn = await connectSsh(cfg);

  // Helpers para executar dentro de docker como fallback
  async function dockerFindPgContainer() {
    const cmd = "docker ps --format '{{.ID}}|{{.Image}}|{{.Names}}'";
    const res = await execRemote(conn, `bash -lc ${JSON.stringify(cmd)}`);
    const lines = res.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const l of lines) {
      const parts = l.split('|');
      const image = (parts[1] || '').toLowerCase();
      if (image.includes('postgres')) return { id: parts[0], image, name: parts[2] };
    }
    return null;
  }

  async function dockerGetPgEnv(containerId) {
    const cmd = `docker inspect -f {{.Config.Env}} ${containerId}`;
    const res = await execRemote(conn, `bash -lc ${JSON.stringify(cmd)}`);
    const envLine = res.out.replace(/[\[\]]/g, '');
    const env = {};
    envLine.split(' ').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx > 0) env[pair.slice(0, idx)] = pair.slice(idx + 1);
    });
    return {
      user: env.POSTGRES_USER || 'postgres',
      db: env.POSTGRES_DB || 'postgres',
      password: env.POSTGRES_PASSWORD || env.POSTGRES_PASS || '',
    };
  }

  async function dockerPsql(containerId, sql, opts = {}) {
    const { user, db, password } = opts;
    const shSingleQuote = (s='') => `'${String(s).replace(/'/g, `'"'"'`)}'`;
    const safeSql = sql.replace(/"/g, '\\"');
    const cmd = `docker exec -i ${containerId} env PGPASSWORD=${shSingleQuote(password)} psql -U ${shSingleQuote(user)} -d ${shSingleQuote(db)} -t -A -F '|' -c "${safeSql}"`;
    const res = await execRemote(conn, `bash -lc ${JSON.stringify(cmd)}`);
    return res.out;
  }

  let useDocker = false;
  let db = cfg.forceDb;
  let schema = cfg.forceSchema || 'public';
  let table = cfg.forceTable;
  let mapping;
  let dockerInfo = null;

  async function tryNative() {
    if (!db) {
      console.log('[sync-pg] Descobrindo bases no Postgres (nativo)...');
      const dbs = await listDatabases(conn);
      if (!dbs.length) throw new Error('Nenhuma base encontrada no Postgres');
      db = dbs.find(d => /lav/i.test(d)) || dbs[0];
      console.log(`[sync-pg] Base escolhida: ${db}`);
    }
    if (!table) {
      console.log('[sync-pg] Procurando tabelas com colunas de telefone (nativo)...');
      const candidates = await findPhoneTables(conn, db);
      if (!candidates.length) throw new Error('Nenhuma tabela com telefone encontrada');
      const best = pickBestTable(candidates);
      schema = best.schema; table = best.table;
      mapping = mapColumns(best.cols);
      console.log(`[sync-pg] Tabela escolhida: ${schema}.${table}`);
    } else {
      const cmdCols = `sudo -u postgres psql -d ${db} -t -A -F '|' -c ${JSON.stringify(`SELECT column_name FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}'`)}`;
      const resCols = await execRemote(conn, `bash -lc ${JSON.stringify(cmdCols)}`);
      const cols = new Set(resCols.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
      mapping = mapColumns(cols);
    }
  }

  async function tryDocker() {
    useDocker = true;
    dockerInfo = await dockerFindPgContainer();
    if (!dockerInfo) throw new Error('Nenhum container postgres encontrado via docker');
    const env = await dockerGetPgEnv(dockerInfo.id);
    const user = env.user; let database = db || env.db; const password = env.password || '';
    if (!database) {
      // listar bases
      const out = await dockerPsql(dockerInfo.id, 'SELECT datname FROM pg_database WHERE datistemplate=false;', { user, db: env.db || 'postgres', password });
      const dbs = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!dbs.length) throw new Error('Nenhuma base encontrada (docker)');
      database = dbs.find(d => /lav/i.test(d)) || dbs[0];
    }
    db = database;
    if (!table) {
      const out = await dockerPsql(dockerInfo.id, "SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE lower(column_name) IN ('phone','telefone','celular','telefone1','telefone2') ORDER BY table_schema, table_name;", { user, db, password });
      const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const tables = new Map();
      for (const line of lines) {
        const [sc, tb, col] = line.split('|');
        const key = `${sc}.${tb}`;
        if (!tables.has(key)) tables.set(key, { schema: sc, table: tb, phoneCols: new Set(), cols: new Set() });
        tables.get(key).phoneCols.add(col);
      }
      for (const key of tables.keys()) {
        const { schema: sc, table: tb } = tables.get(key);
        const outCols = await dockerPsql(dockerInfo.id, `SELECT column_name FROM information_schema.columns WHERE table_schema='${sc}' AND table_name='${tb}'`, { user, db, password });
        const linesCols = outCols.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        for (const l of linesCols) tables.get(key).cols.add(l.split('|')[0] || l);
      }
      const best = pickBestTable(Array.from(tables.values()));
      schema = best.schema; table = best.table; mapping = mapColumns(best.cols);
      console.log(`[sync-pg] (docker) Tabela escolhida: ${schema}.${table}`);
    } else {
      const outCols = await dockerPsql(dockerInfo.id, `SELECT column_name FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}'`, { user, db, password });
      const cols = new Set(outCols.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => s.split('|')[0] || s));
      mapping = mapColumns(cols);
    }

    // Buscar linhas
    const parts = [];
    if (mapping.name) parts.push(`${mapping.name} AS name`);
    if (mapping.first_name) parts.push(`${mapping.first_name} AS first_name`);
    if (mapping.last_name) parts.push(`${mapping.last_name} AS last_name`);
    if (mapping.phone) parts.push(`${mapping.phone} AS phone`);
    if (mapping.email) parts.push(`${mapping.email} AS email`);
    if (mapping.address) parts.push(`${mapping.address} AS address`);
    if (!mapping.phone) throw new Error('Não foi encontrada coluna de telefone na tabela selecionada.');
    const select = `SELECT ${parts.join(', ')} FROM ${schema}.${table} WHERE ${mapping.phone} IS NOT NULL AND ${mapping.phone} <> ''`;
    const outRows = await dockerPsql(dockerInfo.id, select, { user, db, password });
    const lines = outRows.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const headers = parts.map(p => p.split(' AS ')[1]);
    const rows = lines.map(line => {
      const cols = line.split('|');
      const obj = {}; for (let i = 0; i < headers.length; i++) obj[headers[i]] = cols[i] ?? '';
      return obj;
    });
    return rows;
  }

  let rows = [];
  try {
    await tryNative();
    if (!mapping || !table) throw new Error('Falha no mapeamento nativo');
    console.log('[sync-pg] Buscando linhas no Postgres (nativo)...');
    rows = await fetchRows(conn, db, schema, table, mapping);
  } catch (e) {
    console.warn('[sync-pg] Caminho nativo falhou, tentando via Docker...', e?.message || e);
    rows = await tryDocker();
  }

  conn.end();
  console.log(`[sync-pg] Linhas obtidas: ${rows.length}`);

  console.log('[sync-pg] Inserindo clientes faltantes no SQLite local...');
  const { added, skipped } = upsertIntoLocal(cfg.localDb, rows);
  console.log(`[sync-pg] clientes adicionados: ${added}, ignorados: ${skipped}`);
}

if (require.main === module) {
  (async () => { try { await main(); } catch (e) { console.error(e?.stack || e?.message || e); process.exit(1); } })();
}
