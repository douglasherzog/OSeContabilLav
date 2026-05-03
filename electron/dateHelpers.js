// Utilitários centralizados para manipulação de datas (Node.js/Electron)
// Evita problemas de fuso horário, formato e cálculos de datas

/**
 * Retorna a data atual no formato YYYY-MM-DD (fuso local São Paulo/UTC-3)
 */
function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset(); // Offset em minutos (UTC - local)
  const local = new Date(now.getTime() - (offset * 60 * 1000));
  return local.toISOString().slice(0, 10);
}

/**
 * Retorna a data/hora atual no formato YYYY-MM-DD HH:MM:SS (fuso local São Paulo/UTC-3)
 */
function nowLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset(); // Offset em minutos (UTC - local)
  const local = new Date(now.getTime() - (offset * 60 * 1000));
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Retorna o início do mês atual no formato YYYY-MM-DD
 */
function monthStart() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * Retorna o último dia de um mês no formato YYYY-MM-DD
 * @param {string} month - Mês no formato YYYY-MM
 */
function monthEnd(month) {
  const year = parseInt(month.slice(0, 4));
  const monthNum = parseInt(month.slice(5, 7));
  const lastDay = new Date(year, monthNum, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Retorna o primeiro dia de um mês no formato YYYY-MM-DD
 * @param {string} month - Mês no formato YYYY-MM
 */
function monthStartFromStr(month) {
  return `${month}-01`;
}

/**
 * Extrai o mês de uma data no formato YYYY-MM
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 */
function extractMonth(dateStr) {
  return dateStr.slice(0, 7);
}

/**
 * Verifica se uma data está dentro de um mês
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 * @param {string} month - Mês no formato YYYY-MM
 */
function isInMonth(dateStr, month) {
  return dateStr.slice(0, 7) === month;
}

/**
 * Adiciona dias a uma data
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 * @param {number} days - Número de dias a adicionar
 */
function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Valida se uma string é uma data válida no formato YYYY-MM-DD
 * @param {string} dateStr - String a validar
 */
function isValidDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Normaliza uma data para garantir formato YYYY-MM-DD
 * @param {string} dateStr - String de data
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  // Se já está no formato YYYY-MM-DD, retorna
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Tenta converter de outros formatos
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

module.exports = {
  today,
  nowLocal,
  monthStart,
  monthEnd,
  monthStartFromStr,
  extractMonth,
  isInMonth,
  addDays,
  isValidDate,
  normalizeDate
};
