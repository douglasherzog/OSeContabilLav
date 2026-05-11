#!/usr/bin/env bash
set -euo pipefail
DC="docker compose -f /opt/lavanderia-site/compose.yaml"
OUT="/tmp/exports_ose"
mkdir -p "$OUT"

# Clientes
$DC exec -T db psql -U lavanderia -d lavanderia -A -F ';' -P footer=off -c "COPY (SELECT name, COALESCE(phone,'') AS phone, (COALESCE(street,'') || CASE WHEN street_number IS NOT NULL AND street_number<>'' THEN ', '||street_number ELSE '' END || CASE WHEN neighborhood IS NOT NULL AND neighborhood<>'' THEN ' - '||neighborhood ELSE '' END) AS address, COALESCE(TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS'),'') AS created_at FROM client ORDER BY id) TO STDOUT WITH CSV HEADER" > "$OUT/clientes.csv"

# Serviços
$DC exec -T db psql -U lavanderia -d lavanderia -A -F ';' -P footer=off -c "COPY (SELECT name, COALESCE(description,'') AS description, 'geral' AS category, COALESCE(price,0) AS unit_price, COALESCE(unit,'un') AS unit, 1 AS active, COALESCE(TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS'),'') AS created_at FROM service ORDER BY id) TO STDOUT WITH CSV HEADER" > "$OUT/servicos.csv"

# Ordens de serviço (OS)
$DC exec -T db psql -U lavanderia -d lavanderia -A -F ';' -P footer=off -c "COPY (SELECT number, COALESCE(title,'') AS title, COALESCE(status,'aberta') AS status, COALESCE(total,0) AS total, COALESCE(payment_status,'em_aberto') AS payment_status, COALESCE(notes,'') AS note, COALESCE(TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS'),'') AS created_at FROM staff_service_order ORDER BY id) TO STDOUT WITH CSV HEADER" > "$OUT/os.csv"

# Caixa
$DC exec -T db psql -U lavanderia -d lavanderia -A -F ';' -P footer=off -c "COPY (SELECT COALESCE(TO_CHAR(occurred_at, 'YYYY-MM-DD\"T\"HH24:MI:SS'),'') AS occurred_at, COALESCE(amount,0) AS amount, COALESCE(method,'') AS method, COALESCE(account_label,'') AS account_label, COALESCE(category,'manual') AS category, COALESCE(description,'') AS description, COALESCE(source_type,'manual') AS source_type FROM cash_ledger_entry ORDER BY id) TO STDOUT WITH CSV HEADER" > "$OUT/caixa.csv"

# Contas a pagar (AP)
$DC exec -T db psql -U lavanderia -d lavanderia -A -F ';' -P footer=off -c "COPY (SELECT COALESCE(description,'') AS description, COALESCE(category,'geral') AS category, COALESCE(amount,0) AS amount, COALESCE(due_date::text,'') AS due_date, COALESCE(status,'pendente') AS status, COALESCE(note,'') AS note FROM accounts_payable ORDER BY id) TO STDOUT WITH CSV HEADER" > "$OUT/ap.csv"

# Contas a receber (AR) a partir de recibos
$DC exec -T db psql -U lavanderia -d lavanderia -A -F ';' -P footer=off -c "COPY (SELECT ('Recibo '||number||'/'||year||' - '||COALESCE(service_description, '')) AS description, 'geral' AS category, COALESCE(service_value,0) AS amount, COALESCE(service_date::text,'') AS due_date, CASE WHEN payment_date IS NOT NULL THEN 'pago' ELSE 'pendente' END AS status, COALESCE(notes,'') AS note FROM receipt ORDER BY id) TO STDOUT WITH CSV HEADER" > "$OUT/ar.csv"

echo "OK: arquivos gerados em $OUT"
