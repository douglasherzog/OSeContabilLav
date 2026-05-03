import React, { useState } from 'react';
import { Upload, CheckCircle, XCircle, Info, HardDrive, Trash2 } from 'lucide-react';
import { useToastCtx } from '../ToastContext';

const MODULES = [
  { key: 'os', label: 'Ordens de Serviço', cols: 'number, title, status, total, payment_status, note, created_at' },
  { key: 'caixa', label: 'Controle de Caixa', cols: 'occurred_at, amount, method, account_label, category, description, source_type' },
  { key: 'ap', label: 'Contas a Pagar', cols: 'description, category, amount, due_date, status, note' },
  { key: 'ar', label: 'Contas a Receber', cols: 'description, category, amount, due_date, status, note' },
];

export default function Importar() {
  const toast = useToastCtx();
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [dbPath, setDbPath] = useState('');
  const [cleanupLoading, setCleanupLoading] = useState(false);

  async function handleCleanup() {
    if (!confirm('Isso removerá contas duplicadas (mesma descrição, valor, data e status).\nDeseja continuar?')) return;
    setCleanupLoading(true);
    try {
      const result = await window.api.db.cleanupDuplicates();
      if (result.ok) {
        const total = result.apDeleted + result.arDeleted;
        toast.success(`${total} duplicata(s) removida(s)!\nContas a Pagar: ${result.apDeleted}\nContas a Receber: ${result.arDeleted}`);
      }
    } catch { toast.error('Erro ao limpar duplicatas.'); }
    finally { setCleanupLoading(false); }
  }

  async function handleImport(table) {
    setLoading(table);
    try {
      const result = await window.api.import.csv(table);
      setResults(r => ({ ...r, [table]: result }));
      if (result.ok) toast.success(`${result.count} registro(s) importado(s)!`);
      else toast.error(result.message || 'Erro na importação.');
    } finally { setLoading(null); }
  }

  async function handleBackup() {
    setBackupLoading(true);
    try {
      const result = await window.api.db.backup();
      if (result.ok) toast.success(`Backup salvo em: ${result.path}`);
    } catch { toast.error('Erro ao realizar backup.'); }
    finally { setBackupLoading(false); }
  }

  async function loadDbPath() {
    const p = await window.api.db.path();
    setDbPath(p);
  }

  return (
    <div className="p-4 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-800 mb-2">Importar Dados</h1>
      <p className="text-sm text-gray-500 mb-6">Importe dados do sistema web exportando como CSV. O separador deve ser <code className="bg-gray-100 px-1 rounded">;</code> (ponto e vírgula).</p>

      <div className="space-y-3">
        {MODULES.map(m => (
          <div key={m.key} className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-800">{m.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">Colunas esperadas: <code>{m.cols}</code></div>
              </div>
              <button
                onClick={() => handleImport(m.key)}
                disabled={loading === m.key}
                className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                <Upload size={14} />
                {loading === m.key ? 'Importando...' : 'Escolher CSV'}
              </button>
            </div>
            {results[m.key] && (
              <div className={`flex items-center gap-2 mt-3 text-sm ${results[m.key].ok ? 'text-green-600' : 'text-red-500'}`}>
                {results[m.key].ok
                  ? <><CheckCircle size={15} /> {results[m.key].count} registro(s) importado(s).</>
                  : <><XCircle size={15} /> {results[m.key].message}</>
                }
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 bg-blue-50 rounded-xl border border-blue-100 p-4">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-700">
            <div className="font-medium mb-1">Como exportar do sistema web:</div>
            <ol className="list-decimal list-inside space-y-1 text-blue-600">
              <li>No servidor, acesse o banco de dados</li>
              <li>Execute os scripts Python em <code className="bg-blue-100 px-1 rounded">lavanderia-site/scripts/export_*.py</code></li>
              <li>Os arquivos CSV serão gerados na pasta <code className="bg-blue-100 px-1 rounded">exports/</code></li>
              <li>Use o botão acima para importar cada CSV</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-800 flex items-center gap-2"><HardDrive size={16} className="text-gray-500" /> Backup do Banco de Dados</div>
            <div className="text-xs text-gray-400 mt-0.5">Salva uma cópia do arquivo .db em local de sua escolha</div>
          </div>
          <button
            onClick={handleBackup}
            disabled={backupLoading}
            className="flex items-center gap-1.5 bg-slate-700 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            <HardDrive size={14} />
            {backupLoading ? 'Salvando...' : 'Fazer Backup'}
          </button>
        </div>
      </div>

      <div className="mt-3 bg-orange-50 rounded-xl border border-orange-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-800 flex items-center gap-2"><Trash2 size={16} className="text-orange-500" /> Limpar Duplicatas</div>
            <div className="text-xs text-gray-500 mt-0.5">Remove contas duplicadas (mesma descrição, valor, data e status)</div>
          </div>
          <button
            onClick={handleCleanup}
            disabled={cleanupLoading}
            className="flex items-center gap-1.5 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50"
          >
            <Trash2 size={14} />
            {cleanupLoading ? 'Limpando...' : 'Limpar Duplicatas'}
          </button>
        </div>
      </div>

      <div className="mt-4">
        <button onClick={loadDbPath} className="text-xs text-gray-400 hover:text-gray-600 underline">Ver caminho do banco local</button>
        {dbPath && <div className="text-xs text-gray-500 mt-1 font-mono bg-gray-100 px-2 py-1 rounded">{dbPath}</div>}
      </div>
    </div>
  );
}
