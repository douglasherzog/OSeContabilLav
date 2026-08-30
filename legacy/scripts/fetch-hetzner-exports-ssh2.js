const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const SftpClient = require('ssh2-sftp-client');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    host: process.env.HETZNER_HOST || '46.62.225.96',
    user: process.env.HETZNER_USER || 'root',
    port: Number(process.env.HETZNER_PORT || 22),
    password: process.env.HETZNER_SSH_PASSWORD || '',
    key: process.env.HETZNER_SSH_KEY || '',
    projectDir: process.env.HETZNER_PROJECT || '/opt/lavanderia-site',
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--host' || a === '-h') && args[i+1]) { out.host = args[++i]; continue; }
    if ((a === '--user' || a === '-u') && args[i+1]) { out.user = args[++i]; continue; }
    if ((a === '--port' || a === '-p') && args[i+1]) { out.port = Number(args[++i]); continue; }
    if ((a === '--password' || a === '--pass') && args[i+1]) { out.password = args[++i]; continue; }
    if ((a === '--key' || a === '-k') && args[i+1]) { out.key = args[++i]; continue; }
    if ((a === '--project' || a === '--dir') && args[i+1]) { out.projectDir = args[++i]; continue; }
  }
  return out;
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function execRemote(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', (code, signal) => {
        if (code === 0) resolve({ out, errOut, code });
        else reject(new Error(errOut || out || `Remote command failed with code ${code}`));
      }).on('data', (data) => { out += data.toString(); process.stdout.write(data.toString()); })
        .stderr.on('data', (data) => { errOut += data.toString(); process.stderr.write(data.toString()); });
    });
  });
}

async function downloadExportsSftp(cfg) {
  const sftp = new SftpClient();
  const connectCfg = { host: cfg.host, port: cfg.port, username: cfg.user };
  if (cfg.key) connectCfg.privateKey = fs.readFileSync(cfg.key);
  else connectCfg.password = cfg.password;
  await sftp.connect(connectCfg);
  const remoteDir = '/tmp/exports_ose';
  const localTmp = path.join(process.cwd(), 'exports_remote');
  if (fs.existsSync(localTmp)) fs.rmSync(localTmp, { recursive: true, force: true });
  ensureDir(localTmp);
  const list = await sftp.list(remoteDir).catch(() => []);
  for (const item of list) {
    const src = path.posix.join(remoteDir, item.name);
    const dst = path.join(localTmp, item.name);
    await sftp.fastGet(src, dst);
  }
  await sftp.end();
  const finalDir = path.join(process.cwd(), 'exports');
  ensureDir(finalDir);
  for (const f of fs.readdirSync(localTmp)) {
    const src = path.join(localTmp, f);
    const dst = path.join(finalDir, f);
    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
    fs.renameSync(src, dst);
  }
  fs.rmSync(localTmp, { recursive: true, force: true });
}

async function main() {
  const cfg = parseArgs();
  if (!cfg.key && !cfg.password) throw new Error('Forneça --password ou --key para autenticar no SSH.');

  console.log('[1/3] Conectando ao servidor via SSH...');
  const conn = new Client();
  const connectCfg = { host: cfg.host, port: cfg.port, username: cfg.user };
  if (cfg.key) connectCfg.privateKey = fs.readFileSync(cfg.key);
  else connectCfg.password = cfg.password;

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject).connect(connectCfg);
  });

  console.log('[2/3] Executando export e preparando diretório temporário...');
  const remoteCmd = `set -euo pipefail; cd ${cfg.projectDir}; \
if compgen -G "scripts/export_*.py" > /dev/null; then \
  echo "[srv] Encontrados scripts export_*.py"; \
  for f in scripts/export_*.py; do echo "[srv] Rodando $f"; python3 "$f" || true; done; \
else \
  echo "[srv] NENHUM script export_*.py encontrado"; \
fi; \
mkdir -p exports; ls -l exports; \
rm -rf /tmp/exports_ose && mkdir -p /tmp/exports_ose; \
cp -a exports/. /tmp/exports_ose/ || true; \
ls -l /tmp/exports_ose || true;`;
  await execRemote(conn, `bash -lc '${remoteCmd}'`);
  conn.end();

  console.log('[3/3] Baixando CSVs via SFTP e movendo para ./exports ...');
  await downloadExportsSftp(cfg);
  console.log('OK. Arquivos disponíveis em ./exports');
}

if (require.main === module) {
  (async () => {
    try { await main(); }
    catch (e) { console.error(e?.stack || e?.message || e); process.exit(1); }
  })();
}
