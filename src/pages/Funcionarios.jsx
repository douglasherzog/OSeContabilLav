import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../useModalFocus';
import { Plus, Pencil, Trash2, DollarSign, TrendingDown, Users, Calendar, ChevronDown, ChevronUp, XCircle, AlertCircle } from 'lucide-react';
import { brl, fmtDate, today, monthStart } from '../utils';
import { useToastCtx } from '../ToastContext';

const emptyForm = { name: '', type: 'integral', base_salary: '', start_date: today(), admission_date: '' };

export default function Funcionarios() {
  const toast = useToastCtx();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [advances, setAdvances] = useState([]);
  const [showAdvanceForm, setShowAdvanceForm] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({ amount: '', date: today(), method: 'dinheiro', account_label: '', note: '', advance_type: 'regular' });
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));
  const [balance, setBalance] = useState(null);
  const [salaryHistory, setSalaryHistory] = useState([]);
  const [showSalaryHistory, setShowSalaryHistory] = useState(false);
  const [vacationBalance, setVacationBalance] = useState(null);
  const [showVacationModal, setShowVacationModal] = useState(false);
  const [pendingBalances, setPendingBalances] = useState([]);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [payPendingForm, setPayPendingForm] = useState({ id: null, method: 'dinheiro', account_label: '', create_ap: false, amount: '' });
  const advanceAmountRef = useRef(null);
  const firstInputRef = useModalFocus(showForm);
  const currentMonthPending = pendingBalances.find(p => {
    const remaining = (p.amount || 0) - (p.paid_amount || 0);
    return p.reference_month === selectedMonth && remaining > 0.009 && p.status === 'pending';
  });

  // Focar automaticamente no input de valor quando modal de adiantamento abre
  useEffect(() => {
    if (showAdvanceForm) {
      setTimeout(() => advanceAmountRef.current?.focus(), 50);
    }
  }, [showAdvanceForm]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setEmployees(await window.api.employees.list() || []); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadSalaryHistory() {
    if (!selectedEmployee) return;
    try {
      const data = await window.api.employees.salaryHistory(selectedEmployee.id) || [];
      setSalaryHistory(data);
    } catch { }
  }

  // Recalcular automaticamente ao selecionar funcionário
  useEffect(() => {
    if (selectedEmployee) {
      const month = today().slice(0, 7);
      window.api.employees.recalculateAdvances({ employee_id: selectedEmployee.id, month })
        .then(() => load()) // Recarregar dados após recalcular
        .catch(() => {}); // Silenciar erros
    }
  }, [selectedEmployee?.id]);

  useEffect(() => {
    if (selectedEmployee) {
      loadAdvances();
      loadBalance();
      loadVacationBalance();
      loadPendingBalances();
    } else {
      setAdvances([]);
      setBalance(null);
      setVacationBalance(null);
      setPendingBalances([]);
    }
  }, [selectedEmployee, selectedMonth]);

  async function loadAdvances() {
    try {
      const data = await window.api.salaryAdvances.list({ 
        employee_id: selectedEmployee.id, 
        month: selectedMonth 
      }) || [];
      setAdvances(data);
    } catch { }
  }

  async function loadBalance() {
    try {
      const data = await window.api.salaryAdvances.balance({ 
        employee_id: selectedEmployee.id, 
        month: selectedMonth 
      });
      setBalance(data);
    } catch { }
  }

  async function handleSubmit() {
    if (!form.name?.trim()) { toast.error('Informe o nome.'); return; }
    if (!form.start_date) { toast.error('Informe a data de início do salário.'); return; }
    if (!form.admission_date) { toast.error('Informe a data de admissão.'); return; }
    const payload = { 
      ...form, 
      base_salary: parseFloat(form.base_salary) || 0,
      start_date: form.start_date
    };
    try {
      if (editing) { 
        const updated = await window.api.employees.update({ id: editing, ...payload }); 
        setEditing(null); 
        toast.success('Funcionário atualizado!'); 
        // Atualizar imediatamente o funcionário selecionado para refletir o novo salário
        if (updated && updated.id) {
          setSelectedEmployee(prev => prev && prev.id === updated.id ? updated : updated);
          // Recarregar o saldo do mês atual já usando o funcionário atualizado
          try {
            const b = await window.api.salaryAdvances.balance({ employee_id: updated.id, month: selectedMonth });
            setBalance(b);
          } catch {}
        }
      }
      else { 
        await window.api.employees.create(payload); 
        toast.success('Funcionário cadastrado!'); 
      }
      setForm(emptyForm); 
      setShowForm(false); 
      load();
      const empId = editing || selectedEmployee?.id;
      if (empId) {
        loadSalaryHistory();
        loadVacationBalance();
        loadPendingBalances();
        loadAdvances();
      }
    } catch { toast.error('Erro ao salvar.'); }
  }

  async function handleDelete(id) {
    if (!confirm('Inativar funcionário?')) return;
    try { await window.api.employees.delete(id); toast.success('Funcionário inativado.'); load(); }
    catch { toast.error('Erro ao inativar.'); }
  }

  function nextMonthStr(m) {
    const [y, mo] = m.split('-').map(n => parseInt(n, 10));
    const d = new Date(y, mo);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yy}-${mm}`;
  }

  async function handleAddAdvance() {
    if (!advanceForm.amount || parseFloat(advanceForm.amount) <= 0) {
      toast.error('Informe um valor válido.');
      return;
    }
    // Bloqueio com mensagem orientativa: após completar o salário do mês corrente, só lançar no próximo mês
    try {
      const currentMonth = today().slice(0, 7);
      const selectedMonthForAdvance = (advanceForm.date || today()).slice(0, 7);
      const nextM = nextMonthStr(currentMonth);
      const isRegular = !advanceForm.advance_type || advanceForm.advance_type === 'regular';
      const baseSalary = balance?.employee?.base_salary;
      const isCurrentMonthComplete = typeof baseSalary === 'number' && baseSalary > 0 && Math.abs((balance?.regular_advances || 0) - baseSalary) < 0.01;
      if (isRegular && selectedMonthForAdvance === currentMonth && isCurrentMonthComplete) {
        toast.error(`O salário de ${currentMonth} já está completo. Altere a data para ${nextM} para lançar adiantamentos do próximo mês.`);
        return;
      }
    } catch {}
    try {
      const result = await window.api.salaryAdvances.create({
        employee_id: selectedEmployee.id,
        employee_name: selectedEmployee.name,
        advance_type: advanceForm.advance_type,
        amount: parseFloat(advanceForm.amount),
        date: advanceForm.date,
        method: advanceForm.method,
        account_label: advanceForm.account_label,
        note: advanceForm.note
      });
      
      if (result.error) {
        toast.error(result.error);
        return;
      }
      
      const typeLabel = {
        'regular': 'Adiantamento',
        'ferias': 'Férias',
        'decimo_primeira': 'Décimo 1ª parcela',
        'decimo_segunda': 'Décimo 2ª parcela'
      };
      toast.success(`${typeLabel[advanceForm.advance_type]} registrado!`);
      setAdvanceForm({ amount: '', date: today(), method: 'dinheiro', account_label: '', note: '', advance_type: 'regular' });
      setShowAdvanceForm(false);
      loadAdvances();
      loadBalance();
    } catch (e) { console.error('Erro ao registrar adiantamento:', e); toast.error('Erro ao registrar adiantamento.'); }
  }

  async function handleDeleteAdvance(id) {
    if (!confirm('Remover adiantamento?')) return;
    try { 
      await window.api.salaryAdvances.delete(id); 
      toast.success('Adiantamento removido.'); 
      loadAdvances();
      loadBalance();
    }
    catch { toast.error('Erro ao remover.'); }
  }

  async function loadPendingBalances() {
    try {
      const data = await window.api.salaryPending.list({ 
        employee_id: selectedEmployee.id,
        status: 'pending'
      }) || [];
      setPendingBalances(data);
    } catch { }
  }

  async function handlePayPending() {
    if (!payPendingForm.id) return;
    try {
      const result = await window.api.salaryPending.pay({
        id: payPendingForm.id,
        amount: parseFloat(payPendingForm.amount) || undefined,
        method: payPendingForm.method,
        account_label: payPendingForm.account_label,
        create_ap: payPendingForm.create_ap
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        if (result.is_fully_paid) {
          toast.success('Saldo quitado com sucesso!');
        } else {
          toast.success(`Pagamento de R$ ${brl(result.paid_amount)} registrado! Falta: R$ ${brl(result.remaining)}`);
        }
        setPayPendingForm({ id: null, method: 'dinheiro', account_label: '', create_ap: false, amount: '' });
        setShowPendingModal(false);
        loadPendingBalances();
      }
    } catch { toast.error('Erro ao pagar saldo.'); }
  }

  function openPayPendingModal(pending) {
    const remaining = pending.amount - (pending.paid_amount || 0);
    setPayPendingForm({ 
      id: pending.id, 
      method: 'dinheiro', 
      account_label: '', 
      create_ap: false,
      amount: remaining.toString()
    });
    setShowPendingModal(true);
  }

  async function startEdit(r) {
    // Carregar histórico de salários para pegar a data de início do salário mais recente
    let startDate = today();
    try {
      const history = await window.api.employees.salaryHistory(r.id) || [];
      if (history.length > 0) {
        startDate = history[0].start_date; // Data do salário mais recente
      }
    } catch { }

    setForm({
      name: r.name,
      type: r.type || 'integral',
      base_salary: String(r.base_salary || ''),
      start_date: startDate,
      admission_date: r.admission_date ? String(r.admission_date).slice(0,10) : ''
    });
    setEditing(r.id);
    setShowForm(true);
  }

  async function loadVacationBalance() {
    if (!selectedEmployee) return;
    try {
      const data = await window.api.vacation.balance(selectedEmployee.id);
      setVacationBalance(data);
    } catch { }
  }

  function openVacationModal() {
    loadVacationBalance();
    setShowVacationModal(true);
  }

  function openSalaryHistory() {
    loadSalaryHistory();
    setShowSalaryHistory(true);
  }

  function formatMonth(m) {
    const [year, month] = m.split('-');
    return `${month}/${year}`;
  }

  const totalAdvances = advances.reduce((s, a) => {
    // Se o adiantamento tem reference_month, usar reference_month para verificar se pertence ao mês
    const belongsToMonth = a.reference_month 
      ? a.reference_month === selectedMonth 
      : a.date.slice(0, 7) === selectedMonth;
    return belongsToMonth ? s + (a.amount || 0) : s;
  }, 0);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Users size={20} /> Funcionários
        </h1>
        <button onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(true); }} 
          className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700">
          <Plus size={15} /> Novo Funcionário
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lista de Funcionários */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="bg-gray-50 border-b px-4 py-3">
            <h2 className="font-medium text-gray-700">Cadastro</h2>
          </div>
          {loading ? <div className="p-8 text-center text-gray-400">Carregando...</div>
            : employees.length === 0 ? <div className="p-8 text-center text-gray-400">Nenhum funcionário.</div>
            : <div className="divide-y">
                {employees.map(emp => (
                  <div key={emp.id} 
                    onClick={() => setSelectedEmployee(emp)}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${selectedEmployee?.id === emp.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{emp.name}</div>
                        <div className="text-xs text-gray-500">
                          {emp.type === 'integral' ? 'Integral (44h)' : 'Meio turno (22h)'} • 
                          Salário: R$ {brl(emp.base_salary)}
                          {emp.admission_date && <span className="ml-1">• Adm: {fmtDate(emp.admission_date)}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={(e) => { e.stopPropagation(); startEdit(emp); }} 
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                          <Pencil size={14} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(emp.id); }} 
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>

        {/* Controle de Adiantamentos */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="bg-gray-50 border-b px-4 py-3 flex items-center justify-between">
            <h2 className="font-medium text-gray-700">
              {selectedEmployee ? selectedEmployee.name : 'Selecione um funcionário'}
            </h2>
            {selectedEmployee && (
              <div className="flex items-center gap-2">
                <input type="month" className="text-sm border rounded px-2 py-1" 
                  value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
              </div>
            )}
          </div>

          {!selectedEmployee ? (
            <div className="p-8 text-center text-gray-400">
              Clique em um funcionário para ver adiantamentos
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* Botões de Ação */}
              <div className="flex justify-end gap-3">
                <button onClick={async () => { await window.api.debug.autoCloseMonth(); loadPendingBalances(); toast.success('Fechamento automático executado'); }}
                  className="text-xs bg-gray-200 text-gray-700 hover:bg-gray-300 px-2 py-1 rounded">
                  Testar Fechamento
                </button>
                <button onClick={async () => { 
                    if (!selectedEmployee) { toast.error('Selecione um funcionário.'); return; }
                    try {
                      const res = await window.api.debug.cleanupSalaryMonth({ employee_id: selectedEmployee.id, month: selectedMonth });
                      if (res?.ok === false) { toast.error(res?.message || 'Falha ao limpar mês.'); return; }
                      await loadAdvances(); await loadBalance(); await loadPendingBalances();
                      toast.success('Limpeza do mês executada');
                      console.debug('[cleanupSalaryMonth] result:', res);
                    } catch (e) {
                      console.error('cleanupSalaryMonth error:', e);
                      toast.error('Erro ao limpar mês. Veja o console.');
                    }
                  }}
                  className="text-xs bg-purple-200 text-purple-700 hover:bg-purple-300 px-2 py-1 rounded">
                  Limpar Mês
                </button>
                <button onClick={async () => { 
                    if (!selectedEmployee) { toast.error('Selecione um funcionário.'); return; }
                    try {
                      const res = await window.api.debug.resetSalaryState({ employee_id: selectedEmployee.id });
                      if (res?.ok === false) { toast.error(res?.message || 'Falha ao resetar.'); return; }
                      await loadAdvances(); await loadBalance(); await loadPendingBalances();
                      toast.success('Estado de salário resetado para testes');
                      console.debug('[resetSalaryState] result:', res);
                    } catch (e) {
                      console.error('resetSalaryState error:', e);
                      toast.error('Erro ao resetar. Veja o console.');
                    }
                  }}
                  className="text-xs text-purple-600 hover:text-purple-800 underline">
                  Resetar Pendentes/Ajustes
                </button>
                <button onClick={openVacationModal}
                  className="text-xs text-green-600 hover:text-green-800 flex items-center gap-1">
                  <Calendar size={12} /> Férias
                </button>
                <button onClick={openSalaryHistory}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                  <Calendar size={12} /> Histórico de Salários
                </button>
              </div>
              {currentMonthPending && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
                  <div className="text-sm text-red-800 font-medium">
                    Pague o saldo pendente para liberar adiantamentos deste mês.
                  </div>
                  <button onClick={() => openPayPendingModal(currentMonthPending)}
                    className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
                    Pagar agora
                  </button>
                </div>
              )}

              {/* Alerta de Saldos Pendentes */}
              {pendingBalances.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="text-amber-600" size={16} />
                    <span className="text-sm font-medium text-amber-800">Saldos Pendentes</span>
                  </div>
                  <div className="space-y-2">
                    {pendingBalances.map(pending => {
                      const remaining = pending.amount - (pending.paid_amount || 0);
                      const isPartiallyPaid = (pending.paid_amount || 0) > 0;
                      return (
                        <div key={pending.id} className="flex justify-between items-center bg-white rounded p-2">
                          <div>
                            <div className="text-xs text-gray-500">Mês: {pending.reference_month}</div>
                            <div className="font-bold text-amber-700">
                              Falta: R$ {brl(remaining)}
                              {isPartiallyPaid && (
                                <span className="text-xs text-gray-500 font-normal ml-2">
                                  (Total: R$ {brl(pending.amount)} - Pago: R$ {brl(pending.paid_amount || 0)})
                                </span>
                              )}
                            </div>
                          </div>
                          <button 
                            onClick={() => openPayPendingModal(pending)}
                            className="text-xs bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-700">
                            {isPartiallyPaid ? 'Pagar Restante' : 'Pagar'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Resumo */}
              {balance && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-xs text-gray-500">Salário Base</div>
                      <div className="font-bold text-blue-700">R$ {brl(balance.employee.base_salary)}</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <div className="text-xs text-gray-500">Adiantado</div>
                      <div className="font-bold text-red-700">R$ {brl(balance.regular_advances)}</div>
                    </div>
                    <div className={`${balance.balance > 0 ? 'bg-green-50' : 'bg-gray-50'} rounded-lg p-3 text-center`}>
                      <div className="text-xs text-gray-500">Saldo a Pagar</div>
                      <div className={`font-bold ${balance.balance > 0 ? 'text-green-700' : 'text-gray-700'}`}>
                        R$ {brl(balance.balance)}
                      </div>
                    </div>
                  </div>
                  
                  {/* Detalhamento de férias e décimo */}
                  {(balance.vacation_advances > 0 || balance.thirteen_advances > 0) && (
                    <div className="text-xs text-gray-500 flex justify-center gap-3 pt-1">
                      {balance.vacation_advances > 0 && (
                        <span className="text-green-600">Férias: R$ {brl(balance.vacation_advances)}</span>
                      )}
                      {balance.thirteen_advances > 0 && (
                        <span className="text-blue-600">Décimo: R$ {brl(balance.thirteen_advances)}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {(() => {
                const adjustments = (advances || []).filter(a => a.note && a.note.startsWith('Ajuste: excesso de adiantamentos'));
                if (!adjustments.length) return null;
                // Determinar mês anterior e próximo do mês selecionado
                const d = new Date(selectedMonth + '-01');
                const dPrev = new Date(d); dPrev.setMonth(dPrev.getMonth() - 1);
                const prevM = `${dPrev.getFullYear()}-${String(dPrev.getMonth()+1).padStart(2,'0')}`;
                const nextM = nextMonthStr(selectedMonth);
                // Particionar ajustes entre "entrando de mês anterior" e "saindo para o próximo mês"
                const incoming = adjustments.filter(a => (a.reference_month === selectedMonth) && (a.note || '').includes(prevM));
                const outgoing = adjustments.filter(a => (a.reference_month && a.reference_month !== selectedMonth) && (a.note || '').includes(selectedMonth));
                const totalIncoming = incoming.reduce((s,a)=> s + (a.amount || 0), 0);
                const totalOutgoing = outgoing.reduce((s,a)=> s + (a.amount || 0), 0);
                if (!totalIncoming && !totalOutgoing) return null;
                return (
                  <div className="space-y-2">
                    {totalIncoming > 0 && (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-800">
                        Ajuste de excesso de {formatMonth(prevM)} totalizando R$ {brl(totalIncoming)} foi contabilizado neste mês.
                      </div>
                    )}
                    {totalOutgoing > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                        Excesso de {formatMonth(selectedMonth)} totalizando R$ {brl(totalOutgoing)} foi levado para {formatMonth(nextM)}.
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Lista de Adiantamentos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-700 flex items-center gap-1">
                    <DollarSign size={14} /> Adiantamentos do Mês
                  </h3>
                  <button onClick={() => setShowAdvanceForm(true)} 
                    disabled={!!currentMonthPending}
                    title={currentMonthPending ? 'Quite o saldo pendente primeiro' : undefined}
                    className={`text-xs px-2 py-1 rounded ${currentMonthPending ? 'bg-blue-400 text-white opacity-60 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                    + Adiantamento
                  </button>
                </div>

                {advances.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-4">Nenhum adiantamento neste mês.</div>
                ) : (
                  <div className="space-y-2">
                    {advances.map(adv => {
                      const advanceMonth = adv.date.slice(0, 7);
                      const referenceMonth = adv.reference_month || advanceMonth; // Se não tem reference_month, usa o mês da data
                      const isCrossMonth = referenceMonth !== selectedMonth;
                      const referenceMonthName = new Date(referenceMonth + '-01').toLocaleDateString('pt-BR', { month: 'long' });
                      const selectedMonthName = new Date(selectedMonth + '-01').toLocaleDateString('pt-BR', { month: 'long' });
                      
                      return (
                        <div key={adv.id} className={`flex items-center justify-between rounded-lg p-3 ${isCrossMonth ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
                          <div>
                            <div className="text-sm font-medium">
                              R$ {brl(adv.amount)}
                              {adv.note && adv.note.startsWith('Ajuste: excesso de adiantamentos') && (
                                <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full align-middle">Ajuste</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">{fmtDate(adv.date)} {adv.note && `• ${adv.note}`}</div>
                            {isCrossMonth && (
                              <div className="text-xs text-amber-700 font-medium mt-1">
                                {referenceMonth === selectedMonth 
                                  ? `Pago em ${advanceMonth.slice(5, 7)}/${advanceMonth.slice(0, 4)}`
                                  : `Contabilizado em ${referenceMonthName.charAt(0).toUpperCase() + referenceMonthName.slice(1)}`
                                }
                              </div>
                            )}
                          </div>
                          <button onClick={() => handleDeleteAdvance(adv.id)} 
                            className="p-1 text-red-500 hover:bg-red-50 rounded">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="text-sm font-medium">Total Adiantado:</span>
                      <span className="font-bold text-red-600">R$ {brl(totalAdvances)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Novo/Editar Funcionário */}
      {showForm && createPortal(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">{editing ? 'Editar' : 'Novo'} Funcionário</h2>
            <div className="space-y-3">
              <input ref={firstInputRef} className="w-full border rounded-lg px-3 py-2 text-sm" 
                placeholder="Nome *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Data de Admissão *</label>
                <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" 
                  value={form.admission_date} onChange={e => setForm(f => ({ ...f, admission_date: e.target.value }))} />
              </div>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" 
                value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="integral">Integral (44h semanais)</option>
                <option value="meio_turno">Meio turno (22h semanais)</option>
              </select>
              <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" 
                placeholder="Salário Base (R$) *" value={form.base_salary} 
                onChange={e => setForm(f => ({ ...f, base_salary: e.target.value }))} step="0.01" />
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  {editing ? 'Data de início do novo salário' : 'Data de início do salário'}
                </label>
                <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" 
                  value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} 
                  className="px-4 py-2 border rounded-lg text-sm">Cancelar</button>
                <button type="button" onClick={handleSubmit} 
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Salvar</button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Modal Adiantamento */}
      {showAdvanceForm && selectedEmployee && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold">Registrar Adiantamento</h2>
                <p className="text-sm text-gray-500">{selectedEmployee.name}</p>
              </div>
              <button onClick={() => setShowAdvanceForm(false)} className="text-gray-400 hover:text-gray-600">
                <XCircle size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <select className="w-full border rounded-lg px-3 py-2 text-sm" 
                value={advanceForm.advance_type} onChange={e => setAdvanceForm(f => ({ ...f, advance_type: e.target.value }))}>
                <option value="regular">Adiantamento Regular</option>
                <option value="ferias">Férias</option>
                <option value="decimo_primeira">Décimo Terceiro - 1ª Parcela</option>
                <option value="decimo_segunda">Décimo Terceiro - 2ª Parcela</option>
              </select>
              <input type="number" ref={advanceAmountRef} className="w-full border rounded-lg px-3 py-2 text-sm" 
                placeholder="Valor (R$) *" value={advanceForm.amount} 
                onChange={e => setAdvanceForm(f => ({ ...f, amount: e.target.value }))} step="0.01" />
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" 
                value={advanceForm.date} onChange={e => setAdvanceForm(f => ({ ...f, date: e.target.value }))} />
              {(() => {
                const currentMonth = today().slice(0, 7);
                const selectedMonthForAdvance = (advanceForm.date || today()).slice(0, 7);
                const isRegular = !advanceForm.advance_type || advanceForm.advance_type === 'regular';
                const baseSalary = balance?.employee?.base_salary;
                const isCurrentMonthComplete = typeof baseSalary === 'number' && baseSalary > 0 && Math.abs((balance?.regular_advances || 0) - baseSalary) < 0.01;
                const nextM = nextMonthStr(currentMonth);
                if (isRegular && selectedMonthForAdvance === currentMonth && isCurrentMonthComplete) {
                  return (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 flex items-start gap-2">
                      <div className="flex-1">
                        O salário de {formatMonth(currentMonth)} já está completo. Altere a data para {formatMonth(nextM)} para lançar adiantamentos do próximo mês.
                      </div>
                      <button type="button" onClick={() => setAdvanceForm(f => ({ ...f, date: `${nextM}-01` }))}
                        className="px-2 py-1 bg-amber-600 text-white rounded">Mudar para próximo mês</button>
                    </div>
                  );
                }
                return null;
              })()}
              <select className="w-full border rounded-lg px-3 py-2 text-sm" 
                value={advanceForm.method} onChange={e => setAdvanceForm(f => ({ ...f, method: e.target.value }))}>
                {['dinheiro', 'pix', 'debito', 'credito', 'transferencia'].map(m => 
                  <option key={m} value={m}>{m}</option>
                )}
              </select>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" 
                placeholder="Conta/Banco (opcional)" value={advanceForm.account_label} 
                onChange={e => setAdvanceForm(f => ({ ...f, account_label: e.target.value }))} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" 
                placeholder="Observação (opcional)" value={advanceForm.note} 
                onChange={e => setAdvanceForm(f => ({ ...f, note: e.target.value }))} />
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setShowAdvanceForm(false)} 
                  className="px-4 py-2 border rounded-lg text-sm">Cancelar</button>
                <button type="button" onClick={handleAddAdvance} 
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Histórico de Salários */}
      {showSalaryHistory && selectedEmployee && createPortal(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Histórico de Salários</h2>
              <button onClick={() => setShowSalaryHistory(false)} className="text-gray-400 hover:text-gray-600">
                <XCircle size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">{selectedEmployee.name}</p>
            <div className="max-h-60 overflow-y-auto space-y-2">
              {salaryHistory.length === 0 ? (
                <div className="text-center text-gray-400 py-4">Nenhum registro de salário.</div>
              ) : (
                salaryHistory.map((sh, idx) => (
                  <div key={sh.id} className={`flex items-center justify-between p-3 rounded-lg ${idx === 0 ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
                    <div>
                      <div className="font-medium">R$ {brl(sh.salary)}</div>
                      <div className="text-xs text-gray-500">
                        Vigente desde: {sh.start_date}
                        {sh.end_date && ` até ${sh.end_date}`}
                        {idx === 0 && ' (atual)'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 pt-4 border-t">
              <button onClick={() => { setShowSalaryHistory(false); startEdit(selectedEmployee); }} 
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                Atualizar Salário
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Modal Pagar Saldo Pendente */}
      {showPendingModal && createPortal(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Pagar Saldo Pendente</h2>
              <button onClick={() => setShowPendingModal(false)} className="text-gray-400 hover:text-gray-600">
                <XCircle size={20} />
              </button>
            </div>
            
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Pagamento do saldo pendente do mês de referência.
              </p>
              
              <div>
                <label className="text-xs text-gray-500 block mb-1">Valor a Pagar (R$)</label>
                <input type="number" step="0.01" className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={payPendingForm.amount} 
                  onChange={e => setPayPendingForm(f => ({ ...f, amount: e.target.value }))} />
                <p className="text-xs text-gray-400 mt-1">
                  Edite para pagamento parcial. Deixe o valor completo para quitar tudo.
                </p>
              </div>
              
              <div>
                <label className="text-xs text-gray-500 block mb-1">Forma de Pagamento</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm" 
                  value={payPendingForm.method} 
                  onChange={e => setPayPendingForm(f => ({ ...f, method: e.target.value }))}>
                  {['dinheiro', 'pix', 'debito', 'credito', 'transferencia'].map(m => 
                    <option key={m} value={m}>{m}</option>
                  )}
                </select>
              </div>
              
              <div>
                <label className="text-xs text-gray-500 block mb-1">Conta/Banco (opcional)</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" 
                  placeholder="Ex: Itaú, Nubank, Caixa..." 
                  value={payPendingForm.account_label} 
                  onChange={e => setPayPendingForm(f => ({ ...f, account_label: e.target.value }))} />
              </div>
              
              <div className="flex items-center gap-2">
                <input type="checkbox" id="create_ap" 
                  checked={payPendingForm.create_ap}
                  onChange={e => setPayPendingForm(f => ({ ...f, create_ap: e.target.checked }))} />
                <label htmlFor="create_ap" className="text-xs text-gray-600">
                  Também lançar em Contas a Pagar
                </label>
              </div>
              
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowPendingModal(false)} 
                  className="px-4 py-2 border rounded-lg text-sm">Cancelar</button>
                <button type="button" onClick={handlePayPending} 
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700">
                  Confirmar Pagamento
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Modal Férias */}
      {showVacationModal && selectedEmployee && createPortal(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Controle de Férias</h2>
              <button onClick={() => setShowVacationModal(false)} className="text-gray-400 hover:text-gray-600">
                <XCircle size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">{selectedEmployee.name}</p>
            
            {vacationBalance ? (
              <div className="space-y-4">
                {/* Resumo de férias */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <div className="text-xs text-gray-500">Dias Disponíveis</div>
                    <div className="font-bold text-green-700 text-lg">{vacationBalance.remaining_days}</div>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-3 text-center">
                    <div className="text-xs text-gray-500">Dias Vencidos</div>
                    <div className={`font-bold text-lg ${vacationBalance.vencido_days > 0 ? 'text-red-600' : 'text-yellow-700'}`}>
                      {vacationBalance.vencido_days}
                    </div>
                  </div>
                </div>
                
                <div className="text-xs text-gray-500 text-center">
                  Tempo de empresa: {vacationBalance.years_worked} anos • 
                  Total tirado: {vacationBalance.total_taken} dias
                </div>

                {/* Histórico de férias */}
                <div className="max-h-40 overflow-y-auto">
                  <h4 className="text-xs font-medium text-gray-700 mb-2">Histórico de Férias</h4>
                  {vacationBalance.vacation_history.length === 0 ? (
                    <div className="text-center text-gray-400 text-xs py-2">Nenhum registro de férias.</div>
                  ) : (
                    vacationBalance.vacation_history.map(v => (
                      <div key={v.id} className="flex items-center justify-between p-2 bg-gray-50 rounded mb-1 text-xs">
                        <div>
                          <span className="font-medium">{v.period_start} a {v.period_end}</span>
                          <span className="text-gray-500 ml-2">({v.days_taken} dias)</span>
                          {v.buyout_days > 0 && <span className="text-orange-600 ml-1">+ {v.buyout_days} pecúlio</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 pt-4 border-t flex gap-2">
                  <button onClick={() => { setShowVacationModal(false); setAdvanceForm(f => ({ ...f, advance_type: 'ferias' })); setShowAdvanceForm(true); }} 
                    className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                    Lançar Férias
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400 py-4">Carregando...</div>
            )}
          </div>
        </div>
      , document.body)}
    </div>
  );
}
