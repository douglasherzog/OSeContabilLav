'use strict';

/**
 * Handlers IPC — Caixa, Contas a Pagar e Contas a Receber
 *
 * Canais registrados:
 *   caixa:list, caixa:create, caixa:update, caixa:delete
 *   caixa:categories:list, caixa:categories:create, caixa:categories:delete
 *   ap:list, ap:create, ap:update, ap:delete
 *   ap:categories:list, ap:categories:create, ap:categories:delete
 *   ar:list, ar:create, ar:update, ar:delete
 *   ar:recurrence:get, ar:recurrence:update
 *   ar:categories:list, ar:categories:create, ar:categories:delete
 *
 * Helpers locais: addDays, addMonths, addInterval, ensureApRecurrences,
 *   ensureArRecurrences (cópias autossuficientes — não exportadas).
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} ctx  — veja ARCHITECTURE.md para a lista completa de propriedades
 */

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}
function addInterval(dateStr, intervalValue, intervalUnit) {
  const val = Math.max(1, parseInt(intervalValue || 1, 10));
  const unit = (intervalUnit || 'month').toLowerCase();
  if (unit === 'week') return addDays(dateStr, val * 7);
  if (unit === 'day') return addDays(dateStr, val);
  return addMonths(dateStr, val);
}

module.exports = function register(ipcMain, { run, all, get, insert, nowLocal, today, saveDb, normalizeMethod, defaultAccountFor, invalidateDashboardCache }) {
  const RESERVED_CATS = ['os_pagamento', 'ap_pagamento', 'ar_recebimento', 'manual'];

  function ensureApRecurrences(maxDate) {
    const todayStr = today();
    const limit = maxDate || addMonths(todayStr, 2);
    const recs = all('SELECT * FROM accounts_payable_recurrences WHERE active=1 AND next_due_date<=? ORDER BY next_due_date ASC', [limit]);
    for (const r of recs) {
      let nextDue = r.next_due_date;
      const maxCount = r.recurrence_type === 'installments' ? (r.installments_count || 0) : 0;
      let createdCount = maxCount > 0 ? (get('SELECT COUNT(1) as c FROM accounts_payable WHERE recurrence_id=?', [r.id])?.c || 0) : 0;
      const loopLimit = (r.recurrence_type === 'installments' && r.end_date && r.end_date > limit) ? r.end_date : limit;
      while (nextDue && nextDue <= loopLimit) {
        if (maxCount > 0 && createdCount >= maxCount) { run('UPDATE accounts_payable_recurrences SET active=0 WHERE id=?', [r.id]); break; }
        if (r.end_date && nextDue > r.end_date) { run('UPDATE accounts_payable_recurrences SET active=0 WHERE id=?', [r.id]); break; }
        const exists = get('SELECT id FROM accounts_payable WHERE recurrence_id=? AND due_date=? LIMIT 1', [r.id, nextDue]);
        if (!exists) {
          insert('INSERT INTO accounts_payable (description,category,amount,due_date,status,note,created_at,recurrence_id) VALUES (?,?,?,?,?,?,?,?)',
            [r.description, r.category || 'geral', r.amount || 0, nextDue, 'pendente', r.note || null, nowLocal(), r.id]);
          if (maxCount > 0) createdCount += 1;
        }
        nextDue = addInterval(nextDue, r.interval_value, r.interval_unit);
        run('UPDATE accounts_payable_recurrences SET next_due_date=? WHERE id=?', [nextDue, r.id]);
      }
    }
  }

  function ensureArRecurrences(maxDate) {
    const todayStr = today();
    const limit = maxDate || addMonths(todayStr, 2);
    const recs = all('SELECT * FROM accounts_receivable_recurrences WHERE active=1 AND next_due_date<=? ORDER BY next_due_date ASC', [limit]);
    for (const r of recs) {
      let nextDue = r.next_due_date;
      const maxCount = r.recurrence_type === 'installments' ? (r.installments_count || 0) : 0;
      let createdCount = maxCount > 0 ? (get('SELECT COUNT(1) as c FROM accounts_receivable WHERE recurrence_id=?', [r.id])?.c || 0) : 0;
      const loopLimit = (r.recurrence_type === 'installments' && r.end_date && r.end_date > limit) ? r.end_date : limit;
      while (nextDue && nextDue <= loopLimit) {
        if (maxCount > 0 && createdCount >= maxCount) { run('UPDATE accounts_receivable_recurrences SET active=0 WHERE id=?', [r.id]); break; }
        if (r.end_date && nextDue > r.end_date) { run('UPDATE accounts_receivable_recurrences SET active=0 WHERE id=?', [r.id]); break; }
        const exists = get('SELECT id FROM accounts_receivable WHERE recurrence_id=? AND due_date=? LIMIT 1', [r.id, nextDue]);
        if (!exists) {
          insert('INSERT INTO accounts_receivable (description,category,amount,due_date,status,note,created_at,recurrence_id) VALUES (?,?,?,?,?,?,?,?)',
            [r.description, r.category || 'geral', r.amount || 0, nextDue, 'pendente', r.note || null, nowLocal(), r.id]);
          if (maxCount > 0) createdCount += 1;
        }
        nextDue = addInterval(nextDue, r.interval_value, r.interval_unit);
        run('UPDATE accounts_receivable_recurrences SET next_due_date=? WHERE id=?', [nextDue, r.id]);
      }
    }
  }

  // ── Caixa ──────────────────────────────────────────────────────────────────
  ipcMain.handle('caixa:list', (_, f={}) => {
    let sql = 'SELECT * FROM cash_ledger WHERE 1=1'; const p = [];
    if (f.date_from) { sql += ' AND occurred_at>=?'; p.push(f.date_from); }
    if (f.date_to)   { sql += ' AND occurred_at<=?'; p.push(f.date_to + ' 23:59:59'); }
    if (f.category)  { sql += ' AND category=?'; p.push(f.category); }
    sql += ' ORDER BY occurred_at DESC,id DESC';
    return all(sql, p);
  });
  ipcMain.handle('caixa:categories:list', () => all('SELECT name FROM cash_categories ORDER BY name ASC').map(r => r.name));
  ipcMain.handle('caixa:categories:create', (_, name) => {
    if (!name || RESERVED_CATS.includes(name)) return { ok: false, error: 'Nome reservado ou inválido' };
    try { insert('INSERT OR IGNORE INTO cash_categories (name,created_at) VALUES (?,?)', [name.trim().toLowerCase().replace(/\s+/g, '_'), nowLocal()]); } catch(_) {}
    return { ok: true };
  });
  ipcMain.handle('caixa:categories:delete', (_, name) => {
    run('DELETE FROM cash_categories WHERE name=?', [name]);
    return { ok: true };
  });
  ipcMain.handle('caixa:create', (_, d) => {
    const m = normalizeMethod(d.method);
    const acc = defaultAccountFor(m, d.account_label || null);
    if (m !== 'dinheiro' && !String(acc).trim()) return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
    const id = insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type) VALUES (?,?,?,?,?,?,?)',
      [d.occurred_at, d.amount, m, acc, d.category || 'manual', d.description || null, 'manual']);
    invalidateDashboardCache();
    return get('SELECT * FROM cash_ledger WHERE id=?', [id]);
  });
  ipcMain.handle('caixa:update', (_, {id,...d}) => {
    const m = normalizeMethod(d.method);
    const acc = defaultAccountFor(m, d.account_label || null);
    if (m !== 'dinheiro' && !String(acc).trim()) return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
    run('UPDATE cash_ledger SET occurred_at=?,amount=?,method=?,account_label=?,category=?,description=? WHERE id=?',
      [d.occurred_at, d.amount, m, acc, d.category, d.description || null, id]);
    invalidateDashboardCache();
    return get('SELECT * FROM cash_ledger WHERE id=?', [id]);
  });
  ipcMain.handle('caixa:delete', (_, id) => {
    run('DELETE FROM cash_ledger WHERE id=?', [id]);
    invalidateDashboardCache();
    return { ok: true };
  });

  // ── Categorias AP / AR ─────────────────────────────────────────────────────
  ipcMain.handle('ap:categories:list', () => all('SELECT name FROM ap_categories ORDER BY name ASC').map(r => r.name));
  ipcMain.handle('ap:categories:create', (_, name) => {
    if (!name) return { ok: false, error: 'Nome inválido' };
    try { insert('INSERT OR IGNORE INTO ap_categories (name,created_at) VALUES (?,?)', [name.trim().toLowerCase().replace(/\s+/g, '_'), nowLocal()]); } catch(_) {}
    return { ok: true };
  });
  ipcMain.handle('ap:categories:delete', (_, name) => { run('DELETE FROM ap_categories WHERE name=?', [name]); return { ok: true }; });

  ipcMain.handle('ar:categories:list', () => all('SELECT name FROM ar_categories ORDER BY name ASC').map(r => r.name));
  ipcMain.handle('ar:categories:create', (_, name) => {
    if (!name) return { ok: false, error: 'Nome inválido' };
    try { insert('INSERT OR IGNORE INTO ar_categories (name,created_at) VALUES (?,?)', [name.trim().toLowerCase().replace(/\s+/g, '_'), nowLocal()]); } catch(_) {}
    return { ok: true };
  });
  ipcMain.handle('ar:categories:delete', (_, name) => { run('DELETE FROM ar_categories WHERE name=?', [name]); return { ok: true }; });

  // ── Contas a Pagar ─────────────────────────────────────────────────────────
  ipcMain.handle('ap:list', (_, f={}) => {
    ensureApRecurrences(f?.date_to || null);
    let sql = 'SELECT * FROM accounts_payable WHERE 1=1'; const p = [];
    if (f.status)         { sql += ' AND status=?'; p.push(f.status); }
    if (f.recurrence === '1') { sql += ' AND recurrence_id IS NOT NULL'; }
    if (f.recurrence === '0') { sql += ' AND recurrence_id IS NULL'; }
    if (f.date_from)      { sql += ' AND due_date>=?'; p.push(f.date_from); }
    if (f.date_to)        { sql += ' AND due_date<=?'; p.push(f.date_to); }
    sql += ' ORDER BY due_date ASC,id DESC';
    return all(sql, p);
  });
  ipcMain.handle('ap:create', (_, d) => {
    if (Array.isArray(d.installments_custom) && d.installments_custom.length > 0) {
      const created = [];
      for (const inst of d.installments_custom) {
        const id = insert('INSERT INTO accounts_payable (description,category,amount,due_date,note) VALUES (?,?,?,?,?)',
          [d.description, d.category || 'geral', inst.amount || 0, inst.due_date || null, inst.note || d.note || null]);
        created.push(id);
      }
      return { ok: true, created };
    }
    if (d.recurrence && d.recurrence.start_date) {
      const startDate = d.recurrence.start_date;
      const recType = d.recurrence.recurrence_type || (d.recurrence.installments_count ? 'installments' : 'variable');
      const instCount = d.recurrence.installments_count || null;
      const recId = insert(
        'INSERT INTO accounts_payable_recurrences (description,category,amount,note,start_date,interval_value,interval_unit,end_date,next_due_date,recurrence_type,installments_count,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [d.description, d.category || 'geral', d.amount || 0, d.note || null, startDate, d.recurrence.interval_value || 1, d.recurrence.interval_unit || 'month', d.recurrence.end_date || null, startDate, recType, instCount, 1, nowLocal()]
      );
      const ensureUntil = (recType === 'installments' && d.recurrence.end_date) ? d.recurrence.end_date : startDate;
      ensureApRecurrences(ensureUntil);
      return get('SELECT * FROM accounts_payable WHERE recurrence_id=? AND due_date=? LIMIT 1', [recId, startDate]);
    }
    const id = insert('INSERT INTO accounts_payable (description,category,amount,due_date,note) VALUES (?,?,?,?,?)',
      [d.description, d.category || 'geral', d.amount, d.due_date || null, d.note || null]);
    return get('SELECT * FROM accounts_payable WHERE id=?', [id]);
  });
  ipcMain.handle('ap:update', (_, {id,...d}) => {
    const old = get('SELECT * FROM accounts_payable WHERE id=?', [id]);
    if (d.status === 'paga' && old?.status !== 'paga') {
      let occurredAt = d.paid_at;
      const now = new Date();
      if (!occurredAt || occurredAt.length <= 10) {
        const datePart = occurredAt || nowLocal().slice(0, 10);
        occurredAt = `${datePart}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      } else if (!occurredAt.includes('T')) {
        const [dp, tp] = occurredAt.split(' ');
        const [day, month, year] = dp.split('/');
        const [hh, mm] = tp.split(':');
        occurredAt = `${year}-${month}-${day}T${hh}:${mm}`;
      }
      const m = normalizeMethod(d.method);
      const acc = defaultAccountFor(m, d.account_label || '');
      if (m !== 'dinheiro' && !String(acc).trim()) return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
      const cashId = insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [occurredAt, -(d.amount || 0), m, acc, d.category || 'contas', `Conta: ${d.description}`, 'ap', id, nowLocal()]);
      run("UPDATE accounts_payable SET source_type='ap', source_id=? WHERE id=?", [cashId, id]);
      saveDb();
    } else if (d.status === 'pendente' && old?.status === 'paga') {
      if (old?.source_id) run('DELETE FROM cash_ledger WHERE id=?', [old.source_id]);
      run("UPDATE accounts_payable SET source_type='ap', source_id=NULL WHERE id=?", [id]);
      saveDb();
    }
    const updMethod = d.method != null ? normalizeMethod(d.method) : (old?.method || null);
    const updAccount = defaultAccountFor(updMethod || 'dinheiro', d.account_label != null ? d.account_label : (old?.account_label || ''));
    run('UPDATE accounts_payable SET description=?,category=?,amount=?,due_date=?,note=?,status=?,paid_at=?,method=?,account_label=? WHERE id=?',
      [d.description, d.category, d.amount, d.due_date || null, d.note || null, d.status, d.paid_at || null, updMethod, updAccount, id]);
    saveDb();
    return get('SELECT * FROM accounts_payable WHERE id=?', [id]);
  });
  ipcMain.handle('ap:delete', (_, id) => { run('DELETE FROM accounts_payable WHERE id=?', [id]); return { ok: true }; });

  // ── Contas a Receber ───────────────────────────────────────────────────────
  ipcMain.handle('ar:list', (_, f={}) => {
    ensureArRecurrences(f?.date_to || null);
    let sql = 'SELECT * FROM accounts_receivable WHERE 1=1'; const p = [];
    if (f.status)         { sql += ' AND status=?'; p.push(f.status); }
    if (f.recurrence === '1') { sql += ' AND recurrence_id IS NOT NULL'; }
    if (f.recurrence === '0') { sql += ' AND recurrence_id IS NULL'; }
    if (f.date_from)      { sql += ' AND due_date>=?'; p.push(f.date_from); }
    if (f.date_to)        { sql += ' AND due_date<=?'; p.push(f.date_to); }
    sql += ' ORDER BY due_date ASC,id DESC';
    return all(sql, p);
  });
  ipcMain.handle('ar:recurrence:get', (_, id) => get('SELECT * FROM accounts_receivable_recurrences WHERE id=?', [id]));
  ipcMain.handle('ar:recurrence:update', (_, d) => {
    const rec = get('SELECT * FROM accounts_receivable_recurrences WHERE id=?', [d.id]);
    if (!rec) return { error: 'Recorrência não encontrada' };
    run('UPDATE accounts_receivable_recurrences SET description=?,category=?,amount=?,note=?,interval_value=?,interval_unit=?,end_date=?,recurrence_type=?,installments_count=? WHERE id=?',
      [d.description, d.category || 'geral', d.amount || 0, d.note || null, d.interval_value || 1, d.interval_unit || 'month', d.end_date || null, d.recurrence_type || 'variable', d.installments_count || null, d.id]);
    run("UPDATE accounts_receivable SET description=?,category=?,amount=?,note=? WHERE recurrence_id=? AND status='pendente' AND (due_date IS NULL OR due_date>=?)",
      [d.description, d.category || 'geral', d.amount || 0, d.note || null, d.id, today()]);
    return { ok: true };
  });
  ipcMain.handle('ar:create', (_, d) => {
    if (Array.isArray(d.installments_custom) && d.installments_custom.length > 0) {
      const created = [];
      for (const inst of d.installments_custom) {
        const id = insert('INSERT INTO accounts_receivable (description,category,amount,due_date,note) VALUES (?,?,?,?,?)',
          [d.description, d.category || 'geral', inst.amount || 0, inst.due_date || null, inst.note || d.note || null]);
        created.push(id);
      }
      return { ok: true, created };
    }
    if (d.recurrence && d.recurrence.start_date) {
      const startDate = d.recurrence.start_date;
      const recType = d.recurrence.recurrence_type || (d.recurrence.installments_count ? 'installments' : 'variable');
      const instCount = d.recurrence.installments_count || null;
      const recId = insert(
        'INSERT INTO accounts_receivable_recurrences (description,category,amount,note,start_date,interval_value,interval_unit,end_date,next_due_date,recurrence_type,installments_count,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [d.description, d.category || 'geral', d.amount || 0, d.note || null, startDate, d.recurrence.interval_value || 1, d.recurrence.interval_unit || 'month', d.recurrence.end_date || null, startDate, recType, instCount, 1, nowLocal()]
      );
      const ensureUntil = (recType === 'installments' && d.recurrence.end_date) ? d.recurrence.end_date : startDate;
      ensureArRecurrences(ensureUntil);
      return get('SELECT * FROM accounts_receivable WHERE recurrence_id=? AND due_date=? LIMIT 1', [recId, startDate]);
    }
    const id = insert('INSERT INTO accounts_receivable (description,category,amount,due_date,note) VALUES (?,?,?,?,?)',
      [d.description, d.category || 'geral', d.amount, d.due_date || null, d.note || null]);
    return get('SELECT * FROM accounts_receivable WHERE id=?', [id]);
  });
  ipcMain.handle('ar:update', (_, {id,...d}) => {
    const old = get('SELECT * FROM accounts_receivable WHERE id=?', [id]);
    if (d.status === 'recebida' && old?.status !== 'recebida') {
      let occurredAt = d.received_at;
      const now = new Date();
      if (!occurredAt || occurredAt.length <= 10) {
        const datePart = occurredAt || nowLocal().slice(0, 10);
        occurredAt = `${datePart}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      } else if (!occurredAt.includes('T')) {
        const [dp, tp] = occurredAt.split(' ');
        const [day, month, year] = dp.split('/');
        const [hh, mm] = tp.split(':');
        occurredAt = `${year}-${month}-${day}T${hh}:${mm}`;
      }
      const m = normalizeMethod(d.method);
      const acc = defaultAccountFor(m, d.account_label || '');
      if (m !== 'dinheiro' && !String(acc).trim()) return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
      const cashId = insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [occurredAt, d.amount || 0, m, acc, d.category || 'contas', `Recebimento: ${d.description}`, 'ar', id, nowLocal()]);
      run("UPDATE accounts_receivable SET source_type='ar', source_id=? WHERE id=?", [cashId, id]);
      saveDb();
    } else if (d.status === 'pendente' && old?.status === 'recebida') {
      if (old?.source_id) run('DELETE FROM cash_ledger WHERE id=?', [old.source_id]);
      run("UPDATE accounts_receivable SET source_type='ar', source_id=NULL WHERE id=?", [id]);
      saveDb();
    }
    const updMethod = d.method != null ? normalizeMethod(d.method) : (old?.method || null);
    const updAccount = defaultAccountFor(updMethod || 'dinheiro', d.account_label != null ? d.account_label : (old?.account_label || ''));
    run('UPDATE accounts_receivable SET description=?,category=?,amount=?,due_date=?,note=?,status=?,received_at=?,method=?,account_label=? WHERE id=?',
      [d.description, d.category, d.amount, d.due_date || null, d.note || null, d.status, d.received_at || null, updMethod, updAccount, id]);
    saveDb();
    return get('SELECT * FROM accounts_receivable WHERE id=?', [id]);
  });
  ipcMain.handle('ar:delete', (_, id) => { run('DELETE FROM accounts_receivable WHERE id=?', [id]); return { ok: true }; });
};
