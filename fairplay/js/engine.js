/* FairPlay engine — pure functions for rotation planning and equity math.
   No DOM access here so it can be unit-tested in Node. */
(function (root) {
  'use strict';

  /**
   * Build a fair rotation plan.
   * @param {Array<{id:string, seasonSeconds:number}>} players present players;
   *        seasonSeconds is prior playing time this season (cross-game fairness)
   * @param {number} slots   players on the field at once
   * @param {number} periods number of periods/innings/shifts
   * @returns {string[][]} periods × slots array of player ids
   *
   * Guarantees:
   * - Appearance counts within the game differ by at most 1 across players.
   * - Nobody sits two periods in a row unless roster size makes that impossible
   *   (present > 2 × slots).
   * - Ties broken by lowest season minutes, so under-played kids catch up
   *   across the season, then by roster order for determinism.
   */
  function buildRotation(players, slots, periods) {
    const n = players.length;
    if (n === 0 || slots <= 0 || periods <= 0) return [];
    const S = Math.min(slots, n);

    const apps = Object.create(null);      // appearances this game
    const benched = Object.create(null);   // consecutive periods on bench
    players.forEach(p => { apps[p.id] = 0; benched[p.id] = 0; });
    const order = new Map(players.map((p, i) => [p.id, i]));

    const plan = [];
    for (let per = 0; per < periods; per++) {
      const ranked = players.slice().sort((a, b) =>
        (apps[a.id] - apps[b.id]) ||
        (benched[b.id] - benched[a.id]) ||
        ((a.seasonSeconds || 0) - (b.seasonSeconds || 0)) ||
        (order.get(a.id) - order.get(b.id))
      );
      const onField = ranked.slice(0, S).map(p => p.id);
      const fieldSet = new Set(onField);
      players.forEach(p => {
        if (fieldSet.has(p.id)) { apps[p.id]++; benched[p.id] = 0; }
        else benched[p.id]++;
      });
      plan.push(onField);
    }
    return plan;
  }

  /** Appearance counts per player id for a plan. */
  function appearanceCounts(plan) {
    const counts = Object.create(null);
    plan.forEach(period => period.forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
    return counts;
  }

  /**
   * Equity score 0–100 from actual seconds played per kid.
   * 100 = perfectly equal. Uses coefficient of variation, clamped.
   */
  function equityScore(secondsList) {
    const vals = secondsList.filter(v => typeof v === 'number');
    if (vals.length < 2) return 100;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mean <= 0) return 100;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const cv = Math.sqrt(variance) / mean;
    return Math.max(0, Math.round(100 * (1 - cv)));
  }

  function equityBadge(score) {
    if (score >= 90) return { label: 'Gold Whistle', emoji: '🥇', note: 'Near-perfect equal play time.' };
    if (score >= 75) return { label: 'Silver Whistle', emoji: '🥈', note: 'Solid fairness — small gaps.' };
    if (score >= 60) return { label: 'Bronze Whistle', emoji: '🥉', note: 'Fair-ish. A few kids need more time next game.' };
    return { label: 'Needs Work', emoji: '📋', note: 'Play-time gaps are large — FairPlay will prioritize under-played kids next game.' };
  }

  function fmtClock(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  const api = { buildRotation, appearanceCounts, equityScore, equityBadge, fmtClock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FairPlayEngine = api;
})(typeof self !== 'undefined' ? self : this);
