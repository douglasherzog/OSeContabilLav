const { testComputeVacation } = require('./vacation.test');

function run(name, fn) {
  try { fn(); console.log(`✔ ${name}`); }
  catch (e) { console.error(`✘ ${name}:`, e.message); process.exitCode = 1; }
}

console.log('Running unit tests...');
run('computeVacationAmounts', testComputeVacation);

if (process.exitCode === 0 || process.exitCode === undefined) {
  console.log('All tests passed.');
}
