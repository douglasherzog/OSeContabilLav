import React, { useEffect, useState, useCallback } from 'react';
import { useModalFocus } from '../useModalFocus';
import Modal from '../components/Modal';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search, Download, Trash2 } from 'lucide-react';
import { brl, fmtDateTime, monthStart, today, STATUS_LABELS, STATUS_COLORS, exportCSV } from '../utils';
import { useToastCtx } from '../ToastContext';

const STATUSES = ['', 'aberta', 'pronta', 'entregue', 'entregue_pendente'];
// Métodos e contas padronizados

export default function OSList() {
  const navigate = useNavigate();
  const toast = useToastCtx();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ q: '', statuses: [], date_from: monthStart(), date_to: today(), client: '', total_min: '', total_max: '', remaining_only: false, assigned_to: '' });
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = [filters.statuses.length > 0, filters.date_from, filters.date_to, filters.client, filters.total_min, filters.total_max, filters.remaining_only, filters.assigned_to, filters.q].filter(Boolean).length;
  const [filterClients, setFilterClients] = useState([]);
  const [filterClientSearch, setFilterClientSearch] = useState('');
  const [filterClientDebounced, setFilterClientDebounced] = useState('');
  const [showFilterClientDrop, setShowFilterClientDrop] = useState(false);
  const [filterAssigned, setFilterAssigned] = useState([]);
  const [filterAssignedSearch, setFilterAssignedSearch] = useState('');
  const [filterAssignedDebounced, setFilterAssignedDebounced] = useState('');
  const [showFilterAssignedDrop, setShowFilterAssignedDrop] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const firstInputRef = useModalFocus(showForm);
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ client_id: '', status: 'aberta', note: '', order_date: today() });
  const [newClient, setNewClient] = useState({ first_name: '', last_name: '', phone: '' });
  const [showNewClient, setShowNewClient] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientSearchDebounced, setClientSearchDebounced] = useState('');
  const [showClientDrop, setShowClientDrop] = useState(false);
  const [draftItems, setDraftItems] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [itemInput, setItemInput] = useState({ description: '', quantity: '1', unit_price: '' });
  const [catalogMode, setCatalogMode] = useState(true);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [showItemInput, setShowItemInput] = useState(false);
  const [showNewService, setShowNewService] = useState(false);
  const [newServiceForm, setNewServiceForm] = useState({ name: '', unit_price: '', unit: 'peca' });
  const [entryPayment, setEntryPayment] = useState({ enabled: false, amount: '', method: 'dinheiro', account_label: '' });
  const [methods, setMethods] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showNewMethod, setShowNewMethod] = useState(false);
  const [newMethodName, setNewMethodName] = useState('');
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccountLabel, setNewAccountLabel] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.os.list(filters);
      setOrders(data || []);
    } finally { setLoading(false); }
  }, [filters]);

  function toggleStatus(s) {
    setFilters(f => ({
      ...f,
      statuses: f.statuses.includes(s) ? f.statuses.filter(x => x !== s) : [...f.statuses, s]
    }));
  }

  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.api.clients.list().then(setClients); }, []);
  useEffect(() => { window.api.clients.listWithOS().then(r => setFilterClients(r || [])); }, []);
  useEffect(() => { window.api.os.listAssigned().then(r => setFilterAssigned(r || [])); }, []);
  useEffect(() => {
    const t = setTimeout(() => setFilterAssignedDebounced(filterAssignedSearch), 150);
    return () => clearTimeout(t);
  }, [filterAssignedSearch]);
  useEffect(() => {
    const t = setTimeout(() => setFilterClientDebounced(filterClientSearch), 150);
    return () => clearTimeout(t);
  }, [filterClientSearch]);
  useEffect(() => {
    const t = setTimeout(() => setClientSearchDebounced(clientSearch), 150);
    return () => clearTimeout(t);
  }, [clientSearch]);
  useEffect(() => { window.api.services.list(false).then(r => setCatalog(r || [])); }, []);
  useEffect(() => { window.api.paymentMethods?.list?.().then(r => {
    const list = (r||[]).filter(m => m.active).map(m => ({ value: m.name, label: m.name.charAt(0).toUpperCase()+m.name.slice(1) }));
    setMethods(list);
  }).catch(()=>setMethods([])); }, []);
  useEffect(() => { window.api.bankAccounts?.list?.().then(r => setAccounts(r||[])).catch(()=>setAccounts([])); }, []);
  // Sugere conta se método não for dinheiro
  useEffect(() => {
    if (entryPayment.method !== 'dinheiro') {
      if (!entryPayment.account_label && accounts.length > 0) {
        setEntryPayment(p => ({ ...p, account_label: accounts[0].label }));
      }
    } else {
      setEntryPayment(p => ({ ...p, account_label: '' }));
    }
  }, [entryPayment.method, accounts]);

  async function handleQuickNewService() {
    try {
      const s = await window.api.services.create({ name: newServiceForm.name, unit_price: parseFloat(newServiceForm.unit_price) || 0, unit: newServiceForm.unit, category: 'geral' });
      const updated = await window.api.services.list(false);
      setCatalog(updated || []);
      setItemInput(f => ({ ...f, description: s.name, unit_price: String(s.unit_price || '') }));
      setNewServiceForm({ name: '', unit_price: '', unit: 'peca' });
      setShowNewService(false);
      toast.success('Serviço cadastrado!');
    } catch { toast.error('Erro ao cadastrar serviço.'); }
  }

  const draftTotal = draftItems.reduce((s, i) => s + i.total, 0);
  const requiredEntry = draftItems.reduce((s, i) => s + (i.requires_entry ? i.total * (i.entry_pct || 50) / 100 : 0), 0);
  const entryOk = requiredEntry <= 0.01 || (entryPayment.enabled && parseFloat(entryPayment.amount || 0) >= requiredEntry - 0.01);
  const entryForced = requiredEntry > 0.01;
  // Auto-habilitar e atualizar valor sempre que requiredEntry mudar
  React.useEffect(() => {
    if (entryForced) {
      setEntryPayment(p => ({ ...p, enabled: true, amount: requiredEntry.toFixed(2) }));
    }
  }, [requiredEntry]);

  function addDraftItem() {
    if (!itemInput.description) return;
    const qty = parseFloat(itemInput.quantity) || 1;
    const price = parseFloat(itemInput.unit_price) || 0;
    const catalogService = catalog.find(s => s.name === itemInput.description);
    setDraftItems(prev => [...prev, {
      _key: Date.now(),
      description: itemInput.description,
      quantity: qty, unit_price: price, total: qty * price,
      requires_entry: catalogService?.requires_entry || 0,
      entry_pct: catalogService?.entry_pct || 50,
    }]);
    setItemInput({ description: '', quantity: '1', unit_price: '' });
    setCatalogSearch('');
    setShowItemInput(false);
  }

  function removeDraftItem(key) {
    setDraftItems(prev => prev.filter(i => i._key !== key));
  }

  async function handleCreate() {
    try {
      const os = await window.api.os.create({ ...form, total: draftTotal });
      for (const item of draftItems) {
        await window.api.os.addItem({ order_id: os.id, description: item.description, quantity: item.quantity, unit_price: item.unit_price });
      }
      if (entryPayment.enabled && parseFloat(entryPayment.amount) > 0) {
        await window.api.os.addPayment({
          order_id: os.id,
          amount: parseFloat(entryPayment.amount),
          method: entryPayment.method,
          account_label: entryPayment.account_label || '',
          when_type: 'entrada',
          payment_date: form.order_date || today(),
        });
      }
      setForm({ client_id: '', status: 'aberta', note: '', order_date: today() });
      setClientSearch('');
      setDraftItems([]);
      setEntryPayment({ enabled: false, amount: '', method: 'dinheiro', account_label: '' });
      setShowForm(false);
      load();
      toast.success('OS criada com sucesso!');
    } catch { toast.error('Erro ao criar OS.'); }
  }

  async function handleCreateClient(e) {
    e.preventDefault();
    try {
      const c = await window.api.clients.create(newClient);
      setClients(prev => [...prev, c]);
      setForm(f => ({ ...f, client_id: c.id }));
      setClientSearch(`${c.name}${c.phone ? ' — ' + c.phone : ''}`);
      setNewClient({ first_name: '', last_name: '', phone: '' });
      setShowNewClient(false);
      toast.success('Cliente cadastrado!');
    } catch { toast.error('Erro ao cadastrar cliente.'); }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">Ordens de Serviço</h1>
        <div className="flex gap-2">
          <button onClick={() => exportCSV(orders, `OS_${today()}.csv`)} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50" disabled={orders.length === 0}>
            <Download size={15} /> Exportar
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700">
            <Plus size={15} /> Nova OS
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4">
        {/* Barra principal */}
        <div className="p-3 flex gap-2 items-center">
          <div className="flex items-center gap-1 border rounded-lg px-2 py-1.5 text-sm flex-1">
            <Search size={14} className="text-gray-400" />
            <input className="outline-none flex-1" placeholder="Buscar cliente, nº, observação..." value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
          </div>
          <button onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              showFilters || activeFilterCount > 0 ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50 text-gray-600'
            }`}>
            <RefreshCw size={13} /> Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          <button onClick={() => { setFilters({ q: '', statuses: [], date_from: monthStart(), date_to: today(), client: '', total_min: '', total_max: '', remaining_only: false, assigned_to: '' }); setFilterClientSearch(''); setFilterAssignedSearch(''); setShowFilters(false); }} className="text-sm text-red-500 hover:underline">Limpar</button>
        </div>

        {/* Painel expansível */}
        {showFilters && (
          <div className="border-t px-3 pb-3 pt-3 space-y-3">

            {/* Status múltiplo */}
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1.5">Status</div>
              <div className="flex gap-1 flex-wrap">
                {STATUSES.filter(Boolean).map(s => (
                  <button key={s} type="button" onClick={() => toggleStatus(s)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                      filters.statuses.includes(s) ? STATUS_COLORS[s] + ' border-current' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* Linha 2: Data + Cliente + Responsável */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">Data de criação</div>
                <div className="flex items-center gap-1">
                  <input type="date" className="flex-1 border rounded-lg px-2 py-1.5 text-sm" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))} />
                  <span className="text-gray-400 text-xs">até</span>
                  <input type="date" className="flex-1 border rounded-lg px-2 py-1.5 text-sm" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))} />
                </div>
              </div>
              <div className="relative">
                <div className="text-xs font-medium text-gray-500 mb-1">Cliente</div>
                <input
                  className="w-full border rounded-lg px-2 py-1.5 text-sm"
                  placeholder="Nome do cliente..."
                  value={filterClientSearch}
                  onChange={e => {
                    setFilterClientSearch(e.target.value);
                    setShowFilterClientDrop(true);
                    if (!e.target.value) setFilters(f => ({ ...f, client: '' }));
                  }}
                  onFocus={() => setShowFilterClientDrop(true)}
                  onBlur={() => setTimeout(() => setShowFilterClientDrop(false), 150)}
                  autoComplete="off"
                />
                {showFilterClientDrop && (() => {
                  const q = filterClientDebounced.toLowerCase();
                  const hits = !q
                    ? filterClients.slice(0, 20)
                    : filterClients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 20);
                  if (!hits.length) return null;
                  return (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {hits.map(c => (
                        <button key={c.id} type="button"
                          onMouseDown={() => {
                            setFilters(f => ({ ...f, client: c.name }));
                            setFilterClientSearch(c.name);
                            setShowFilterClientDrop(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-800">{c.name}</span>
                          {c.phone && <span className="text-gray-400 text-xs shrink-0">{c.phone}</span>}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div className="relative">
                <div className="text-xs font-medium text-gray-500 mb-1">Responsável</div>
                <input
                  className="w-full border rounded-lg px-2 py-1.5 text-sm"
                  placeholder="Nome do responsável..."
                  value={filterAssignedSearch}
                  onChange={e => {
                    setFilterAssignedSearch(e.target.value);
                    setShowFilterAssignedDrop(true);
                    setFilters(f => ({ ...f, assigned_to: e.target.value }));
                  }}
                  onFocus={() => setShowFilterAssignedDrop(true)}
                  onBlur={() => setTimeout(() => setShowFilterAssignedDrop(false), 150)}
                  autoComplete="off"
                />
                {showFilterAssignedDrop && (() => {
                  const q = filterAssignedDebounced.toLowerCase();
                  const hits = !q
                    ? filterAssigned.slice(0, 20)
                    : filterAssigned.filter(a => a.name.toLowerCase().includes(q)).slice(0, 20);
                  if (!hits.length) return null;
                  return (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {hits.map(a => (
                        <button key={a.name} type="button"
                          onMouseDown={() => {
                            setFilters(f => ({ ...f, assigned_to: a.name }));
                            setFilterAssignedSearch(a.name);
                            setShowFilterAssignedDrop(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50">
                          <span className="font-medium text-gray-800">{a.name}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Linha 3: Total + Pendência */}
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">Total (R$)</div>
                <div className="flex items-center gap-1">
                  <input type="number" className="w-28 border rounded-lg px-2 py-1.5 text-sm" placeholder="Mín" value={filters.total_min} onChange={e => setFilters(f => ({ ...f, total_min: e.target.value }))} min="0" step="0.01" />
                  <span className="text-gray-400 text-xs">até</span>
                  <input type="number" className="w-28 border rounded-lg px-2 py-1.5 text-sm" placeholder="Máx" value={filters.total_max} onChange={e => setFilters(f => ({ ...f, total_max: e.target.value }))} min="0" step="0.01" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer pb-1">
                <input type="checkbox" checked={filters.remaining_only} onChange={e => setFilters(f => ({ ...f, remaining_only: e.target.checked }))} className="rounded" />
                Apenas com saldo pendente
              </label>
            </div>

            <button onClick={load} className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700">
              <RefreshCw size={13} /> Aplicar filtros
            </button>
          </div>
        )}
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['#', 'Cliente', 'Status', 'Total', 'Pago', 'Restante', 'Criado em'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 font-medium text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">Carregando...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">Nenhuma OS encontrada.</td></tr>
            ) : orders.map(o => {
              const remaining = Math.max(0, (o.total || 0) - (o.paid || 0));
              return (
                <tr key={o.id} onClick={() => navigate(`/os/${o.id}`)} className="border-b last:border-0 hover:bg-blue-50 cursor-pointer transition-colors">
                  <td className="px-3 py-2.5 font-mono text-gray-500">#{o.number}</td>
                  <td className="px-3 py-2.5 font-medium">{o.client_name || '-'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[o.status] || 'bg-gray-100'}`}>
                        {STATUS_LABELS[o.status] || o.status}
                      </span>
                      {o.status === 'entregue' && (o.total || 0) - (o.paid || 0) > 0.01 && (
                        <span title="Saldo pendente" className="text-orange-500 text-xs">⚠</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">R$ {brl(o.total)}</td>
                  <td className="px-3 py-2.5 text-right text-green-600">R$ {brl(o.paid || 0)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${remaining <= 0.01 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      R$ {brl(remaining)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500">{fmtDateTime(o.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setDraftItems([]); setClientSearch(''); setEntryPayment({ enabled: false, amount: '', method: 'dinheiro', account_label: '' }); setForm({ client_id: '', status: 'aberta', note: '', order_date: today() }); }}
        title="Nova Ordem de Serviço"
        maxWidth="max-w-2xl"
        scrollable
        footer={
          <>
            <button type="button" onClick={() => { setShowForm(false); setDraftItems([]); setClientSearch(''); setEntryPayment({ enabled: false, amount: '', method: 'dinheiro', account_label: '' }); setForm({ client_id: '', status: 'aberta', note: '', order_date: today() }); }} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
            <button type="button" onClick={handleCreate} disabled={!entryOk} title={!entryOk ? `Registre a entrada mínima de R$ ${brl(requiredEntry)}` : ''} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">Criar OS</button>
          </>
        }
      >
        <div className="space-y-3">

              {/* Cliente com busca */}
              <div className="flex gap-2 items-start">
                <div className="flex-1 relative">
                  <input
                    ref={firstInputRef}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Buscar cliente *"
                    value={clientSearch}
                    required={!form.client_id}
                    onChange={e => {
                      setClientSearch(e.target.value);
                      setShowClientDrop(true);
                      if (!e.target.value) setForm(f => ({ ...f, client_id: '' }));
                    }}
                    onFocus={() => setShowClientDrop(true)}
                    onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
                    autoComplete="off"
                  />
                  {showClientDrop && (() => {
                    const q = clientSearchDebounced.toLowerCase();
                    const filtered = !q
                      ? clients.slice(0, 20)
                      : clients.filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)).slice(0, 20);
                    return (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {filtered.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onMouseDown={() => {
                              setForm(f => ({ ...f, client_id: c.id }));
                              setClientSearch(`${c.name}${c.phone ? ' — ' + c.phone : ''}`);
                              setShowClientDrop(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2"
                          >
                            <span className="font-medium text-gray-800">{c.name}</span>
                            {c.phone && <span className="text-gray-400 text-xs shrink-0">{c.phone}</span>}
                          </button>
                        ))}
                      {filtered.length === 0 && (
                        <div className="px-3 py-2 text-sm text-gray-400">Nenhum cliente encontrado.</div>
                      )}
                    </div>
                    );
                  })()}
                  {/* campo hidden para validação */}
                  <input type="hidden" value={form.client_id} required />
                </div>
                <button type="button" onClick={() => setShowNewClient(v => !v)} className="text-blue-600 text-sm hover:underline whitespace-nowrap mt-2">+ Novo</button>
              </div>
              {showNewClient && (
                <div className="border rounded-lg p-3 bg-blue-50 space-y-2">
                  <div className="flex gap-2">
                    <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Nome *" value={newClient.first_name} onChange={e => setNewClient(n => ({ ...n, first_name: e.target.value }))} required />
                    <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Sobrenome *" value={newClient.last_name} onChange={e => setNewClient(n => ({ ...n, last_name: e.target.value }))} required />
                  </div>
                  <input className={`w-full border rounded-lg px-3 py-2 text-sm ${!newClient.phone ? 'border-yellow-300 bg-yellow-50' : 'bg-white'}`} placeholder="Telefone (recomendado)" value={newClient.phone} onChange={e => setNewClient(n => ({ ...n, phone: e.target.value }))} />
                  <button type="button" onClick={handleCreateClient} disabled={!newClient.first_name || !newClient.last_name} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm disabled:opacity-40">Salvar cliente</button>
                </div>
              )}

              {/* Dados da OS */}
              <div className="flex gap-2">
                <select className="flex-1 border rounded-lg px-3 py-2 text-sm" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
                <div className="flex-1">
                  <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} />
                  <div className="text-xs text-gray-400 mt-0.5 ml-1">Data da ordem</div>
                </div>
              </div>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Observações" rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />

              {/* Itens */}
              <div className="border rounded-xl p-3 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-700">Itens da OS</span>
                  <button type="button" onClick={() => { setCatalogSearch(''); setShowItemInput(v => !v); }} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <Plus size={13} /> Adicionar item
                  </button>
                </div>

                {showItemInput && (
                  <div className="bg-white border rounded-lg p-3 mb-3 space-y-2">
                    {/* Toggle catálogo/manual */}
                    <div className="flex items-center justify-between">
                    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit text-xs">
                      <button type="button" onClick={() => setCatalogMode(true)}
                        className={`px-3 py-1 rounded-md transition-colors ${catalogMode ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500'}`}>
                        Catálogo
                      </button>
                      <button type="button" onClick={() => setCatalogMode(false)}
                        className={`px-3 py-1 rounded-md transition-colors ${!catalogMode ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500'}`}>
                        Manual
                      </button>
                    </div>
                    <button type="button" onClick={() => setShowNewService(v => !v)}
                      className="text-xs text-blue-600 hover:underline">+ Novo serviço</button>
                    </div>

                    {showNewService && (
                      <div className="border rounded-lg p-2.5 bg-gray-50 space-y-1.5">
                        <div className="text-xs font-medium text-gray-600">Cadastrar novo serviço</div>
                        <div className="space-y-1.5">
                          <input className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white" placeholder="Nome do serviço *" value={newServiceForm.name} onChange={e => setNewServiceForm(f => ({ ...f, name: e.target.value }))} autoFocus />
                          <div className="flex gap-2">
                            <input type="number" className="flex-1 border rounded-lg px-3 py-1.5 text-sm bg-white" placeholder="Preço (R$)" value={newServiceForm.unit_price} onChange={e => setNewServiceForm(f => ({ ...f, unit_price: e.target.value }))} step="0.01" min="0" />
                            <select className="w-24 border rounded-lg px-2 py-1.5 text-sm bg-white" value={newServiceForm.unit} onChange={e => setNewServiceForm(f => ({ ...f, unit: e.target.value }))}>
                              {['peça','kg','m2','lugar','un','km','hora'].map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={handleQuickNewService} disabled={!newServiceForm.name} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs disabled:opacity-40">Salvar e selecionar</button>
                            <button type="button" onClick={() => setShowNewService(false)} className="px-3 py-1.5 border rounded-lg text-xs bg-white">Cancelar</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {catalogMode && catalog.length > 0 && (
                      <>
                      <input
                        className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
                        placeholder="Buscar serviço..."
                        value={catalogSearch}
                        onChange={e => setCatalogSearch(e.target.value)}
                        autoComplete="off"
                        autoFocus
                      />
                      <div className="grid grid-cols-1 gap-1 max-h-36 overflow-y-auto">
                        {catalog.filter(s => !catalogSearch || s.name.toLowerCase().includes(catalogSearch.toLowerCase())).map(s => (
                          <button key={s.id} type="button"
                            onClick={() => setItemInput(f => ({ ...f, description: s.name, unit_price: String(s.unit_price || '') }))}
                            className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                              itemInput.description === s.name ? 'border-blue-500 bg-blue-50' : 'bg-gray-50 hover:bg-blue-50 border-gray-200'
                            }`}>
                            <span className="font-medium text-gray-800">{s.name}</span>
                            <span className="text-gray-400 text-xs ml-2 shrink-0">{s.unit_price > 0 ? `R$ ${brl(s.unit_price)}` : '—'} / {s.unit}</span>
                          </button>
                        ))}
                      </div>
                      </>
                    )}
                    {catalogMode && catalog.length === 0 && (
                      <div className="text-xs text-gray-400 text-center py-1">Catálogo vazio. Use o modo Manual.</div>
                    )}

                    {(!catalogMode || itemInput.description) && (
                      <>
                        <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Descrição *" value={itemInput.description} onChange={e => setItemInput(f => ({ ...f, description: e.target.value }))} />
                        <div className="flex gap-2">
                          <input type="number" className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Qtd" value={itemInput.quantity} onChange={e => setItemInput(f => ({ ...f, quantity: e.target.value }))} step="0.01" min="0.01" />
                          <input type="number" className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Preço unit. (R$)" value={itemInput.unit_price} onChange={e => setItemInput(f => ({ ...f, unit_price: e.target.value }))} step="0.01" min="0" />
                        </div>
                      </>
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={addDraftItem} disabled={!itemInput.description} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs disabled:opacity-40">Confirmar</button>
                      <button type="button" onClick={() => { setShowItemInput(false); setItemInput({ description: '', quantity: '1', unit_price: '' }); setCatalogSearch(''); }} className="px-3 py-1.5 border rounded-lg text-xs">Cancelar</button>
                    </div>
                  </div>
                )}

                {draftItems.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center py-2">Nenhum item adicionado.</div>
                ) : (
                  <>
                    <table className="w-full text-xs mb-2">
                      <thead><tr className="text-gray-500 border-b"><th className="text-left pb-1">Descrição</th><th className="text-right pb-1">Qtd</th><th className="text-right pb-1">Unit.</th><th className="text-right pb-1">Total</th><th className="pb-1"></th></tr></thead>
                      <tbody>
                        {draftItems.map(i => (
                          <tr key={i._key} className="border-b last:border-0">
                            <td className="py-1">{i.description}</td>
                            <td className="py-1 text-right">{i.quantity}</td>
                            <td className="py-1 text-right">R$ {brl(i.unit_price)}</td>
                            <td className="py-1 text-right font-medium">R$ {brl(i.total)}</td>
                            <td className="py-1 pl-1">
                              <button type="button" onClick={() => removeDraftItem(i._key)} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex justify-end text-sm font-bold text-gray-800">
                      Total: R$ {brl(draftTotal)}
                    </div>
                  </>
                )}
              </div>

              {/* Alerta entrada obrigatória */}
              {requiredEntry > 0.01 && (
                <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm border ${
                  entryOk ? 'bg-green-50 border-green-200 text-green-800' : 'bg-orange-50 border-orange-300 text-orange-800'
                }`}>
                  <span className="text-base mt-0.5">{entryOk ? '✅' : '⚠️'}</span>
                  <div>
                    <div className="font-medium">
                      {entryOk ? 'Entrada satisfeita' : 'Entrada obrigatória não registrada'}
                    </div>
                    <div className="text-xs mt-0.5">
                      {draftItems.filter(i => i.requires_entry).map(i => (
                        <span key={i._key} className="block">
                          • {i.description}: {i.entry_pct}% de R$ {brl(i.total)} = <strong>R$ {brl(i.total * i.entry_pct / 100)}</strong>
                        </span>
                      ))}
                      <span className="block mt-1 font-semibold">Total mínimo de entrada: R$ {brl(requiredEntry)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Pagamento na entrada (opcional) */}
              <div className="border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    if (entryForced) return;
                    setEntryPayment(p => ({ ...p, enabled: !p.enabled, amount: !p.enabled && draftTotal > 0 ? draftTotal.toFixed(2) : p.amount }));
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors ${
                    entryPayment.enabled ? 'bg-green-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  } ${entryForced ? 'cursor-default' : ''}`}
                >
                  <span>Registrar pagamento na entrada{entryForced ? ' (obrigatório)' : '?'}</span>
                  <span className="text-xs opacity-75">{entryForced ? 'Obrigatório' : entryPayment.enabled ? 'Sim — clique para cancelar' : 'Opcional'}</span>
                </button>
                {entryPayment.enabled && (
                  <div className="p-3 bg-green-50 space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <input
                          type="number"
                          className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                          placeholder="Valor (R$) *"
                          value={entryPayment.amount}
                          onChange={e => setEntryPayment(p => ({ ...p, amount: e.target.value }))}
                          step="0.01" min="0.01"
                          required={entryPayment.enabled}
                        />
                        {draftTotal > 0 && parseFloat(entryPayment.amount) === draftTotal && (
                          <div className="text-xs text-green-700 mt-0.5 ml-1">Pagamento total na entrada</div>
                        )}
                        {draftTotal > 0 && parseFloat(entryPayment.amount) > 0 && parseFloat(entryPayment.amount) < draftTotal && (
                          <div className="text-xs text-yellow-700 mt-0.5 ml-1">Restante: R$ {brl(draftTotal - parseFloat(entryPayment.amount))}</div>
                        )}
                      </div>
                      <div className="flex gap-2 items-start">
                        <div className="flex items-center gap-1">
                          <select className="w-40 border rounded-lg px-3 py-2 text-sm bg-white" value={entryPayment.method} onChange={e => setEntryPayment(p => ({ ...p, method: e.target.value }))}>
                            {(methods.length>0 ? methods : [
                              { value: 'dinheiro', label: 'Dinheiro' },
                              { value: 'pix', label: 'Pix' },
                              { value: 'debito', label: 'Débito' },
                              { value: 'credito', label: 'Crédito' },
                            ]).map(m => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => setShowNewMethod(v=>!v)} className="px-2 py-2 text-xs border rounded-md bg-white hover:bg-gray-50">+ </button>
                        </div>
                        <div className="flex items-center gap-1">
                          <select className="w-48 border rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50" value={entryPayment.account_label} onChange={e => setEntryPayment(p => ({ ...p, account_label: e.target.value }))} disabled={entryPayment.method==='dinheiro'}>
                            <option value="">Selecione a conta</option>
                            {accounts.map(a => (
                              <option key={a.id} value={a.label}>{a.label}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => setShowNewAccount(v=>!v)} className="px-2 py-2 text-xs border rounded-md bg-white hover:bg-gray-50">+ </button>
                        </div>
                      </div>
                      {showNewMethod && (
                        <div className="flex gap-2 items-center">
                          <input className="w-40 border rounded-lg px-3 py-1.5 text-sm bg-white" placeholder="Nova forma (ex.: pix)" value={newMethodName} onChange={e=>setNewMethodName(e.target.value)} />
                          <button type="button" onClick={async()=>{ if(!newMethodName.trim())return; try{ await window.api.paymentMethods.create({ name: newMethodName.trim().toLowerCase(), active:1}); const r=await window.api.paymentMethods.list(); setMethods((r||[]).filter(m=>m.active).map(m=>({value:m.name,label:m.name.charAt(0).toUpperCase()+m.name.slice(1)}))); setEntryPayment(p=>({ ...p, method: newMethodName.trim().toLowerCase() })); setNewMethodName(''); setShowNewMethod(false);} catch{} }} disabled={!newMethodName.trim()} className="px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded-md disabled:opacity-40">Adicionar</button>
                          <button type="button" onClick={()=>{setShowNewMethod(false);setNewMethodName('');}} className="px-2.5 py-1.5 text-xs border rounded-md bg-white">Cancelar</button>
                        </div>
                      )}
                      {showNewAccount && (
                        <div className="flex gap-2 items-center">
                          <input className="w-48 border rounded-lg px-3 py-1.5 text-sm bg-white" placeholder="Nova conta (ex.: Caixa)" value={newAccountLabel} onChange={e=>setNewAccountLabel(e.target.value)} />
                          <button type="button" onClick={async()=>{ if(!newAccountLabel.trim())return; try{ await window.api.bankAccounts.create({ label: newAccountLabel.trim() }); const r=await window.api.bankAccounts.list(); setAccounts(r||[]); setEntryPayment(p=>({ ...p, account_label: newAccountLabel.trim() })); setNewAccountLabel(''); setShowNewAccount(false);} catch{} }} disabled={!newAccountLabel.trim()} className="px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded-md disabled:opacity-40">Adicionar</button>
                          <button type="button" onClick={()=>{setShowNewAccount(false);setNewAccountLabel('');}} className="px-2.5 py-1.5 text-xs border rounded-md bg-white">Cancelar</button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">O pagamento será lançado automaticamente no caixa.</div>
                  </div>
                )}
              </div>

        </div>
      </Modal>
    </div>
  );
}
