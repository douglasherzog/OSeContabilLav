import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Printer, MessageCircle } from 'lucide-react';
import { brl, fmtDateTime, fmtDate, today, STATUS_LABELS, STATUS_COLORS } from '../utils';
import { useToastCtx } from '../ToastContext';

const STATUSES = ['aberta', 'pronta', 'entregue', 'entregue_pendente'];
const METHODS = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix',      label: 'Pix' },
  { value: 'debito',   label: 'Débito' },
  { value: 'credito',  label: 'Crédito' },
];
const WHEN_TYPES = [
  { value: 'entrada',       label: 'Na entrada' },
  { value: 'apos_entrada',  label: 'Após entrada' },
  { value: 'retirada',      label: 'Na retirada' },
  { value: 'apos_retirada', label: 'Após retirada' },
];

export default function OSDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToastCtx();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [payForm, setPayForm] = useState({ amount: '', method: 'dinheiro', when_type: 'retirada', payment_date: today(), note: '' });
  const [itemForm, setItemForm] = useState({ description: '', quantity: '1', unit_price: '' });
  const [showPayForm, setShowPayForm] = useState(false);
  const [showItemForm, setShowItemForm] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [catalogMode, setCatalogMode] = useState(true);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [showNewService, setShowNewService] = useState(false);
  const [newServiceForm, setNewServiceForm] = useState({ name: '', unit_price: '', unit: 'peca' });
  const [company, setCompany] = useState({});

  const load = async () => {
    setLoading(true);
    const data = await window.api.os.get(parseInt(id));
    setOrder(data);
    setForm({
      status: data?.status || 'aberta',
      total: data?.total || 0,
      note: data?.note || '',
      assigned_to: data?.assigned_to || '',
      created_at: data?.created_at || '',
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);
  useEffect(() => { window.api.services.list(false).then(r => setCatalog(r || [])); }, []);
  useEffect(() => { window.api.company.get().then(d => setCompany(d || {})); }, []);

  async function handleQuickNewService() {
    try {
      const s = await window.api.services.create({ name: newServiceForm.name, unit_price: parseFloat(newServiceForm.unit_price) || 0, unit: newServiceForm.unit, category: 'geral' });
      const updated = await window.api.services.list(false);
      setCatalog(updated || []);
      setItemForm(f => ({ ...f, description: s.name, unit_price: String(s.unit_price || '') }));
      setNewServiceForm({ name: '', unit_price: '', unit: 'peca' });
      setShowNewService(false);
      toast.success('Serviço cadastrado!');
    } catch { toast.error('Erro ao cadastrar serviço.'); }
  }

  async function handleSave() {
    try {
      const newDate = form.created_at ? form.created_at.slice(0, 10) : null;
      if (newDate) {
        const payDates = (order.payments || []).map(p => p.payment_date).filter(Boolean);
        const tooEarly = payDates.find(pd => pd.slice(0, 10) < newDate);
        if (tooEarly) {
          toast.error(`Data da OS não pode ser posterior ao pagamento de ${tooEarly.slice(0, 10).split('-').reverse().join('/')}.`);
          return;
        }
      }
      await window.api.os.update({ id: parseInt(id), ...form, total: parseFloat(form.total) || 0 });
      setEditing(false);
      load();
      toast.success('OS atualizada com sucesso!');
    } catch { toast.error('Erro ao salvar OS.'); }
  }

  async function handleDelete() {
    if (!confirm(`Excluir OS #${order?.number}?`)) return;
    try {
      await window.api.os.delete(parseInt(id));
      toast.success('OS excluída.');
      navigate('/os');
    } catch { toast.error('Erro ao excluir OS.'); }
  }

  async function handleAddPayment() {
    try {
      const amt = parseFloat(payForm.amount);
      await window.api.os.addPayment({
        order_id: parseInt(id),
        amount: amt,
        method: payForm.method,
        when_type: payForm.when_type,
        payment_date: payForm.payment_date,
        note: payForm.note,
      });
      setPayForm({ amount: '', method: 'dinheiro', when_type: 'retirada', payment_date: today(), note: '' });
      setShowPayForm(false);
      load();
      toast.success('Pagamento registrado e lançado no caixa!');
    } catch { toast.error('Erro ao registrar pagamento.'); }
  }

  async function handleDeletePayment(payment_id) {
    if (!confirm('Remover este pagamento?')) return;
    try {
      await window.api.os.deletePayment({ payment_id, order_id: parseInt(id) });
      load();
      toast.success('Pagamento removido.');
    } catch { toast.error('Erro ao remover pagamento.'); }
  }

  async function reloadAndSyncEntry() {
    const updated = await window.api.os.get(parseInt(id));
    setOrder(updated);
    const reqEnt = (updated.items || []).reduce((s, i) => s + (i.requires_entry ? (i.total || 0) * (i.entry_pct || 50) / 100 : 0), 0);
    const paidEnt = (updated.payments || []).filter(p => p.when_type === 'entrada').reduce((s, p) => s + (p.amount || 0), 0);
    const pending = Math.max(0, reqEnt - paidEnt);
    if (pending > 0.01) {
      setShowPayForm(true);
      setPayForm(f => ({ ...f, amount: pending.toFixed(2), when_type: 'entrada' }));
    } else if (reqEnt <= 0.01) {
      // sem obrigatoriedade, fechar painel se estava aberto por causa da entrada
      setShowPayForm(false);
    }
  }

  async function handleAddItem() {
    try {
      await window.api.os.addItem({ order_id: parseInt(id), description: itemForm.description, quantity: parseFloat(itemForm.quantity) || 1, unit_price: parseFloat(itemForm.unit_price) || 0 });
      setItemForm({ description: '', quantity: '1', unit_price: '' });
      setShowItemForm(false);
      setCatalogSearch('');
      await reloadAndSyncEntry();
      toast.success('Item adicionado!');
    } catch { toast.error('Erro ao adicionar item.'); }
  }

  async function handleDeleteItem(item_id) {
    if (!confirm('Remover este item?')) return;
    try {
      await window.api.os.deleteItem({ item_id, order_id: parseInt(id) });
      await reloadAndSyncEntry();
      toast.success('Item removido.');
    } catch { toast.error('Erro ao remover item.'); }
  }

  function openWhatsApp() {
    const phone = (order.client_phone || '').replace(/\D/g, '');
    if (!phone) { toast.warning('Telefone do cliente não cadastrado.'); return; }
    const msg = encodeURIComponent(`Olá ${order.client_name || ''}! Sua OS #${order.number} está com status: ${STATUS_LABELS[order.status] || order.status}.${order.expected_at ? ` Previsão de entrega: ${fmtDate(order.expected_at)}.` : ''}`);
    window.open(`https://wa.me/55${phone}?text=${msg}`, '_blank');
  }

  function printHTML(html, title) {
    const w = window.open('', '_blank', 'width=800,height=900');
    w.document.write(html);
    w.document.close();
  }

  function handlePrintCupom() {
    const paidAmt = (order.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    const rem = Math.max(0, (order.total || 0) - paidAmt);
    const now = new Date();
    const nowStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const methodLabel = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', transferencia: 'Transferência' };
    const c = company;
    const cAddr = [c.address, c.neighborhood, c.city && c.state ? `${c.city}/${c.state}` : c.city].filter(Boolean).join(' — ');
    const cPhone = [c.phone1, c.phone2].filter(Boolean).join(' / ');
    printHTML(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>Cupom OS #${order.number}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; background: #fff;
             width: 80mm; margin: 0 auto; padding: 4mm; }
      .center { text-align: center; }
      .bold { font-weight: bold; }
      .line { border-top: 1px dashed #000; margin: 6px 0; }
      .line-solid { border-top: 1px solid #000; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; margin: 2px 0; }
      .item-desc { flex: 1; margin-right: 4px; }
      .item-val { white-space: nowrap; }
      .items-table { width: 100%; border-collapse: collapse; }
      .items-table td { padding: 1px 0; font-size: 12px; vertical-align: top; }
      .items-table td.desc { width: 100%; word-break: break-word; padding-right: 6px; }
      .items-table td.val { white-space: nowrap; text-align: right; }
      .big { font-size: 15px; font-weight: bold; }
      .sig { margin-top: 16px; }
      .sig-line { border-top: 1px solid #000; margin-top: 28px; width: 100%; }
      .sig-label { font-size: 10px; text-align: center; margin-top: 2px; color: #444; }
      @media print {
        body { width: 80mm; }
        @page { margin: 0; size: 80mm auto; }
      }
    </style></head><body>
    <div class="center bold" style="font-size:14px;">${(c.name||'').toUpperCase()}</div>
    ${c.legal_name ? `<div class="center" style="font-size:10px;">${c.legal_name}</div>` : ''}
    ${cAddr ? `<div class="center" style="font-size:10px;">${cAddr}</div>` : ''}
    ${c.cnpj ? `<div class="center" style="font-size:10px;">CNPJ: ${c.cnpj}</div>` : ''}
    ${cPhone ? `<div class="center" style="font-size:10px;">${cPhone}</div>` : ''}
    <div class="line-solid"></div>
    <div class="center bold">CUPOM DE RETIRADA</div>
    <div class="center" style="font-size:10px;">${nowStr}</div>
    <div class="line"></div>
    <div class="row"><span>OS Nº:</span><span class="bold">#${order.number}</span></div>
    <div class="row"><span>Cliente:</span><span class="bold">${order.client_name || '-'}</span></div>
    ${order.client_phone ? `<div class="row"><span>Fone:</span><span>${order.client_phone}</span></div>` : ''}
    ${order.note ? `<div style="font-size:10px;margin-top:2px;">Obs: ${order.note}</div>` : ''}
    <div class="line"></div>
    <div class="bold" style="margin-bottom:4px;">ITENS</div>
    <table class="items-table">
    ${(order.items || []).map(i => `
      <tr>
        <td class="desc">${i.quantity > 1 ? i.quantity + 'x ' : ''}${i.description}</td>
        <td class="val">R$ ${brl(i.total)}</td>
      </tr>`).join('')}
    </table>
    <div class="line-solid"></div>
    <div class="row big"><span>TOTAL</span><span>R$ ${brl(order.total)}</span></div>
    ${paidAmt > 0.01 ? `<div class="row" style="color:#000;"><span>Pago</span><span>R$ ${brl(paidAmt)}</span></div>` : ''}
    <div class="row bold" style="${rem <= 0.01 ? '' : 'font-size:13px;'}"><span>${rem <= 0.01 ? 'QUITADO ✓' : 'RESTANTE'}</span><span>${rem <= 0.01 ? '' : 'R$ ' + brl(rem)}</span></div>
    ${(order.payments || []).length > 0 ? `
    <div class="line"></div>
    <div style="font-size:10px;"><span class="bold">Pagamentos:</span></div>
    ${order.payments.map(p => `<div class="row" style="font-size:10px;">
      <span>${p.payment_date ? fmtDate(p.payment_date) : '-'} — ${methodLabel[p.method] || p.method}</span>
      <span>R$ ${brl(p.amount)}</span>
    </div>`).join('')}` : ''}
    <div class="line"></div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-label">Assinatura do cliente / Responsável pela retirada</div>
    </div>
    <div class="line" style="margin-top:14px;"></div>
    <div class="center" style="font-size:9px;">Documento sem valor fiscal · ${nowStr}</div>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
  }

  function handlePrintRecibo() {
    const paidAmt = (order.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    const rem = Math.max(0, (order.total || 0) - paidAmt);
    const now = new Date();
    const nowStr = now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const methodLabel = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', transferencia: 'Transferência' };
    const c = company;
    const cAddr = [c.address, c.neighborhood, c.city && c.state ? `${c.city}/${c.state}` : c.city].filter(Boolean).join(' — ');
    const cPhone = [c.phone1, c.phone2].filter(Boolean).join(' / ');
    printHTML(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>Recibo OS #${order.number}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 28px 36px; max-width: 720px; margin: 0 auto; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #111; padding-bottom: 14px; margin-bottom: 18px; }
      .company h1 { font-size: 20px; font-weight: bold; }
      .company p { font-size: 11px; color: #555; margin-top: 2px; }
      .doc-info { text-align: right; }
      .doc-info .os-num { font-size: 22px; font-weight: bold; color: #111; }
      .doc-info p { font-size: 11px; color: #555; }
      .section { margin-bottom: 18px; }
      .section-title { font-weight: bold; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
                       color: #666; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
      .row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
      .label { color: #666; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { text-align: left; padding: 6px 6px; background: #f9fafb; border-bottom: 2px solid #e5e7eb; font-size: 11px; color: #555; }
      td { padding: 6px 6px; border-bottom: 1px solid #f3f4f6; }
      td.right, th.right { text-align: right; }
      .total-block { margin-top: 12px; border-top: 2px solid #111; padding-top: 10px; }
      .total-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
      .total-row.main { font-size: 17px; font-weight: bold; }
      .green { color: #16a34a; }
      .orange { color: #d97706; }
      .sig-area { margin-top: 36px; display: flex; gap: 40px; }
      .sig-box { flex: 1; }
      .sig-line { border-top: 1px solid #555; margin-top: 40px; }
      .sig-label { font-size: 10px; color: #666; margin-top: 4px; text-align: center; }
      .footer { margin-top: 24px; border-top: 1px dashed #ccc; padding-top: 10px; text-align: center; font-size: 10px; color: #aaa; }
      @media print { body { padding: 16px 20px; } @page { margin: 10mm; } }
    </style></head><body>
    <div class="header">
      <div class="company">
        <h1>${c.name || ''}</h1>
        ${c.legal_name || cAddr ? `<p>${[c.legal_name, cAddr].filter(Boolean).join(' &nbsp;|&nbsp; ')}</p>` : ''}
        ${c.cnpj || cPhone ? `<p>${[c.cnpj ? 'CNPJ: ' + c.cnpj : '', cPhone].filter(Boolean).join(' &nbsp;|&nbsp; ')}</p>` : ''}
      </div>
      <div class="doc-info">
        <div class="os-num">OS #${order.number}</div>
        <p>Emitido em ${nowStr}</p>
        <p>Status: <strong>${STATUS_LABELS[order.status] || order.status}</strong></p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Dados do Cliente</div>
      <div class="row"><span class="label">Nome:</span><span><strong>${order.client_name || '-'}</strong></span></div>
      <div class="row"><span class="label">Telefone:</span><span>${order.client_phone || '-'}</span></div>
      ${order.assigned_to ? `<div class="row"><span class="label">Responsável:</span><span>${order.assigned_to}</span></div>` : ''}
      ${order.note ? `<div class="row"><span class="label">Observações:</span><span style="color:#555">${order.note}</span></div>` : ''}
    </div>

    ${(order.items || []).length > 0 ? `
    <div class="section">
      <div class="section-title">Itens do Serviço</div>
      <table>
        <thead><tr><th>Descrição</th><th class="right">Qtd</th><th class="right">Valor Unit.</th><th class="right">Total</th></tr></thead>
        <tbody>
          ${order.items.map(i => `<tr>
            <td>${i.description}</td>
            <td class="right">${i.quantity}</td>
            <td class="right">R$ ${brl(i.unit_price)}</td>
            <td class="right">R$ ${brl(i.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <div class="section">
      <div class="section-title">Resumo Financeiro</div>
      ${(order.payments || []).length > 0 ? `
      <table>
        <thead><tr><th>Data</th><th>Forma de Pagamento</th><th>Momento</th><th class="right">Valor</th></tr></thead>
        <tbody>
          ${order.payments.map(p => `<tr>
            <td>${p.payment_date ? fmtDate(p.payment_date) : '-'}</td>
            <td>${methodLabel[p.method] || p.method}</td>
            <td>${{ entrada: 'Na entrada', retirada: 'Na retirada', apos_entrada: 'Após entrada', apos_retirada: 'Após retirada' }[p.when_type] || p.when_type}</td>
            <td class="right">R$ ${brl(p.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p style="color:#888;font-size:12px;">Nenhum pagamento registrado.</p>'}
      <div class="total-block">
        <div class="total-row"><span>Total dos serviços:</span><span>R$ ${brl(order.total)}</span></div>
        <div class="total-row green"><span>Total pago:</span><span>R$ ${brl(paidAmt)}</span></div>
        <div class="total-row main ${rem <= 0.01 ? 'green' : 'orange'}">
          <span>${rem <= 0.01 ? '✓ Conta quitada' : 'Restante a pagar'}:</span>
          <span>R$ ${brl(rem)}</span>
        </div>
      </div>
    </div>

    <div class="sig-area">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">Assinatura do cliente</div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">Responsável pela entrega</div>
      </div>
    </div>

    <div class="footer">Documento sem valor fiscal · ${c.name || ''} · ${nowStr}</div>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`);
  }

  const paid = (order?.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  const remaining = Math.max(0, (order?.total || 0) - paid);
  const requiredEntry = (order?.items || []).reduce((s, i) => s + (i.requires_entry ? (i.total || 0) * (i.entry_pct || 50) / 100 : 0), 0);
  const entryPaid = (order?.payments || []).filter(p => p.when_type === 'entrada').reduce((s, p) => s + (p.amount || 0), 0);
  const entryOk = requiredEntry <= 0.01 || entryPaid >= requiredEntry - 0.01;
  const entryPending = Math.max(0, requiredEntry - entryPaid);


  if (loading) return <div className="p-8 text-gray-400">Carregando...</div>;
  if (!order) return <div className="p-8 text-gray-400">OS não encontrada.</div>;

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <button
        type="button"
        onClick={() => {
          if (!entryOk) {
            if (!window.confirm(`Esta OS possui entrada obrigatória pendente de R$ ${brl(requiredEntry - entryPaid)}.\n\nDeseja sair mesmo assim?`)) return;
          }
          navigate('/os');
        }}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={15} /> Voltar
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-gray-400 mb-1">OS #{order.number} · {order.client_name}</div>
            {editing ? (
              <div className="space-y-3 mt-2">
                <div className="flex gap-2">
                  <select className="flex-1 border rounded-lg px-3 py-2 text-sm" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                  <input type="number" className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Total" value={form.total} onChange={e => setForm(f => ({ ...f, total: e.target.value }))} step="0.01" min="0" />
                </div>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Responsável" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} />
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Data da OS</label>
                  <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.created_at ? form.created_at.slice(0,10) : ''} onChange={e => setForm(f => ({ ...f, created_at: e.target.value }))} />
                </div>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Observações" rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
                <div className="flex gap-2">
                  <button type="button" onClick={handleSave} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">Salvar</button>
                  <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 border rounded-lg text-sm">Cancelar</button>
                </div>
              </div>
            ) : (
              <>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${STATUS_COLORS[order.status]}`}>{STATUS_LABELS[order.status]}</span>
                {order.assigned_to && <div className="text-sm text-gray-500 mt-1">Responsável: {order.assigned_to}</div>}
                {order.note && <div className="text-sm text-gray-500 mt-1">{order.note}</div>}
              </>
            )}
          </div>
          {!editing && (
            <div className="flex gap-2 flex-wrap justify-end">
              {order.client_phone && (
                <button onClick={openWhatsApp} className="flex items-center gap-1.5 px-3 py-1.5 border border-green-200 text-green-600 rounded-lg text-sm hover:bg-green-50" title="Enviar mensagem WhatsApp">
                  <MessageCircle size={14} /> WhatsApp
                </button>
              )}
              <button onClick={handlePrintCupom} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 text-gray-600" title="Cupom de retirada (80mm)">
                <Printer size={14} /> Cupom
              </button>
              <button onClick={handlePrintRecibo} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 text-gray-600" title="Recibo completo A4">
                <Printer size={14} /> Recibo A4
              </button>
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">Editar</button>
              <button onClick={handleDelete} className="px-3 py-1.5 border border-red-200 text-red-500 rounded-lg text-sm hover:bg-red-50"><Trash2 size={14} /></button>
            </div>
          )}
        </div>

        {/* Alerta saldo pendente */}
        {(order.status === 'entregue' || order.status === 'entregue_pendente') && remaining > 0.01 && (
          <div className="mt-3 flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-orange-700">
              <span className="text-base">⚠️</span>
              <span>OS entregue com saldo pendente de <strong>R$ {brl(remaining)}</strong></span>
            </div>
            {order.status === 'entregue' && (
              <button
                onClick={async () => {
                  await window.api.os.update({ id: order.id, ...form, status: 'entregue_pendente' });
                  load();
                  toast.success('Status atualizado para Entregue c/ Pendência.');
                }}
                className="text-xs px-2.5 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 whitespace-nowrap">
                Marcar como pendente
              </button>
            )}
          </div>
        )}

        {/* Totais */}
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t">
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-0.5">Total</div>
            <div className="font-bold text-gray-800">R$ {brl(order.total)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-0.5">Pago</div>
            <div className="font-bold text-green-600">R$ {brl(paid)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-0.5">Restante</div>
            <div className={`font-bold ${remaining <= 0.01 ? 'text-green-600' : 'text-yellow-600'}`}>R$ {brl(remaining)}</div>
          </div>
        </div>
      </div>

      {/* Itens */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700">Itens</h2>
          <button type="button" onClick={() => { setCatalogSearch(''); setShowItemForm(v => !v); }} className="flex items-center gap-1 text-sm text-blue-600 hover:underline"><Plus size={14} /> Adicionar</button>
        </div>
        {requiredEntry > 0.01 && (
          <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm border mb-3 ${
            entryOk ? 'bg-green-50 border-green-200 text-green-800' : 'bg-orange-50 border-orange-300 text-orange-800'
          }`}>
            <span className="text-base mt-0.5">{entryOk ? '✅' : '⚠️'}</span>
            <div>
              <div className="font-medium">{entryOk ? 'Entrada satisfeita' : 'Entrada obrigatória pendente'}</div>
              <div className="text-xs mt-0.5">
                {(order.items || []).filter(i => i.requires_entry).map(i => (
                  <span key={i.id} className="block">• {i.description}: {i.entry_pct}% de R$ {brl(i.total)} = <strong>R$ {brl(i.total * i.entry_pct / 100)}</strong></span>
                ))}
                <span className="block mt-1">Mínimo: <strong>R$ {brl(requiredEntry)}</strong> · Pago na entrada: <strong>R$ {brl(entryPaid)}</strong></span>
              </div>
            </div>
          </div>
        )}
        {showItemForm && (
          <div className="border rounded-lg p-3 bg-blue-50 mb-3 space-y-2">
            {/* Toggle catálogo / manual */}
            <div className="flex items-center justify-between">
            <div className="flex gap-1 bg-white rounded-lg border p-0.5 w-fit text-xs">
              <button type="button" onClick={() => setCatalogMode(true)}
                className={`px-3 py-1 rounded-md transition-colors ${catalogMode ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                Do catálogo
              </button>
              <button type="button" onClick={() => setCatalogMode(false)}
                className={`px-3 py-1 rounded-md transition-colors ${!catalogMode ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                Manual
              </button>
            </div>
            <button type="button" onClick={() => setShowNewService(v => !v)}
              className="text-xs text-blue-600 hover:underline">
              + Novo serviço
            </button>
            </div>

            {showNewService && (
              <div className="border rounded-lg p-2.5 bg-white space-y-1.5">
                <div className="text-xs font-medium text-gray-600 mb-1">Cadastrar novo serviço</div>
                <div className="space-y-1.5">
                  <input className="w-full border rounded-lg px-3 py-1.5 text-sm" placeholder="Nome do serviço *" value={newServiceForm.name} onChange={e => setNewServiceForm(f => ({ ...f, name: e.target.value }))} autoFocus />
                  <div className="flex gap-2">
                    <input type="number" className="flex-1 border rounded-lg px-3 py-1.5 text-sm" placeholder="Preço (R$)" value={newServiceForm.unit_price} onChange={e => setNewServiceForm(f => ({ ...f, unit_price: e.target.value }))} step="0.01" min="0" />
                    <select className="w-24 border rounded-lg px-2 py-1.5 text-sm" value={newServiceForm.unit} onChange={e => setNewServiceForm(f => ({ ...f, unit: e.target.value }))}>
                      {['peca','kg','m2','lugar','un','hora'].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleQuickNewService} disabled={!newServiceForm.name} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs disabled:opacity-40">Salvar e selecionar</button>
                    <button type="button" onClick={() => setShowNewService(false)} className="px-3 py-1.5 border rounded-lg text-xs">Cancelar</button>
                  </div>
                </div>
              </div>
            )}

            {catalogMode && catalog.length > 0 ? (
              <>
              <input
                className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
                placeholder="Buscar serviço..."
                value={catalogSearch}
                onChange={e => setCatalogSearch(e.target.value)}
                autoComplete="off"
                autoFocus
              />
              <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
                {catalog.filter(s => !catalogSearch || s.name.toLowerCase().includes(catalogSearch.toLowerCase())).map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setItemForm(f => ({ ...f, description: s.name, unit_price: String(s.unit_price || '') }))}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm text-left transition-colors ${itemForm.description === s.name ? 'border-blue-500 bg-blue-100' : 'bg-white hover:bg-blue-50 border-gray-200'}`}
                  >
                    <span className="font-medium text-gray-800">{s.name}</span>
                    <span className="text-gray-500 text-xs ml-2 shrink-0">{s.unit_price > 0 ? `R$ ${brl(s.unit_price)}` : '—'} / {s.unit}</span>
                  </button>
                ))}
              </div>
              </>
            ) : catalogMode && catalog.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-2">
                Nenhum serviço cadastrado no catálogo.{' '}
                <a href="#/servicos" className="text-blue-500 underline" onClick={() => setShowItemForm(false)}>Cadastrar agora</a>
              </div>
            ) : null}

            {(!catalogMode || itemForm.description) && (
              <>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder="Descrição do serviço *"
                  value={itemForm.description}
                  onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))}
                />
                <div className="flex gap-2">
                  <input type="number" className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white" placeholder="Qtd" value={itemForm.quantity} onChange={e => setItemForm(f => ({ ...f, quantity: e.target.value }))} step="0.01" min="0.01" />
                  <input type="number" className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white" placeholder="Preço unit. (R$)" value={itemForm.unit_price} onChange={e => setItemForm(f => ({ ...f, unit_price: e.target.value }))} step="0.01" min="0" />
                </div>
              </>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={handleAddItem} disabled={!itemForm.description} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-40">Adicionar</button>
              <button type="button" onClick={() => { setShowItemForm(false); setItemForm({ description: '', quantity: '1', unit_price: '' }); setCatalogSearch(''); }} className="px-3 py-1.5 border rounded-lg text-sm bg-white">Cancelar</button>
            </div>
          </div>
        )}
        {(order.items || []).length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-4">Nenhum item.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b"><th className="pb-2">Descrição</th><th className="pb-2 text-right">Qtd</th><th className="pb-2 text-right">Unit.</th><th className="pb-2 text-right">Total</th><th className="pb-2"></th></tr></thead>
            <tbody>
              {order.items.map(item => (
                <tr key={item.id} className="border-b last:border-0 group">
                  <td className="py-2">{item.description}</td>
                  <td className="py-2 text-right">{item.quantity}</td>
                  <td className="py-2 text-right">R$ {brl(item.unit_price)}</td>
                  <td className="py-2 text-right font-medium">R$ {brl(item.total)}</td>
                  <td className="py-2 pl-2">
                    <button onClick={() => handleDeleteItem(item.id)} className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagamentos */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700">Pagamentos</h2>
          <button onClick={() => {
            if (!showPayForm) {
              const r = Math.max(0, (order.total || 0) - (order.payments || []).reduce((s, p) => s + (p.amount || 0), 0));
              setPayForm(f => ({ ...f, amount: r > 0 ? r.toFixed(2) : '' }));
            }
            setShowPayForm(v => !v);
          }} className="flex items-center gap-1 text-sm text-green-600 hover:underline"><Plus size={14} /> Registrar</button>
        </div>
        {showPayForm && (() => {
          const paid = (order.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
          const remaining = Math.max(0, (order.total || 0) - paid);
          const half = Math.max(0, (order.total || 0) / 2);
          return (
          <div className="border rounded-lg p-3 bg-green-50 mb-3 space-y-2">
            {/* Atalhos de valor */}
            <div className="flex gap-1.5 flex-wrap">
              <span className="text-xs text-gray-500 self-center">Valor:</span>
              {remaining > 0 && (
                <button type="button" onClick={() => setPayForm(f => ({ ...f, amount: remaining.toFixed(2) }))}
                  className="text-xs px-2 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700">
                  Saldo restante (R$ {brl(remaining)})
                </button>
              )}
              {paid === 0 && half > 0 && (
                <button type="button" onClick={() => setPayForm(f => ({ ...f, amount: half.toFixed(2) }))}
                  className="text-xs px-2 py-1 bg-white border border-green-400 text-green-700 rounded-lg hover:bg-green-50">
                  50% (R$ {brl(half)})
                </button>
              )}
            </div>

            {/* Valor + método */}
            <div className="flex gap-2">
              <input type="number" className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white" placeholder="Valor (R$) *" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} required step="0.01" min="0.01" />
              <div className="flex gap-1">
                {METHODS.map(m => (
                  <button key={m.value} type="button"
                    onClick={() => setPayForm(f => ({ ...f, method: m.value }))}
                    className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      payForm.method === m.value
                        ? m.value === 'credito' ? 'bg-orange-500 text-white border-orange-500' : 'bg-green-600 text-white border-green-600'
                        : m.value === 'credito' ? 'bg-white text-orange-500 border-orange-300 hover:bg-orange-50' : 'bg-white text-gray-600 border-gray-200 hover:bg-green-50'
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Momento + data */}
            <div className="flex gap-2">
              <select className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white" value={payForm.when_type} onChange={e => setPayForm(f => ({ ...f, when_type: e.target.value }))}>
                {WHEN_TYPES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
              <input type="date" className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white" value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} />
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={handleAddPayment} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm">Registrar</button>
              <button type="button" onClick={() => setShowPayForm(false)} className="px-3 py-1.5 border rounded-lg text-sm bg-white">Cancelar</button>
            </div>
          </div>
          );
        })()}
        {(order.payments || []).length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-4">Nenhum pagamento registrado.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b text-xs"><th className="pb-2">Data</th><th className="pb-2">Método</th><th className="pb-2">Momento</th><th className="pb-2 text-right">Valor</th><th className="pb-2"></th></tr></thead>
            <tbody>
              {order.payments.map(p => (
                <tr key={p.id} className="border-b last:border-0 group text-sm">
                  <td className="py-2 text-gray-500">{p.payment_date ? fmtDate(p.payment_date) : fmtDate(p.created_at)}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      p.method === 'dinheiro' ? 'bg-green-100 text-green-700' :
                      p.method === 'pix'      ? 'bg-blue-100 text-blue-700' :
                      p.method === 'debito'   ? 'bg-purple-100 text-purple-700' :
                      'bg-orange-100 text-orange-700'
                    }`}>{METHODS.find(m => m.value === p.method)?.label || p.method}</span>
                  </td>
                  <td className="py-2 text-gray-500 text-xs">{WHEN_TYPES.find(w => w.value === p.when_type)?.label || p.when_type}</td>
                  <td className="py-2 text-right font-medium text-green-600">R$ {brl(p.amount)}</td>
                  <td className="py-2 pl-2">
                    <button onClick={() => handleDeletePayment(p.id)} className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
