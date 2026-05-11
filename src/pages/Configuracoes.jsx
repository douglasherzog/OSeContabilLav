import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Phone, MapPin, Mail, Globe, Save, RefreshCw, Plus, Trash2, Pencil } from 'lucide-react';
import { useToastCtx } from '../ToastContext';

const emptyForm = {
  name: '', legal_name: '', cnpj: '',
  address: '', neighborhood: '', city: '', state: '',
  phone1: '', phone2: '', email: '', website: '',
};

export default function Configuracoes() {
  const toast = useToastCtx();
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Métodos de pagamento
  const [methods, setMethods] = useState([]);
  const [newMethod, setNewMethod] = useState('');
  const [editingMethod, setEditingMethod] = useState(null);
  const [editingMethodName, setEditingMethodName] = useState('');
  // Contas bancárias
  const [accounts, setAccounts] = useState([]);
  const [newAccountLabel, setNewAccountLabel] = useState('');
  const [editingAccount, setEditingAccount] = useState(null);
  const [editingAccountLabel, setEditingAccountLabel] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.company.get();
      setForm(f => ({ ...f, ...data }));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      try {
        const m = await window.api.paymentMethods.list();
        setMethods(m || []);
      } catch {}
      try {
        const a = await window.api.bankAccounts.list();
        setAccounts(a || []);
      } catch {}
    })();
  }, []);

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Nome fantasia é obrigatório.'); return; }
    setSaving(true);
    try {
      await window.api.company.update(form);
      toast.success('Dados da empresa salvos!');
    } catch { toast.error('Erro ao salvar.'); }
    finally { setSaving(false); }
  }

  // Métodos de pagamento — CRUD
  async function addMethod() {
    const name = (newMethod || '').trim().toLowerCase();
    if (!name) return;
    try {
      const res = await window.api.paymentMethods.create({ name, active: 1 });
      if (res?.ok === false) throw new Error(res.error || 'Erro');
      try {
        const m = await window.api.paymentMethods.list();
        setMethods(m || []);
      } catch (e2) {
        console.error('paymentMethods.list error', e2);
      }
      setNewMethod('');
      toast.success('Forma de pagamento adicionada!');
    } catch (e) { 
      console.error('paymentMethods.create error', e);
      toast.error('Erro ao adicionar forma de pagamento: ' + (e?.message || '')); 
    }
  }
  async function toggleMethodActive(name, active) {
    try {
      const res = await window.api.paymentMethods.update({ name, active: active ? 1 : 0 });
      if (res?.ok === false) throw new Error(res.error || 'Erro');
      const m = await window.api.paymentMethods.list();
      setMethods(m || []);
    } catch { toast.error('Erro ao atualizar.'); }
  }
  async function deleteMethod(name) {
    if (!confirm(`Desativar forma "${name}"?`)) return;
    try {
      const res = await window.api.paymentMethods.delete({ name });
      if (res?.ok === false) throw new Error(res.error || 'Erro');
      const m = await window.api.paymentMethods.list();
      setMethods(m || []);
      toast.success('Forma desativada!');
    } catch { toast.error('Erro ao desativar.'); }
  }

  // Contas bancárias — CRUD
  async function addAccount() {
    const label = (newAccountLabel || '').trim();
    if (!label) return;
    try {
      await window.api.bankAccounts.create({ label });
      try {
        const a = await window.api.bankAccounts.list();
        setAccounts(a || []);
      } catch (e2) {
        console.error('bankAccounts.list error', e2);
      }
      setNewAccountLabel('');
      toast.success('Conta adicionada!');
    } catch (e) { 
      console.error('bankAccounts.create error', e);
      toast.error('Erro ao adicionar conta: ' + (e?.message || ''));
    }
  }
  async function saveAccountEdit(id) {
    try {
      await window.api.bankAccounts.update({ id, label: editingAccountLabel, active: 1 });
      const a = await window.api.bankAccounts.list();
      setAccounts(a || []);
      setEditingAccount(null); setEditingAccountLabel('');
      toast.success('Conta atualizada!');
    } catch { toast.error('Erro ao atualizar conta.'); }
  }
  async function deleteAccount(id) {
    if (!confirm('Desativar conta?')) return;
    try {
      await window.api.bankAccounts.delete(id);
      const a = await window.api.bankAccounts.list();
      setAccounts(a || []);
      toast.success('Conta desativada!');
    } catch { toast.error('Erro ao desativar.'); }
  }

  const f = (key) => ({
    value: form[key] ?? '',
    onChange: e => setForm(p => ({ ...p, [key]: e.target.value })),
  });

  if (loading) return <div className="p-8 text-gray-400 flex items-center gap-2"><RefreshCw size={16} className="animate-spin" /> Carregando...</div>;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Configurações</h1>
          <p className="text-xs text-gray-400 mt-0.5">Dados da empresa usados nos cupons e recibos</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          <Save size={14} /> {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      <div className="space-y-5">

        {/* Identificação */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={16} className="text-blue-500" />
            <h2 className="font-semibold text-gray-700 text-sm">Identificação</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Nome Fantasia *</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Lavanderia Senhor dos Passos" {...f('name')} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Razão Social</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Herzog Comercial LTDA" {...f('legal_name')} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">CNPJ</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="00.000.000/0000-00" {...f('cnpj')} />
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <MapPin size={16} className="text-blue-500" />
            <h2 className="font-semibold text-gray-700 text-sm">Endereço</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Rua / Logradouro</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Rua Senhor dos Passos, 155" {...f('address')} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Bairro</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Centro" {...f('neighborhood')} />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Cidade</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Rio Pardo" {...f('city')} />
              </div>
              <div className="w-20">
                <label className="text-xs text-gray-500 mb-1 block">UF</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="RS" maxLength={2} {...f('state')} />
              </div>
            </div>
          </div>
        </div>

        {/* Contato */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Phone size={16} className="text-blue-500" />
            <h2 className="font-semibold text-gray-700 text-sm">Contato</h2>
          </div>
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Telefone / WhatsApp 1</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="(51) 99999-9999" {...f('phone1')} />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Telefone 2 (opcional)</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="(51) 99999-9999" {...f('phone2')} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">E-mail</label>
              <input type="email" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="contato@empresa.com.br" {...f('email')} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Site (opcional)</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="www.empresa.com.br" {...f('website')} />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-3">Pré-visualização nos documentos</p>
          <div className="text-center font-mono text-xs text-gray-700 space-y-0.5">
            <div className="font-bold text-sm">{form.name || '—'}</div>
            {form.legal_name && <div>{form.legal_name}</div>}
            {(form.address || form.neighborhood || form.city) && (
              <div>{[form.address, form.neighborhood, form.city && form.state ? `${form.city}/${form.state}` : form.city].filter(Boolean).join(' — ')}</div>
            )}
            {form.cnpj && <div>CNPJ: {form.cnpj}</div>}
            {(form.phone1 || form.phone2) && (
              <div>{[form.phone1, form.phone2].filter(Boolean).join(' / ')}</div>
            )}
            {form.email && <div>{form.email}</div>}
          </div>
        </div>

        {/* Formas de Pagamento */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 text-sm">Formas de Pagamento</h2>
            <div className="flex gap-1">
              <input className="border rounded-lg px-3 py-1.5 text-sm" placeholder="ex.: pix" value={newMethod} onChange={e=>setNewMethod(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); addMethod(); } }} />
              <button onClick={addMethod} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm"><Plus size={14} /></button>
            </div>
          </div>
          <div className="divide-y">
            {(methods||[]).length===0 && <div className="text-sm text-gray-400">Nenhuma forma cadastrada.</div>}
            {methods.map(m => (
              <div key={m.name} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${m.active? 'bg-green-100 text-green-700':'bg-gray-100 text-gray-500'}`}>{m.active? 'ativa':'inativa'}</span>
                  <span className="font-medium">{m.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleMethodActive(m.name, !m.active)} className="px-2 py-1 border rounded text-xs">{m.active? 'Desativar':'Ativar'}</button>
                  <button onClick={() => deleteMethod(m.name)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contas/Bancos */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 text-sm">Contas / Bancos</h2>
            <div className="flex gap-1">
              <input className="border rounded-lg px-3 py-1.5 text-sm" placeholder="ex.: Caixa" value={newAccountLabel} onChange={e=>setNewAccountLabel(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); addAccount(); } }} />
              <button onClick={addAccount} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm"><Plus size={14} /></button>
            </div>
          </div>
          <div className="divide-y">
            {(accounts||[]).length===0 && <div className="text-sm text-gray-400">Nenhuma conta ativa.</div>}
            {accounts.map(a => (
              <div key={a.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  {editingAccount === a.id ? (
                    <input className="border rounded-lg px-2 py-1 text-sm" value={editingAccountLabel} onChange={e=>setEditingAccountLabel(e.target.value)} />
                  ) : (
                    <span className="font-medium">{a.label}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {editingAccount === a.id ? (
                    <>
                      <button onClick={() => saveAccountEdit(a.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Salvar</button>
                      <button onClick={() => { setEditingAccount(null); setEditingAccountLabel(''); }} className="px-2 py-1 border rounded text-xs">Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingAccount(a.id); setEditingAccountLabel(a.label); }} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
                      <button onClick={() => deleteAccount(a.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  );
}
