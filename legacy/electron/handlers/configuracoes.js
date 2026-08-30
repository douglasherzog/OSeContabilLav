'use strict';

/**
 * Handlers IPC — Configurações, Empresa, Banco de Dados e Importação
 *
 * Canais registrados:
 *   db:path, db:backup, db:cleanup_duplicates, db:repair, db:normalize_units
 *   import:csv
 *   company:get, company:update
 *   payment_methods:list, payment_methods:create, payment_methods:update, payment_methods:delete
 *   bank_accounts:list, bank_accounts:create, bank_accounts:update, bank_accounts:delete
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} ctx  — veja ARCHITECTURE.md para a lista completa de propriedades
 */

const fs = require('fs');

module.exports = function register(ipcMain, { run, all, get, insert, nowLocal, today, saveDb, getDbPath, dialog }) {
  // ── DB utilitários ──────────────────────────────────────────────────────────
  ipcMain.handle('db:path', () => getDbPath());
  ipcMain.handle('db:backup', async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: `osecontabil_backup_${today()}.db`,
      filters: [{ name: 'SQLite DB', extensions: ['db'] }],
    });
    if (result.canceled) return { ok: false };
    fs.copyFileSync(getDbPath(), result.filePath);
    return { ok: true, path: result.filePath };
  });
  ipcMain.handle('db:cleanup_duplicates', () => {
    run(`DELETE FROM accounts_payable WHERE id NOT IN (
      SELECT MIN(id) FROM accounts_payable GROUP BY description, amount, due_date, status
    )`);
    const apDeleted = get('SELECT changes() as c')?.c || 0;
    run(`DELETE FROM accounts_receivable WHERE id NOT IN (
      SELECT MIN(id) FROM accounts_receivable GROUP BY description, amount, due_date, status
    )`);
    const arDeleted = get('SELECT changes() as c')?.c || 0;
    saveDb();
    return { ok: true, apDeleted, arDeleted };
  });
  ipcMain.handle('db:repair', () => {
    try {
      run("UPDATE service_orders SET payment_status='em_aberto' WHERE payment_status IS NULL");
      run("UPDATE service_orders SET status='aberta' WHERE status IS NULL");
      run("UPDATE cash_ledger SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''");
      run("UPDATE accounts_payable SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''");
      run("UPDATE accounts_receivable SET method='dinheiro' WHERE method IS NULL OR TRIM(method)=''");
      saveDb();
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('db:normalize_units', () => {
    try {
      const svcs = all("SELECT id, name FROM services WHERE name LIKE 'Lavagem %' OR name LIKE 'lavagem %'");
      for (const s of svcs) {
        const stripped = s.name.replace(/^[Ll]avagem\s+/i, '');
        run('UPDATE services SET name=? WHERE id=?', [stripped.charAt(0).toUpperCase() + stripped.slice(1), s.id]);
      }
      saveDb();
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  // ── Importação CSV ──────────────────────────────────────────────────────────
  ipcMain.handle('import:csv', async (_, {table}) => {
    const result = await dialog.showOpenDialog({ filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile'] });
    if (result.canceled) return { ok: false, message: 'Cancelado' };
    try {
      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      const headers = lines[0].split(';').map(h => h.trim().replace(/^"|"$/g, ''));
      let count = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';').map(c => c.trim().replace(/^"|"$/g, '') || null);
        const row = {};
        headers.forEach((h, idx) => { row[h] = cols[idx]; });
        try {
          if (table === 'os') insert('INSERT OR IGNORE INTO service_orders (number,title,status,total,payment_status,note,created_at) VALUES (?,?,?,?,?,?,?)',
            [row.number, row.title, row.status||'aberta', row.total||0, row.payment_status||'em_aberto', row.note, row.created_at]);
          else if (table === 'caixa') insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type) VALUES (?,?,?,?,?,?,?)',
            [row.occurred_at, row.amount||0, row.method, row.account_label, row.category||'manual', row.description, row.source_type||'manual']);
          else if (table === 'ap') insert('INSERT OR IGNORE INTO accounts_payable (description,category,amount,due_date,status,note) VALUES (?,?,?,?,?,?)',
            [row.description, row.category||'geral', row.amount||0, row.due_date, row.status||'pendente', row.note]);
          else if (table === 'ar') insert('INSERT OR IGNORE INTO accounts_receivable (description,category,amount,due_date,status,note) VALUES (?,?,?,?,?,?)',
            [row.description, row.category||'geral', row.amount||0, row.due_date, row.status||'pendente', row.note]);
          else if (table === 'clientes') {
            const full = (row.name || '').trim();
            const parts = full.split(/\s+/);
            const firstName = row.first_name || parts[0] || full || '';
            const lastName = row.last_name || parts.slice(1).join(' ') || '.';
            try { run('ALTER TABLE clients ADD COLUMN name TEXT', []); } catch(_) {}
            insert('INSERT OR IGNORE INTO clients (first_name,last_name,phone,email,address,created_at) VALUES (?,?,?,?,?,?)',
              [firstName, lastName, row.phone||'', row.email||'', row.address||'', row.created_at||nowLocal()]);
            try {
              const lastId = get('SELECT last_insert_rowid() as id')?.id;
              if (lastId) run('UPDATE clients SET name=? WHERE id=?', [full || (`${firstName} ${lastName}`.trim()), lastId]);
            } catch(_) {}
          } else if (table === 'servicos') {
            insert('INSERT OR IGNORE INTO services (name,description,category,unit_price,unit,active,created_at) VALUES (?,?,?,?,?,?,?)',
              [row.name, row.description||'', row.category||'geral', parseFloat(row.unit_price||row.price||0)||0,
                row.unit||'un', (row.active==null?1:(String(row.active).toLowerCase()==='true'||String(row.active)==='1'?1:0)), row.created_at||nowLocal()]);
          }
          count++;
        } catch(e) {}
      }
      return { ok: true, count };
    } catch(e) { return { ok: false, message: String(e) }; }
  });

  // ── Empresa ─────────────────────────────────────────────────────────────────
  ipcMain.handle('company:get', () => {
    const rows = all('SELECT key, value FROM company_settings');
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });
  ipcMain.handle('company:update', (_, data) => {
    for (const [key, value] of Object.entries(data)) {
      run('INSERT INTO company_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value ?? '']);
    }
    return { ok: true };
  });

  // ── Métodos de Pagamento ────────────────────────────────────────────────────
  ipcMain.handle('payment_methods:list', () => all('SELECT name, active FROM payment_methods ORDER BY name ASC'));
  ipcMain.handle('payment_methods:create', (_, {name, active}) => {
    if (!name) return { ok: false, error: 'Nome inválido' };
    try { insert('INSERT OR IGNORE INTO payment_methods (name,active,created_at) VALUES (?,?,?)', [String(name).trim().toLowerCase(), active?1:0, nowLocal()]); } catch(_) {}
    return { ok: true };
  });
  ipcMain.handle('payment_methods:update', (_, {name, active}) => {
    if (!name) return { ok: false, error: 'Nome inválido' };
    run('UPDATE payment_methods SET active=? WHERE name=?', [active?1:0, String(name).trim().toLowerCase()]);
    return { ok: true };
  });
  ipcMain.handle('payment_methods:delete', (_, {name}) => {
    if (!name) return { ok: false, error: 'Nome inválido' };
    run('UPDATE payment_methods SET active=0 WHERE name=?', [String(name).trim().toLowerCase()]);
    return { ok: true };
  });

  // ── Contas Bancárias ────────────────────────────────────────────────────────
  ipcMain.handle('bank_accounts:list', () => all('SELECT * FROM bank_accounts WHERE active=1 ORDER BY label ASC'));
  ipcMain.handle('bank_accounts:create', (_, d) => {
    if (!d?.label) return { ok: false, error: 'Label inválido' };
    const id = insert('INSERT INTO bank_accounts (label,bank_name,agency,account_number,active,created_at) VALUES (?,?,?,?,?,?)',
      [d.label, d.bank_name||null, d.agency||null, d.account_number||null, 1, nowLocal()]);
    return get('SELECT * FROM bank_accounts WHERE id=?', [id]);
  });
  ipcMain.handle('bank_accounts:update', (_, {id, ...d}) => {
    run('UPDATE bank_accounts SET label=?,bank_name=?,agency=?,account_number=?,active=? WHERE id=?',
      [d.label, d.bank_name||null, d.agency||null, d.account_number||null, d.active?1:0, id]);
    return get('SELECT * FROM bank_accounts WHERE id=?', [id]);
  });
  ipcMain.handle('bank_accounts:delete', (_, id) => {
    run('UPDATE bank_accounts SET active=0 WHERE id=?', [id]);
    return { ok: true };
  });
};
