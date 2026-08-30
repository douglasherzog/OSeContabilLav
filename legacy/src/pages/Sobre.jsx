import React, { useEffect, useState } from 'react';
import { Info, RefreshCw, FileText, Download, CheckCircle, AlertCircle } from 'lucide-react';

export default function Sobre() {
  const [version, setVersion] = useState('...');
  const [updateStatus, setUpdateStatus] = useState(null);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    window.api.appInfo.version().then(setVersion).catch(() => setVersion('—'));

    if (window.api.appInfo.onUpdateAvailable) {
      window.api.appInfo.onUpdateAvailable((info) =>
        setUpdateStatus({ type: 'available', version: info.version })
      );
      window.api.appInfo.onUpdateDownloaded((info) =>
        setUpdateStatus({ type: 'downloaded', version: info.version })
      );
      window.api.appInfo.onUpdateError((msg) =>
        setUpdateStatus({ type: 'error', message: msg })
      );
      window.api.appInfo.onUpdateProgress((p) =>
        setProgress(Math.round(p.percent || 0))
      );
    }
  }, []);

  async function handleCheckUpdate() {
    setUpdateStatus({ type: 'checking' });
    setProgress(null);
    const res = await window.api.appInfo.checkUpdate().catch(() => ({ status: 'error' }));
    if (res?.status === 'dev') setUpdateStatus({ type: 'dev' });
    else if (res?.status === 'error') setUpdateStatus({ type: 'error', message: res.message });
  }

  async function handleInstall() {
    setUpdateStatus({ type: 'downloading' });
    await window.api.appInfo.installUpdate().catch(() => {});
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Info size={20} className="text-blue-500" />
        <h1 className="text-xl font-bold text-gray-800">Sobre o Sistema</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-gray-800 text-lg">OS e Contabil — Lavanderia</div>
            <div className="text-sm text-gray-500">Lavanderia Senhor dos Passos</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">Versão</div>
            <div className="font-mono font-bold text-blue-600 text-lg">v{version}</div>
          </div>
        </div>

        <div className="border-t pt-4 space-y-2 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <span className="w-28 text-gray-400">Banco de dados</span>
            <span>SQLite (better-sqlite3)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 text-gray-400">Interface</span>
            <span>React 18 + Tailwind CSS</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 text-gray-400">Plataforma</span>
            <span>Electron (Windows)</span>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="text-sm font-medium text-gray-700 mb-3">Atualização</div>

          {updateStatus?.type === 'dev' && (
            <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <Info size={15} /> Modo desenvolvimento — atualizações desativadas.
            </div>
          )}
          {updateStatus?.type === 'checking' && (
            <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
              <RefreshCw size={15} className="animate-spin" /> Verificando atualizações...
            </div>
          )}
          {updateStatus?.type === 'available' && (
            <div className="flex items-center justify-between text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <span className="text-blue-700 flex items-center gap-2">
                <Download size={15} /> Versão {updateStatus.version} disponível
              </span>
              <button onClick={handleInstall} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">
                Baixar
              </button>
            </div>
          )}
          {(updateStatus?.type === 'downloading' || progress !== null) && (
            <div className="text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                <Download size={15} className="animate-bounce" /> Baixando...
              </div>
              {progress !== null && (
                <div className="w-full bg-blue-200 rounded-full h-1.5">
                  <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          )}
          {updateStatus?.type === 'downloaded' && (
            <div className="flex items-center justify-between text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <span className="text-green-700 flex items-center gap-2">
                <CheckCircle size={15} /> Versão {updateStatus.version} pronta — reinicie para instalar.
              </span>
            </div>
          )}
          {updateStatus?.type === 'error' && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={15} /> {updateStatus.message || 'Erro ao verificar atualização.'}
            </div>
          )}
          {!updateStatus && (
            <div className="text-sm text-gray-500">Nenhuma verificação feita ainda.</div>
          )}

          <div className="flex gap-2 mt-3">
            <button onClick={handleCheckUpdate} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50">
              <RefreshCw size={14} /> Verificar atualizações
            </button>
            <button onClick={() => window.api.appInfo.openLogs()} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50">
              <FileText size={14} /> Abrir logs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
