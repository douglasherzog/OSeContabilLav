---
description: Provisionar prod.db a partir do servidor Hetzner (lavanderia-site)
---

1. Defina variáveis (PowerShell)
   $SSH_DIR = Join-Path $env:USERPROFILE '.ssh'
   $KEY = "$SSH_DIR\hetzner_ed25519"
   $USR = 'root'
   $SRV = '46.62.225.96'
   $PORT = 22

2. (Primeira vez) Instale a chave pública no servidor
   ssh -p $PORT -o StrictHostKeyChecking=no "$USR@$SRV" "mkdir -p ~/.ssh && chmod 700 ~/.ssh"
   scp -P $PORT -o StrictHostKeyChecking=no "$SSH_DIR\hetzner_ed25519.pub" "$($USR)@$($SRV):/root/.ssh/hetzner_ed25519.pub"
   ssh -p $PORT -o StrictHostKeyChecking=no "$USR@$SRV" "cat ~/.ssh/hetzner_ed25519.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
   ssh -p $PORT -i "$KEY" "$USR@$SRV" "echo OK"

3. Gerar CSVs no servidor (docker compose/psql) e baixar
   scp -i "$KEY" .\scripts\remote-export.sh "$USR@$SRV:/root/remote-export.sh"
   ssh -i "$KEY" "$USR@$SRV" "chmod +x /root/remote-export.sh && bash /root/remote-export.sh"
   if (!(Test-Path .\exports)) { New-Item -ItemType Directory -Path .\exports -Force | Out-Null }
   scp -i "$KEY" "$USR@$SRV:/tmp/exports_ose/*.csv" .\exports\

4. Construir o SQLite
   npm run build:proddb

5. Publicar no app instalado (ambos possíveis caminhos)
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

6. Reabra a aplicação e ajuste filtros de data/status para validar dados.
