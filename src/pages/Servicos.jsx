import React, { useEffect, useState, useCallback } from 'react';
import { useModalFocus } from '../useModalFocus';
import Modal from '../components/Modal';
import { Plus, Pencil, Trash2, Search, ToggleLeft, ToggleRight } from 'lucide-react';
import { brl, exportCSV, today } from '../utils';
import { useToastCtx } from '../ToastContext';
import { Download } from 'lucide-react';

const UNITS = ['un', 'peça', 'kg', 'm2', 'lugar', 'par', 'jogo', 'metro', 'km', 'hora'];
const emptyForm = { name: '', description: '', category: 'geral', unit_price: '', unit: 'un', active: true, requires_entry: false, entry_pct: '50' };

export default function Servicos() {
  const toast = useToastCtx();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const firstInputRef = useModalFocus(showForm);

  const load = useCallback(async () => {
    setLoading(true);
    try { setServices(await window.api.services.list(showInactive) || []); }
    finally { setLoading(false); }
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  const filtered = services.filter(s =>
    !q || s.name.toLowerCase().includes(q.toLowerCase()) || (s.description || '').toLowerCase().includes(q.toLowerCase())
  );

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!form.name?.trim()) { toast.error('Informe o nome do serviço.'); return; }
    try {
      const payload = { ...form, unit_price: parseFloat(form.unit_price) || 0, active: form.active ? 1 : 0, requires_entry: form.requires_entry ? 1 : 0, entry_pct: parseFloat(form.entry_pct) || 50 };
      if (editing) {
        await window.api.services.update({ id: editing, ...payload });
        toast.success('Serviço atualizado!');
      } else {
        await window.api.services.create(payload);
        toast.success('Serviço cadastrado!');
      }
      setForm(emptyForm); setShowForm(false); setEditing(null); load();
    } catch { toast.error('Erro ao salvar serviço.'); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Excluir serviço "${name}"?`)) return;
    try {
      await window.api.services.delete(id);
      toast.success('Serviço excluído.');
      load();
    } catch { toast.error('Erro ao excluir.'); }
  }

  async function toggleActive(s) {
    try {
      await window.api.services.update({ ...s, active: s.active ? 0 : 1 });
      load();
    } catch { toast.error('Erro ao alterar status.'); }
  }

  function startEdit(s) {
    const price = s.unit_price != null ? parseFloat(s.unit_price.toFixed(2)) : '';
    const unit = s.unit === 'peca' ? 'peça' : (s.unit || 'un');
    setForm({ name: s.name ?? '', description: s.description ?? '', category: s.category || 'geral', unit_price: price === '' ? '' : String(price), unit, active: !!s.active, requires_entry: !!s.requires_entry, entry_pct: s.entry_pct != null ? String(s.entry_pct) : '50' });
    setEditing(s.id);
    setShowForm(true);
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">Catálogo de Serviços</h1>
        <div className="flex gap-2">
          <button
            onClick={() => exportCSV(services, `Servicos_${today()}.csv`)}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50"
            disabled={services.length === 0}
          >
            <Download size={15} /> Exportar
          </button>
          <button
            onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(true); }}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700"
          >
            <Plus size={15} /> Novo Serviço
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1 border rounded-lg px-2 py-1.5 text-sm flex-1 min-w-[180px]">
          <Search size={14} className="text-gray-400" />
          <input className="outline-none flex-1" placeholder="Buscar serviço..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button
          type="button"
          onClick={() => setShowInactive(v => !v)}
          className={`flex items-center gap-2 text-sm cursor-pointer select-none px-2 py-1.5 rounded-lg border transition-colors ${
            showInactive ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          {showInactive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          Mostrar inativos
        </button>
      </div>

      {/* Resumo */}
      <div className="bg-white rounded-xl border p-3 mb-4 text-sm text-gray-500">
        {filtered.length} serviço(s)
      </div>

      {/* Lista plana */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Nenhum serviço cadastrado.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b text-xs bg-gray-50">
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">Descrição</th>
                <th className="px-4 py-2 font-medium">Unid.</th>
                <th className="px-4 py-2 font-medium text-center">Entrada</th>
                <th className="px-4 py-2 font-medium text-right">Preço padrão</th>
                <th className="px-4 py-2 font-medium text-center">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className={`border-b last:border-0 group transition-colors hover:bg-gray-50 ${!s.active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{s.name}</td>
                  <td className="px-4 py-2.5 text-gray-500 max-w-[240px] truncate">{s.description || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{s.unit || 'un'}</td>
                  <td className="px-4 py-2.5 text-center">
                    {s.requires_entry
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">{s.entry_pct}%</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-800">
                    {s.unit_price > 0 ? `R$ ${brl(s.unit_price)}` : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => toggleActive(s)} title={s.active ? 'Desativar' : 'Ativar'} className="inline-flex">
                      {s.active
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Ativo</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">Inativo</span>
                      }
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEdit(s)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={13} /></button>
                      <button onClick={() => handleDelete(s.id, s.name)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={`${editing ? 'Editar' : 'Novo'} Serviço`}
        maxWidth="max-w-md"
        footer={
          <>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
            <button type="button" onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Salvar</button>
          </>
        }
      >
        <input
          ref={firstInputRef}
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="Nome do serviço *"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        />
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="Descrição (opcional)"
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
        <select
          className="w-full border rounded-lg px-3 py-2 text-sm"
          value={form.unit}
          onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
        >
          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <input
          type="number"
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="Preço padrão (R$)"
          value={form.unit_price}
          onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))}
          step="0.01"
          min="0"
        />
        <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer font-medium">
            <input type="checkbox" checked={!!form.requires_entry} onChange={e => setForm(f => ({ ...f, requires_entry: e.target.checked }))} />
            Exige entrada obrigatória
          </label>
          {form.requires_entry && (
            <div className="flex items-center gap-2 pl-5">
              <label className="text-sm text-gray-600">Percentual de entrada:</label>
              <input
                type="number" min="1" max="100" step="1"
                className="w-20 border rounded-lg px-2 py-1 text-sm text-center"
                value={form.entry_pct}
                onChange={e => setForm(f => ({ ...f, entry_pct: e.target.value }))}
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          )}
        </div>
        {editing && (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={!!form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            Serviço ativo
          </label>
        )}
      </Modal>
    </div>
  );
}
