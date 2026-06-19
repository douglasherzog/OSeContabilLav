import React, { useEffect, useState, useCallback } from 'react';
import { useModalFocus } from '../useModalFocus';
import Modal from '../components/Modal';
import { Plus, RefreshCw, Pencil, Trash2, CheckCircle, XCircle, Download, Settings2 } from 'lucide-react';
import { brl, fmtDate, today, exportCSV } from '../utils';
import { useToastCtx } from '../ToastContext';

const emptyForm = { description: '', category: 'geral', amount: '', due_date: '', note: '', recurrence: false, interval_value: 1, interval_unit: 'month', end_date: '', recurrence_type: 'variable', installments_count: '', installments_days: '' };
const RESERVED_CATS = ['contas'];

export default function ContasReceber() {
  const toast = useToastCtx();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ status: 'pendente', date_from: '', date_to: '', recurrence: '' });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [receiveModal, setReceiveModal] = useState(null);
  const [receiveForm, setReceiveForm] = useState({ received_at: today(), method: 'pix', account_label: '' });
  const [categories, setCategories] = useState([]);
  const [showCategories, setShowCategories] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [showNewCategoryInline, setShowNewCategoryInline] = useState(false);
  const [newCategoryInline, setNewCategoryInline] = useState('');
  const firstInputRef = useModalFocus(showForm);
  // Listas padronizadas
  const [methods, setMethods] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showNewMethod, setShowNewMethod] = useState(false);
  const [newMethodName, setNewMethodName] = useState('');
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccountLabel, setNewAccountLabel] = useState('');
  const [recurrenceModal, setRecurrenceModal] = useState(null);

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
  useEffect(() => { window.api.paymentMethods?.list?.().then(r => {
    const list = (r||[]).filter(m => m.active).map(m => ({ value: m.name, label: m.name.charAt(0).toUpperCase()+m.name.slice(1) }));
    setMethods(list);
  }).catch(()=>setMethods([])); }, []);
  useEffect(() => { window.api.bankAccounts?.list?.().then(r => setAccounts(r||[])).catch(()=>setAccounts([])); }, []);

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const todayStr = today();

  function isOverdue(r) {
    return r.status === 'pendente' && r.due_date && r.due_date < todayStr;
  }

  function addMonths(dateStr, months) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return d.toISOString().slice(0, 10);
  }

  function addInterval(dateStr, intervalValue, intervalUnit) {
    const val = Math.max(1, parseInt(intervalValue || 1, 10));
    const unit = (intervalUnit || 'month').toLowerCase();
    if (unit === 'week') return addDays(dateStr, val * 7);
    if (unit === 'day') return addDays(dateStr, val);
    return addMonths(dateStr, val);
  }

  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function handleSubmit() {
    if (!form.description?.trim()) { toast.error('Informe a descrição.'); return; }
    const payload = { ...form, amount: parseFloat(form.amount) || 0 };
    try {
      if (payload.recurrence && payload.recurrence_type === 'installments_custom') {
        if (!payload.due_date) { toast.error('Informe a data base da compra.'); return; }
        const daysList = String(payload.installments_days || '')
          .split(/[;,\s]+/)
          .map(v => parseInt(v, 10))
          .filter(v => Number.isFinite(v) && v >= 0);
        if (daysList.length === 0) { toast.error('Informe os dias das parcelas (ex.: 15,30,45).'); return; }
        const total = parseFloat(payload.amount) || 0;
        const base = Math.floor((total / daysList.length) * 100) / 100;
        const remainder = +(total - base * daysList.length).toFixed(2);
        const installments = daysList.map((days, idx) => ({
          due_date: addDays(payload.due_date, days),
          amount: +(base + (idx === daysList.length - 1 ? remainder : 0)).toFixed(2),
          note: `Parcela ${idx + 1}/${daysList.length} (${days} dias)`
        }));
        payload.installments_custom = installments;
        payload.recurrence = null;
      } else if (payload.recurrence) {
        if (!payload.due_date) { toast.error('Informe a data inicial da recorrência.'); return; }
        const installmentsCount = parseInt(payload.installments_count || 0, 10);
        let endDate = payload.end_date || null;
        if (payload.recurrence_type === 'installments' && installmentsCount > 1) {
          endDate = addInterval(payload.due_date, (installmentsCount - 1) * parseInt(payload.interval_value || 1, 10), payload.interval_unit);
        }
        payload.recurrence = {
          start_date: payload.due_date,
          interval_value: parseInt(payload.interval_value || 1, 10),
          interval_unit: payload.interval_unit || 'month',
          end_date: endDate,
          recurrence_type: payload.recurrence_type || 'variable',
          installments_count: installmentsCount || null,
        };
      } else {
        payload.recurrence = null;
      }
      if (editing) { await window.api.ar.update({ id: editing, ...payload, status: 'pendente' }); setEditing(null); toast.success('Conta atualizada!'); }
      else { await window.api.ar.create(payload); toast.success(payload.recurrence ? 'Recorrência criada!' : 'Conta criada!'); }
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

  async function handleCreateMethod() {
    const name = (newMethodName||'').trim().toLowerCase();
    if (!name) return;
    try {
      await window.api.paymentMethods.create({ name, active: 1 });
      const r = await window.api.paymentMethods.list();
      const list = (r||[]).filter(m => m.active).map(m => ({ value: m.name, label: m.name.charAt(0).toUpperCase()+m.name.slice(1) }));
      setMethods(list);
      setReceiveForm(f => ({ ...f, method: name }));
      setNewMethodName(''); setShowNewMethod(false);
      toast.success('Forma de pagamento adicionada!');
    } catch { toast.error('Erro ao adicionar forma de pagamento.'); }
  }

  async function handleCreateAccount() {
    const label = (newAccountLabel||'').trim();
    if (!label) return;
    try {
      await window.api.bankAccounts.create({ label });
      const r = await window.api.bankAccounts.list();
      setAccounts(r||[]);
      setReceiveForm(f => ({ ...f, account_label: label }));
      setNewAccountLabel(''); setShowNewAccount(false);
      toast.success('Conta/banco adicionada!');
    } catch { toast.error('Erro ao adicionar conta/banco.'); }
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

  async function handleAddCategory(value) {
    const raw = (value ?? newCategory).trim();
    const name = raw.toLowerCase().replace(/\s+/g, '_');
    if (!name) { toast.error('Informe um nome.'); return; }
    if (RESERVED_CATS.includes(name)) { toast.error('Nome reservado.'); return; }
    try {
      const res = await window.api.ar.categories.create(name);
      if (res?.ok) {
        toast.success('Categoria criada!');
        setNewCategory('');
        loadCategories();
        if (value != null) {
          setForm(f => ({ ...f, category: name }));
          setNewCategoryInline('');
          setShowNewCategoryInline(false);
        }
      }
      else { toast.error(res?.error || 'Erro ao criar categoria.'); }
    } catch { toast.error('Erro ao criar categoria.'); }
  }

  async function handleDeleteCategory(name) {
    if (!confirm(`Remover categoria "${name}"?`)) return;
    try { await window.api.ar.categories.delete(name); toast.success('Categoria removida.'); loadCategories(); }
    catch { toast.error('Erro ao remover categoria.'); }
  }

  async function openRecurrenceEditor(row) {
    if (!row.recurrence_id) return;
    try {
      const rec = await window.api.ar.recurrence.get(row.recurrence_id);
      if (!rec) { toast.error('Recorrência não encontrada.'); return; }
      setRecurrenceModal(rec);
    } catch { toast.error('Erro ao carregar recorrência.'); }
  }

  async function handleUpdateRecurrence() {
    if (!recurrenceModal?.id) return;
    try {
      const res = await window.api.ar.recurrence.update(recurrenceModal);
      if (res?.error) { toast.error(res.error); return; }
      toast.success('Recorrência atualizada!');
      setRecurrenceModal(null);
      load();
    } catch { toast.error('Erro ao atualizar recorrência.'); }
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
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={filters.recurrence} onChange={e => setFilters(f => ({ ...f, recurrence: e.target.value }))}>
          <option value="">Todas</option>
          <option value="1">Recorrentes</option>
          <option value="0">Avulsas</option>
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
            <tr>{['Descrição', 'Categoria', 'Vencimento', 'Status', 'Conta/Banco', 'Valor', ''].map(h => (
              <th key={h} className="text-left px-3 py-2.5 font-medium text-gray-600">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">Carregando...</td></tr>
              : rows.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">Nenhuma conta.</td></tr>
              : rows.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 font-medium">
                      <span>{r.description}</span>
                      {r.recurrence_id && (
                        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">recorrente</span>
                      )}
                      {r.note?.startsWith('Parcela ') && (
                        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{r.note}</span>
                      )}
                    </div>
                    {r.note && !r.note.startsWith('Parcela ') && <div className="text-xs text-gray-400">{r.note}</div>}
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
                  <td className="px-3 py-2.5 text-gray-500">{r.account_label || '-'}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-green-600">R$ {brl(r.amount)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 justify-end">
                      {r.status !== 'recebida'
                        ? <button onClick={() => { setReceiveModal(r); setReceiveForm({ received_at: today(), method: 'pix', account_label: '' }); }} className="p-1 text-gray-400 hover:text-green-600" title="Marcar como recebida"><CheckCircle size={15} /></button>
                        : <button onClick={() => handleUnreceive(r)} className="p-1 text-gray-400 hover:text-yellow-600" title="Reabrir"><XCircle size={15} /></button>
                      }
                      {r.recurrence_id && (
                        <button onClick={() => openRecurrenceEditor(r)} className="p-1 text-gray-400 hover:text-emerald-600" title="Editar recorrência"><Settings2 size={14} /></button>
                      )}
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

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={`${editing ? 'Editar' : 'Nova'} Conta a Receber`}
        maxWidth="max-w-md"
        footer={
          <>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 border rounded-lg text-sm">Cancelar</button>
            <button type="button" onClick={handleSubmit} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm">Salvar</button>
          </>
        }
      >
        <div className="space-y-3">
              <input ref={firstInputRef} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Descrição *" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="flex gap-2">
                    <select className="flex-1 border rounded-lg px-3 py-2 text-sm" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                      <option value="geral">geral</option>
                      {categories.filter(c => c !== 'geral').map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    <button type="button" onClick={() => setShowNewCategoryInline(v => !v)} className="px-2 py-2 text-xs border rounded-md bg-white hover:bg-gray-50">+</button>
                  </div>
                  {showNewCategoryInline && (
                    <div className="flex gap-2 items-center mt-2">
                      <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Nova categoria" value={newCategoryInline} onChange={e => setNewCategoryInline(e.target.value)} />
                      <button type="button" onClick={() => handleAddCategory(newCategoryInline)} disabled={!newCategoryInline.trim()} className="px-3 py-2 text-xs bg-blue-600 text-white rounded-md disabled:opacity-40">Adicionar</button>
                      <button type="button" onClick={() => { setShowNewCategoryInline(false); setNewCategoryInline(''); }} className="px-3 py-2 text-xs border rounded-md bg-white">Cancelar</button>
                    </div>
                  )}
                </div>
                <input type="number" className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Valor (R$) *" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} step="0.01" min="0.01" required />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Vencimento</label>
                <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Observações" rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              {!editing && (
                <div className="border rounded-lg p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input type="checkbox" className="accent-blue-600" checked={!!form.recurrence} onChange={e => setForm(f => ({ ...f, recurrence: e.target.checked }))} />
                    Conta recorrente
                  </label>
                  {form.recurrence && (
                    <div className="mt-3 space-y-2">
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">Tipo de recorrência</label>
                        <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={form.recurrence_type} onChange={e => setForm(f => ({ ...f, recurrence_type: e.target.value }))}>
                          <option value="variable">Valor variável (mensalidade, etc.)</option>
                          <option value="installments">Parcelada (valor fixo)</option>
                          <option value="installments_custom">Parcelada por dias (15/30/45)</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Repetir a cada</label>
                          <div className="flex gap-2">
                            <input type="number" className="w-20 border rounded-lg px-2 py-1.5 text-sm" min="1" value={form.interval_value} onChange={e => setForm(f => ({ ...f, interval_value: e.target.value }))} />
                            <select className="flex-1 border rounded-lg px-2 py-1.5 text-sm" value={form.interval_unit} onChange={e => setForm(f => ({ ...f, interval_unit: e.target.value }))}>
                              <option value="day">dias</option>
                              <option value="week">semanas</option>
                              <option value="month">meses</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Encerrar em</label>
                          <input type="date" className="w-full border rounded-lg px-2 py-1.5 text-sm" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} disabled={form.recurrence_type === 'installments'} />
                        </div>
                      </div>
                      {form.recurrence_type === 'installments' && (
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Número de parcelas</label>
                          <input type="number" className="w-full border rounded-lg px-2 py-1.5 text-sm" min="2" value={form.installments_count} onChange={e => setForm(f => ({ ...f, installments_count: e.target.value }))} />
                        </div>
                      )}
                      {form.recurrence_type === 'installments_custom' && (
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Dias das parcelas</label>
                          <input type="text" className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Ex.: 15,30,45" value={form.installments_days} onChange={e => setForm(f => ({ ...f, installments_days: e.target.value }))} />
                          <p className="text-xs text-gray-400 mt-1">Os valores serão divididos igualmente. Última parcela ajusta o centavo.</p>
                        </div>
                      )}
                      <p className="text-xs text-gray-400">A primeira ocorrência será na data de vencimento informada.</p>
                    </div>
                  )}
                </div>
              )}
        </div>
      </Modal>

      <Modal
        isOpen={!!recurrenceModal}
        onClose={() => setRecurrenceModal(null)}
        title="Editar Recorrência"
        maxWidth="max-w-md"
        footer={
          <>
            <button type="button" onClick={() => setRecurrenceModal(null)} className="px-4 py-2 border rounded-lg text-sm">Cancelar</button>
            <button type="button" onClick={handleUpdateRecurrence} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">Salvar</button>
          </>
        }
      >
        <div className="space-y-3">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Descrição" value={recurrenceModal.description || ''} onChange={e => setRecurrenceModal(r => ({ ...r, description: e.target.value }))} />
              <div className="flex gap-2">
                <select className="flex-1 border rounded-lg px-3 py-2 text-sm" value={recurrenceModal.category || 'geral'} onChange={e => setRecurrenceModal(r => ({ ...r, category: e.target.value }))}>
                  <option value="geral">geral</option>
                  {categories.filter(c => c !== 'geral').map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <input type="number" className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Valor (R$)" value={recurrenceModal.amount ?? ''} onChange={e => setRecurrenceModal(r => ({ ...r, amount: e.target.value }))} step="0.01" min="0.01" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Repetir a cada</label>
                  <div className="flex gap-2">
                    <input type="number" className="w-20 border rounded-lg px-2 py-1.5 text-sm" min="1" value={recurrenceModal.interval_value || 1} onChange={e => setRecurrenceModal(r => ({ ...r, interval_value: e.target.value }))} />
                    <select className="flex-1 border rounded-lg px-2 py-1.5 text-sm" value={recurrenceModal.interval_unit || 'month'} onChange={e => setRecurrenceModal(r => ({ ...r, interval_unit: e.target.value }))}>
                      <option value="day">dias</option>
                      <option value="week">semanas</option>
                      <option value="month">meses</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Encerrar em</label>
                  <input type="date" className="w-full border rounded-lg px-2 py-1.5 text-sm" value={recurrenceModal.end_date || ''} onChange={e => setRecurrenceModal(r => ({ ...r, end_date: e.target.value }))} />
                </div>
              </div>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Observações" rows={2} value={recurrenceModal.note || ''} onChange={e => setRecurrenceModal(r => ({ ...r, note: e.target.value }))} />
        </div>
      </Modal>

      <Modal
        isOpen={!!receiveModal}
        onClose={() => setReceiveModal(null)}
        title="Marcar como Recebida"
        subtitle={receiveModal ? `${receiveModal.description} — R$ ${brl(receiveModal.amount)}` : ''}
        maxWidth="max-w-sm"
        footer={
          <>
            <button type="button" onClick={() => setReceiveModal(null)} className="px-4 py-2 border rounded-lg text-sm">Cancelar</button>
            <button type="button" onClick={handleReceive} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm">Confirmar</button>
          </>
        }
      >
        <div className="space-y-3">
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={receiveForm.received_at} onChange={e => setReceiveForm(f => ({ ...f, received_at: e.target.value }))} />
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-1">
                  <select className="w-full border rounded-lg px-3 py-2 text-sm" value={receiveForm.method} onChange={e => setReceiveForm(f => ({ ...f, method: e.target.value }))}>
                    {(methods.length>0 ? methods : [
                      { value: 'dinheiro', label: 'Dinheiro' },
                      { value: 'pix', label: 'Pix' },
                      { value: 'debito', label: 'Débito' },
                      { value: 'credito', label: 'Crédito' },
                    ]).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewMethod(v=>!v)} className="px-2 py-2 text-xs border rounded-md bg-white hover:bg-gray-50">+ </button>
                </div>
                <div className="flex-1 flex items-center gap-1">
                  <select className="w-full border rounded-lg px-3 py-2 text-sm disabled:opacity-50" value={receiveForm.account_label} onChange={e => setReceiveForm(f => ({ ...f, account_label: e.target.value }))} disabled={receiveForm.method==='dinheiro'}>
                    <option value="">Selecione a conta</option>
                    {accounts.map(a => <option key={a.id} value={a.label}>{a.label}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewAccount(v=>!v)} className="px-2 py-2 text-xs border rounded-md bg-white hover:bg-gray-50">+ </button>
                </div>
              </div>
              {showNewMethod && (
                <div className="flex gap-2 items-center">
                  <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Nova forma (ex.: pix)" value={newMethodName} onChange={e=>setNewMethodName(e.target.value)} />
                  <button type="button" onClick={handleCreateMethod} disabled={!newMethodName.trim()} className="px-3 py-2 text-xs bg-blue-600 text-white rounded-md disabled:opacity-40">Adicionar</button>
                  <button type="button" onClick={()=>{setShowNewMethod(false);setNewMethodName('');}} className="px-3 py-2 text-xs border rounded-md bg-white">Cancelar</button>
                </div>
              )}
              {showNewAccount && (
                <div className="flex gap-2 items-center">
                  <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Nova conta (ex.: Caixa)" value={newAccountLabel} onChange={e=>setNewAccountLabel(e.target.value)} />
                  <button type="button" onClick={handleCreateAccount} disabled={!newAccountLabel.trim()} className="px-3 py-2 text-xs bg-blue-600 text-white rounded-md disabled:opacity-40">Adicionar</button>
                  <button type="button" onClick={()=>{setShowNewAccount(false);setNewAccountLabel('');}} className="px-3 py-2 text-xs border rounded-md bg-white">Cancelar</button>
                </div>
              )}
        </div>
      </Modal>

      <Modal
        isOpen={showCategories}
        onClose={() => setShowCategories(false)}
        title="Categorias"
        maxWidth="max-w-md"
      >
        <div className="flex gap-2">
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
      </Modal>
    </div>
  );
}
