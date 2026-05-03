import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Phone, MapPin, Mail, Globe, Save, RefreshCw } from 'lucide-react';
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.company.get();
      setForm(f => ({ ...f, ...data }));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Nome fantasia é obrigatório.'); return; }
    setSaving(true);
    try {
      await window.api.company.update(form);
      toast.success('Dados da empresa salvos!');
    } catch { toast.error('Erro ao salvar.'); }
    finally { setSaving(false); }
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
