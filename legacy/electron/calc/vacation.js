// Pure calculation for vacations. No DB access.
// Computes base (pro rata by days), one third, and total based on salary at start date.

function daysInclusive(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (!(start instanceof Date) || isNaN(start) || !(end instanceof Date) || isNaN(end) || end < start) {
    throw new Error('Período inválido');
  }
  const msPerDay = 24*60*60*1000;
  return Math.floor((end - start) / msPerDay) + 1;
}

function computeVacationAmounts(period_start, period_end, salaryAtStart, includeOneThird = true) {
  const d = daysInclusive(period_start, period_end);
  const base = +(Number(salaryAtStart || 0) * (d / 30)).toFixed(2);
  const oneThird = includeOneThird ? +(base / 3).toFixed(2) : 0;
  const total = +(base + oneThird).toFixed(2);
  return { days: d, base, one_third: oneThird, total };
}

module.exports = { computeVacationAmounts, daysInclusive };
