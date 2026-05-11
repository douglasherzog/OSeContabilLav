import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { LayoutDashboard, Receipt, Wallet, CreditCard, TrendingUp, Settings, Users, Layers, Building2, UserCircle } from 'lucide-react';
import OSList from './pages/OSList';
import OSDetail from './pages/OSDetail';
import Caixa from './pages/Caixa';
import ContasPagar from './pages/ContasPagar';
import ContasReceber from './pages/ContasReceber';
import Importar from './pages/Importar';
import Dashboard from './pages/Dashboard';
import Clientes from './pages/Clientes';
import Servicos from './pages/Servicos';
import Configuracoes from './pages/Configuracoes';
import Funcionarios from './pages/Funcionarios';

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Painel' },
  { to: '/os', icon: Receipt, label: 'Ordens de Serviço', badgeKey: 'ready' },
  { to: '/clientes', icon: Users, label: 'Clientes' },
  { to: '/servicos', icon: Layers, label: 'Serviços' },
  { to: '/caixa', icon: Wallet, label: 'Caixa' },
  { to: '/contas-pagar', icon: CreditCard, label: 'Contas a Pagar', badgeKey: 'overdue' },
  { to: '/contas-receber', icon: TrendingUp, label: 'Contas a Receber' },
  { to: '/importar', icon: Settings, label: 'Importar' },
  { to: '/funcionarios', icon: UserCircle, label: 'Funcionários' },
  { to: '/configuracoes', icon: Building2, label: 'Configurações' },
];

export default function App() {
  const [overdueCount, setOverdueCount] = useState(0);
  const [readyCount, setReadyCount] = useState(0);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const [overdue, ready] = await Promise.all([
          window.api.dashboard.overdueCount(),
          window.api.dashboard.readyCount(),
        ]);
        setOverdueCount(overdue || 0);
        setReadyCount(ready || 0);
      } catch {}
    }
    fetchCounts();
    const interval = setInterval(fetchCounts, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {(window.__WEB_MODE__ || (window.api && window.api.__polyfill)) && (
        <div className="fixed top-2 right-2 z-50 bg-amber-100 text-amber-900 text-xs px-2 py-1 rounded shadow border border-amber-200">
          Modo Web (sem backend)
        </div>
      )}
      {/* Sidebar */}
      <aside className="w-56 bg-slate-800 text-white flex flex-col shrink-0">
        <div className="px-4 py-5 border-b border-slate-700">
          <div className="text-sm font-bold text-slate-100 leading-tight">Lavanderia Senhor dos Passos</div>
          <div className="text-xs text-slate-400 mt-0.5">Herzog Comercial LTDA</div>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV.map(({ to, icon: Icon, label, badgeKey }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`
              }
            >
              <Icon size={16} />
              <span className="flex-1">{label}</span>
              {badgeKey === 'overdue' && overdueCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {overdueCount > 99 ? '99+' : overdueCount}
                </span>
              )}
              {badgeKey === 'ready' && readyCount > 0 && (
                <span className="bg-yellow-400 text-yellow-900 text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {readyCount > 99 ? '99+' : readyCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/os" element={<OSList />} />
          <Route path="/os/:id" element={<OSDetail />} />
          <Route path="/caixa" element={<Caixa />} />
          <Route path="/contas-pagar" element={<ContasPagar />} />
          <Route path="/contas-receber" element={<ContasReceber />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/servicos" element={<Servicos />} />
          <Route path="/importar" element={<Importar />} />
          <Route path="/funcionarios" element={<Funcionarios />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
        </Routes>
      </main>
    </div>
  );
}
