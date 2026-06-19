'use strict';

/**
 * Handlers IPC — Funcionários, Folha de Pagamento, Férias e 13º Salário
 *
 * Canais registrados:
 *   employees:list, employees:create, employees:update, employees:delete
 *   employees:salary_history, employees:recalculate_advances
 *   salary_advances:list, salary_advances:create, salary_advances:delete, salary_advances:balance
 *   payroll:closing:preview, payroll:close
 *   vacation:balance, vacation:preview, vacation:register
 *   thirteenth:calculate, thirteenth:pay
 *   salary_pending:list, salary_pending:create, salary_pending:pay, salary_pending:delete
 *   debug:auto_close_month, debug:cleanup_salary_month, debug:reset_salary_state
 *
 * Helpers locais: getSalaryAtDate, getCurrentSalary, getEmployeeSalaryAtMonth,
 *   recalculateAdvanceReferenceMonths (cópias autossuficientes — não exportadas).
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {object} ctx  — veja ARCHITECTURE.md para a lista completa de propriedades
 */

module.exports = function register(ipcMain, {
  run, all, get, insert, nowLocal, today, saveDb,
  normalizeMethod, defaultAccountFor,
  getNextMonth, getPreviousMonth, getLastDayOfMonth,
  computeVacationAmounts, autoClosePreviousMonth,
}) {
  // ── Helpers locais ──────────────────────────────────────────────────────────
  function getSalaryAtDate(employeeId, dateStr) {
    const salary = get(`
      SELECT salary FROM employee_salaries
      WHERE employee_id=?
      AND start_date <= ?
      AND (end_date IS NULL OR end_date >= ?)
      ORDER BY start_date DESC
      LIMIT 1
    `, [employeeId, dateStr, dateStr]);
    if (salary?.salary) return salary.salary;
    const first = get('SELECT MIN(start_date) as min_start FROM employee_salaries WHERE employee_id=?', [employeeId]);
    if (first?.min_start && dateStr < first.min_start) return 0;
    const employee = get('SELECT base_salary FROM employees WHERE id=?', [employeeId]);
    return employee?.base_salary || 0;
  }

  function getCurrentSalary(employeeId) {
    const employee = get('SELECT base_salary FROM employees WHERE id=?', [employeeId]);
    return employee?.base_salary || 0;
  }

  function getEmployeeSalaryAtMonth(employeeId, month) {
    const lastDay = getLastDayOfMonth(month);
    const referenceDate = `${month}-${String(lastDay).padStart(2, '0')}`;
    return getSalaryAtDate(employeeId, referenceDate);
  }

  function recalculateAdvanceReferenceMonths(employeeId, month) {
    const currentSalary = getEmployeeSalaryAtMonth(employeeId, month);
    if (!currentSalary || currentSalary <= 0) return;
    const nextMonth = getNextMonth(month);
    const allAdvances = all(
      "SELECT * FROM salary_advances WHERE employee_id=? AND (reference_month=? OR strftime('%Y-%m', date)=?) AND (advance_type='regular' OR advance_type IS NULL) ORDER BY date ASC, id ASC",
      [employeeId, month, month]
    );
    let runningTotal = 0;
    let carryAmount = 0;
    for (const adv of allAdvances) {
      const amount = adv.amount || 0;
      if (runningTotal >= currentSalary) {
        if (adv.reference_month !== nextMonth) run('UPDATE salary_advances SET reference_month=? WHERE id=?', [nextMonth, adv.id]);
        continue;
      }
      if (runningTotal + amount <= currentSalary) {
        if (adv.reference_month !== month) run('UPDATE salary_advances SET reference_month=? WHERE id=?', [month, adv.id]);
        runningTotal += amount;
      } else {
        const amountWithin = Math.max(0, currentSalary - runningTotal);
        const extra = Math.max(0, amount - amountWithin);
        if (amountWithin > 0) {
          if (adv.reference_month !== month || Math.abs((adv.amount||0) - amountWithin) > 0.009) {
            run('UPDATE salary_advances SET reference_month=?, amount=? WHERE id=?', [month, amountWithin, adv.id]);
          }
          runningTotal = currentSalary;
        } else {
          if (adv.reference_month !== nextMonth) run('UPDATE salary_advances SET reference_month=? WHERE id=?', [nextMonth, adv.id]);
        }
        carryAmount += extra;
      }
    }
    const carryoverNote = `Ajuste: excesso de adiantamentos de ${month}`;
    const existingCarry = get(
      "SELECT id, amount FROM salary_advances WHERE employee_id=? AND reference_month=? AND advance_type='regular' AND note=?",
      [employeeId, nextMonth, carryoverNote]
    );
    const fillNeeded = Math.max(0, currentSalary - runningTotal);
    if (fillNeeded > 0.009 && existingCarry?.amount > 0.009) {
      const pull = Math.min(fillNeeded, existingCarry.amount || 0);
      if (pull > 0.009) {
        const recompositionNote = `Ajuste: recomposição de excesso de ${month}`;
        const existingRecomp = get(
          "SELECT id FROM salary_advances WHERE employee_id=? AND reference_month=? AND advance_type='regular' AND note=?",
          [employeeId, month, recompositionNote]
        );
        if (existingRecomp?.id) {
          run('UPDATE salary_advances SET amount=?, date=? WHERE id=?', [pull, today(), existingRecomp.id]);
        } else {
          insert('INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)',
            [employeeId, 'regular', pull, today(), recompositionNote, 0, month, nowLocal()]);
        }
        const remaining = (existingCarry.amount || 0) - pull;
        if (remaining > 0.009) {
          run('UPDATE salary_advances SET amount=?, date=? WHERE id=?', [remaining, today(), existingCarry.id]);
        } else {
          run('DELETE FROM salary_advances WHERE id=?', [existingCarry.id]);
        }
        runningTotal += pull;
      }
    }
    if (carryAmount > 0.009) {
      const todayStr2 = today();
      if (existingCarry?.id) {
        if (Math.abs((existingCarry.amount||0) - carryAmount) > 0.009) {
          run('UPDATE salary_advances SET amount=?, date=? WHERE id=?', [carryAmount, todayStr2, existingCarry.id]);
        }
      } else {
        insert('INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)',
          [employeeId, 'regular', carryAmount, todayStr2, carryoverNote, 0, nextMonth, nowLocal()]);
      }
    } else if (existingCarry?.id) {
      const stillHas = get('SELECT amount FROM salary_advances WHERE id=?', [existingCarry.id])?.amount || 0;
      if (stillHas <= 0.009) run('DELETE FROM salary_advances WHERE id=?', [existingCarry.id]);
    }
    saveDb();
  }

  // ── Funcionários ────────────────────────────────────────────────────────────
  ipcMain.handle('employees:list', () => {
    const employees = all('SELECT * FROM employees WHERE active=1 ORDER BY name ASC');
    return employees.map(emp => ({ ...emp, base_salary: getCurrentSalary(emp.id) }));
  });
  ipcMain.handle('employees:create', (_, d) => {
    const admission = d.admission_date ? String(d.admission_date).slice(0,10) : null;
    const vacStart = d.vacation_accrual_start ? String(d.vacation_accrual_start).slice(0,10) : null;
    const base = d.base_salary || 0;
    const id = insert('INSERT INTO employees (name,type,active,admission_date,vacation_accrual_start,base_salary,created_at) VALUES (?,?,?,?,?,?,?)',
      [d.name, d.type||'integral', 1, admission, vacStart, base, nowLocal()]);
    if (base > 0) {
      insert('INSERT INTO employee_salaries (employee_id,salary,start_date,created_at) VALUES (?,?,?,?)',
        [id, base, d.start_date || nowLocal().slice(0,10), nowLocal()]);
    }
    saveDb();
    const emp = get('SELECT * FROM employees WHERE id=?', [id]);
    return { ...emp, base_salary: getCurrentSalary(id) };
  });
  ipcMain.handle('employees:update', (_, {id,...d}) => {
    const currentEmp = get('SELECT * FROM employees WHERE id=?', [id]);
    if (!currentEmp) return { error: 'Funcionário não encontrado' };
    try {
      run('UPDATE employees SET name=?,type=?,active=?,base_salary=?,admission_date=?,vacation_accrual_start=? WHERE id=?',
        [d.name, d.type, d.active !== undefined ? d.active : currentEmp.active, d.base_salary !== undefined ? d.base_salary : currentEmp.base_salary, d.admission_date || currentEmp.admission_date, d.vacation_accrual_start || currentEmp.vacation_accrual_start, id]);
    } catch (e) {
      run('UPDATE employees SET name=?,type=?,active=?,base_salary=? WHERE id=?',
        [d.name, d.type, d.active !== undefined ? d.active : currentEmp.active, d.base_salary !== undefined ? d.base_salary : currentEmp.base_salary, id]);
    }
    if (d.base_salary !== undefined && d.start_date) {
      run('UPDATE employee_salaries SET end_date=? WHERE employee_id=? AND end_date IS NULL', [d.start_date, id]);
      insert('INSERT INTO employee_salaries (employee_id,salary,start_date,created_at) VALUES (?,?,?,?)',
        [id, d.base_salary, d.start_date, nowLocal()]);
      const month = d.start_date.slice(0, 7);
      if (month && month.length === 7) {
        recalculateAdvanceReferenceMonths(id, month);
        try { const nm = getNextMonth(month); if (nm) recalculateAdvanceReferenceMonths(id, nm); } catch(_) {}
      }
    }
    saveDb();
    const emp = get('SELECT * FROM employees WHERE id=?', [id]);
    return { ...emp, base_salary: getCurrentSalary(id) };
  });
  ipcMain.handle('employees:delete', (_, id) => {
    run('UPDATE employees SET active=0 WHERE id=?', [id]);
    saveDb();
    return { ok: true };
  });
  ipcMain.handle('employees:salary_history', (_, {employee_id}) => {
    const history = all('SELECT * FROM employee_salaries WHERE employee_id=? ORDER BY start_date DESC', [employee_id]);
    const currentEmp = get('SELECT base_salary FROM employees WHERE id=?', [employee_id]);
    if (currentEmp && currentEmp.base_salary) {
      const todayLocal = nowLocal().slice(0, 10);
      return [{ id: 0, employee_id, salary: currentEmp.base_salary, start_date: todayLocal, end_date: null, created_at: nowLocal(), is_current: true }, ...history];
    }
    return history;
  });
  ipcMain.handle('employees:recalculate_advances', (_, {employee_id, month}) => {
    if (!employee_id || !month) return { error: 'employee_id e month são obrigatórios' };
    recalculateAdvanceReferenceMonths(employee_id, month);
    return { ok: true };
  });

  // ── Adiantamentos ───────────────────────────────────────────────────────────
  ipcMain.handle('salary_advances:list', (_, {employee_id, month}) => {
    let sql = 'SELECT * FROM salary_advances WHERE 1=1';
    const params = [];
    if (employee_id) { sql += ' AND employee_id=?'; params.push(employee_id); }
    if (month) { sql += " AND (reference_month=? OR strftime('%Y-%m', date)=?)"; params.push(month, month); }
    sql += ' ORDER BY date DESC';
    return all(sql, params);
  });
  ipcMain.handle('salary_advances:create', (_, d) => {
    const todayStr = today();
    const currentMonth = todayStr.slice(0, 7);
    const selectedMonth = (d.date || todayStr).slice(0, 7);
    const nextMonth = getNextMonth(currentMonth);
    const effectiveDate = todayStr;
    let referenceMonth = selectedMonth;

    if (d.advance_type === 'regular' || !d.advance_type) {
      if (selectedMonth === currentMonth) {
        const pendingRow = get("SELECT SUM(amount - COALESCE(paid_amount,0)) AS remaining FROM salary_balance_pending WHERE employee_id=? AND reference_month=? AND status='pending'", [d.employee_id, currentMonth]);
        const remainingPending = pendingRow?.remaining || 0;
        if (remainingPending > 0.009) {
          return { error: `Existe saldo pendente de R$ ${remainingPending.toFixed(2)} do mês anterior. Quite esse saldo antes de lançar adiantamentos deste mês.` };
        }
      }
      const currentSalary = getEmployeeSalaryAtMonth(d.employee_id, currentMonth);
      const currentTotal = (all("SELECT COALESCE(SUM(amount), 0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR strftime('%Y-%m', date)=?) AND (advance_type='regular' OR advance_type IS NULL)", [d.employee_id, currentMonth, currentMonth])[0]?.total || 0);
      const isSalaryPaidCompletely = Math.abs(currentTotal - currentSalary) < 0.01;
      if (selectedMonth === currentMonth) {
        referenceMonth = currentMonth;
      } else if (selectedMonth === nextMonth) {
        if (!isSalaryPaidCompletely) return { error: `Só é permitido lançar adiantamentos para o próximo mês quando o salário de ${currentMonth} estiver exatamente completo.` };
        referenceMonth = nextMonth;
      } else {
        return { error: 'Só é permitido lançar adiantamentos no mês atual ou no próximo mês.' };
      }
      const refMonthTotal = (all("SELECT COALESCE(SUM(amount), 0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR strftime('%Y-%m', date)=?) AND (advance_type='regular' OR advance_type IS NULL)", [d.employee_id, referenceMonth, referenceMonth])[0]?.total || 0);
      const monthSalary = getEmployeeSalaryAtMonth(d.employee_id, referenceMonth);
      if (refMonthTotal + (d.amount || 0) > monthSalary) {
        const available = Math.max(0, monthSalary - refMonthTotal);
        return { error: `Valor excede o saldo disponível do mês ${referenceMonth}. Saldo restante: R$ ${available.toFixed(2)}` };
      }
    }

    const typeLabel = { regular: 'Adiantamento', ferias: 'Férias', decimo_primeira: 'Décimo 1ª', decimo_segunda: 'Décimo 2ª' };
    const desc = `${typeLabel[d.advance_type] || 'Adiantamento'}: ${d.employee_name}`;
    const m = normalizeMethod(d.method);
    const acc = defaultAccountFor(m, d.account_label || '');
    if (m !== 'dinheiro' && !String(acc).trim()) return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
    const cashId = insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [effectiveDate + 'T12:00:00', -(d.amount || 0), m, acc,
        d.advance_type === 'ferias' ? 'ferias' : d.advance_type?.startsWith('decimo') ? 'decimo_terceiro' : 'adiantamento_salario',
        desc, 'salary_advance', 0, nowLocal()]);
    const id = insert('INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [d.employee_id, d.advance_type || 'regular', d.amount, effectiveDate, d.note || null, cashId, referenceMonth, nowLocal()]);
    saveDb();
    return get('SELECT * FROM salary_advances WHERE id=?', [id]);
  });
  ipcMain.handle('salary_advances:delete', (_, id) => {
    const adv = get('SELECT * FROM salary_advances WHERE id=?', [id]);
    if (adv?.source_id) run('DELETE FROM cash_ledger WHERE id=?', [adv.source_id]);
    run('DELETE FROM salary_advances WHERE id=?', [id]);
    saveDb();
    return { ok: true };
  });
  ipcMain.handle('salary_advances:balance', (_, {employee_id, month}) => {
    const emp = get('SELECT * FROM employees WHERE id=?', [employee_id]);
    if (!emp) return { error: 'Funcionário não encontrado' };
    const [year, mon] = month.split('-');
    const lastDayOfMonth = new Date(parseInt(year), parseInt(mon), 0).getDate();
    const referenceDate = `${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
    const baseSalary = getSalaryAtDate(employee_id, referenceDate);
    const regularAdvances = get("SELECT SUM(amount) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND advance_type='regular'", [employee_id, month, month])?.total || 0;
    const vacationAdvances = get("SELECT SUM(amount) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND advance_type='ferias'", [employee_id, month, month])?.total || 0;
    const thirteenAdvances = get("SELECT SUM(amount) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND advance_type LIKE 'decimo%'", [employee_id, month, month])?.total || 0;
    const totalAdvances = regularAdvances + vacationAdvances + thirteenAdvances;
    return { employee: { ...emp, base_salary: baseSalary }, regular_advances: regularAdvances, vacation_advances: vacationAdvances, thirteen_advances: thirteenAdvances, total_advances: totalAdvances, balance: baseSalary - regularAdvances, month };
  });

  // ── Fechamento de Folha ─────────────────────────────────────────────────────
  ipcMain.handle('payroll:closing:preview', (_, { employee_id, month, net_amount }) => {
    if (!employee_id || !month) return { error: 'employee_id e month são obrigatórios' };
    const emp = get('SELECT id, name FROM employees WHERE id=?', [employee_id]);
    if (!emp) return { error: 'Funcionário não encontrado' };
    const net = parseFloat(net_amount) || 0;
    const regularAdvances = get("SELECT COALESCE(SUM(amount),0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND (advance_type='regular' OR advance_type IS NULL)", [employee_id, month, month])?.total || 0;
    const toPay = Math.max(0, +(net - regularAdvances).toFixed(2));
    return { employee: emp, month, net_amount: +net.toFixed(2), advances_applied: +regularAdvances.toFixed(2), to_pay: toPay };
  });
  ipcMain.handle('payroll:close', (_, d) => {
    const { employee_id, month, net_amount, method, account_label, note } = d || {};
    if (!employee_id || !month) return { error: 'employee_id e month são obrigatórios' };
    const emp = get('SELECT id, name FROM employees WHERE id=?', [employee_id]);
    if (!emp) return { error: 'Funcionário não encontrado' };
    const prev = get('SELECT * FROM payroll_closings WHERE employee_id=? AND reference_month=?', [employee_id, month]);
    const regularAdvances = get("SELECT COALESCE(SUM(amount),0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND (advance_type='regular' OR advance_type IS NULL)", [employee_id, month, month])?.total || 0;
    const net = parseFloat(net_amount) || 0;
    const toPay = Math.max(0, +(net - regularAdvances).toFixed(2));
    const occurredAt = today() + 'T12:00:00';
    const desc = `Fechamento Folha ${month}: ${emp.name} (líquido - adiantamentos)`;
    let cashId = prev?.cash_ledger_id || null;
    const m = normalizeMethod(method);
    const acc = defaultAccountFor(m, account_label || '');
    if (m !== 'dinheiro' && !String(acc).trim()) return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
    if (cashId) {
      run('UPDATE cash_ledger SET occurred_at=?,amount=?,method=?,account_label=?,category=?,description=?,source_type=?,created_at=? WHERE id=?',
        [occurredAt, -toPay, m, acc, 'folha_pagamento', desc, 'payroll_closing', nowLocal(), cashId]);
    } else {
      cashId = insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [occurredAt, -toPay, m, acc, 'folha_pagamento', desc, 'payroll_closing', 0, nowLocal()]);
    }
    const nowStr = nowLocal();
    if (prev?.id) {
      run('UPDATE payroll_closings SET net_amount=?,advances_applied=?,to_pay=?,cash_ledger_id=?,note=?,method=?,account_label=?,updated_at=? WHERE id=?',
        [net, regularAdvances, toPay, cashId, note || null, m, acc, nowStr, prev.id]);
    } else {
      insert('INSERT INTO payroll_closings (employee_id,reference_month,net_amount,advances_applied,to_pay,cash_ledger_id,note,method,account_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [employee_id, month, net, regularAdvances, toPay, cashId, note || null, m, acc, nowStr, nowStr]);
    }
    saveDb();
    return { ok: true, employee: emp, month, net_amount: +net.toFixed(2), advances_applied: +regularAdvances.toFixed(2), to_pay: toPay, cash_ledger_id: cashId };
  });

  // ── Férias ──────────────────────────────────────────────────────────────────
  ipcMain.handle('vacation:balance', (_, {employee_id}) => {
    const emp = get('SELECT * FROM employees WHERE id=?', [employee_id]);
    if (!emp) return { error: 'Funcionário não encontrado' };
    const accrualStartStr = emp.vacation_accrual_start || emp.admission_date;
    if (!accrualStartStr) return { error: 'Defina data de admissão ou início do contador de férias' };
    const admission = new Date(accrualStartStr);
    const todayDate = new Date();
    const yearsWorked = Math.floor((todayDate - admission) / (365.25 * 24 * 60 * 60 * 1000));
    const takenVacations = all('SELECT * FROM vacation_records WHERE employee_id=? ORDER BY period_start DESC', [employee_id]);
    const totalDaysTaken = takenVacations.reduce((sum, v) => sum + (v.days_taken || 0), 0);
    const totalDaysBuyout = takenVacations.reduce((sum, v) => sum + (v.buyout_days || 0), 0);
    const totalEntitled = yearsWorked * 30;
    const remainingDays = Math.max(0, totalEntitled - totalDaysTaken - totalDaysBuyout);
    const vencidoDays = Math.max(0, remainingDays - 30);
    return { employee: emp, years_worked: yearsWorked, total_entitled: totalEntitled, total_taken: totalDaysTaken, total_buyout: totalDaysBuyout, remaining_days: remainingDays, vencido_days: vencidoDays, vacation_history: takenVacations };
  });
  ipcMain.handle('vacation:preview', (_, d) => {
    if (!d?.employee_id || !d?.period_start || !d?.period_end) return { error: 'Parâmetros obrigatórios faltando' };
    const salaryAtStart = getSalaryAtDate(d.employee_id, d.period_start) || 0;
    try {
      const r = computeVacationAmounts(d.period_start, d.period_end, salaryAtStart, d.include_one_third !== false);
      return { ...r, salary_at_start: salaryAtStart, reference_month: (d.period_start || today()).slice(0,7) };
    } catch (e) { return { error: String(e.message || e) }; }
  });
  ipcMain.handle('vacation:register', (_, d) => {
    const emp = get('SELECT * FROM employees WHERE id=?', [d.employee_id]);
    if (!emp) return { error: 'Funcionário não encontrado' };
    if (!d.period_start || !d.period_end) return { error: 'Informe período de férias (início e fim).' };
    const start = new Date(d.period_start);
    const end = new Date(d.period_end);
    if (isNaN(start) || isNaN(end) || end < start) return { error: 'Período de férias inválido.' };
    const days = Math.floor((end - start) / (24*60*60*1000)) + 1;
    const salaryAtStart = getSalaryAtDate(d.employee_id, d.period_start) || 0;
    const calc = computeVacationAmounts(d.period_start, d.period_end, salaryAtStart, d.include_one_third !== false);
    const effectiveDate = today();
    const referenceMonth = (d.reference_month && d.reference_month.length === 7) ? d.reference_month : (d.period_start || effectiveDate).slice(0,7);
    const desc = `Férias: ${emp.name || ('Funcionário #' + d.employee_id)}`;
    const m = normalizeMethod(d.method);
    const acc = defaultAccountFor(m, d.account_label || '');
    if (m !== 'dinheiro' && !String(acc).trim()) return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
    const cashId = insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [effectiveDate + 'T12:00:00', -calc.total, m, acc, 'ferias', desc, 'salary_advance', 0, nowLocal()]);
    const note = `Férias ${d.period_start} a ${d.period_end} — Base R$ ${calc.base.toFixed(2)}${calc.one_third>0?`, 1/3 R$ ${calc.one_third.toFixed(2)}`:''}`;
    const advId = insert('INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [d.employee_id, 'ferias', calc.total, effectiveDate, note, cashId, referenceMonth, nowLocal()]);
    insert('INSERT INTO vacation_records (employee_id,period_start,period_end,days_taken,buyout_days,notes,created_at) VALUES (?,?,?,?,?,?,?)',
      [d.employee_id, d.period_start, d.period_end, days, d.buyout_days || 0, d.notes || null, nowLocal()]);
    saveDb();
    return { id: advId, amount: calc.total, base_amount: calc.base, one_third: calc.one_third, reference_month: referenceMonth };
  });

  // ── 13º Salário ─────────────────────────────────────────────────────────────
  ipcMain.handle('thirteenth:calculate', (_, { employee_id, year }) => {
    const emp = get('SELECT * FROM employees WHERE id=?', [employee_id]);
    if (!emp) return { error: 'Funcionário não encontrado' };
    const y = year || new Date().getFullYear();
    const isCurrentYear = y === new Date().getFullYear();
    const lastMonth = isCurrentYear ? (new Date().getMonth() + 1) : 12;
    const admission = emp.admission_date ? new Date(emp.admission_date) : null;
    let accrued = 0;
    for (let mo = 1; mo <= lastMonth; mo++) {
      const monthStr = `${y}-${String(mo).padStart(2,'0')}`;
      const lastDay = new Date(y, mo, 0).getDate();
      const refDate = `${monthStr}-${String(lastDay).padStart(2,'0')}`;
      let eligible = true;
      if (admission) {
        const monthStart = new Date(y, mo-1, 1);
        const monthEnd = new Date(y, mo-1, lastDay);
        if (admission > monthEnd) eligible = false;
        else if (admission >= monthStart && admission <= monthEnd) {
          if ((monthEnd - admission) / (24*60*60*1000) + 1 <= 15.0) eligible = false;
        }
      }
      if (!eligible) continue;
      accrued += (getSalaryAtDate(employee_id, refDate) || 0) / 12.0;
    }
    const paidRow = get("SELECT COALESCE(SUM(amount),0) AS paid FROM salary_advances WHERE employee_id=? AND (strftime('%Y', date)=? OR substr(COALESCE(reference_month,''),1,4)=?) AND advance_type LIKE 'decimo%'",
      [employee_id, String(y), String(y)]);
    const paid = paidRow?.paid || 0;
    return { employee: { id: emp.id, name: emp.name }, year: y, accrued: +accrued.toFixed(2), paid: +paid.toFixed(2), remaining: Math.max(0, +(accrued - paid).toFixed(2)) };
  });
  ipcMain.handle('thirteenth:pay', (_, d) => {
    const emp = get('SELECT * FROM employees WHERE id=?', [d.employee_id]);
    if (!emp) return { error: 'Funcionário não encontrado' };
    if (!d.amount || d.amount <= 0) return { error: 'Informe um valor válido' };
    const effectiveDate = d.date || today();
    const y = (effectiveDate || today()).slice(0,4);
    const type = d.installment_type || d.advance_type || 'decimo_primeira';
    const desc = `${type === 'decimo_segunda' ? '13º 2ª' : '13º 1ª'}: ${emp.name || ('Funcionário #' + d.employee_id)}`;
    const m = normalizeMethod(d.method);
    const acc = defaultAccountFor(m, d.account_label || '');
    if (m !== 'dinheiro' && !String(acc).trim()) return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
    const cashId = insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [effectiveDate + 'T12:00:00', -(d.amount || 0), m, acc, 'decimo_terceiro', desc, 'salary_advance', 0, nowLocal()]);
    const advId = insert('INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [d.employee_id, type, d.amount, effectiveDate, d.note || null, cashId, `${y}-12`, nowLocal()]);
    saveDb();
    return get('SELECT * FROM salary_advances WHERE id=?', [advId]);
  });

  // ── Saldos Pendentes ────────────────────────────────────────────────────────
  ipcMain.handle('salary_pending:list', (_, { employee_id, status }) => {
    let sql = 'SELECT p.*, e.name as employee_name FROM salary_balance_pending p JOIN employees e ON p.employee_id = e.id WHERE 1=1';
    const params = [];
    if (employee_id) { sql += ' AND p.employee_id=?'; params.push(employee_id); }
    if (status) { sql += ' AND p.status=?'; params.push(status); }
    sql += ' ORDER BY p.reference_month DESC, p.created_at DESC';
    return all(sql, params);
  });
  ipcMain.handle('salary_pending:create', (_, d) => {
    const id = insert('INSERT INTO salary_balance_pending (employee_id,reference_month,amount,status,created_at) VALUES (?,?,?,?,?)',
      [d.employee_id, d.reference_month, d.amount, d.status || 'pending', nowLocal()]);
    saveDb();
    return get('SELECT * FROM salary_balance_pending WHERE id=?', [id]);
  });
  ipcMain.handle('salary_pending:pay', (_, { id, amount, method, account_label, create_ap }) => {
    const pending = get('SELECT * FROM salary_balance_pending WHERE id=?', [id]);
    if (!pending) return { error: 'Saldo pendente não encontrado' };
    if (pending.status === 'paid') return { error: 'Saldo já foi quitado' };
    const payAmount = amount || (pending.amount - (pending.paid_amount || 0));
    const remainingBefore = pending.amount - (pending.paid_amount || 0);
    if (payAmount > remainingBefore) return { error: `Valor excede o saldo. Falta pagar: ${remainingBefore}` };
    const newPaidAmount = (pending.paid_amount || 0) + payAmount;
    const remaining = pending.amount - newPaidAmount;
    const isFullyPaid = remaining <= 0;
    const now = nowLocal();
    const todayStr2 = today();
    const m = normalizeMethod(method);
    const acc = defaultAccountFor(m, account_label || '');
    if (m !== 'dinheiro' && !String(acc).trim()) return { error: 'Selecione uma conta/banco quando o método de pagamento não for dinheiro.' };
    const cashId = insert('INSERT INTO cash_ledger (occurred_at,amount,method,account_label,category,description,source_type,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [todayStr2 + 'T12:00:00', -(payAmount || 0), m, acc, 'saldo_salario_anterior',
        `Pagamento parcial saldo ${pending.reference_month}: ${get('SELECT name FROM employees WHERE id=?', [pending.employee_id])?.name} (R$${payAmount} de R$${pending.amount})`,
        'salary_pending', id, now]);
    run('UPDATE salary_balance_pending SET paid_amount=?,status=? WHERE id=?', [newPaidAmount, isFullyPaid ? 'paid' : 'pending', id]);
    if (create_ap) {
      insert('INSERT INTO accounts_payable (description,category,amount,due_date,status,paid_at,method,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [`Saldo salário ${pending.reference_month} - Parcial`, 'folha_pagamento', payAmount, todayStr2, 'paga', now, m,
          `Funcionário ID: ${pending.employee_id} - Pago: ${payAmount} de ${pending.amount}`, now]);
    }
    saveDb();
    return { ok: true, cash_id: cashId, paid_amount: payAmount, total_paid: newPaidAmount, remaining, is_fully_paid: isFullyPaid };
  });
  ipcMain.handle('salary_pending:delete', (_, id) => {
    const pending = get('SELECT * FROM salary_balance_pending WHERE id=?', [id]);
    if (pending?.status === 'paid') {
      const cashEntry = get("SELECT id FROM cash_ledger WHERE source_type='salary_pending' AND source_id=?", [id]);
      if (cashEntry) run('DELETE FROM cash_ledger WHERE id=?', [cashEntry.id]);
    }
    run('DELETE FROM salary_balance_pending WHERE id=?', [id]);
    saveDb();
    return { ok: true };
  });

  // ── Debug / RH ──────────────────────────────────────────────────────────────
  ipcMain.handle('debug:auto_close_month', () => {
    autoClosePreviousMonth();
    return { ok: true, message: 'Fechamento automático executado' };
  });
  ipcMain.handle('debug:cleanup_salary_month', (_, { employee_id, month }) => {
    if (!employee_id || !month) return { ok: false, message: 'Parâmetros inválidos' };
    const prev = getPreviousMonth(month);
    const salary = getEmployeeSalaryAtMonth(employee_id, prev);
    const totalAdvances = get("SELECT COALESCE(SUM(amount),0) as total FROM salary_advances WHERE employee_id=? AND (reference_month=? OR (reference_month IS NULL AND strftime('%Y-%m', date)=?)) AND (advance_type='regular' OR advance_type IS NULL)", [employee_id, prev, prev])?.total || 0;
    const excess = Math.max(0, totalAdvances - salary);
    const deficit = Math.max(0, salary - totalAdvances);
    const carryNote = `Ajuste: excesso de adiantamentos de ${prev}`;
    const existingCarry = get("SELECT id FROM salary_advances WHERE employee_id=? AND reference_month=? AND advance_type='regular' AND note=?", [employee_id, month, carryNote]);
    let actions = { removedPendings: 0, updatedPending: false, removedCarry: false, updatedCarry: false, createdCarry: false };
    if (excess > 0.009) {
      const pendings = all("SELECT id FROM salary_balance_pending WHERE employee_id=? AND reference_month=? AND status='pending'", [employee_id, month]);
      for (const p of pendings) { run('DELETE FROM salary_balance_pending WHERE id=?', [p.id]); actions.removedPendings++; }
      if (existingCarry?.id) { run('UPDATE salary_advances SET amount=?,date=? WHERE id=?', [excess, today(), existingCarry.id]); actions.updatedCarry = true; }
      else { insert('INSERT INTO salary_advances (employee_id,advance_type,amount,date,note,source_id,reference_month,created_at) VALUES (?,?,?,?,?,?,?,?)', [employee_id, 'regular', excess, today(), carryNote, 0, month, nowLocal()]); actions.createdCarry = true; }
    } else if (deficit > 0.009) {
      if (existingCarry?.id) { run('DELETE FROM salary_advances WHERE id=?', [existingCarry.id]); actions.removedCarry = true; }
      const existPending = get("SELECT id FROM salary_balance_pending WHERE employee_id=? AND reference_month=? AND status='pending'", [employee_id, month]);
      if (existPending?.id) { run('UPDATE salary_balance_pending SET amount=? WHERE id=?', [deficit, existPending.id]); actions.updatedPending = true; }
      else { insert('INSERT INTO salary_balance_pending (employee_id,reference_month,amount,paid_amount,status,created_at) VALUES (?,?,?,?,?,?)', [employee_id, month, deficit, 0, 'pending', nowLocal()]); }
    } else {
      const pendings = all("SELECT id FROM salary_balance_pending WHERE employee_id=? AND reference_month=? AND status='pending'", [employee_id, month]);
      for (const p of pendings) { run('DELETE FROM salary_balance_pending WHERE id=?', [p.id]); actions.removedPendings++; }
      if (existingCarry?.id) { run('DELETE FROM salary_advances WHERE id=?', [existingCarry.id]); actions.removedCarry = true; }
    }
    try { recalculateAdvanceReferenceMonths(employee_id, month); } catch(e) { console.warn('[cleanup] recalc month error', e); }
    saveDb();
    return { ok: true, salary, totalAdvances, excess, deficit, actions };
  });
  ipcMain.handle('debug:reset_salary_state', (_, { employee_id }) => {
    if (!employee_id) return { ok: false, message: 'employee_id obrigatório' };
    run('DELETE FROM salary_balance_pending WHERE employee_id=?', [employee_id]);
    const pendDeleted = get('SELECT changes() as c')?.c || 0;
    run("DELETE FROM salary_advances WHERE employee_id=? AND note LIKE 'Ajuste: excesso de adiantamentos %'", [employee_id]);
    const adjDeleted = get('SELECT changes() as c')?.c || 0;
    saveDb();
    return { ok: true, pendDeleted, adjDeleted };
  });
};
