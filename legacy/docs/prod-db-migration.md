---
# Production DB Migration Playbook (Hetzner ➜ OSeContabilLav/SQLite)

This document describes the end‑to‑end procedure to export production data from the Hetzner server (lavanderia‑site), build a local SQLite production database (prod.db), and deploy it to the installed app.

## 1) Prerequisites
- Windows 10/11 with PowerShell.
- OpenSSH client (builtin on recent Windows).
- Node.js + npm (project already includes scripts).
- Access to Hetzner server (root@46.62.225.96) and Docker Compose.
- Optional: Antivirus exceptions for the app folders to avoid false positives (AVG):
  - %LOCALAPPDATA%\Programs\OS e Contabil - Lav\
  - %APPDATA%\OSeContabilLav\
  - Project portable: <repo>\dist-electron\win-unpacked\

## 2) SSH key (first time only)
```
# PowerShell
$SSH_DIR = Join-Path $env:USERPROFILE '.ssh'
New-Item -ItemType Directory -Path $SSH_DIR -Force | Out-Null
ssh-keygen -t ed25519 -f "$SSH_DIR\hetzner_ed25519" -C "lavanderia-hetzner"
# opcional: ssh-agent não é necessário, usaremos -i
```

## 3) Install public key on server (one-time)
```
# Variables to avoid PowerShell reserved names
$USR='root'; $SRV='46.62.225.96'; $PORT=22
$PUB = "$env:USERPROFILE\.ssh\hetzner_ed25519.pub"

ssh -p $PORT -o StrictHostKeyChecking=no "$USR@$SRV" "mkdir -p ~/.ssh && chmod 700 ~/.ssh"
# Note the $() to avoid parsing issues with ':' in PowerShell
scp -P $PORT -o StrictHostKeyChecking=no "$PUB" "$($USR)@$($SRV):/root/.ssh/hetzner_ed25519.pub"
ssh -p $PORT -o StrictHostKeyChecking=no "$($USR)@$($SRV)" "cat ~/.ssh/hetzner_ed25519.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# Test passwordless
ssh -p $PORT -i "$env:USERPROFILE\.ssh\hetzner_ed25519" "$($USR)@$($SRV)" "echo OK"
```

## 4) Export production data (recommended method)
We use a remote script that runs psql inside the Docker Compose stack and writes CSV files to /tmp/exports_ose on the server.

- Script is versioned at scripts/remote-export.sh
- Upload + run + download:
```
# Variables
$KEY = "$env:USERPROFILE\.ssh\hetzner_ed25519"
$USR='root'; $SRV='46.62.225.96'

# Upload and run remotely
scp -i "$KEY" .\scripts\remote-export.sh "$USR@$SRV:/root/remote-export.sh"
ssh -i "$KEY" "$USR@$SRV" "chmod +x /root/remote-export.sh && bash /root/remote-export.sh"

# Download CSVs to local ./exports
if (!(Test-Path .\exports)) { New-Item -ItemType Directory -Path .\exports -Force | Out-Null }
scp -i "$KEY" "$USR@$SRV:/tmp/exports_ose/*.csv" .\exports\
```

Generated CSVs (headers tailored for our importer):
- clientes.csv
- servicos.csv
- os.csv
- caixa.csv
- ap.csv
- ar.csv

## 5) Build SQLite prod.db
The builder autodetects "," or ";" as delimiter and supports quoted fields. It coerces undefined values to safe defaults.
```
npm run build:proddb
# Output: ./prod.db
```

## 6) Deploy to installed app
The Electron app stores DB in app.getPath('userData') as osecontabil.db.
Common locations (one of these will be used by your build):
- %APPDATA%\OS e Contabil - Lav\osecontabil.db
- %APPDATA%\OSeContabilLav\osecontabil.db

Deployment steps:
```
$src = Join-Path $PWD 'prod.db'
$dst1 = Join-Path $env:APPDATA 'OS e Contabil - Lav/osecontabil.db'
$dst2 = Join-Path $env:APPDATA 'OSeContabilLav/osecontabil.db'
foreach ($dst in @($dst1,$dst2)) {
  $dir = Split-Path $dst -Parent
  if (Test-Path $dir) {
    if (Test-Path $dst) { $stamp = Get-Date -Format 'yyyyMMddHHmmss'; Copy-Item $dst "$dst.backup.$stamp" -Force }
    Copy-Item $src $dst -Force
  }
}
```
Restart the app after replacement.

## 7) Quick full pipeline (after first-time key install)
```
# Configure variables only if needed
$env:HETZNER_SSH      = 'root@46.62.225.96'
$env:HETZNER_SSH_KEY  = "$env:USERPROFILE\.ssh\hetzner_ed25519"
# Optional if not 22
# $env:HETZNER_SSH_PORT = '22'
# $env:HETZNER_PROJECT  = '/opt/lavanderia-site'

# Recommended: use remote-export.sh (section 4), then
npm run build:proddb
# Then deploy (section 6)
```

## 8) Validations
Counts in SQLite from Node using sql.js:
```
# Example (PowerShell):
$DB = Join-Path $env:APPDATA 'OS e Contabil - Lav/osecontabil.db'
node -e "const fs=require('fs');const p=require('path');(async()=>{const init=require('sql.js');const SQL=await init({locateFile:()=>p.join(p.dirname(require.resolve('sql.js')),'sql-wasm.wasm')});const db=new SQL.Database(fs.readFileSync(process.argv[1]));const tabs=['clients','services','service_orders','cash_ledger','accounts_payable','accounts_receivable'];for(const t of tabs){console.log(t, db.exec('SELECT COUNT(*) AS c FROM '+t)[0].values[0][0])}})();" "$DB"
```

## 9) Troubleshooting
- PowerShell path: always use $env:USERPROFILE \.ssh with a backslash, or Join-Path.
- scp with colon: in PowerShell, write "$($USR)@$($SRV):/path" to avoid $SRV: being parsed as a drive.
- ssh-agent errors: run PowerShell as Admin or skip agent; use -i with your key.
- Antivirus (AVG): add exceptions; otherwise the .exe may be removed/quarantined.
- Empty UI after import: clear filters and set wide date ranges. Ensure DB copied to the correct userData path. Rebuild prod.db if CSVs changed.
- Encoding: our importer handles quoted fields and both , and ; delimiters.

## 10) Extending scope (optional)
You can also export and import OS items and OS payments:
- staff_service_order_item ➜ os_items.csv (order_id, service_id, quantity, unit_price)
- staff_service_order_payment ➜ os_payments.csv (order_id, amount, method, when_type, payment_date, note, created_at)
Then, extend build-prod-db-from-csv.js to parse and insert into os_items/os_payments and to recompute paid/payment_status per OS.

---
