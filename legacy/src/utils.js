import { 
  today, 
  monthStart, 
  fmtDate as formatDate, 
  fmtDateTime as formatDateTime,
  monthEnd,
  monthStartFromStr,
  extractMonth,
  isInMonth,
  addDays,
  isValidDate,
  normalizeDate
} from './utils/dateHelpers.js';

export function brl(value) {
  const n = parseFloat(value) || 0;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(str) {
  if (!str) return '-';
  return formatDate(str);
}

export function fmtDateTime(str) {
  if (!str || str === 'Invalid Date') return '-';
  return formatDateTime(str);
}

// Re-exportar todas as funções do dateHelpers.js
export { today, monthStart, monthEnd, monthStartFromStr, extractMonth, isInMonth, addDays, isValidDate, normalizeDate };

export const STATUS_LABELS = {
  aberta: 'Aberta',
  pronta: 'Pronta',
  entregue: 'Entregue',
  entregue_pendente: 'Entregue c/ Pendência',
};

export function exportCSV(rows, filename) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = v => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(';'), ...rows.map(r => headers.map(h => escape(r[h])).join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const STATUS_COLORS = {
  aberta: 'bg-blue-100 text-blue-700',
  pronta: 'bg-yellow-100 text-yellow-700',
  entregue: 'bg-green-100 text-green-700',
  entregue_pendente: 'bg-orange-100 text-orange-700',
};
