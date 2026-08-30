import React, { useEffect, useState, useCallback } from 'react';
import { useModalFocus } from '../useModalFocus';
import Modal from '../components/Modal';
import { Plus, RefreshCw, Pencil, Trash2, Download, Settings } from 'lucide-react';
import { brl, fmtDateTime, monthStart, today, exportCSV } from '../utils';
import { nowLocalInput } from '../utils/dateHelpers';
import { useToastCtx } from '../ToastContext';

// Métodos e contas serão carregados do backend
const DIRECTIONS = [{ v: 'in', l: 'Entrada' }, { v: 'out', l: 'Saída' }];

const emptyForm = () => ({ occurred_at: nowLocalInput(), amount: '', direction: 'in', method: 'pix', account_label: '', category: '', description: '' });

export default function Caixa() {
  const toast = useToastCtx();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ date_from: monthStart(), date_to: today(), category: '' });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [categories, setCategories] = useState([]);
  const [newCatName, setNewCatName] = useState('');
  const [showNewCat, setShowNewCat] = useState(false);
  const [showManageCats, setShowManageCats] = useState(false);
  const firstInputRef = useModalFocus(showForm);
  // Listas padronizadas
  const [methods, setMethods] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showNewMethod, setShowNewMethod] = useState(false);
  const [newMethodName, setNewMethodName] = useState('');
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccountLabel, setNewAccountLabel] = useState('');

  const loadCategories = useCallback(async () => {
    const cats = await window.api.caixa.listCategories();
    setCategories(cats || []);
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { window.api.paymentMethods?.list?.().then(r => {
    const list = (r||[]).filter(m => m.active).map(m => ({ value: m.name, label: m.name.charAt(0).toUpperCase()+m.name.slice(1) }));
    setMethods(list);
  }).catch(()=>setMethods([])); }, []);
  useEffect(() => { window.api.bankAccounts?.list?.().then(r => setAccounts(r||[])).catch(()=>setAccounts([])); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.caixa.list(filters);
      setRows(data || []);
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const totalEntradas = rows.filter(r => (r.amount || 0) >= 0).reduce((s, r) => s + r.amount, 0);
  const totalSaidas = rows.filter(r => (r.amount || 0) < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
  const saldo = totalEntradas - totalSaidas;

  async function handleSubmit() {
    const amt = parseFloat(form.amount) || 0;
    const finalAmt = form.direction === 'out' ? -Math.abs(amt) : Math.abs(amt);
    const payload = { ...form, amount: finalAmt };
    try {
      if (editing) {
        await window.api.caixa.update({ id: editing, ...payload });
        setEditing(null);
        toast.success('Lançamento atualizado!');
      } else {
        await window.api.caixa.create(payload);
        toast.success('Lançamento registrado!');
      }

  async function handleCreateMethod() {
    const name = (newMethodName||'').trim().toLowerCase();
    if (!name) return;
    try {
      await window.api.paymentMethods.create({ name, active: 1 });
      const r = await window.api.paymentMethods.list();
      const list = (r||[]).filter(m => m.active).map(m => ({ value: m.name, label: m.name.charAt(0).toUpperCase()+m.name.slice(1) }));
      setMethods(list);
      setForm(f => ({ ...f, method: name }));
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
      setForm(f => ({ ...f, account_label: label }));
      setNewAccountLabel(''); setShowNewAccount(false);
      toast.success('Conta/banco adicionada!');
    } catch { toast.error('Erro ao adicionar conta/banco.'); }
  }
      setForm(emptyForm());
      setShowForm(false);
      load();
    } catch { toast.error('Erro ao salvar lançamento.'); }
  }

  async function handleDelete(id) {
    if (!confirm('Excluir lançamento?')) return;
    try {
      await window.api.caixa.delete(id);
      toast.success('Lançamento excluído.');
      load();
    } catch { toast.error('Erro ao excluir.'); }
  }

  async function handleDeleteCategory(name) {
    if (!confirm(`Excluir categoria "${name}"?`)) return;
    await window.api.caixa.deleteCategory(name);
    await loadCategories();
    if (form.category === name) setForm(f => ({ ...f, category: '' }));
    toast.success('Categoria excluída.');
  }

  async function handleCreateCategory() {
    const name = newCatName.trim();
    if (!name) return;
    const res = await window.api.caixa.createCategory(name);
    if (res?.ok === false) { toast.error(res.error || 'Categoria inválida.'); return; }
    await loadCategories();
    const normalized = name.toLowerCase().replace(/\s+/g, '_');
    setForm(f => ({ ...f, category: normalized }));
    setNewCatName('');
    setShowNewCat(false);
    toast.success('Categoria criada!');
  }

  function startEdit(row) {
    setForm({
      occurred_at: (row.occurred_at || '').slice(0, 16),
      amount: String(Math.abs(row.amount || 0)),
      direction: (row.amount || 0) < 0 ? 'out' : 'in',
      method: row.method || 'pix',
      account_label: row.account_label || '',
      category: row.category || 'manual',
      description: row.description || '',
    });
    setEditing(row.id);
    setShowForm(true);
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">Controle de Caixa</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowManageCats(true)} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50" title="Gerenciar categorias">
            <Settings size={15} /> Categorias
          </button>
          <button onClick={() => exportCSV(rows, `Caixa_${today()}.csv`)} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50" disabled={rows.length === 0}>
            <Download size={15} /> Exportar
          </button>
          <button onClick={() => { setForm(emptyForm()); setEditing(null); setShowNewCat(false); setNewCatName(''); setShowForm(true); }} className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700">
            <Plus size={15} /> Lançamento
          </button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-xs text-gray-400 mb-0.5">Entradas</div>
          <div className="font-bold text-green-600">R$ {brl(totalEntradas)}</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-xs text-gray-400 mb-0.5">Saídas</div>
          <div className="font-bold text-red-500">R$ {brl(totalSaidas)}</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-xs text-gray-400 mb-0.5">Saldo</div>
          <div className={`font-bold ${saldo >= 0 ? 'text-blue-600' : 'text-red-600'}`}>R$ {brl(saldo)}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex flex-wrap gap-2 items-end">
        <div className="flex items-center gap-1 text-sm">
          <span className="text-gray-500">De</span>
          <input type="date" className="border rounded-lg px-2 py-1.5" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} />
          <span className="text-gray-500">Até</span>
          <input type="date" className="border rounded-lg px-2 py-1.5" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} />
        </div>
        <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="Categoria" value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} />
        <button onClick={load} className="flex items-center gap-1 border rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50"><RefreshCw size={14} /> Filtrar</button>
        <button onClick={() => setFilters({ date_from: '', date_to: '', category: '' })} className="text-sm text-red-500 hover:underline">Limpar</button>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Data', 'Descrição', 'Categoria', 'Método', 'Conta/Banco', 'Valor', ''].map(h => (
                <th key={h} className="text-left px-3 py-2.5 font-medium text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">Carregando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">Nenhum lançamento.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtDateTime(r.occurred_at)}</td>
                <td className="px-3 py-2.5">{r.description || '-'}</td>
                <td className="px-3 py-2.5"><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{r.category}</code></td>
                <td className="px-3 py-2.5"><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{r.method}</code></td>
                <td className="px-3 py-2.5 text-gray-500">{r.account_label || '-'}</td>
                <td className={`px-3 py-2.5 text-right font-medium ${(r.amount || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {(r.amount || 0) >= 0 ? '+' : '-'} R$ {brl(Math.abs(r.amount || 0))}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 justify-end">
                    {(r.source_type || '') === 'manual' && (
                      <button onClick={() => startEdit(r)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={13} /></button>
                    )}
                    <button onClick={() => handleDelete(r.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showManageCats}
        onClose={() => { setShowManageCats(false); setNewCatName(''); }}
        title="Gerenciar Categorias"
        maxWidth="max-w-sm"
      >
        <ul className="space-y-1 max-h-64 overflow-y-auto">
          {categories.length === 0 && <li className="text-sm text-gray-400 text-center py-4">Nenhuma categoria.</li>}
          {categories.map(c => (
            <li key={c} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 border">
              <span className="text-sm">{c}</span>
              <button onClick={() => handleDeleteCategory(c)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        <div className="flex gap-1">
          <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="nova_categoria" value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } }} />
          <button type="button" onClick={handleCreateCategory} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">+ Adicionar</button>
        </div>
      </Modal>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); setShowNewCat(false); setNewCatName(''); }}
        title={`${editing ? 'Editar' : 'Novo'} Lançamento`}
        maxWidth="max-w-md"
        footer={
          <>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); setShowNewCat(false); setNewCatName(''); }} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
            <button type="button" onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Salvar</button>
          </>
        }
      >
        <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Data/hora</label>
                  <input ref={firstInputRef} type="datetime-local" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.occurred_at} onChange={e => setForm(f => ({ ...f, occurred_at: e.target.value }))} />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Direção</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}>
                    {DIRECTIONS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Valor (R$)</label>
                  <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="0,00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} step="0.01" min="0.01" required />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Método</label>
                  <div className="flex items-center gap-1">
                    <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
                      {(methods.length>0 ? methods : [
                        { value: 'dinheiro', label: 'Dinheiro' },
                        { value: 'pix', label: 'Pix' },
                        { value: 'debito', label: 'Débito' },
                        { value: 'credito', label: 'Crédito' },
                      ]).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <button type="button" onClick={() => setShowNewMethod(v=>!v)} className="px-2 py-2 text-xs border rounded-md bg-white hover:bg-gray-50">+ </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Categoria</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.category} onChange={e => {
                    if (e.target.value === '__new__') { setShowNewCat(true); }
                    else { setForm(f => ({ ...f, category: e.target.value })); setShowNewCat(false); }
                  }}>
                    <option value="">Selecione...</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="__new__">+ Nova categoria...</option>
                  </select>
                  {showNewCat && (
                    <div className="flex gap-1 mt-1">
                      <input autoFocus className="flex-1 border rounded-lg px-2 py-1.5 text-sm" placeholder="nome_da_categoria" value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } }} />
                      <button type="button" onClick={handleCreateCategory} className="px-2 py-1.5 bg-blue-600 text-white rounded-lg text-xs">OK</button>
                      <button type="button" onClick={() => { setShowNewCat(false); setNewCatName(''); }} className="px-2 py-1.5 border rounded-lg text-xs">✕</button>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Conta/Banco</label>
                  <div className="flex items-center gap-1">
                    <select className="w-full border rounded-lg px-3 py-2 text-sm disabled:opacity-50" value={form.account_label} onChange={e => setForm(f => ({ ...f, account_label: e.target.value }))} disabled={form.method==='dinheiro'}>
                      <option value="">Selecione a conta</option>
                      {accounts.map(a => <option key={a.id} value={a.label}>{a.label}</option>)}
                    </select>
                    <button type="button" onClick={() => setShowNewAccount(v=>!v)} className="px-2 py-2 text-xs border rounded-md bg-white hover:bg-gray-50">+ </button>
                  </div>
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
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Descrição</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Descrição do lançamento" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
        </div>
      </Modal>
    </div>
  );
}
