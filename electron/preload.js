const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Catálogo de Serviços
  services: {
    list: (includeInactive) => ipcRenderer.invoke('services:list', includeInactive),
    create: (data) => ipcRenderer.invoke('services:create', data),
    update: (data) => ipcRenderer.invoke('services:update', data),
    delete: (id) => ipcRenderer.invoke('services:delete', id),
  },
  // Clientes
  clients: {
    list: () => ipcRenderer.invoke('clients:list'),
    listWithOS: () => ipcRenderer.invoke('clients:list_with_os'),
    create: (data) => ipcRenderer.invoke('clients:create', data),
    update: (data) => ipcRenderer.invoke('clients:update', data),
    delete: (id) => ipcRenderer.invoke('clients:delete', id),
    getOS: (client_id) => ipcRenderer.invoke('clients:get_os', client_id),
  },
  // OS
  os: {
    list: (filters) => ipcRenderer.invoke('os:list', filters),
    listAssigned: () => ipcRenderer.invoke('os:list_assigned'),
    get: (id) => ipcRenderer.invoke('os:get', id),
    create: (data) => ipcRenderer.invoke('os:create', data),
    update: (data) => ipcRenderer.invoke('os:update', data),
    delete: (id) => ipcRenderer.invoke('os:delete', id),
    addPayment: (data) => ipcRenderer.invoke('os:add_payment', data),
    updatePayment: (data) => ipcRenderer.invoke('os:update_payment', data),
    addItem: (data) => ipcRenderer.invoke('os:add_item', data),
    deleteItem: (data) => ipcRenderer.invoke('os:delete_item', data),
    deletePayment: (data) => ipcRenderer.invoke('os:delete_payment', data),
  },
  // Caixa
  caixa: {
    list: (filters) => ipcRenderer.invoke('caixa:list', filters),
    create: (data) => ipcRenderer.invoke('caixa:create', data),
    update: (data) => ipcRenderer.invoke('caixa:update', data),
    delete: (id) => ipcRenderer.invoke('caixa:delete', id),
    listCategories: () => ipcRenderer.invoke('caixa:categories:list'),
    createCategory: (name) => ipcRenderer.invoke('caixa:categories:create', name),
    deleteCategory: (name) => ipcRenderer.invoke('caixa:categories:delete', name),
  },
  // Contas a Pagar
  ap: {
    list: (filters) => ipcRenderer.invoke('ap:list', filters),
    create: (data) => ipcRenderer.invoke('ap:create', data),
    update: (data) => ipcRenderer.invoke('ap:update', data),
    delete: (id) => ipcRenderer.invoke('ap:delete', id),
    categories: {
      list: () => ipcRenderer.invoke('ap:categories:list'),
      create: (name) => ipcRenderer.invoke('ap:categories:create', name),
      delete: (name) => ipcRenderer.invoke('ap:categories:delete', name),
    },
  },
  // Contas a Receber
  ar: {
    list: (filters) => ipcRenderer.invoke('ar:list', filters),
    create: (data) => ipcRenderer.invoke('ar:create', data),
    update: (data) => ipcRenderer.invoke('ar:update', data),
    delete: (id) => ipcRenderer.invoke('ar:delete', id),
    categories: {
      list: () => ipcRenderer.invoke('ar:categories:list'),
      create: (name) => ipcRenderer.invoke('ar:categories:create', name),
      delete: (name) => ipcRenderer.invoke('ar:categories:delete', name),
    },
  },
  // Importação
  import: {
    csv: (table) => ipcRenderer.invoke('import:csv', { table }),
  },
  // Funcionários
  employees: {
    list: () => ipcRenderer.invoke('employees:list'),
    create: (data) => ipcRenderer.invoke('employees:create', data),
    update: (data) => ipcRenderer.invoke('employees:update', data),
    delete: (id) => ipcRenderer.invoke('employees:delete', id),
    salaryHistory: (employee_id) => ipcRenderer.invoke('employees:salary_history', { employee_id }),
    recalculateAdvances: (data) => ipcRenderer.invoke('employees:recalculate_advances', data),
  },
  // Adiantamentos de Salário
  salaryAdvances: {
    list: (filters) => ipcRenderer.invoke('salary_advances:list', filters),
    create: (data) => ipcRenderer.invoke('salary_advances:create', data),
    delete: (id) => ipcRenderer.invoke('salary_advances:delete', id),
    balance: (filters) => ipcRenderer.invoke('salary_advances:balance', filters),
  },
  // Debug (apenas para testes)
  debug: {
    autoCloseMonth: () => ipcRenderer.invoke('debug:auto_close_month'),
    cleanupSalaryMonth: (data) => ipcRenderer.invoke('debug:cleanup_salary_month', data),
    resetSalaryState: (data) => ipcRenderer.invoke('debug:reset_salary_state', data),
  },
  // Saldos Pendentes de Salário
  salaryPending: {
    list: (filters) => ipcRenderer.invoke('salary_pending:list', filters),
    create: (data) => ipcRenderer.invoke('salary_pending:create', data),
    pay: (data) => ipcRenderer.invoke('salary_pending:pay', data),
    delete: (id) => ipcRenderer.invoke('salary_pending:delete', id),
  },
  // Férias
  vacation: {
    balance: (employee_id) => ipcRenderer.invoke('vacation:balance', { employee_id }),
    register: (data) => ipcRenderer.invoke('vacation:register', data),
  },
  // Décimo Terceiro
  thirteenth: {
    calculate: (employee_id, year) => ipcRenderer.invoke('thirteenth:calculate', { employee_id, year }),
    pay: (data) => ipcRenderer.invoke('thirteenth:pay', data),
  },
  db: {
    path: () => ipcRenderer.invoke('db:path'),
    backup: () => ipcRenderer.invoke('db:backup'),
    cleanupDuplicates: () => ipcRenderer.invoke('db:cleanup_duplicates'),
  },
  dashboard: {
    summary: () => ipcRenderer.invoke('dashboard:summary'),
    overdueCount: () => ipcRenderer.invoke('ap:overdue_count'),
    readyCount: () => ipcRenderer.invoke('dashboard:ready_count'),
  },
  company: {
    get: () => ipcRenderer.invoke('company:get'),
    update: (data) => ipcRenderer.invoke('company:update', data),
  },
});
