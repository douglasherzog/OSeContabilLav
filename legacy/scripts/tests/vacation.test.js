const assert = require('assert');
const { computeVacationAmounts } = require('../../electron/calc/vacation');

function near(a, b, eps = 0.01) { return Math.abs(a - b) <= eps; }

function testComputeVacation() {
  // 30 dias de férias com salário 1500 => base 1500, 1/3 = 500, total 2000
  const r1 = computeVacationAmounts('2026-05-01', '2026-05-30', 1500, true);
  assert.equal(r1.days, 30);
  assert(near(r1.base, 1500));
  assert(near(r1.one_third, 500));
  assert(near(r1.total, 2000));

  // 10 dias com salário 1800 => base 600, 1/3 = 200, total 800
  const r2 = computeVacationAmounts('2026-06-01', '2026-06-10', 1800, true);
  assert.equal(r2.days, 10);
  assert(near(r2.base, 600));
  assert(near(r2.one_third, 200));
  assert(near(r2.total, 800));

  // Sem 1/3
  const r3 = computeVacationAmounts('2026-06-01', '2026-06-10', 1800, false);
  assert(near(r3.base, 600));
  assert(near(r3.one_third, 0));
  assert(near(r3.total, 600));
}

module.exports = { testComputeVacation };
