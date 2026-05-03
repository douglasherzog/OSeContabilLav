import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../useModalFocus';
import { Plus, RefreshCw, Pencil, Trash2, CheckCircle, XCircle, Download, Settings2 } from 'lucide-react';
import { brl, fmtDate, today, exportCSV } from '../utils';
import { useToastCtx } from '../ToastContext';

const emptyForm = { description: '', category: 'geral', amount: '', due_date: '', note: '' };
const RESERVED_CATS = ['contas'];

export default function ContasReceber() {
  const toast = useToastCtx();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ status: 'pendente', date_from: '', date_to: '' });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [receiveModal, setReceiveModal] = useState(null);
  const [receiveForm, setReceiveForm] = useState({ received_at: today(), method: 'pix', account_label: '' });
  const [categories, setCategories] = useState([]);
  const [showCategories, setShowCategories] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const firstInputRef = useModalFocus(showForm);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await window.api.ar.list(filters) || []); }
    finally { setLoading(false); }
  }, [filters]);

  const loadCategories = useCallback(async () => {
    try { setCategories(await window.api.ar.categories.list() || []); }
    catch { }
  }, []);

  useEffect(() => { load(); loadCategories(); }, [load, loadCategories]);

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const todayStr = today();

  function isOverdue(r) {
    return r.status === 'pendente' && r.due_date && r.due_date < todayStr;
  }

  async function handleSubmit() {
    if (!form.description?.trim()) { toast.error('Informe a descrição.'); return; }
    const payload = { ...form, amount: parseFloat(form.amount) || 0 };
    try {
      if (editing) { await window.api.ar.update({ id: editing, ...payload, status: 'pendente' }); setEditing(null); toast.success('Conta atualizada!'); }
      else { await window.api.ar.create(payload); toast.success('Conta criada!'); }
      setForm(emptyForm); setShowForm(false); load();
    } catch { toast.error('Erro ao salvar conta.'); }
  }

  async function handleReceive() {
    try {
      const payload = { 
        id: receiveModal.id,
        description: receiveModal.description,
        category: receiveModal.category,
        amount: receiveModal.amount,
        due_date: receiveModal.due_date,
        note: receiveModal.note,
        status: 'recebida',
        received_at: receiveForm.received_at,
        method: receiveForm.method,
        account_label: receiveForm.account_label
      };
      await window.api.ar.update(payload);
      toast.success('Conta marcada como recebida!');
    } catch (e) { 
      toast.error('Erro ao registrar recebimento: ' + e.message);
    }
    setReceiveModal(null); load();
  }

  async function handleUnreceive(r) {
    await window.api.ar.update({ ...r, status: 'pendente', received_at: null, method: null });
    load();
  }

  async function handleDelete(id) {
    if (!confirm('Excluir conta?')) return;
    try { await window.api.ar.delete(id); toast.success('Conta excluída.'); load(); }
    catch { toast.error('Erro ao excluir.'); }
  }

  async function handleAddCategory() {
    const name = newCategory.trim().toLowerCase().replace(/\s+/g, '_');
    if (!name) { toast.error('Informe um nome.'); return; }
    if (RESERVED_CATS.includes(name)) { toast.error('Nome reservado.'); return; }
    try {
      const res = await window.api.ar.categories.create(name);
      if (res?.ok) { toast.success('Categoria criada!'); setNewCategory(''); loadCategories(); }
      else { toast.error(res?.error || 'Erro ao criar categoria.'); }
    } catch { toast.error('Erro ao criar categoria.'); }
  }

  async function handleDeleteCategory(name) {
    if (!confirm(`Remover categoria "${name}"?`)) return;
    try { await window.api.ar.categories.delete(name); toast.success('Categoria removida.'); loadCategories(); }
    catch { toast.error('Erro ao remover categoria.'); }
  }

  function startEdit(r) {
    setForm({ description: r.description, category: r.category || 'geral', amount: String(r.amount || ''), due_date: r.due_date || '', note: r.note || '' });
    setEditing(r.id); setShowForm(true);
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">Contas a Receber</h1>
        <div className="flex gap-2">
          <button onClick={() => exportCSV(rows, `ContasReceber_${today()}.csv`)} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50" disabled={rows.length === 0}>
            <Download size={15} /> Exportar
          </button>
          <button onClick={() => setShowCategories(true)} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50">
            <Settings2 size={15} /> Categorias
          </button>
          <button onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(true); }} className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700">
            <Plus size={15} /> Nova Conta
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-3 mb-4 flex items-center justify-between">
        <div className="text-sm text-gray-500">{rows.length} conta(s)</div>
        <div className="font-bold text-gray-800">Total: R$ {brl(total)}</div>
      </div>

      <div className="bg-white rounded-xl border p-3 mb-4 flex flex-wrap gap-2 items-end">
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="pendente">Pendentes</option>
          <option value="recebida">Recebidas</option>
          <option value="">Todas</option>
        </select>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-gray-500">De</span>
          <input type="date" className="border rounded-lg px-2 py-1.5" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} />
          <span className="text-gray-500">Até</span>
          <input type="date" className="border rounded-lg px-2 py-1.5" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} />
        </div>
        <button onClick={load} className="flex items-center gap-1 border rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50"><RefreshCw size={14} /> Filtrar</button>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>{['Descrição', 'Categoria', 'Vencimento', 'Status', 'Valor', ''].map(h => (
              <th key={h} className="text-left px-3 py-2.5 font-medium text-gray-600">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Carregando...</td></tr>
              : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Nenhuma conta.</td></tr>
              : rows.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.description}</div>
                    {r.note && <div className="text-xs text-gray-400">{r.note}</div>}
                  </td>
                  <td className="px-3 py-2.5"><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{r.category}</code></td>
                  <td className="px-3 py-2.5">{r.due_date ? fmtDate(r.due_date) : '-'}</td>
                  <td className="px-3 py-2.5">
                    {r.status === 'recebida'
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">recebida</span>
                      : isOverdue(r)
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">atrasada</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">pendente</span>
                    }
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-green-600">R$ {brl(r.amount)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 justify-end">
                      {r.status !== 'recebida'
                        ? <button onClick={() => { setReceiveModal(r); setReceiveForm({ received_at: today(), method: 'pix', account_label: '' }); }} className="p-1 text-gray-400 hover:text-green-600" title="Marcar como recebida"><CheckCircle size={15} /></button>
                        : <button onClick={() => handleUnreceive(r)} className="p-1 text-gray-400 hover:text-yellow-600" title="Reabrir"><XCircle size={15} /></button>
                      }
                      <button onClick={() => startEdit(r)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={13} /></button>
                      <button onClick={() => handleDelete(r.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {showForm && createPortal(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">{editing ? 'Editar' : 'Nova'} Conta a Receber</h2>
            <div className="space-y-3">
              <input ref={firstInputRef} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Descrição *" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              <div className="flex gap-2">
                <select className="flex-1 border rounded-lg px-3 py-2 text-sm" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="geral">geral</option>
                  {categories.filter(c => c !== 'geral').map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <input type="number" className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Valor (R$) *" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} step="0.01" min="0.01" required />
              </div>
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Observações" rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 border rounded-lg text-sm">Cancelar</button>
                <button type="button" onClick={handleSubmit} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm">Salvar</button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {receiveModal && createPortal(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold mb-1">Marcar como Recebida</h2>
            <p className="text-sm text-gray-500 mb-4">{receiveModal.description} — R$ {brl(receiveModal.amount)}</p>
            <div className="space-y-3">
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={receiveForm.received_at} onChange={e => setReceiveForm(f => ({ ...f, received_at: e.target.value }))} />
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={receiveForm.method} onChange={e => setReceiveForm(f => ({ ...f, method: e.target.value }))}>
                {['pix', 'dinheiro', 'debito', 'credito', 'transferencia'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setReceiveModal(null)} className="px-4 py-2 border rounded-lg text-sm">Cancelar</button>
                <button type="button" onClick={handleReceive} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm">Confirmar</button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Modal Categorias */}
      {showCategories && createPortal(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Categorias</h2>
              <button onClick={() => setShowCategories(false)} className="text-gray-400 hover:text-gray-600">
                <XCircle size={20} />
              </button>
            </div>
            <div className="flex gap-2 mb-4">
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Nova categoria" value={newCategory} onChange={e => setNewCategory(e.target.value)} />
              <button onClick={handleAddCategory} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm"><Plus size={16} /></button>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {categories.length === 0 ? <div className="text-center text-gray-400 py-4">Nenhuma categoria.</div> :
                categories.map(cat => (
                  <div key={cat} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="text-sm"><code className="bg-gray-100 px-2 py-1 rounded">{cat}</code></span>
                    {!['geral'].includes(cat) && (
                      <button onClick={() => handleDeleteCategory(cat)} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={14} /></button>
                    )}
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
