import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Receipt, TrendingUp, TrendingDown, Wallet, Users, AlertTriangle, Clock, CheckCircle, PackageCheck, Phone } from 'lucide-react';
import { brl, fmtDateTime, STATUS_LABELS, STATUS_COLORS } from '../utils';

function StatCard({ icon: Icon, label, value, sub, color = 'blue', alert = false }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    slate: 'bg-slate-50 text-slate-600 border-slate-100',
  };
  return (
    <div className={`bg-white rounded-xl border p-4 flex items-center gap-4 ${alert ? 'border-red-300 ring-1 ring-red-200' : 'border-gray-200'}`}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${colors[color]}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-400 mb-0.5">{label}</div>
        <div className={`font-bold text-lg leading-tight ${alert ? 'text-red-600' : 'text-gray-800'}`}>{value}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
      {alert && <AlertTriangle size={16} className="text-red-400 shrink-0" />}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await window.api.dashboard.summary();
      setData(s);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return (
      <div className="p-6 flex items-center justify-center h-64 text-gray-400">
        <RefreshCw size={20} className="animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  const statusOrder = ['aberta', 'em_andamento', 'pronta', 'aguardando_pagamento', 'entregue'];

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Painel Geral</h1>
          <p className="text-xs text-gray-400 mt-0.5">Visão geral do negócio em tempo real</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm hover:bg-gray-50 text-gray-600">
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {/* Alerta de contas vencidas */}
      {data.apVencidas > 0 && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-500 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold text-red-700">Atenção!</span>
            <span className="text-red-600 text-sm ml-1">
              {data.apVencidas} conta{data.apVencidas > 1 ? 's' : ''} a pagar vencida{data.apVencidas > 1 ? 's' : ''} e não paga{data.apVencidas > 1 ? 's' : ''}.
            </span>
          </div>
          <button onClick={() => navigate('/contas-pagar')} className="text-sm text-red-600 font-medium hover:underline">Ver →</button>
        </div>
      )}

      {/* Alerta de contas vencendo em 7 dias */}
      {data.apVencendo7 > 0 && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <Clock size={18} className="text-yellow-500 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold text-yellow-700">Vencimento próximo!</span>
            <span className="text-yellow-600 text-sm ml-1">
              {data.apVencendo7} conta{data.apVencendo7 > 1 ? 's' : ''} a pagar vence{data.apVencendo7 > 1 ? 'm' : ''} nos próximos 7 dias.
            </span>
          </div>
          <button onClick={() => navigate('/contas-pagar')} className="text-sm text-yellow-700 font-medium hover:underline">Ver →</button>
        </div>
      )}

      {/* Cards principais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard icon={Receipt} label="OS em aberto" value={data.osAberta} sub="Não entregues" color="blue" />
        <StatCard icon={Clock} label="OS criadas hoje" value={data.osHoje} color="slate" />
        <StatCard
          icon={PackageCheck}
          label="Prontas p/ retirada"
          value={data.osProntas.length}
          sub={data.osProntas.length > 0 ? 'Aguardando cliente' : 'Nenhuma no momento'}
          color={data.osProntas.length > 0 ? 'yellow' : 'slate'}
          alert={data.osProntas.length > 0}
        />
        <StatCard
          icon={AlertTriangle}
          label="Contas vencidas"
          value={data.apVencidas}
          sub="A pagar"
          color="red"
          alert={data.apVencidas > 0}
        />
      </div>

      {/* Cards financeiros */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
        <StatCard icon={TrendingUp} label="Receitas do mês" value={`R$ ${brl(data.receitaMes)}`} sub="Entradas no caixa" color="green" />
        <StatCard icon={TrendingDown} label="Saídas do mês" value={`R$ ${brl(data.saidaMes)}`} sub="Saídas no caixa" color="red" />
        <StatCard
          icon={Wallet}
          label="Saldo do mês"
          value={`R$ ${brl(data.saldoMes)}`}
          sub={data.saldoMes >= 0 ? 'Positivo' : 'Negativo'}
          color={data.saldoMes >= 0 ? 'green' : 'red'}
        />
      </div>

      {/* OS prontas aguardando retirada */}
      {data.osProntas.length > 0 && (
        <div className="bg-white rounded-xl border border-yellow-200 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PackageCheck size={16} className="text-yellow-500" />
              <h2 className="font-semibold text-gray-700 text-sm">OS Prontas — Aguardando Retirada</h2>
              <span className="bg-yellow-100 text-yellow-700 text-xs font-bold px-2 py-0.5 rounded-full">{data.osProntas.length}</span>
            </div>
            <button onClick={() => navigate('/os')} className="text-xs text-blue-600 hover:underline">Ver todas →</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100">
                <th className="pb-2 font-medium text-xs">#</th>
                <th className="pb-2 font-medium text-xs">Cliente</th>
                <th className="pb-2 font-medium text-xs">Telefone</th>
                <th className="pb-2 font-medium text-xs text-right">Total</th>
                <th className="pb-2 font-medium text-xs text-right">Restante</th>
                <th className="pb-2 font-medium text-xs">Desde</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.osProntas.map(o => {
                const remaining = Math.max(0, (o.total || 0) - (o.paid || 0));
                const phone = o.client_phone ? o.client_phone.replace(/\D/g,'') : null;
                const wa = phone ? `https://wa.me/${phone}` : null;
                return (
                  <tr key={o.id} onClick={() => navigate(`/os/${o.id}`)} className="border-b last:border-0 hover:bg-yellow-50 cursor-pointer transition-colors">
                    <td className="py-2 font-mono text-gray-400 text-xs">#{o.number}</td>
                    <td className="py-2 font-medium">{o.client_name || '—'}</td>
                    <td className="py-2 text-gray-500 text-xs">{o.client_phone || '—'}</td>
                    <td className="py-2 text-right">R$ {brl(o.total)}</td>
                    <td className="py-2 text-right font-medium">
                      {remaining > 0.01
                        ? <span className="text-red-600">R$ {brl(remaining)}</span>
                        : <span className="text-green-600 text-xs">Quitada</span>}
                    </td>
                    <td className="py-2 text-gray-400 text-xs">{fmtDateTime(o.created_at)}</td>
                    <td className="py-2 text-right">
                      {wa && (
                        <a href={wa} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-700 px-2 py-1 rounded-lg hover:bg-green-50">
                          <Phone size={11} /> WhatsApp
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Contas a pagar / receber */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm">Resumo Financeiro Pendente</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
                <span className="text-sm text-gray-600">A pagar (pendente)</span>
              </div>
              <span className="font-semibold text-red-600">R$ {brl(data.apPendente)}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
                <span className="text-sm text-gray-600">A receber (pendente)</span>
              </div>
              <span className="font-semibold text-green-600">R$ {brl(data.arPendente)}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-gray-100">
              <span className="text-sm font-medium text-gray-600">Saldo líquido previsto</span>
              <span className={`font-bold ${data.arPendente - data.apPendente >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                R$ {brl(data.arPendente - data.apPendente)}
              </span>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => navigate('/contas-pagar')} className="flex-1 text-xs border rounded-lg py-1.5 hover:bg-gray-50 text-gray-600">Ver Contas a Pagar</button>
            <button onClick={() => navigate('/contas-receber')} className="flex-1 text-xs border rounded-lg py-1.5 hover:bg-gray-50 text-gray-600">Ver Contas a Receber</button>
          </div>
        </div>

        {/* OS por status */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm">OS por Status</h2>
          {data.osPorStatus.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-6">Nenhuma OS cadastrada.</div>
          ) : (
            <div className="space-y-2">
              {statusOrder.map(status => {
                const found = data.osPorStatus.find(s => s.status === status);
                const count = found?.c || 0;
                if (count === 0) return null;
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-36 text-center ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[status] || status}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-blue-400 transition-all"
                        style={{ width: `${Math.min(100, (count / Math.max(...data.osPorStatus.map(s => s.c))) * 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-700 w-6 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={() => navigate('/os')} className="w-full text-xs border rounded-lg py-1.5 hover:bg-gray-50 text-gray-600 mt-3">Ver todas as OS</button>
        </div>
      </div>

      {/* Últimas OS */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700 text-sm">Últimas Ordens de Serviço</h2>
          <button onClick={() => navigate('/os')} className="text-xs text-blue-600 hover:underline">Ver todas →</button>
        </div>
        {data.ultimasOS.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-6">Nenhuma OS cadastrada.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100">
                <th className="pb-2 font-medium text-xs">#</th>
                <th className="pb-2 font-medium text-xs">Cliente</th>
                <th className="pb-2 font-medium text-xs">Título</th>
                <th className="pb-2 font-medium text-xs">Status</th>
                <th className="pb-2 font-medium text-xs text-right">Total</th>
                <th className="pb-2 font-medium text-xs">Criado</th>
              </tr>
            </thead>
            <tbody>
              {data.ultimasOS.map(o => (
                <tr
                  key={o.id}
                  onClick={() => navigate(`/os/${o.id}`)}
                  className="border-b last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="py-2 font-mono text-gray-400 text-xs">#{o.number}</td>
                  <td className="py-2 font-medium">{o.client_name || '-'}</td>
                  <td className="py-2 text-gray-600">{o.title || '-'}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[o.status] || 'bg-gray-100'}`}>
                      {STATUS_LABELS[o.status] || o.status}
                    </span>
                  </td>
                  <td className="py-2 text-right font-medium">R$ {brl(o.total)}</td>
                  <td className="py-2 text-gray-400 text-xs">{fmtDateTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
