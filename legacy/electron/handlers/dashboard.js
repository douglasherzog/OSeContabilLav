'use strict';

/**
 * Handlers IPC — Dashboard e contadores globais
 *
 * Canais registrados:
 *   dashboard:summary  — resumo completo com cache TTL de 30s
 *   dashboard:ready_count  — OS com status 'pronta'
 *   ap:overdue_count  — contas a pagar vencidas
 *
 * Retorno especial: esta função retorna `{ invalidate }` para que o main.js
 * possa substituir `ctx.invalidateDashboardCache` pelo método canônico deste
 * módulo, garantindo que todos os outros handlers invalidem o mesmo cache.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} ctx  — veja ARCHITECTURE.md para a lista completa de propriedades
 * @returns {{ invalidate: Function }}
 */

module.exports = function register(ipcMain, { all, get, today, monthStart }) {
  const __cache = { ts: 0, data: null };

  function invalidate() { __cache.ts = 0; __cache.data = null; }

  ipcMain.handle('dashboard:summary', () => {
    const nowTs = Date.now();
    if (__cache.data && nowTs - __cache.ts < 30000) return __cache.data;
    const todayStr = today();
    const monthStr = monthStart();
    const osAberta      = get("SELECT COUNT(*) as c FROM service_orders WHERE status NOT IN ('entregue')")?.c || 0;
    const osHoje        = get('SELECT COUNT(*) as c FROM service_orders WHERE DATE(created_at)=?', [todayStr])?.c || 0;
    const receitaMes    = get('SELECT COALESCE(SUM(amount),0) as s FROM cash_ledger WHERE amount>0 AND occurred_at>=?', [monthStr])?.s || 0;
    const saidaMes      = get('SELECT COALESCE(SUM(amount),0) as s FROM cash_ledger WHERE amount<0 AND occurred_at>=?', [monthStr])?.s || 0;
    const saldoMes      = receitaMes + saidaMes;
    const apVencidas    = get("SELECT COUNT(*) as c FROM accounts_payable WHERE status='pendente' AND due_date<?", [todayStr])?.c || 0;
    const apPendente    = get("SELECT COALESCE(SUM(amount),0) as s FROM accounts_payable WHERE status='pendente'")?.s || 0;
    const arPendente    = get("SELECT COALESCE(SUM(amount),0) as s FROM accounts_receivable WHERE status='pendente'")?.s || 0;
    const totalClientes = get('SELECT COUNT(*) as c FROM clients')?.c || 0;
    const osPorStatus   = all('SELECT status, COUNT(*) as c FROM service_orders GROUP BY status');
    const receitaSemana = get("SELECT COALESCE(SUM(amount),0) as s FROM cash_ledger WHERE amount>0 AND occurred_at>=date(?,'weekday 0','-6 days')", [todayStr])?.s || 0;
    const ultimasOS     = all("SELECT so.*, (c.first_name || ' ' || c.last_name) as client_name FROM service_orders so LEFT JOIN clients c ON c.id=so.client_id ORDER BY so.created_at DESC LIMIT 5");
    const osProntas     = all(`SELECT so.id, so.number, so.created_at, so.total,
      COALESCE(p.paid,0) as paid,
      (c.first_name || ' ' || c.last_name) as client_name, c.phone as client_phone
      FROM service_orders so
      LEFT JOIN clients c ON c.id=so.client_id
      LEFT JOIN (SELECT order_id, SUM(amount) as paid FROM os_payments GROUP BY order_id) p ON p.order_id=so.id
      WHERE so.status='pronta' ORDER BY so.created_at ASC`);
    const apVencendo7   = get("SELECT COUNT(*) as c FROM accounts_payable WHERE status='pendente' AND due_date>=? AND due_date<=date(?,'+7 days')", [todayStr, todayStr])?.c || 0;
    const payload = { osAberta, osHoje, receitaMes, saidaMes: Math.abs(saidaMes), saldoMes, apVencidas, apPendente, arPendente, totalClientes, osPorStatus, receitaSemana, ultimasOS, osProntas, apVencendo7 };
    __cache.ts = nowTs;
    __cache.data = payload;
    return payload;
  });

  ipcMain.handle('dashboard:ready_count', () => get("SELECT COUNT(*) as c FROM service_orders WHERE status='pronta'")?.c || 0);
  ipcMain.handle('ap:overdue_count', () => get("SELECT COUNT(*) as c FROM accounts_payable WHERE status='pendente' AND due_date<?", [today()])?.c || 0);

  return { invalidate };
};
