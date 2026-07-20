/* Node test for the FairPlay rotation engine: node tests/engine.test.js */
const { buildRotation, appearanceCounts, equityScore, equityBadge, fmtClock } =
  require('../js/engine.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.error('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

function players(n) {
  return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, seasonSeconds: 0 }));
}

// 1. Appearance spread ≤ 1 across many roster/slot/period shapes
for (const [n, slots, periods] of [[10, 5, 4], [7, 5, 4], [11, 9, 5], [6, 5, 4], [13, 6, 3], [5, 5, 4], [3, 5, 2]]) {
  const plan = buildRotation(players(n), slots, periods);
  const counts = appearanceCounts(plan);
  const vals = players(n).map(p => counts[p.id] || 0);
  const spread = Math.max(...vals) - Math.min(...vals);
  check(`spread<=1 for n=${n} slots=${slots} periods=${periods}`, spread <= 1, `spread=${spread} counts=${vals}`);
  const totalSlots = Math.min(slots, n) * periods;
  check(`slots filled for n=${n} slots=${slots}`, vals.reduce((a, b) => a + b, 0) === totalSlots);
  // no duplicate player within a period
  check(`no dupes n=${n} slots=${slots}`, plan.every(per => new Set(per).size === per.length));
}

// 2. No back-to-back benching when n <= 2*slots
{
  const plan = buildRotation(players(9), 5, 6);
  let backToBack = false;
  for (let per = 1; per < plan.length; per++) {
    const prev = new Set(plan[per - 1]);
    const cur = new Set(plan[per]);
    for (const p of players(9)) {
      if (!prev.has(p.id) && !cur.has(p.id)) backToBack = true;
    }
  }
  check('no back-to-back benching (n=9, slots=5)', !backToBack);
}

// 3. Season minutes deficit wins ties: the short-changed kid plays MORE this game
{
  const ps = players(10);
  ps[7].seasonSeconds = 0;         // shorted kid
  ps.forEach((p, i) => { if (i !== 7) p.seasonSeconds = 1200; });
  const plan = buildRotation(ps, 5, 4);
  const counts = appearanceCounts(plan);
  const others = ps.filter((_, i) => i !== 7).map(p => counts[p.id] || 0);
  check('season-shorted kid gets max appearances', counts['p7'] >= Math.max(...others));
  check('season-shorted kid starts period 1', plan[0].includes('p7'));
}

// 4. Edge cases
check('empty roster -> empty plan', buildRotation([], 5, 4).length === 0);
check('fewer players than slots still works', buildRotation(players(3), 5, 2).every(per => per.length === 3));

// 5. Equity score behavior
check('perfect equality = 100', equityScore([600, 600, 600]) === 100);
check('all zero = 100', equityScore([0, 0, 0]) === 100);
check('single player = 100', equityScore([600]) === 100);
const uneven = equityScore([1200, 200, 200, 200]);
check('very uneven scores low', uneven < 60, 'got ' + uneven);
const slight = equityScore([600, 580, 610, 590]);
check('slightly uneven scores high', slight >= 90, 'got ' + slight);
check('badge tiers', equityBadge(95).label === 'Gold Whistle' && equityBadge(40).label === 'Needs Work');

// 6. Clock formatting
check('fmtClock 0', fmtClock(0) === '0:00');
check('fmtClock 605', fmtClock(605) === '10:05');

console.log(failures ? `\n${failures} failure(s)` : '\nAll engine tests passed.');
process.exit(failures ? 1 : 0);
