/* FairPlay app — views, state, live game clock. Vanilla JS, no build step. */
(function () {
'use strict';

const E = window.FairPlayEngine;
const LS_KEY = 'fairplay.v1';

/* ---------------------------------------------------------------- state */

const SPORTS = [
  { key: 'soccer',   name: 'Soccer',        emoji: '⚽', slots: 5, periods: 4, periodMinutes: 10, unit: 'Period' },
  { key: 'flag',     name: 'Flag Football', emoji: '🏈', slots: 5, periods: 4, periodMinutes: 10, unit: 'Quarter' },
  { key: 'basket',   name: 'Basketball',    emoji: '🏀', slots: 5, periods: 4, periodMinutes: 8,  unit: 'Quarter' },
  { key: 'baseball', name: 'Baseball / T-Ball', emoji: '⚾', slots: 9, periods: 5, periodMinutes: 12, unit: 'Inning' },
  { key: 'volley',   name: 'Volleyball',    emoji: '🏐', slots: 6, periods: 3, periodMinutes: 12, unit: 'Set' },
  { key: 'hockey',   name: 'Hockey',        emoji: '🏒', slots: 5, periods: 3, periodMinutes: 12, unit: 'Period' },
  { key: 'custom',   name: 'Custom',        emoji: '🎽', slots: 5, periods: 4, periodMinutes: 10, unit: 'Period' },
];

let state = load();
let view = state.teams.length ? (liveGame() ? 'game' : 'teams') : 'teams';
let selectedFieldTile = null; // player id selected for substitution
let tickTimer = null;

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupted state falls through to fresh */ }
  return { teams: [], activeTeamId: null, org: '' };
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    ('id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
}

function team() { return state.teams.find(t => t.id === state.activeTeamId) || null; }
function sportOf(t) { return SPORTS.find(s => s.key === t.sport) || SPORTS[SPORTS.length - 1]; }
function liveGame() {
  const t = team();
  return t ? t.games.find(g => g.status === 'live') : null;
}
function playerName(t, id) {
  const p = t.players.find(p => p.id === id);
  return p ? p.name : '?';
}
function seasonSeconds(t, pid) {
  return t.games.filter(g => g.status === 'done')
    .reduce((sum, g) => sum + (g.seconds[pid] || 0), 0);
}

/* ------------------------------------------------------------ rendering */

const $app = document.getElementById('app');
const $ctx = document.getElementById('topbar-context');

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function modal(html, onMount) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  if (onMount) onMount(root);
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

function setView(v) {
  view = v;
  selectedFieldTile = null;
  render();
}

document.getElementById('tabbar').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (btn) setView(btn.dataset.view);
});
document.getElementById('btn-home').addEventListener('click', () => setView('teams'));

function render() {
  document.querySelectorAll('.tab').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  const t = team();
  $ctx.textContent = t ? `${sportOf(t).emoji} ${t.name}` : (state.org || '');

  const needsTeam = ['roster', 'game', 'season'];
  if (needsTeam.includes(view) && !t) { view = 'teams'; }

  switch (view) {
    case 'teams':    return renderTeams();
    case 'roster':   return renderRoster();
    case 'game':     return renderGame();
    case 'season':   return renderSeason();
    case 'settings': return renderSettings();
    default:         return renderTeams();
  }
}

/* --------------------------------------------------------------- teams */

function renderTeams() {
  stopTick();
  let html = `<h1>Your teams</h1>
    <p class="sub">Every kid plays. FairPlay makes sure of it — and proves it to parents.</p>`;

  if (!state.teams.length) {
    html += `<div class="empty"><div class="big">🏟️</div>
      No teams yet.<br>Add your first team to build a roster and run a fair game.
      <div style="margin-top:16px"><button class="btn btn-primary" id="btn-demo">Load demo team</button></div>
    </div>`;
  }

  html += state.teams.map(t => {
    const s = sportOf(t);
    const done = t.games.filter(g => g.status === 'done').length;
    return `<div class="card tappable" data-team="${t.id}">
      <div class="row">
        <div class="row-main">
          <div class="emoji-badge">${s.emoji}</div>
          <div>
            <div class="row-title">${esc(t.name)}</div>
            <div class="row-sub">${s.name} · ${t.players.length} players · ${done} game${done === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div>${t.id === state.activeTeamId ? '<span class="accent">✓ active</span>' : ''}</div>
      </div>
    </div>`;
  }).join('');

  html += `<button class="btn btn-block" id="btn-add-team">＋ New team</button>`;
  $app.innerHTML = html;

  $app.querySelectorAll('[data-team]').forEach(el =>
    el.addEventListener('click', () => {
      state.activeTeamId = el.dataset.team;
      save();
      setView('roster');
    }));
  const addBtn = document.getElementById('btn-add-team');
  if (addBtn) addBtn.addEventListener('click', teamForm);
  const demoBtn = document.getElementById('btn-demo');
  if (demoBtn) demoBtn.addEventListener('click', loadDemo);
}

function teamForm(existing) {
  const t = existing && existing.id ? existing : null;
  const s = t ? sportOf(t) : SPORTS[0];
  modal(`
    <h2>${t ? 'Edit team' : 'New team'}</h2>
    <label class="field">Team name
      <input id="f-name" value="${t ? esc(t.name) : ''}" placeholder="Aventura Sharks U8" autocomplete="off">
    </label>
    <label class="field">Sport
      <select id="f-sport">
        ${SPORTS.map(sp => `<option value="${sp.key}" ${sp.key === (t ? t.sport : 'soccer') ? 'selected' : ''}>${sp.emoji} ${sp.name}</option>`).join('')}
      </select>
    </label>
    <div class="field-grid">
      <label class="field">On field
        <input id="f-slots" type="number" min="1" max="15" value="${t ? t.slots : s.slots}">
      </label>
      <label class="field">Periods
        <input id="f-periods" type="number" min="1" max="12" value="${t ? t.periods : s.periods}">
      </label>
      <label class="field">Min / period
        <input id="f-mins" type="number" min="1" max="45" value="${t ? t.periodMinutes : s.periodMinutes}">
      </label>
    </div>
    <div class="modal-actions">
      <button class="btn" id="f-cancel">Cancel</button>
      <button class="btn btn-primary" id="f-save">${t ? 'Save' : 'Create team'}</button>
    </div>
  `, root => {
    root.querySelector('#f-sport').addEventListener('change', e => {
      const sp = SPORTS.find(x => x.key === e.target.value);
      root.querySelector('#f-slots').value = sp.slots;
      root.querySelector('#f-periods').value = sp.periods;
      root.querySelector('#f-mins').value = sp.periodMinutes;
    });
    root.querySelector('#f-cancel').addEventListener('click', closeModal);
    root.querySelector('#f-save').addEventListener('click', () => {
      const name = root.querySelector('#f-name').value.trim();
      if (!name) { toast('Give the team a name'); return; }
      const data = {
        name,
        sport: root.querySelector('#f-sport').value,
        slots: Math.max(1, +root.querySelector('#f-slots').value || 5),
        periods: Math.max(1, +root.querySelector('#f-periods').value || 4),
        periodMinutes: Math.max(1, +root.querySelector('#f-mins').value || 10),
      };
      if (t) Object.assign(t, data);
      else {
        const nt = Object.assign({ id: uid(), players: [], games: [] }, data);
        state.teams.push(nt);
        state.activeTeamId = nt.id;
      }
      save(); closeModal();
      setView(t ? 'roster' : 'roster');
    });
  });
}

function loadDemo() {
  const names = ['Liam','Maya','Noah','Sofia','Ethan','Ava','Lucas','Isabella','Mason','Camila'];
  const nt = {
    id: uid(), name: 'Demo Sharks U8', sport: 'soccer',
    slots: 5, periods: 4, periodMinutes: 10,
    players: names.map((n, i) => ({ id: uid(), name: n, number: String(i + 2) })),
    games: [],
  };
  state.teams.push(nt);
  state.activeTeamId = nt.id;
  save();
  toast('Demo team loaded — go run a game!');
  setView('roster');
}

/* -------------------------------------------------------------- roster */

function renderRoster() {
  stopTick();
  const t = team();
  const s = sportOf(t);
  let html = `<h1>${esc(t.name)}</h1>
    <p class="sub">${s.name} · ${t.slots} on the field · ${t.periods} × ${t.periodMinutes} min ${s.unit.toLowerCase()}s
      &nbsp;<button class="btn btn-sm btn-ghost" id="btn-edit-team">Edit</button></p>
    <h2>Roster (${t.players.length})</h2>`;

  if (!t.players.length) {
    html += `<div class="empty"><div class="big">🧢</div>Add your players below.<br>Numbers are optional.</div>`;
  }
  html += t.players.map(p => `
    <div class="card">
      <div class="row">
        <div class="row-main">
          <div class="emoji-badge">${p.number ? '#' + esc(p.number) : '🧢'}</div>
          <div class="row-title">${esc(p.name)}</div>
        </div>
        <button class="btn btn-sm btn-danger" data-del="${p.id}">Remove</button>
      </div>
    </div>`).join('');

  html += `<div class="card">
      <label class="field">Player name
        <input id="np-name" placeholder="Jordan" autocomplete="off">
      </label>
      <div class="field-grid" style="grid-template-columns: 1fr 2fr">
        <label class="field">Jersey #
          <input id="np-num" placeholder="7" autocomplete="off">
        </label>
        <label class="field">&nbsp;
          <button class="btn btn-primary btn-block" id="btn-add-player">＋ Add player</button>
        </label>
      </div>
    </div>`;
  $app.innerHTML = html;

  document.getElementById('btn-edit-team').addEventListener('click', () => teamForm(t));
  const add = () => {
    const name = document.getElementById('np-name').value.trim();
    if (!name) { toast('Type a name first'); return; }
    t.players.push({ id: uid(), name, number: document.getElementById('np-num').value.trim() });
    save(); renderRoster();
    setTimeout(() => { const el = document.getElementById('np-name'); if (el) el.focus(); }, 0);
  };
  document.getElementById('btn-add-player').addEventListener('click', add);
  document.getElementById('np-name').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  $app.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => {
      t.players = t.players.filter(p => p.id !== b.dataset.del);
      save(); renderRoster();
    }));
}

/* ---------------------------------------------------------------- game */

function renderGame() {
  const g = liveGame();
  if (g) return renderLive(g);
  stopTick();
  const t = team();
  if (t.players.length < 2) {
    $app.innerHTML = `<div class="empty"><div class="big">🧢</div>
      You need at least 2 players on the roster to run a game.
      <div style="margin-top:16px"><button class="btn btn-primary" id="go-roster">Go to roster</button></div></div>`;
    document.getElementById('go-roster').addEventListener('click', () => setView('roster'));
    return;
  }

  if (!renderGame._present) renderGame._present = new Set(t.players.map(p => p.id));
  const present = renderGame._present;

  let html = `<h1>Game day</h1>
    <p class="sub">Step 1 — who showed up? Tap to toggle.</p>
    <div class="chip-grid">
      ${t.players.map(p => `<button class="chip ${present.has(p.id) ? 'on' : ''}" data-p="${p.id}">
        ${p.number ? '#' + esc(p.number) + ' ' : ''}${esc(p.name)}</button>`).join('')}
    </div>
    <label class="field" style="margin-top:16px">Opponent (optional)
      <input id="g-opp" placeholder="Red Dragons" autocomplete="off">
    </label>
    <button class="btn btn-primary btn-block" id="btn-preview">Build fair lineup → </button>
    <p class="hint">${present.size} present · ${Math.min(t.slots, present.size)} on the field ·
      everyone gets ${present.size ? Math.round((Math.min(t.slots, present.size) * t.periods / present.size) * 10) / 10 : 0}
      of ${t.periods} ${sportOf(t).unit.toLowerCase()}s (±1)</p>`;
  $app.innerHTML = html;

  $app.querySelectorAll('[data-p]').forEach(chip =>
    chip.addEventListener('click', () => {
      const id = chip.dataset.p;
      if (present.has(id)) present.delete(id); else present.add(id);
      renderGame();
    }));
  document.getElementById('btn-preview').addEventListener('click', () => {
    if (present.size < 2) { toast('Need at least 2 kids present'); return; }
    previewLineup([...present], document.getElementById('g-opp').value.trim());
  });
}

function previewLineup(presentIds, opponent) {
  const t = team();
  const s = sportOf(t);
  const players = presentIds.map(id => ({ id, seasonSeconds: seasonSeconds(t, id) }));
  const plan = E.buildRotation(players, t.slots, t.periods);
  const counts = E.appearanceCounts(plan);

  const rows = plan.map((period, i) => {
    const sitting = presentIds.filter(id => !period.includes(id));
    return `<tr>
      <th>${s.unit} ${i + 1}</th>
      <td>${period.map(id => esc(playerName(t, id))).join(', ')}</td>
      <td class="sits">${sitting.map(id => esc(playerName(t, id))).join(', ') || '—'}</td>
    </tr>`;
  }).join('');

  modal(`
    <h2>Fair lineup ${opponent ? 'vs ' + esc(opponent) : ''}</h2>
    <p class="hint" style="margin:0 0 12px">Balanced by this game <b>and</b> season minutes — kids who were short last week start first.
      Appearances: ${presentIds.map(id => `${esc(playerName(t, id))} ${counts[id] || 0}`).join(' · ')}</p>
    <div class="table-scroll"><table class="rota">
      <tr><th></th><th>On the field</th><th>Sitting</th></tr>${rows}
    </table></div>
    <div class="modal-actions">
      <button class="btn" id="pl-back">Back</button>
      <button class="btn" id="pl-shuffle">↻ Rebuild</button>
      <button class="btn btn-primary" id="pl-start">Start game ▶</button>
    </div>
  `, root => {
    root.querySelector('#pl-back').addEventListener('click', closeModal);
    root.querySelector('#pl-shuffle').addEventListener('click', () => {
      presentIds.sort(() => Math.random() - 0.5);
      closeModal(); previewLineup(presentIds, opponent);
    });
    root.querySelector('#pl-start').addEventListener('click', () => {
      const seconds = {};
      presentIds.forEach(id => { seconds[id] = 0; });
      t.games.push({
        id: uid(),
        date: new Date().toISOString(),
        opponent,
        presentIds,
        plan,
        lineup: plan[0].slice(),
        currentPeriod: 0,
        seconds,
        status: 'live',
        clock: { running: false, elapsed: 0, lastTickAt: null },
      });
      renderGame._present = null;
      save(); closeModal(); render();
    });
  });
}

/* ----------------------------------------------------------- live game */

function applyClock(g) {
  if (g.clock.running && g.clock.lastTickAt) {
    const now = Date.now();
    const delta = Math.max(0, (now - g.clock.lastTickAt) / 1000);
    g.clock.elapsed += delta;
    g.lineup.forEach(id => { g.seconds[id] = (g.seconds[id] || 0) + delta; });
    g.clock.lastTickAt = now;
  }
}

function startTick() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    const g = liveGame();
    if (!g || !g.clock.running) return;
    applyClock(g);
    if (Math.floor(g.clock.elapsed) % 5 === 0) save();
    updateLiveClockDom(g);
  }, 1000);
}
function stopTick() { clearInterval(tickTimer); tickTimer = null; }

function updateLiveClockDom(g) {
  const t = team();
  const el = document.getElementById('live-clock');
  if (!el) return;
  const total = t.periodMinutes * 60;
  const remaining = total - g.clock.elapsed;
  el.textContent = E.fmtClock(Math.max(0, remaining));
  el.classList.toggle('running', g.clock.running);
  if (remaining <= 0 && g.clock.running) {
    g.clock.running = false;
    save();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    toast(`${sportOf(t).unit} ${g.currentPeriod + 1} is over — sub and start the next one`);
    renderLive(g);
    return;
  }
  document.querySelectorAll('[data-live-mins]').forEach(node => {
    node.textContent = E.fmtClock(g.seconds[node.dataset.liveMins] || 0);
  });
}

function renderLive(g) {
  const t = team();
  const s = sportOf(t);
  applyClock(g);
  startTick();

  const lastPeriod = g.currentPeriod >= t.periods - 1;
  const bench = g.presentIds.filter(id => !g.lineup.includes(id));
  const nextPlan = !lastPeriod ? g.plan[g.currentPeriod + 1] : [];

  const pills = Array.from({ length: t.periods }, (_, i) =>
    `<span class="pill ${i < g.currentPeriod ? 'done' : i === g.currentPeriod ? 'now' : ''}"></span>`).join('');

  const tile = (id, zone) => `
    <div class="player-tile ${selectedFieldTile === id ? 'selected' : ''}" data-tile="${id}" data-zone="${zone}">
      <span class="pname">${esc(playerName(t, id))}
        ${zone === 'bench' && nextPlan.includes(id) ? '<span class="next-up"> · next up</span>' : ''}</span>
      <span class="mins" data-live-mins="${id}">${E.fmtClock(g.seconds[id] || 0)}</span>
    </div>`;

  $app.innerHTML = `
    <div class="clock-wrap">
      <div class="clock ${g.clock.running ? 'running' : ''}" id="live-clock">
        ${E.fmtClock(Math.max(0, t.periodMinutes * 60 - g.clock.elapsed))}</div>
      <div class="clock-sub">${s.unit} ${g.currentPeriod + 1} of ${t.periods}
        ${g.opponent ? ' · vs ' + esc(g.opponent) : ''}</div>
      <div class="period-pills">${pills}</div>
      <div style="display:flex; gap:10px; justify-content:center; margin-top:8px">
        <button class="btn ${g.clock.running ? '' : 'btn-primary'}" id="btn-clock">
          ${g.clock.running ? '⏸ Pause' : '▶ Start clock'}</button>
        <button class="btn" id="btn-next">${lastPeriod ? '🏁 End game' : 'Next ' + s.unit.toLowerCase() + ' →'}</button>
      </div>
    </div>

    <div class="zone zone-field">
      <h3>On the field (${g.lineup.length})</h3>
      ${g.lineup.map(id => tile(id, 'field')).join('')}
    </div>
    <div class="zone zone-bench">
      <h3>Bench (${bench.length})</h3>
      ${bench.map(id => tile(id, 'bench')).join('') || '<div class="hint">Everyone is on the field.</div>'}
    </div>
    <p class="hint">Substitute any time: tap a kid on the field, then tap who replaces them from the bench.
      The clock only credits kids while it runs.</p>
    <button class="btn btn-danger btn-block btn-sm" id="btn-abandon">Cancel game (no stats saved)</button>`;

  document.getElementById('btn-clock').addEventListener('click', () => {
    applyClock(g);
    g.clock.running = !g.clock.running;
    g.clock.lastTickAt = g.clock.running ? Date.now() : null;
    save(); renderLive(g);
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    applyClock(g);
    g.clock.running = false;
    g.clock.lastTickAt = null;
    if (lastPeriod) return finishGame(g);
    g.currentPeriod++;
    g.clock.elapsed = 0;
    g.lineup = g.plan[g.currentPeriod].slice();
    save(); renderLive(g);
  });

  document.getElementById('btn-abandon').addEventListener('click', () => {
    modal(`<h2>Cancel this game?</h2><p class="hint">No minutes will be saved.</p>
      <div class="modal-actions">
        <button class="btn" id="ab-no">Keep playing</button>
        <button class="btn btn-danger" id="ab-yes">Yes, cancel it</button>
      </div>`, root => {
      root.querySelector('#ab-no').addEventListener('click', closeModal);
      root.querySelector('#ab-yes').addEventListener('click', () => {
        t.games = t.games.filter(x => x.id !== g.id);
        save(); closeModal(); render();
      });
    });
  });

  $app.querySelectorAll('[data-tile]').forEach(el =>
    el.addEventListener('click', () => {
      const id = el.dataset.tile;
      const zone = el.dataset.zone;
      if (zone === 'field') {
        selectedFieldTile = selectedFieldTile === id ? null : id;
        renderLive(g);
      } else if (selectedFieldTile) {
        applyClock(g);
        const idx = g.lineup.indexOf(selectedFieldTile);
        if (idx >= 0) g.lineup[idx] = id;
        toast(`${playerName(t, id)} in, ${playerName(t, selectedFieldTile)} out`);
        selectedFieldTile = null;
        save(); renderLive(g);
      } else {
        toast('First tap the kid coming OFF the field');
      }
    }));
}

function finishGame(g) {
  const t = team();
  applyClock(g);
  g.clock.running = false;
  g.status = 'done';
  save();
  stopTick();
  renderReport(g);
}

/* -------------------------------------------------------------- report */

function renderReport(g) {
  const t = team();
  const secs = g.presentIds.map(id => g.seconds[id] || 0);
  const score = E.equityScore(secs);
  const badge = E.equityBadge(score);
  const max = Math.max(...secs, 1);
  const sorted = g.presentIds.slice().sort((a, b) => (g.seconds[b] || 0) - (g.seconds[a] || 0));

  $app.innerHTML = `
    <div class="card score-hero">
      <div class="score-num accent">${score}</div>
      <div class="score-label">${badge.emoji} ${badge.label}</div>
      <div class="score-note">${badge.note}</div>
    </div>
    <h2>Playing time ${g.opponent ? '· vs ' + esc(g.opponent) : ''}</h2>
    <div class="card">
      ${sorted.map(id => `
        <div class="bar-row">
          <div class="bar-name">${esc(playerName(t, id))}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round(100 * (g.seconds[id] || 0) / max)}%"></div></div>
          <div class="bar-val">${E.fmtClock(g.seconds[id] || 0)}</div>
        </div>`).join('')}
    </div>
    <button class="btn btn-primary btn-block" id="btn-share">📣 Share fairness report with parents</button>
    <button class="btn btn-block btn-ghost" id="btn-done" style="margin-top:10px">Done</button>`;

  document.getElementById('btn-share').addEventListener('click', () => {
    const lines = sorted.map(id => `  ${playerName(t, id)}: ${E.fmtClock(g.seconds[id] || 0)}`);
    const text = `🏟️ ${t.name}${g.opponent ? ' vs ' + g.opponent : ''} — FairPlay report\n` +
      `Equity score: ${score}/100 ${badge.emoji} ${badge.label}\n\nPlaying time:\n${lines.join('\n')}\n\n` +
      `Tracked live with FairPlay — every kid plays.`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied — paste into the team chat'));
  });
  document.getElementById('btn-done').addEventListener('click', () => setView('season'));
}

/* -------------------------------------------------------------- season */

function renderSeason() {
  stopTick();
  const t = team();
  const games = t.games.filter(g => g.status === 'done');
  if (!games.length) {
    $app.innerHTML = `<h1>Season</h1><div class="empty"><div class="big">📊</div>
      No finished games yet. Run a game and your season equity dashboard appears here.</div>`;
    return;
  }
  const totals = {};
  t.players.forEach(p => { totals[p.id] = 0; });
  games.forEach(g => Object.keys(g.seconds).forEach(id => { totals[id] = (totals[id] || 0) + g.seconds[id]; }));
  const avgScore = Math.round(games.reduce((a, g) =>
    a + E.equityScore(g.presentIds.map(id => g.seconds[id] || 0)), 0) / games.length);
  const ids = Object.keys(totals).filter(id => t.players.some(p => p.id === id));
  const max = Math.max(...ids.map(id => totals[id]), 1);
  const sorted = ids.sort((a, b) => totals[b] - totals[a]);

  $app.innerHTML = `<h1>Season</h1>
    <div class="stat-grid">
      <div class="stat"><div class="v">${games.length}</div><div class="k">Games</div></div>
      <div class="stat"><div class="v accent">${avgScore}</div><div class="k">Avg equity</div></div>
      <div class="stat"><div class="v">${t.players.length}</div><div class="k">Players</div></div>
    </div>
    <h2>Total playing time</h2>
    <div class="card">
      ${sorted.map(id => `
        <div class="bar-row">
          <div class="bar-name">${esc(playerName(t, id))}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round(100 * totals[id] / max)}%"></div></div>
          <div class="bar-val">${E.fmtClock(totals[id])}</div>
        </div>`).join('')}
    </div>
    <p class="hint">FairPlay uses these season totals when building the next lineup, so kids at the bottom automatically start first next game.</p>
    <h2>Game log</h2>
    ${games.slice().reverse().map(g => {
      const sc = E.equityScore(g.presentIds.map(id => g.seconds[id] || 0));
      return `<div class="card tappable" data-game="${g.id}">
        <div class="row">
          <div>
            <div class="row-title">${g.opponent ? 'vs ' + esc(g.opponent) : 'Game'}</div>
            <div class="row-sub">${new Date(g.date).toLocaleDateString()} · ${g.presentIds.length} kids</div>
          </div>
          <div class="accent" style="font-weight:800">${sc}</div>
        </div>
      </div>`;
    }).join('')}`;

  $app.querySelectorAll('[data-game]').forEach(el =>
    el.addEventListener('click', () => {
      const g = t.games.find(x => x.id === el.dataset.game);
      if (g) renderReport(g);
    }));
}

/* ------------------------------------------------------------ settings */

function renderSettings() {
  stopTick();
  $app.innerHTML = `<h1>More</h1>
    <div class="card">
      <label class="field">League / organization name (shown on reports)
        <input id="s-org" value="${esc(state.org || '')}" placeholder="i9 Sports Northeast Dade">
      </label>
      <button class="btn btn-sm" id="s-save-org">Save</button>
    </div>
    <h2>Data</h2>
    <div class="card">
      <button class="btn btn-block" id="s-export">⬇ Export all data (JSON backup)</button>
      <button class="btn btn-block" id="s-import" style="margin-top:10px">⬆ Import backup</button>
      <input type="file" id="s-file" accept="application/json" hidden>
      <button class="btn btn-danger btn-block" id="s-reset" style="margin-top:10px">Erase everything</button>
    </div>
    <h2>About</h2>
    <div class="card">
      <p style="font-size:.9rem; line-height:1.5">
        <b>FairPlay</b> is the volunteer coach's game-day autopilot: attendance in seconds,
        auto-built fair rotations, a live clock that credits each kid's real minutes, and a
        parent-proof equity report after every game. Works fully offline — no signal needed at the field.
        Your data never leaves this device.</p>
      <p class="hint">Install it: open your browser menu → “Add to Home Screen.”</p>
    </div>`;

  document.getElementById('s-save-org').addEventListener('click', () => {
    state.org = document.getElementById('s-org').value.trim();
    save(); toast('Saved');
  });
  document.getElementById('s-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fairplay-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('s-import').addEventListener('click', () =>
    document.getElementById('s-file').click());
  document.getElementById('s-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then(txt => {
      const data = JSON.parse(txt);
      if (!Array.isArray(data.teams)) throw new Error('bad file');
      state = data; save(); toast('Backup restored'); setView('teams');
    }).catch(() => toast('That file is not a FairPlay backup'));
  });
  document.getElementById('s-reset').addEventListener('click', () => {
    modal(`<h2>Erase everything?</h2><p class="hint">All teams, rosters, and game history on this device will be deleted. Export a backup first if unsure.</p>
      <div class="modal-actions">
        <button class="btn" id="r-no">Cancel</button>
        <button class="btn btn-danger" id="r-yes">Erase all data</button>
      </div>`, root => {
      root.querySelector('#r-no').addEventListener('click', closeModal);
      root.querySelector('#r-yes').addEventListener('click', () => {
        state = { teams: [], activeTeamId: null, org: '' };
        save(); closeModal(); setView('teams');
      });
    });
  });
}

/* ---------------------------------------------------------------- init */

render();
})();
