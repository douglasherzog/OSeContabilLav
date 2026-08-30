'use strict';

/**
 * Handlers IPC — Ordens de Serviço
 *
 * Canais registrados:
 *   os:list_assigned, os:list, os:get, os:create, os:update, os:delete
 *   os:add_payment, os:update_payment, os:delete_payment
 *   os:add_item, os:delete_item
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} ctx  — veja ARCHITECTURE.md para a lista completa de propriedades
 */

module.exports = function register(ipcMain, { run, all, get, insert, nowLocal, normalizeMethod, defaultAccountFor }) {
  ipcMain.handle('os:list_assigned', () => {
    return all("SELECT DISTINCT assigned_to as name FROM service_orders WHERE assigned_to IS NOT NULL AND assigned_to != '' ORDER BY assigned_to ASC");
  });
  ipcMain.handle('os:list', (_, f={}) => {
    let sql = `SELECT so.*,
      (c.first_name || ' ' || c.last_name) as client_name,
      COALESCE(p.paid,0) as paid,
      so.total - COALESCE(p.paid,0) as remaining
      FROM service_orders so
      LEFT JOIN clients c ON c.id=so.client_id
      LEFT JOIN (SELECT order_id, SUM(amount) as paid FROM os_payments GROUP BY order_id) p ON p.order_id=so.id
      WHERE 1=1`;
    const p = [];
    if(f.statuses && f.statuses.length>0){sql+=` AND so.status IN (${f.statuses.map(()=>'?').join(',')})`;p.push(...f.statuses);}
    else if(f.status){sql+=' AND so.status=?';p.push(f.status);}
    if(f.date_from){sql+=' AND (so.created_at IS NULL OR so.created_at>=?)';p.push(f.date_from);}
    if(f.date_to){sql+=' AND (so.created_at IS NULL OR so.created_at<=?)';p.push(f.date_to+' 23:59:59');}
    if(f.q){const l='%'+f.q+'%';sql+=" AND ((c.first_name || ' ' || c.last_name) LIKE ? OR CAST(so.number AS TEXT) LIKE ? OR so.note LIKE ?)";p.push(l,l,l);}
    if(f.client){const l='%'+f.client+'%';sql+=" AND (c.first_name || ' ' || c.last_name) LIKE ?";p.push(l);}
    if(f.total_min!=null&&f.total_min!==''){sql+=' AND so.total>=?';p.push(parseFloat(f.total_min));}
    if(f.total_max!=null&&f.total_max!==''){sql+=' AND so.total<=?';p.push(parseFloat(f.total_max));}
    if(f.remaining_only){sql+=' AND (so.total - COALESCE(p.paid,0)) > 0.01';}
    if(f.assigned_to){const l='%'+f.assigned_to+'%';sql+=' AND so.assigned_to LIKE ?';p.push(l);}
    sql+=' ORDER BY so.created_at DESC, so.id DESC';
    return all(sql,p);
  });
  ipcMain.handle('os:get', (_, id) => {
    const o = get("SELECT so.*, (c.first_name || ' ' || c.last_name) as client_name, c.phone as client_phone FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id WHERE so.id=?", [id]);
    if(!o) return null;
    o.items = all('SELECT * FROM os_items WHERE order_id=?', [id]);
    o.payments = all('SELECT * FROM os_payments WHERE order_id=? ORDER BY created_at ASC', [id]);
    return o;
  });
  ipcMain.handle('os:create', (_, d) => {
    const mx = get('SELECT MAX(number) as m FROM service_orders');
    const num = (mx?.m||0)+1;
    const n = nowLocal();
    const id = insert('INSERT INTO service_orders (number,client_id,status,total,note,assigned_to,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [num,d.client_id||null,d.status||'aberta',d.total||0,d.note||null,d.assigned_to||null,n,n]);
    return get('SELECT * FROM service_orders WHERE id=?', [id]);
  });
  ipcMain.handle('os:update', (_, {id,...d}) => {
    run('UPDATE service_orders SET status=?,total=?,note=?,assigned_to=?,created_at=?,updated_at=? WHERE id=?', [d.status||'aberta',d.total||0,d.note||null,d.assigned_to||null,d.created_at||nowLocal(),nowLocal(),id]);
    return get('SELECT * FROM service_orders WHERE id=?', [id]);
  });
  ipcMain.handle('os:delete', (_, id) => {
    const payments = all('SELECT id FROM os_payments WHERE order_id=?', [id]);
    payments.forEach(p => run("DELETE FROM cash_ledger WHERE source_type='os' AND source_id=?", [p.id]));
    run('DELETE FROM os_payments WHERE order_id=?',[id]);
    run('DELETE FROM os_items WHERE order_id=?',[id]);
    run('DELETE FROM service_orders WHERE id=?',[id]);
    return {ok:true};
  });
  ipcMain.handle('os:add_payment', (_, d) => {
    const m = normalizeMethod(d.method);
    const acc = defaultAccountFor(m, d.account_label||'');
    if (m !== 'dinheiro' && !String(acc).trim()) { return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' }; }
    const payment_id = insert('INSERT INTO os_payments (order_id,amount,method,account_label,when_type,payment_date,note) VALUES (?,?,?,?,?,?,?)', [d.order_id,d.amount,m,acc,d.when_type||'retirada',d.payment_date||null,d.note||null]);
    const paid = get('SELECT COALESCE(SUM(amount),0) as s FROM os_payments WHERE order_id=?', [d.order_id])?.s||0;
    const o = get("SELECT so.*, (c.first_name || ' ' || c.last_name) as client_name FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id WHERE so.id=?", [d.order_id]);
    const rem = Math.max(0,(o?.total||0)-paid);
    run('UPDATE service_orders SET paid=?,payment_status=? WHERE id=?', [paid, rem<=0.01?'quitado':'em_aberto', d.order_id]);
    const desc = `OS #${o?.number||d.order_id} — ${o?.client_name||'cliente'}`;
    const occurredAt = (d.payment_date||nowLocal().slice(0,10)) + ' ' + nowLocal().slice(11,16);
    insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [occurredAt,d.amount,m,acc,'os_pagamento',desc,'os',payment_id,nowLocal()]);
    return {ok:true};
  });
  ipcMain.handle('os:update_payment', (_, d) => {
    const m = normalizeMethod(d.method);
    const acc = defaultAccountFor(m, d.account_label||'');
    if (m !== 'dinheiro' && !String(acc).trim()) { return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' }; }
    run('UPDATE os_payments SET amount=?,method=?,account_label=?,when_type=?,payment_date=?,note=? WHERE id=?', [d.amount,m,acc,d.when_type||'retirada',d.payment_date||null,d.note||null,d.payment_id]);
    const order_id = get('SELECT order_id FROM os_payments WHERE id=?', [d.payment_id])?.order_id;
    if (order_id) {
      const paid = get('SELECT COALESCE(SUM(amount),0) as s FROM os_payments WHERE order_id=?', [order_id])?.s||0;
      const o = get('SELECT total FROM service_orders WHERE id=?', [order_id]);
      const rem = Math.max(0,(o?.total||0)-paid);
      run('UPDATE service_orders SET paid=?,payment_status=? WHERE id=?', [paid, rem<=0.01?'quitado':'em_aberto', order_id]);
    }
    const occurredAt = (d.payment_date||nowLocal().slice(0,10)) + ' ' + nowLocal().slice(11,16);
    run("UPDATE cash_ledger SET occurred_at=?,amount=?,method=?,account_label=?,description=? WHERE source_type='os' AND source_id=?", [occurredAt,d.amount,m,acc,d.description||null,d.payment_id]);
    return {ok:true};
  });
  ipcMain.handle('os:add_item', (_, d) => {
    const tot = (d.quantity||1)*(d.unit_price||0);
    const svc = get('SELECT requires_entry,entry_pct FROM services WHERE name=? AND active=1 LIMIT 1', [d.description]);
    const reqEntry = d.requires_entry ?? svc?.requires_entry ?? 0;
    const entPct = d.entry_pct ?? svc?.entry_pct ?? 50;
    insert('INSERT INTO os_items (order_id,description,quantity,unit_price,total,requires_entry,entry_pct) VALUES (?,?,?,?,?,?,?)', [d.order_id,d.description,d.quantity||1,d.unit_price||0,tot,reqEntry?1:0,entPct]);
    const s = get('SELECT COALESCE(SUM(total),0) as s FROM os_items WHERE order_id=?', [d.order_id])?.s||0;
    run('UPDATE service_orders SET total=? WHERE id=?', [s,d.order_id]);
    return {ok:true};
  });
  ipcMain.handle('os:delete_item', (_, {item_id, order_id}) => {
    run('DELETE FROM os_items WHERE id=?', [item_id]);
    const s = get('SELECT COALESCE(SUM(total),0) as s FROM os_items WHERE order_id=?', [order_id])?.s||0;
    run('UPDATE service_orders SET total=? WHERE id=?', [s, order_id]);
    const paid = get('SELECT COALESCE(SUM(amount),0) as s FROM os_payments WHERE order_id=?', [order_id])?.s||0;
    const rem = Math.max(0, s - paid);
    run('UPDATE service_orders SET payment_status=? WHERE id=?', [rem<=0.01?'quitado':'em_aberto', order_id]);
    return {ok:true};
  });
  ipcMain.handle('os:delete_payment', (_, {payment_id, order_id}) => {
    run('DELETE FROM os_payments WHERE id=?', [payment_id]);
    run("DELETE FROM cash_ledger WHERE source_type='os' AND source_id=?", [payment_id]);
    const paid = get('SELECT COALESCE(SUM(amount),0) as s FROM os_payments WHERE order_id=?', [order_id])?.s||0;
    const o = get('SELECT total FROM service_orders WHERE id=?', [order_id]);
    const rem = Math.max(0, (o?.total||0) - paid);
    run('UPDATE service_orders SET paid=?,payment_status=? WHERE id=?', [paid, rem<=0.01?'quitado':'em_aberto', order_id]);
    return {ok:true};
  });
};
