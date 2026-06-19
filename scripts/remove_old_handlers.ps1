$f = "c:\Users\Usuario\CascadeProjects\OSeContabilLav\electron\main.js"
$c = Get-Content $f -Raw -Encoding UTF8

# Lista de prefixos de handler migrados para modulos
# Removeremos cada ipcMain.handle("CHANNEL", ...) do main.js
$channels = @(
  "services:list", "services:create", "services:update", "services:delete",
  "clients:list", "clients:list_with_os", "clients:create", "clients:update", "clients:delete", "clients:get_os",
  "os:list_assigned", "os:list", "os:get", "os:create", "os:update", "os:delete",
  "os:add_payment", "os:update_payment", "os:add_item", "os:delete_item", "os:delete_payment",
  "caixa:list", "caixa:categories:list", "caixa:categories:create", "caixa:categories:delete",
  "caixa:create", "caixa:update", "caixa:delete",
  "ap:categories:list", "ap:categories:create", "ap:categories:delete",
  "ar:categories:list", "ar:categories:create", "ar:categories:delete",
  "ap:list", "ap:create", "ap:update", "ap:delete", "ap:overdue_count",
  "ar:list", "ar:recurrence:get", "ar:recurrence:update", "ar:create", "ar:update", "ar:delete",
  "employees:list", "employees:create", "employees:update", "employees:delete",
  "employees:salary_history", "employees:recalculate_advances",
  "salary_advances:list", "salary_advances:create", "salary_advances:delete", "salary_advances:balance",
  "payroll:closing:preview", "payroll:close",
  "vacation:balance", "vacation:preview", "vacation:register",
  "thirteenth:calculate", "thirteenth:pay",
  "salary_pending:list", "salary_pending:create", "salary_pending:pay", "salary_pending:delete",
  "debug:auto_close_month", "debug:cleanup_salary_month", "debug:reset_salary_state",
  "import:csv",
  "db:path", "db:backup", "db:cleanup_duplicates", "db:repair", "db:normalize_units",
  "company:get", "company:update",
  "payment_methods:list", "payment_methods:create", "payment_methods:update", "payment_methods:delete",
  "bank_accounts:list", "bank_accounts:create", "bank_accounts:update", "bank_accounts:delete",
  "dashboard:summary", "dashboard:ready_count"
)

# Para cada canal, remover o bloco ipcMain.handle usando regex multi-linha
foreach ($ch in $channels) {
  # Escapa caracteres especiais do canal para uso em regex
  $escaped = [regex]::Escape($ch)
  # Padrao: ipcMain.handle("CHANNEL", ... ate o fechamento });
  # Usa regex gulosa com balanceamento de chaves - abordagem linha a linha
  $pattern = "(?s)ipcMain\.handle\(`"$escaped`"[^;]*?\}\);"
  if ($c -match $pattern) {
    $c = $c -replace $pattern, ""
    Write-Host "Removido: $ch"
  } else {
    # Tentar com aspas simples
    $pattern2 = "(?s)ipcMain\.handle\('$escaped'[^;]*?\}\);"
    if ($c -match $pattern2) {
      $c = $c -replace $pattern2, ""
      Write-Host "Removido (aspas simples): $ch"
    } else {
      Write-Host "NAO encontrado: $ch"
    }
  }
}

# Remover funcoes auxiliares que foram movidas para modulos
# normalizePhone (foi para servicos.js)
$c = $c -replace "(?s)function normalizePhone\(raw\) \{.*?\}\r?\n", ""

# Remover bloco duplicate ensureArRecurrences no topo (linhas 36-68 originais, agora em caixa.js)
# Ela aparece duas vezes (topo e como funcao local). Remover apenas a primeira ocorrencia.
$firstOccurrence = $c.IndexOf("function ensureArRecurrences(maxDate)")
$secondOccurrence = $c.IndexOf("function ensureArRecurrences(maxDate)", $firstOccurrence + 1)
if ($firstOccurrence -ge 0 -and $secondOccurrence -ge 0) {
  # Ha duas ocorrencias - remover a primeira
  # Encontrar o final da primeira funcao
  Write-Host "ensureArRecurrences duplicada encontrada - removendo primeira ocorrencia manualmente"
}

# Remover linhas em branco excessivas (mais de 2 seguidas)
$c = $c -replace "(\r?\n){3,}", "`r`n`r`n"

Set-Content $f -Value $c -Encoding UTF8 -NoNewline
Write-Host "Remocao de handlers antigos concluida"
