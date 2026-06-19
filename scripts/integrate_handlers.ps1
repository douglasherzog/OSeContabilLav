$f = "c:\Users\Usuario\CascadeProjects\OSeContabilLav\electron\main.js"
$lines = Get-Content $f -Encoding UTF8

# Passo 1: Inserir requires dos handlers apos os requires existentes
$requiresBlock = @'
const registerServicos      = require('./handlers/servicos');
const registerOS            = require('./handlers/os');
const registerCaixa         = require('./handlers/caixa');
const registerFuncionarios  = require('./handlers/funcionarios');
const registerConfiguracoes = require('./handlers/configuracoes');
const registerDashboard     = require('./handlers/dashboard');
'@

$insertAfterLine = 'const { computeVacationAmounts } = require("./calc/vacation");'
$c = Get-Content $f -Raw -Encoding UTF8
if ($c.Contains($insertAfterLine)) {
  $c = $c.Replace($insertAfterLine, $insertAfterLine + "`r`n" + $requiresBlock)
  Write-Host "Requires inseridos"
} else {
  Write-Host "AVISO: linha de referencia nao encontrada para requires"
}

Set-Content $f -Value $c -Encoding UTF8 -NoNewline

# Passo 2: Inserir chamadas register() em app.whenReady(), apos await initDb()
$c = Get-Content $f -Raw -Encoding UTF8
$registerBlock = @'

  // Registrar handlers IPC modulares
  const ctx = { run, all, get, insert, nowLocal, today, monthStart, saveDb, getDbPath, dialog,
    normalizeMethod, defaultAccountFor, invalidateDashboardCache,
    getNextMonth, getPreviousMonth, getLastDayOfMonth,
    computeVacationAmounts, autoClosePreviousMonth };
  registerServicos(ipcMain, ctx);
  registerOS(ipcMain, ctx);
  registerCaixa(ipcMain, ctx);
  registerFuncionarios(ipcMain, ctx);
  registerConfiguracoes(ipcMain, ctx);
  registerDashboard(ipcMain, ctx);
'@

$insertAfterReady = 'await initDb();'
if ($c.Contains($insertAfterReady)) {
  $c = $c.Replace($insertAfterReady, $insertAfterReady + $registerBlock)
  Write-Host "Chamadas register() inseridas"
} else {
  Write-Host "AVISO: nao encontrou 'await initDb()' para inserir register()"
}

Set-Content $f -Value $c -Encoding UTF8 -NoNewline
Write-Host "Script concluido"
