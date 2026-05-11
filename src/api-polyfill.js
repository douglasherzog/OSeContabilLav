// Lightweight web-mode polyfill: ensures the app renders when Electron preload (window.api) is unavailable.
(function(){
  if (typeof window === 'undefined') return;
  if (window.api) return; // Electron available

  const ok = (value) => Promise.resolve(value);
  const emptyArr = () => ok([]);
  const okTrue = () => ok({ ok: true });

  const dashboardDefault = {
    osAberta: 0,
    osHoje: 0,
    receitaMes: 0,
    saidaMes: 0,
    saldoMes: 0,
    apVencidas: 0,
    apPendente: 0,
    arPendente: 0,
    totalClientes: 0,
    osPorStatus: [],
    receitaSemana: 0,
    ultimasOS: [],
    osProntas: [],
    apVencendo7: 0,
  };

  // mark web-mode for UI hints
  window.__WEB_MODE__ = true;
  window.api = {
    services: {
      list: emptyArr,
      create: okTrue,
      update: okTrue,
      delete: okTrue,
    },
    clients: {
      list: emptyArr,
      listWithOS: emptyArr,
      create: okTrue,
      update: okTrue,
      delete: okTrue,
      getOS: emptyArr,
    },
    os: {
      list: emptyArr,
      listAssigned: emptyArr,
      get: () => ok({}),
      create: okTrue,
      update: okTrue,
      delete: okTrue,
      addPayment: okTrue,
      updatePayment: okTrue,
      addItem: okTrue,
      deleteItem: okTrue,
      deletePayment: okTrue,
    },
    paymentMethods: {
      list: emptyArr,
      create: okTrue,
      update: okTrue,
      delete: okTrue,
    },
    bankAccounts: {
      list: emptyArr,
      create: okTrue,
      update: okTrue,
      delete: okTrue,
    },
    caixa: {
      list: emptyArr,
      create: okTrue,
      update: okTrue,
      delete: okTrue,
      listCategories: emptyArr,
      createCategory: okTrue,
      deleteCategory: okTrue,
    },
    ap: {
      list: emptyArr,
      create: okTrue,
      update: okTrue,
      delete: okTrue,
      categories: { list: emptyArr, create: okTrue, delete: okTrue },
    },
    ar: {
      list: emptyArr,
      create: okTrue,
      update: okTrue,
      delete: okTrue,
      categories: { list: emptyArr, create: okTrue, delete: okTrue },
    },
    import: { csv: () => ok({ ok: false }) },
    employees: {
      list: emptyArr, create: okTrue, update: okTrue, delete: okTrue, salaryHistory: emptyArr, recalculateAdvances: okTrue,
    },
    salaryAdvances: { list: emptyArr, create: okTrue, delete: okTrue, balance: () => ok(0) },
    salaryPending: { list: emptyArr, create: okTrue, pay: okTrue, delete: okTrue },
    vacation: { balance: () => ok({}), preview: () => ok({}), register: okTrue },
    thirteenth: { calculate: () => ok({}), pay: okTrue },
    debug: { autoCloseMonth: okTrue, cleanupSalaryMonth: okTrue, resetSalaryState: okTrue },
    payroll: { previewClosing: () => ok({}), close: okTrue },
    db: { path: () => ok(''), backup: okTrue, cleanupDuplicates: okTrue, repair: okTrue, normalizeUnits: okTrue },
    dashboard: {
      summary: () => ok(dashboardDefault),
      overdueCount: () => ok(0),
      readyCount: () => ok(0),
    },
    company: {
      get: () => ok({ name: 'Modo Web', legal_name: '' }),
      update: okTrue,
    },
  };
  // also mark on api object
  window.api.__polyfill = true;
})();
