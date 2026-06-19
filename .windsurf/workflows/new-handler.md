---
description: Adicionar novo handler IPC ou domínio ao projeto
---

## Contexto

O projeto usa Electron + React + BetterSqlite3. Toda comunicação entre renderer e main process passa por `ipcMain.handle` / `ipcRenderer.invoke`, com a API exposta via `contextBridge` em `preload.js`.

Os handlers são organizados em módulos por domínio em `electron/handlers/`. Cada módulo exporta uma função `register(ipcMain, ctx)`. Consulte `ARCHITECTURE.md` na raiz para referência completa.

---

## Passos

### 1. Identificar o módulo correto

Verificar qual módulo existente cobre o domínio, ou criar um novo:

| Domínio | Arquivo |
|---|---|
| Serviços e Clientes | `electron/handlers/servicos.js` |
| Ordens de Serviço | `electron/handlers/os.js` |
| Caixa, AP e AR | `electron/handlers/caixa.js` |
| Funcionários, Folha, Férias, 13º | `electron/handlers/funcionarios.js` |
| Configurações, Empresa, DB, CSV | `electron/handlers/configuracoes.js` |
| Dashboard e contadores | `electron/handlers/dashboard.js` |

### 2. Adicionar o handler no módulo

Dentro da função `register`, adicionar o novo `ipcMain.handle`:

```js
ipcMain.handle('dominio:acao', (_, payload) => {
  // lógica síncrona — BetterSqlite3 não usa async
  const id = insert('INSERT INTO tabela (campo) VALUES (?)', [payload.campo]);
  return get('SELECT * FROM tabela WHERE id=?', [id]);
});
```

**Regras obrigatórias:**
- Usar apenas funções do `ctx` desestruturado no parâmetro de `register`
- Retornar `{ error: 'mensagem' }` em vez de lançar exceção para erros de validação
- Usar `nowLocal()` para timestamps, `today()` para comparações de data
- Para operações que alteram caixa/saldo, chamar `invalidateDashboardCache()` ou `saveDb()`
- Verificar método de pagamento: `normalizeMethod` + `defaultAccountFor` + validação

### 3. Se for um novo módulo (novo domínio)

Criar `electron/handlers/novo_dominio.js`:

```js
'use strict';

module.exports = function register(ipcMain, { run, all, get, insert, nowLocal }) {
  ipcMain.handle('novo_dominio:list', () => {
    return all('SELECT * FROM nova_tabela ORDER BY created_at DESC');
  });
};
```

Registrar em `electron/main.js`:

```js
// Topo do arquivo, junto aos outros requires:
const registerNovoDominio = require('./handlers/novo_dominio');

// Dentro de app.whenReady(), após initDb() e antes de createWindow():
registerNovoDominio(ipcMain, ctx);
```

### 4. Se precisar de nova tabela ou coluna — adicionar migration

Em `electron/main.js`, localizar o array `MIGRATIONS` e adicionar ao **final**:

```js
() => {
  run('ALTER TABLE tabela ADD COLUMN nova_coluna TEXT');
  // ou
  run(`CREATE TABLE IF NOT EXISTS nova_tabela (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campo TEXT NOT NULL,
    created_at TEXT
  )`);
},
```

### 5. Expor no preload

Em `electron/preload.js`, adicionar dentro do objeto `contextBridge.exposeInMainWorld('api', { ... })`:

```js
novoDominio: {
  list: () => ipcRenderer.invoke('novo_dominio:list'),
  create: (data) => ipcRenderer.invoke('novo_dominio:create', data),
  update: (data) => ipcRenderer.invoke('novo_dominio:update', data),
  delete: (id) => ipcRenderer.invoke('novo_dominio:delete', id),
},
```

### 6. Verificar sintaxe

// turbo
```
node --check electron/main.js
```

// turbo
```
node --check electron/handlers/MODULO.js
```

### 7. Usar no renderer

```jsx
// Em qualquer página React:
const items = await window.api.novoDominio.list();
const novo = await window.api.novoDominio.create({ campo: 'valor' });
if (novo?.error) { /* tratar erro */ }
```
