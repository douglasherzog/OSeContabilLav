'use strict';

/**
 * Handlers IPC — Serviços e Clientes
 *
 * Canais registrados:
 *   services:list, services:create, services:update, services:delete
 *   clients:list, clients:list_with_os, clients:create, clients:update,
 *   clients:delete, clients:get_os
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} ctx  — veja ARCHITECTURE.md para a lista completa de propriedades
 */

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  let d = digits;
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `+55${d}`;
  if (d.length === 10) return `+55${d}`;
  return `+${digits}`;
}

module.exports = function register(ipcMain, { run, all, get, insert, nowLocal }) {
  ipcMain.handle('services:list', (_, includeInactive) => {
    const sql = includeInactive
      ? 'SELECT * FROM services ORDER BY category ASC, name ASC'
      : 'SELECT * FROM services WHERE active=1 ORDER BY category ASC, name ASC';
    return all(sql);
  });
  ipcMain.handle('services:create', (_, d) => {
    const id = insert('INSERT INTO services (name,description,category,unit_price,unit,active,requires_entry,entry_pct,created_at) VALUES (?,?,?,?,?,1,?,?,?)', [d.name, d.description||null, d.category||'geral', d.unit_price||0, d.unit||'un', d.requires_entry?1:0, d.entry_pct||50, nowLocal()]);
    return get('SELECT * FROM services WHERE id=?', [id]);
  });
  ipcMain.handle('services:update', (_, {id,...d}) => {
    run('UPDATE services SET name=?,description=?,category=?,unit_price=?,unit=?,active=?,requires_entry=?,entry_pct=? WHERE id=?', [d.name, d.description||null, d.category||'geral', d.unit_price||0, d.unit||'un', d.active??1, d.requires_entry?1:0, d.entry_pct||50, id]);
    return get('SELECT * FROM services WHERE id=?', [id]);
  });
  ipcMain.handle('services:delete', (_, id) => {
    run('DELETE FROM services WHERE id=?', [id]);
    return {ok:true};
  });

  ipcMain.handle('clients:list', () => {
    return all("SELECT *, (first_name || ' ' || last_name) as name FROM clients ORDER BY first_name ASC, last_name ASC");
  });
  ipcMain.handle('clients:list_with_os', () => {
    return all(`SELECT DISTINCT c.id, (c.first_name || ' ' || c.last_name) as name, c.phone
      FROM clients c INNER JOIN service_orders so ON so.client_id = c.id
      ORDER BY c.first_name ASC, c.last_name ASC`);
  });
  ipcMain.handle('clients:create', (_, d) => {
    const phone = normalizePhone(d.phone);
    const id = insert('INSERT INTO clients (first_name,last_name,phone,email,address,created_at) VALUES (?,?,?,?,?,?)', [d.first_name, d.last_name, phone, d.email||null, d.address||null, nowLocal()]);
    return get("SELECT *, (first_name || ' ' || last_name) as name FROM clients WHERE id=?", [id]);
  });
  ipcMain.handle('clients:update', (_, {id,...d}) => {
    const phone = normalizePhone(d.phone);
    run('UPDATE clients SET first_name=?,last_name=?,phone=?,email=?,address=? WHERE id=?', [d.first_name, d.last_name, phone, d.email||null, d.address||null, id]);
    return get("SELECT *, (first_name || ' ' || last_name) as name FROM clients WHERE id=?", [id]);
  });
  ipcMain.handle('clients:delete', (_, id) => {
    run('DELETE FROM clients WHERE id=?', [id]);
    return {ok:true};
  });
  ipcMain.handle('clients:get_os', (_, client_id) => {
    return all('SELECT * FROM service_orders WHERE client_id=? ORDER BY created_at DESC', [client_id]);
  });
};
