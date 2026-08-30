import React, { useEffect, useState, useCallback } from 'react';
import { useModalFocus } from '../useModalFocus';
import Modal from '../components/Modal';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search, Phone, Mail, MapPin, RefreshCw, MessageCircle } from 'lucide-react';
import { fmtDate, brl, STATUS_LABELS, STATUS_COLORS } from '../utils';
import { useToastCtx } from '../ToastContext';

const emptyForm = { first_name: '', last_name: '', phone: '', email: '', address: '' };

export default function Clientes() {
  const navigate = useNavigate();
  const toast = useToastCtx();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const firstInputRef = useModalFocus(showForm);
  const [selected, setSelected] = useState(null);
  const [clientOS, setClientOS] = useState([]);
  const [loadingOS, setLoadingOS] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setClients(await window.api.clients.list() || []); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = q
    ? clients.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || '').includes(q) || (c.first_name||'').toLowerCase().includes(q.toLowerCase()) || (c.last_name||'').toLowerCase().includes(q.toLowerCase()))
    : clients;

  async function handleSubmit() {
    if (!form.first_name?.trim()) { toast.error('Informe o nome.'); return; }
    try {
      if (editing) {
        await window.api.clients.update({ id: editing, ...form });
        toast.success('Cliente atualizado!');
      } else {
        await window.api.clients.create(form);
        toast.success('Cliente cadastrado!');
      }
      setForm(emptyForm); setShowForm(false); setEditing(null); load();
    } catch { toast.error('Erro ao salvar cliente.'); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Excluir cliente "${name}"? As OS vinculadas não serão excluídas.`)) return;
    try {
      await window.api.clients.delete(id);
      toast.success('Cliente excluído.');
      if (selected?.id === id) setSelected(null);
      load();
    } catch { toast.error('Erro ao excluir cliente.'); }
  }

  async function handleSelect(client) {
    setSelected(client);
    setLoadingOS(true);
    try { setClientOS(await window.api.clients.getOS(client.id) || []); }
    finally { setLoadingOS(false); }
  }

  function startEdit(c) {
    setForm({ first_name: c.first_name ?? '', last_name: c.last_name ?? '', phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '' });
    setEditing(c.id);
    setShowForm(true);
  }

  function openWhatsApp(phone) {
    const p = (phone || '').replace(/\D/g, '');
    if (!p) return;
    window.open(`https://wa.me/${p}`, '_blank');
  }

  return (
    <div className="p-4 flex gap-4 h-full">
      {/* Lista de clientes */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-800">Clientes</h1>
          <button onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(true); }} className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700">
            <Plus size={15} /> Novo Cliente
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex gap-2 items-center">
          <Search size={14} className="text-gray-400" />
          <input
            className="outline-none flex-1 text-sm"
            placeholder="Buscar por nome ou telefone..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button onClick={load} className="p-1 text-gray-400 hover:text-gray-600"><RefreshCw size={14} /></button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="text-center py-10 text-gray-400 text-sm">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">Nenhum cliente encontrado.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Nome', 'Telefone', 'E-mail', 'Endereço', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => handleSelect(c)}
                    className={`border-b last:border-0 cursor-pointer transition-colors ${selected?.id === c.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-3 py-2.5 font-medium">{c.name}</td>
                    <td className="px-3 py-2.5 text-gray-500">
                      <div className="flex items-center gap-1.5">
                        {c.phone || '-'}
                        {c.phone && (
                          <button onClick={e => { e.stopPropagation(); openWhatsApp(c.phone); }} className="text-green-500 hover:text-green-600" title="WhatsApp">
                            <MessageCircle size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500">{c.email || '-'}</td>
                    <td className="px-3 py-2.5 text-gray-500 max-w-[180px] truncate">{c.address || '-'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        <button onClick={() => startEdit(c)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(c.id, c.name)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="text-xs text-gray-400 mt-2">{filtered.length} cliente(s)</div>
      </div>

      {/* Painel lateral: histórico do cliente */}
      {selected && (
        <div className="w-80 shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="font-bold text-gray-800">{selected.name}</h2>
                <div className="text-xs text-gray-400 mt-0.5">Cadastrado em {fmtDate(selected.created_at)}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>
            <div className="space-y-1.5 mb-4">
              {selected.phone && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Phone size={13} className="text-gray-400" /> {selected.phone}
                </div>
              )}
              {selected.email && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Mail size={13} className="text-gray-400" /> {selected.email}
                </div>
              )}
              {selected.address && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin size={13} className="text-gray-400" /> {selected.address}
                </div>
              )}
            </div>

            <div className="border-t pt-3">
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Ordens de Serviço</div>
              {loadingOS ? (
                <div className="text-xs text-gray-400 py-3 text-center">Carregando...</div>
              ) : clientOS.length === 0 ? (
                <div className="text-xs text-gray-400 py-3 text-center">Nenhuma OS encontrada.</div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {clientOS.map(o => (
                    <div
                      key={o.id}
                      onClick={() => navigate(`/os/${o.id}`)}
                      className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <div>
                        <div className="text-xs font-mono text-gray-400">#{o.number}</div>
                        <div className="text-sm font-medium text-gray-700 leading-tight">OS #{o.number}</div>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[o.status] || 'bg-gray-100'}`}>
                          {STATUS_LABELS[o.status] || o.status}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-gray-700">R$ {brl(o.total)}</div>
                        <div className="text-xs text-gray-400">{fmtDate(o.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={`${editing ? 'Editar' : 'Novo'} Cliente`}
        maxWidth="max-w-md"
        footer={
          <>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
            <button type="button" onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Salvar</button>
          </>
        }
      >
        <div className="flex gap-2">
          <input ref={firstInputRef} className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Nome *" value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
          <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Sobrenome *" value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} required />
        </div>
        <div>
          <input
            className={`w-full border rounded-lg px-3 py-2 text-sm ${!form.phone ? 'border-yellow-300 bg-yellow-50' : ''}`}
            placeholder="Telefone / WhatsApp (recomendado)"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          />
          {!form.phone && <div className="text-xs text-yellow-600 mt-1 ml-1">⚠️ Recomendado para contato e WhatsApp</div>}
        </div>
        <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="E-mail" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Endereço" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
      </Modal>
    </div>
  );
}
