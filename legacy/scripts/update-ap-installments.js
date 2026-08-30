const fs = require('fs');
const path = require('path');

const targetPath = path.resolve(__dirname, '..', 'electron', 'main.js');
const content = fs.readFileSync(targetPath, 'utf8');

const anchor = 'ipcMain.handle("ap:create", (_, d) => {';
const insertBlock = `ipcMain.handle("ap:create", (_, d) => {\n  if (Array.isArray(d.installments_custom) && d.installments_custom.length > 0) {\n    const created = [];\n    for (const inst of d.installments_custom) {\n      const id = insert(\n        "INSERT INTO accounts_payable (description,category,amount,due_date,note) VALUES (?,?,?,?,?)",\n        [d.description, d.category || "geral", inst.amount || 0, inst.due_date || null, d.note || null]\n      );\n      created.push(id);\n    }\n    return { ok: true, created };\n  }\n`;

if (!content.includes(anchor)) {
  console.error('[patch] Anchor not found. Aborting.');
  process.exit(1);
}
if (content.includes('installments_custom')) {
  console.log('[patch] Patch already applied.');
  process.exit(0);
}

const updated = content.replace(anchor, insertBlock);
fs.writeFileSync(targetPath, updated, 'utf8');
console.log('[patch] Updated:', targetPath);
