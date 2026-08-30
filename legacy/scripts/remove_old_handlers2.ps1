$f = "c:\Users\Usuario\CascadeProjects\OSeContabilLav\electron\main.js"
$lines = Get-Content $f -Encoding UTF8

$channels = @(
  'services:list', 'services:create', 'services:update', 'services:delete',
  'clients:list', 'clients:list_with_os', 'clients:create', 'clients:update', 'clients:delete', 'clients:get_os',
  'os:list_assigned', 'os:list', 'os:get', 'os:create', 'os:update', 'os:delete',
  'os:add_payment', 'os:update_payment', 'os:add_item', 'os:delete_item', 'os:delete_payment',
  'caixa:list', 'caixa:categories:list', 'caixa:categories:create', 'caixa:categories:delete',
  'caixa:create', 'caixa:update', 'caixa:delete',
  'ap:categories:list', 'ap:categories:create', 'ap:categories:delete',
  'ar:categories:list', 'ar:categories:create', 'ar:categories:delete',
  'ap:list', 'ap:create', 'ap:update', 'ap:delete', 'ap:overdue_count',
  'ar:list', 'ar:recurrence:get', 'ar:recurrence:update', 'ar:create', 'ar:update', 'ar:delete',
  'employees:list', 'employees:create', 'employees:update', 'employees:delete',
  'employees:salary_history', 'employees:recalculate_advances',
  'salary_advances:list', 'salary_advances:create', 'salary_advances:delete', 'salary_advances:balance',
  'payroll:closing:preview', 'payroll:close',
  'vacation:balance', 'vacation:preview', 'vacation:register',
  'thirteenth:calculate', 'thirteenth:pay',
  'salary_pending:list', 'salary_pending:create', 'salary_pending:pay', 'salary_pending:delete',
  'debug:auto_close_month', 'debug:cleanup_salary_month', 'debug:reset_salary_state',
  'db:path', 'db:cleanup_duplicates', 'db:repair', 'db:normalize_units',
  'company:get', 'company:update',
  'payment_methods:list', 'payment_methods:create', 'payment_methods:update', 'payment_methods:delete',
  'bank_accounts:list', 'bank_accounts:create', 'bank_accounts:update', 'bank_accounts:delete',
  'dashboard:summary', 'dashboard:ready_count', 'dashboard:invalidate_cache'
)

# Construir set de canais para busca rapida
$chanSet = @{}
foreach ($ch in $channels) { $chanSet[$ch] = $true }

$output = [System.Collections.Generic.List[string]]::new()
$i = 0
$totalLines = $lines.Length
$removedCount = 0

while ($i -lt $totalLines) {
  $line = $lines[$i]

  # Verificar se esta linha inicia um handler que deve ser removido
  $matched = $false
  foreach ($ch in $channels) {
    if ($line -match "ipcMain\.handle\([`"']$([regex]::Escape($ch))[`"']") {
      # Encontrou inicio de handler para remover
      # Contar chaves para encontrar o fim do bloco
      $depth = 0
      $j = $i
      $foundEnd = $false
      while ($j -lt $totalLines) {
        $l = $lines[$j]
        foreach ($char in $l.ToCharArray()) {
          if ($char -eq '{') { $depth++ }
          elseif ($char -eq '}') { $depth-- }
        }
        if ($depth -le 0 -and $j -gt $i) {
          # Fim do bloco encontrado
          Write-Host "Removendo $ch (linhas $($i+1)-$($j+1))"
          $i = $j + 1
          $removedCount++
          $foundEnd = $true
          $matched = $true
          break
        }
        $j++
      }
      if (-not $foundEnd) {
        Write-Host "AVISO: nao encontrou fim do handler $ch"
      }
      break
    }
  }

  if (-not $matched) {
    $output.Add($line)
    $i++
  }
}

Write-Host "Total handlers removidos: $removedCount"
Write-Host "Linhas antes: $totalLines | Linhas depois: $($output.Count)"

# Remover funcao normalizePhone que foi para servicos.js
$content = $output -join "`r`n"

# Remover a primeira ocorrencia de ensureArRecurrences (duplicata no topo do arquivo - antes das funcoes auxiliares)
# A funcao comeca com "function ensureArRecurrences" e termina com o "}" de fechamento
$firstIdx = $content.IndexOf("function ensureArRecurrences(maxDate)")
if ($firstIdx -ge 0) {
  $secondIdx = $content.IndexOf("function ensureArRecurrences(maxDate)", $firstIdx + 1)
  if ($secondIdx -ge 0) {
    Write-Host "Removendo primeira ocorrencia duplicada de ensureArRecurrences"
    # Encontrar o bloco da funcao usando as linhas
    $beforeFirst = $content.Substring(0, $firstIdx)
    $fromFirst = $content.Substring($firstIdx)
    # Encontrar o fim da primeira funcao - procura pela proxima funcao de nivel top
    $endPattern = "`r`nfunction "
    $endIdx = $fromFirst.IndexOf($endPattern, 10)  # ignora o inicio
    if ($endIdx -gt 0) {
      $toRemove = $fromFirst.Substring(0, $endIdx)
      $after = $fromFirst.Substring($endIdx)
      $content = $beforeFirst + $after
      Write-Host "Primeira ensureArRecurrences removida ($($toRemove.Length) chars)"
    }
  } else {
    Write-Host "Apenas uma ocorrencia de ensureArRecurrences - nao removendo"
  }
}

# Remover funcao normalizePhone
$normPhoneIdx = $content.IndexOf("function normalizePhone(raw)")
if ($normPhoneIdx -ge 0) {
  $beforeNP = $content.Substring(0, $normPhoneIdx)
  $fromNP = $content.Substring($normPhoneIdx)
  $endNP = $fromNP.IndexOf("`r`nfunction ", 10)
  if ($endNP -le 0) { $endNP = $fromNP.IndexOf("`r`nipcMain", 10) }
  if ($endNP -gt 0) {
    $content = $beforeNP + $fromNP.Substring($endNP)
    Write-Host "normalizePhone removida"
  }
}

# Limpar linhas em branco excessivas
$content = $content -replace "(\r\n){3,}", "`r`n`r`n"

Set-Content $f -Value $content -Encoding UTF8 -NoNewline
Write-Host "Concluido"
