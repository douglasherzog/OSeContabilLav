const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SSH_HOST = process.env.HETZNER_SSH || 'root@46.62.225.96';
const SSH_KEY = process.env.HETZNER_SSH_KEY || '';
const SSH_PORT = process.env.HETZNER_SSH_PORT || '';
const PROJECT_DIR = process.env.HETZNER_PROJECT || '/opt/lavanderia-site';

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf-8', ...opts });
  if (res.error) throw res.error;
  return { code: res.status, out: res.stdout, err: res.stderr };
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function main() {
  console.log('[1/4] Executando export no servidor via SSH...');
  const remoteCmd = [
    'bash', '-lc', `set -euo pipefail; cd ${PROJECT_DIR}; \
if compgen -G "scripts/export_*.py" > /dev/null; then \
  echo "[srv] Encontrados scripts export_*.py"; \
  for f in scripts/export_*.py; do echo "[srv] Rodando $f"; python3 "$f" || true; done; \
else \
  echo "[srv] NENHUM script export_*.py encontrado"; \
fi; \
mkdir -p exports; ls -l exports; \
rm -rf /tmp/exports_ose && mkdir -p /tmp/exports_ose; \
cp -a exports/. /tmp/exports_ose/ || true; \
ls -l /tmp/exports_ose || true; \
`]
  const sshArgs = [];
  if (SSH_KEY) sshArgs.push('-i', SSH_KEY);
  if (SSH_PORT) sshArgs.push('-p', SSH_PORT);
  sshArgs.push('-o','StrictHostKeyChecking=no', SSH_HOST, ...remoteCmd);
  const ssh1 = sh('ssh', sshArgs);
  if (ssh1.code !== 0) {
    console.error(ssh1.err || ssh1.out);
    if ((ssh1.err||ssh1.out||'').toLowerCase().includes('password')) {
      console.error('\nDica: configure uma chave SSH e defina HETZNER_SSH_KEY (e opcionalmente HETZNER_SSH_PORT) para conexão sem senha.');
    }
    process.exit(1);
  }
  console.log(ssh1.out);

  console.log('[2/4] Baixando CSVs via SCP...');
  const localTmp = path.join(process.cwd(), 'exports_remote');
  if (fs.existsSync(localTmp)) fs.rmSync(localTmp, { recursive: true, force: true });
  ensureDir(localTmp);
  const scpArgs = [];
  if (SSH_KEY) scpArgs.push('-i', SSH_KEY);
  if (SSH_PORT) scpArgs.push('-P', SSH_PORT);
  scpArgs.push('-o','StrictHostKeyChecking=no','-r', `${SSH_HOST}:/tmp/exports_ose/*`, localTmp + path.sep);
  const scp = sh('scp', scpArgs);
  if (scp.code !== 0) { console.error(scp.err || scp.out); process.exit(1); }

  console.log('[3/4] Movendo CSVs para ./exports');
  const finalDir = path.join(process.cwd(), 'exports');
  ensureDir(finalDir);
  for (const f of fs.readdirSync(localTmp)) {
    const src = path.join(localTmp, f);
    const dst = path.join(finalDir, f);
    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
    fs.renameSync(src, dst);
  }
  fs.rmSync(localTmp, { recursive: true, force: true });
  console.log('   OK');

  console.log('[4/4] Arquivos disponíveis em ./exports');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e?.message || e); process.exit(1); }
}
