// Utilitários centralizados para manipulação de datas
// Evita problemas de fuso horário, formato e cálculos de datas

/**
 * Retorna data/hora local no formato YYYY-MM-DDTHH:mm para uso em
 * campos <input type="datetime-local"> (fuso do sistema/São Paulo)
 */
export function nowLocalInput() {
  const d = new Date();
  const brasilia = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const year = brasilia.getFullYear();
  const month = String(brasilia.getMonth() + 1).padStart(2, '0');
  const day = String(brasilia.getDate()).padStart(2, '0');
  const hours = String(brasilia.getHours()).padStart(2, '0');
  const minutes = String(brasilia.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Retorna a data atual no formato YYYY-MM-DD (fuso local São Paulo/UTC-3)
 */
export function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset(); // Offset em minutos (UTC - local)
  const local = new Date(now.getTime() - (offset * 60 * 1000));
  return local.toISOString().slice(0, 10);
}

/**
 * Retorna o início do mês atual no formato YYYY-MM-DD
 */
export function monthStart() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * Retorna o último dia de um mês no formato YYYY-MM-DD
 * @param {string} month - Mês no formato YYYY-MM
 */
export function monthEnd(month) {
  const year = parseInt(month.slice(0, 4));
  const monthNum = parseInt(month.slice(5, 7));
  const lastDay = new Date(year, monthNum, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Retorna o primeiro dia de um mês no formato YYYY-MM-DD
 * @param {string} month - Mês no formato YYYY-MM
 */
export function monthStartFromStr(month) {
  return `${month}-01`;
}

/**
 * Formata uma data para exibição (DD/MM/YYYY)
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 */
export function fmtDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Formata uma data/hora para exibição (DD/MM/YYYY HH:mm)
 * @param {string} dateTimeStr - Data/hora no formato YYYY-MM-DDTHH:mm:ss
 */
export function fmtDateTime(dateTimeStr) {
  if (!dateTimeStr) return '';
  const [datePart, timePart] = dateTimeStr.split('T');
  const [year, month, day] = datePart.slice(0, 10).split('-');
  const [hours, minutes] = timePart ? timePart.slice(0, 5).split(':') : ['00', '00'];
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Extrai o mês de uma data no formato YYYY-MM
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 */
export function extractMonth(dateStr) {
  return dateStr.slice(0, 7);
}

/**
 * Verifica se uma data está dentro de um mês
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 * @param {string} month - Mês no formato YYYY-MM
 */
export function isInMonth(dateStr, month) {
  return dateStr.slice(0, 7) === month;
}

/**
 * Adiciona dias a uma data
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 * @param {number} days - Número de dias a adicionar
 */
export function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Retorna o dia da semana (0-6, onde 0 é domingo)
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 */
export function getDayOfWeek(dateStr) {
  return new Date(dateStr).getDay();
}

/**
 * Compara duas datas (-1 se a1 < a2, 0 se igual, 1 se a1 > a2)
 * @param {string} dateStr1 - Data no formato YYYY-MM-DD
 * @param {string} dateStr2 - Data no formato YYYY-MM-DD
 */
export function compareDates(dateStr1, dateStr2) {
  if (dateStr1 < dateStr2) return -1;
  if (dateStr1 > dateStr2) return 1;
  return 0;
}

/**
 * Valida se uma string é uma data válida no formato YYYY-MM-DD
 * @param {string} dateStr - String a validar
 */
export function isValidDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Normaliza uma data para garantir formato YYYY-MM-DD
 * @param {string} dateStr - String de data
 */
export function normalizeDate(dateStr) {
  if (!dateStr) return null;
  // Se já está no formato YYYY-MM-DD, retorna
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Tenta converter de outros formatos
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
