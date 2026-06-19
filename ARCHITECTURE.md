# Arquitetura — OS e Contabil Lavanderia

## Visão Geral

Aplicação desktop local construída com **Electron + React + Vite**.

```
Renderer (React/Vite)
    └── window.api.*           ← contextBridge (preload.js)
           └── ipcRenderer.invoke('canal:ação', payload)
                   ↓
Main Process (Node.js)
    └── ipcMain.handle('canal:ação', handler)
           └── BetterSqlite3  ← osecontabil.db (SQLite, WAL)
```

O banco de dados é **local, síncrono e exclusivo** do processo main. O renderer nunca acessa o banco diretamente.

---

## Estrutura de Diretórios

```
electron/
  main.js              ← Orquestrador: inicializa app, DB e registra módulos
  preload.js           ← Expõe window.api ao renderer via contextBridge
  dateHelpers.js       ← Helpers de data (today, nowLocal, addDays…)
  calc/
    vacation.js        ← Lógica de cálculo de férias (computeVacationAmounts)
  handlers/
    servicos.js        ← services:* e clients:*
    os.js              ← os:*
    caixa.js           ← caixa:*, ap:*, ar:*, categorias, recorrências
    funcionarios.js    ← employees:*, salary_advances:*, payroll:*, vacation:*,
                          thirteenth:*, salary_pending:*, debug:* (RH)
    configuracoes.js   ← db:*, import:csv, company:*, payment_methods:*, bank_accounts:*
    dashboard.js       ← dashboard:*, ap:overdue_count

src/
  App.jsx              ← Layout principal, navegação, badges de contadores
  pages/               ← Uma página por domínio (Dashboard, OSList, Caixa…)
  components/          ← Componentes reutilizáveis
  utils/
    dateHelpers.js     ← Mesmos helpers de data (lado renderer)
  utils.js             ← Formatação (brl, fmtDate), exportCSV, STATUS_LABELS
```

---

## Módulos IPC (`electron/handlers/`)

### Padrão obrigatório para todos os módulos

```js
'use strict';

module.exports = function register(ipcMain, ctx) {
  // Desestruturar apenas o que for necessário do ctx
  const { run, all, get, insert, nowLocal, today } = ctx;

  ipcMain.handle('dominio:acao', (_, payload) => {
    // lógica síncrona com BetterSqlite3
    return resultado;
  });
};
```

- A função exportada **sempre se chama `register`** e recebe `(ipcMain, ctx)`.
- Módulos que precisam invalidar o cache do dashboard devem usar **`ctx.invalidateDashboardCache`** — nunca recriar um cache próprio.
- Helpers locais (ex: `normalizePhone`, `addDays`) podem ser declarados **no topo do arquivo**, antes do `module.exports`.
- Não importar `ipcMain` ou `db` diretamente — tudo chega via `ctx`.

### Objeto de contexto (`ctx`)

O `ctx` é montado em `main.js` no `app.whenReady()` e contém:

| Propriedade | Tipo | Descrição |
|---|---|---|
| `run(sql, params)` | Function | Executa SQL sem retorno (INSERT/UPDATE/DELETE) |
| `all(sql, params)` | Function | Retorna array de linhas |
| `get(sql, params)` | Function | Retorna primeira linha ou `undefined` |
| `insert(sql, params)` | Function | Executa INSERT e retorna `lastInsertRowid` |
| `nowLocal()` | Function | Data/hora local ISO: `YYYY-MM-DDTHH:MM:SS` |
| `today()` | Function | Data local: `YYYY-MM-DD` |
| `monthStart()` | Function | Primeiro dia do mês atual: `YYYY-MM-DD` |
| `saveDb()` | Function | Invalida cache do dashboard (efeito colateral esperado) |
| `getDbPath()` | Function | Caminho absoluto do arquivo `.db` |
| `dialog` | Object | `electron.dialog` para abrir/salvar arquivos |
| `normalizeMethod(m)` | Function | Normaliza método de pagamento para nome canônico |
| `defaultAccountFor(m, label)` | Function | Retorna conta padrão para um método |
| `invalidateDashboardCache()` | Function | Invalida o cache do `dashboard:summary` |
| `getNextMonth(month)` | Function | Próximo mês em `YYYY-MM` |
| `getPreviousMonth(month)` | Function | Mês anterior em `YYYY-MM` |
| `getLastDayOfMonth(month)` | Function | Último dia do mês (número inteiro) |
| `computeVacationAmounts(...)` | Function | Calcula base, 1/3 e total de férias |
| `autoClosePreviousMonth()` | Function | Fecha mês anterior de folha (chamado em `initDb`) |

### Módulo `dashboard.js` — caso especial

`registerDashboard` **retorna** `{ invalidate }`. O `main.js` usa esse retorno para substituir `ctx.invalidateDashboardCache` antes de registrar os demais módulos:

```js
const dashboardModule = registerDashboard(ipcMain, ctx);
if (dashboardModule?.invalidate) ctx.invalidateDashboardCache = dashboardModule.invalidate;
registerCaixa(ipcMain, ctx);      // recebe o invalidate correto
registerFuncionarios(ipcMain, ctx);
```

---

## Camada de Apresentação (`preload.js`)

Toda comunicação do renderer passa por `window.api`, exposto via `contextBridge`. A estrutura espelha os domínios dos handlers:

```
window.api
  .services.*        → services:*
  .clients.*         → clients:*
  .os.*              → os:*
  .paymentMethods.*  → payment_methods:*
  .bankAccounts.*    → bank_accounts:*
  .caixa.*           → caixa:*
  .ap.*              → ap:*
  .ar.*              → ar:*
  .import.*          → import:*
  .employees.*       → employees:*
  .salaryAdvances.*  → salary_advances:*
  .payroll.*         → payroll:*
  .debug.*           → debug:*
  .salaryPending.*   → salary_pending:*
  .vacation.*        → vacation:*
  .thirteenth.*      → thirteenth:*
  .db.*              → db:*
  .dashboard.*       → dashboard:*, ap:overdue_count
  .company.*         → company:*
```

**Regra:** ao adicionar um handler IPC em qualquer módulo, **sempre** adicionar a entrada correspondente em `preload.js`.

---

## Banco de Dados

- **Driver:** `better-sqlite3` (síncrono, sem callbacks/Promises)
- **Arquivo:** `%userData%/osecontabil.db`
- **Modo WAL** habilitado para performance
- **Migrations versionadas** via `PRAGMA user_version` — array `MIGRATIONS` em `main.js`
- **Backups automáticos** diários em `%userData%/backups/`, mantendo os últimos 7

### Adicionar uma migration

1. Abrir `electron/main.js`
2. Localizar o array `MIGRATIONS`
3. Adicionar um novo elemento ao **final** do array:

```js
const MIGRATIONS = [
  // versão 1, 2, 3... existentes
  () => {
    run('ALTER TABLE minha_tabela ADD COLUMN nova_coluna TEXT');
  },
];
```

O número da versão é implícito pela posição no array (índice + 1).

---

## Adicionando um novo domínio

### 1. Criar o handler

Criar `electron/handlers/meu_dominio.js`:

```js
'use strict';

module.exports = function register(ipcMain, { run, all, get, insert, nowLocal }) {
  ipcMain.handle('meu_dominio:list', () => {
    return all('SELECT * FROM minha_tabela ORDER BY created_at DESC');
  });

  ipcMain.handle('meu_dominio:create', (_, d) => {
    const id = insert('INSERT INTO minha_tabela (campo, created_at) VALUES (?,?)',
      [d.campo, nowLocal()]);
    return get('SELECT * FROM minha_tabela WHERE id=?', [id]);
  });
};
```

### 2. Registrar em `main.js`

```js
// No topo, junto aos outros requires:
const registerMeuDominio = require('./handlers/meu_dominio');

// Dentro de app.whenReady(), após initDb():
registerMeuDominio(ipcMain, ctx);
```

### 3. Expor em `preload.js`

```js
// Dentro do objeto exposto ao contextBridge:
meuDominio: {
  list: () => ipcRenderer.invoke('meu_dominio:list'),
  create: (data) => ipcRenderer.invoke('meu_dominio:create', data),
},
```

### 4. Usar no renderer

```jsx
const dados = await window.api.meuDominio.list();
```

---

## Convenções de Código

### Nomes de canais IPC

```
dominio:acao
dominio:sub_dominio:acao
```

Exemplos: `os:list`, `caixa:categories:create`, `salary_advances:balance`

### Retornos dos handlers

| Situação | Retorno esperado |
|---|---|
| Busca | Array ou objeto (ou `null` se não encontrado) |
| Criação bem-sucedida | Objeto recém-criado (via `SELECT` após insert) |
| Atualização bem-sucedida | Objeto atualizado |
| Exclusão bem-sucedida | `{ ok: true }` |
| Erro de validação | `{ error: 'Mensagem legível ao usuário' }` |

### Tratamento de erros no renderer

```jsx
const result = await window.api.dominio.create(data);
if (result?.error) {
  setError(result.error);
  return;
}
```

### Datas

- Sempre usar `nowLocal()` para gravar timestamps no banco
- Sempre usar `today()` para comparações de data (`due_date < ?`)
- Não usar `new Date().toISOString()` — gera UTC, não horário local

### Métodos de pagamento e contas

- Sempre normalizar com `normalizeMethod(m)` antes de gravar
- Sempre resolver conta com `defaultAccountFor(method, label)` antes de gravar
- Validar: `if (m !== 'dinheiro' && !String(acc).trim()) return { error: '...' }`

---

## Fluxo de Desenvolvimento

```
1. Nova funcionalidade backend?
   → Criar/editar electron/handlers/DOMINIO.js
   → Se necessário, adicionar migration em main.js
   → Registrar em main.js (require + registerX)
   → Expor em preload.js

2. Nova funcionalidade frontend?
   → Criar/editar src/pages/PAGINA.jsx ou src/components/COMPONENTE.jsx
   → Consumir via window.api.*

3. Verificar sintaxe antes de testar:
   node --check electron/main.js
   node --check electron/handlers/MEU_MODULO.js
```
