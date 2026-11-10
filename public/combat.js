// Combat Calculator page. All maths happens server-side in POST /api/combat/simulate
// (single source of truth: src/combat/engine.js).

const $ = (id) => document.getElementById(id);
const unitCache = new Map();
let units = [];

const pct = (p) => (p >= 0.995 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace(/\.?0+$/, '') || '0' : '–');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function getUnit(id) {
  if (!unitCache.has(id)) unitCache.set(id, api(`/api/combat/units/${encodeURIComponent(id)}`).then((b) => b.unit));
  return unitCache.get(id);
}

/* ------------------------------------------------------------ unit pickers */

function fillSelect(sel, query, keep) {
  const q = query.trim().toLowerCase();
  const match = (u) => !q || u.name.toLowerCase().includes(q) || u.faction.toLowerCase().includes(q)
    || u.aliases.some((a) => a.includes(q));
  const byFaction = new Map();
  for (const u of units.filter(match)) {
    if (!byFaction.has(u.faction)) byFaction.set(u.faction, []);
    byFaction.get(u.faction).push(u);
  }
  sel.innerHTML = '';
  for (const [faction, list] of byFaction) {
    const g = document.createElement('optgroup'); g.label = faction;
    for (const u of list) g.append(new Option(u.name, u.id));
    sel.append(g);
  }
  sel.append(new Option('Custom profile…', '__custom'));
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

async function renderAttackerWeapons(preselect) {
  const id = $('a-unit').value;
  const custom = id === '__custom';
  $('a-custom').classList.toggle('hidden', !custom);
  $('a-weapons-fs').classList.toggle('hidden', custom);
  const box = $('a-weapons');
  box.innerHTML = '';
  if (custom) return;
  const u = await getUnit(id);
  const models = Number($('a-models').value) || 1;
  u.weapons.forEach((w, i) => {
    const row = document.createElement('div');
    row.className = 'weapon';
    const checked = preselect ? preselect.includes(w.id) : i === 0;
    const kw = w.keywords.length ? ` · ${w.keywords.join(', ')}` : '';
    const skill = w.skill ? `${w.skill}+` : 'N/A';
    row.innerHTML = `
      <input type="checkbox" id="w-${i}" data-id="${esc(w.id)}" ${checked ? 'checked' : ''} aria-describedby="w-${i}-s">
      <label for="w-${i}" style="margin:0;color:inherit"><span class="name">${esc(w.name)}</span>
        <span class="stats" id="w-${i}-s"><br>${w.type === 'melee' ? 'Melee' : `${w.range}"`} · A${esc(w.A)} · ${skill} · S${w.S} · AP${w.AP} · D${esc(w.D)}${esc(kw)}</span></label>
      <input type="number" min="1" max="30" value="${models}" aria-label="Models firing ${esc(w.name)}" data-models-for="${i}">`;
    box.append(row);
  });
}

async function renderDefender() {
  const id = $('d-unit').value;
  const custom = id === '__custom';
  $('d-custom').classList.toggle('hidden', !custom);
  if (custom) { $('d-profile').textContent = 'Enter a custom profile below.'; return; }
  const u = await getUnit(id);
  const p = u.profile;
  $('d-profile').textContent = `T${p.T} · Sv ${p.Sv}+${p.inv ? ` · ${p.inv}++ invuln` : ''} · W${p.W}${p.fnp ? ` · FNP ${p.fnp}+` : ''} · ${u.keywords.join(', ')}`;
}

/* ------------------------------------------------------------- request */

const optNum = (v) => (v === '' || v == null ? undefined : Number(v));
const kwList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

function buildRequest() {
  const aModels = Number($('a-models').value);
  const attacker = { models: aModels, modifiers: {
    stationary: $('m-stationary').checked, halfRange: $('m-half').checked, charged: $('m-charged').checked,
    lethalHits: $('m-lethal').checked, devastatingWounds: $('m-dev').checked, ignoresCover: $('m-ignorecover').checked,
    rerollHits: $('m-rh').value, rerollWounds: $('m-rw').value,
    hitMod: Number($('m-hit').value), woundMod: Number($('m-wound').value),
    critHit: Number($('m-crit').value),
  } };
  if ($('m-sus').value) attacker.modifiers.sustainedHits = $('m-sus').value;
  if ($('a-unit').value === '__custom') {
    const kws = kwList($('cw-kw').value);
    const torrent = kws.some((k) => k.toLowerCase() === 'torrent');
    attacker.custom = { name: 'Custom attacker', weapons: [{
      name: $('cw-name').value || 'Custom weapon', type: $('cw-type').value, A: $('cw-A').value.trim(),
      skill: torrent ? undefined : Number($('cw-skill').value), S: Number($('cw-S').value),
      AP: -Math.abs(Number($('cw-AP').value) || 0), D: $('cw-D').value.trim(), keywords: kws }] };
  } else {
    attacker.unitId = $('a-unit').value;
    attacker.weapons = [...document.querySelectorAll('#a-weapons .weapon')]
      .filter((r) => r.querySelector('input[type=checkbox]').checked)
      .map((r) => ({ id: r.querySelector('input[type=checkbox]').dataset.id,
        models: Math.min(aModels, Number(r.querySelector('input[type=number]').value) || aModels) }));
  }
  const defender = { models: Number($('d-models').value), modifiers: {
    cover: $('dm-cover').checked, damageReduction: $('dm-dr').checked ? 1 : 0,
    hitMod: $('dm-stealth').checked ? -1 : 0, woundMod: $('dm-woundmod').checked ? -1 : 0,
    apReduction: $('dm-aoc').checked ? 1 : 0,
    fnp: optNum($('dm-fnp').value), invuln: optNum($('dm-inv').value),
  } };
  if ($('d-unit').value === '__custom') {
    defender.custom = { name: 'Custom defender', T: Number($('cd-T').value), Sv: Number($('cd-Sv').value),
      inv: optNum($('cd-inv').value), W: Number($('cd-W').value), fnp: optNum($('cd-fnp').value),
      keywords: kwList($('cd-kw').value) };
  } else defender.unitId = $('d-unit').value;
  return { attacker, defender };
}

/* ------------------------------------------------------------- results */

function renderResults(r) {
  const n = r.defender.models;
  const e = r.expected;
  $('results').hidden = false;
  $('res-sub').textContent = `${r.attacker.name} (${r.attacker.models}) attacking ${n} × ${r.defender.name}`;
  const tiles = [
    ['Unsaved wounds', fmt(e.unsavedWounds), 'expected'],
    ['Damage inflicted', fmt(e.damageInflicted), `of ${n * r.defender.W} wounds total`],
    ['Models killed', fmt(e.modelsKilled), `of ${n} expected`],
    ['Chance to wipe', pct(r.pWipe), 'all models destroyed'],
  ];
  $('tiles').innerHTML = tiles.map(([k, v, s]) =>
    `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="k">${s}</div></div>`).join('');

  const steps = [['Attacks', e.attacks], ['Hits', e.hits], ['Wounds', e.wounds], ['Failed saves', e.unsavedWounds],
    ['Damage', e.damageInflicted]];
  const max = Math.max(...steps.map((s) => s[1]), 1e-9);
  $('funnel').innerHTML = steps.map(([k, v]) => `
    <div class="step"><span>${k}</span>
      <div class="track" role="img" aria-label="${k}: ${fmt(v)}"><div class="bar" style="width:${(v / max) * 100}%"></div></div>
      <span class="num">${fmt(v)}</span></div>`).join('');

  renderChart(r.killDistribution);
  $('dist-table').innerHTML = '<thead><tr><th>Models killed</th><th class="num">Probability</th><th class="num">At least this many</th></tr></thead><tbody>'
    + r.killDistribution.map((p, k) => `<tr><td>${k}</td><td class="num">${(p * 100).toFixed(1)}%</td><td class="num">${(r.killDistribution.slice(k).reduce((a, b) => a + b, 0) * 100).toFixed(1)}%</td></tr>`).join('')
    + '</tbody>';

  const rows = r.weapons.map((w) => {
    const hit = w.hitTarget ? `${w.hitTarget}+${w.hitModifier ? ` (${w.hitModifier > 0 ? '+' : ''}${w.hitModifier})` : ''}` : 'auto';
    const wound = `${w.woundTarget}+${w.woundModifier ? ` (${w.woundModifier > 0 ? '+' : ''}${w.woundModifier})` : ''}`;
    const save = w.saveTarget ? `${w.saveTarget}+ ${w.saveUsed === 'invulnerable' ? 'invuln' : 'armour'}${w.coverApplied ? ' (cover)' : ''}` : 'none';
    const extras = [w.lethalHits && 'Lethal Hits', w.sustainedHits && `Sustained Hits ${w.sustainedHits}`,
      w.devastatingWounds > 0 && `${fmt(w.devastatingWounds)} dev. wounds`, ...w.notes].filter(Boolean).join('; ');
    return `<tr><td>${esc(w.weapon)} ×${w.models}${extras ? `<br><span class="muted" style="font-size:.8rem">${esc(extras)}</span>` : ''}</td>
      <td class="num">${fmt(w.attacks)}</td><td class="num">${hit}<br>${fmt(w.hits)}</td><td class="num">${wound}<br>${fmt(w.wounds)}</td>
      <td class="num">${save}<br>${fmt(w.unsavedWounds)}</td><td class="num">${fmt(w.damagePerUnsaved)}<br>${fmt(w.damage)}</td></tr>`;
  }).join('');
  $('breakdown').innerHTML = `<thead><tr><th>Weapon</th><th class="num">Attacks</th><th class="num">Hit · hits</th><th class="num">Wound · wounds</th><th class="num">Save · unsaved</th><th class="num">Dmg each · total</th></tr></thead><tbody>${rows}</tbody>`;

  $('method').textContent = (r.method === 'exact'
    ? 'Method: exact probability calculation (dynamic programming over the defending unit\'s state).'
    : `Method: Monte Carlo simulation, ${r.trials.toLocaleString()} trials (seed ${r.seed}); figures are estimates${r.fallbackReason ? ` (${r.fallbackReason})` : ''}.`)
    + ` Rules: ${r.rulesVersion}. Damage does not spill over between models. "Damage" in the funnel counts wounds actually removed; raw damage before allocation losses is ${fmt(e.damage)}.`;
}

function renderChart(dist) {
  const W = 600, H = 220, padL = 40, padB = 28, padT = 16;
  const n = dist.length;
  const maxP = Math.max(...dist, 0.01);
  const step = maxP > 0.5 ? 0.25 : maxP > 0.2 ? 0.1 : 0.05;
  const top = Math.min(1, Math.ceil(maxP / step) * step);
  const ticks = Math.round(top / step);
  const plotW = W - padL - 8, plotH = H - padB - padT;
  const slot = plotW / n, bw = Math.max(4, slot - 2);
  const y = (p) => padT + plotH - (p / top) * plotH;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-h chart-desc"><desc id="chart-desc">Bar chart of the probability of killing each number of models, from 0 to ${n - 1}. Most likely: ${dist.indexOf(Math.max(...dist))} killed.</desc>`;
  for (let i = 0; i <= ticks; i++) {
    const p = step * i, yy = y(p);
    svg += `<line class="grid" x1="${padL}" x2="${W - 8}" y1="${yy}" y2="${yy}"/><text x="${padL - 6}" y="${yy + 4}" text-anchor="end">${Math.round(p * 100)}%</text>`;
  }
  const labelEvery = n > 16 ? 2 : 1;
  dist.forEach((p, k) => {
    const x = padL + k * slot + (slot - bw) / 2;
    const h = Math.max(0, padT + plotH - y(p));
    const r = Math.min(4, bw / 2, h);
    // bar with 4px rounded top anchored to the baseline
    const yb = padT + plotH, yt = yb - h;
    const d = h > 0 ? `M${x},${yb}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${yb}Z` : '';
    svg += `<g tabindex="0" role="img" aria-label="${k} killed: ${(p * 100).toFixed(1)}%" data-k="${k}" data-p="${p}">
      <rect x="${padL + k * slot}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent"/>
      ${d ? `<path class="bar" d="${d}"/>` : ''}</g>`;
    if (k % labelEvery === 0) svg += `<text x="${x + bw / 2}" y="${H - padB + 16}" text-anchor="middle">${k}</text>`;
    if (p >= 0.05 && n <= 16) svg += `<text x="${x + bw / 2}" y="${yt - 4}" text-anchor="middle">${Math.round(p * 100)}%</text>`;
  });
  svg += `<text x="${padL + plotW / 2}" y="${H - 2}" text-anchor="middle">models killed</text></svg><div class="tooltip" hidden></div>`;
  const box = $('chart');
  box.innerHTML = svg;
  const tip = box.querySelector('.tooltip');
  const show = (g) => {
    tip.hidden = false;
    tip.textContent = `${g.dataset.k} killed: ${(Number(g.dataset.p) * 100).toFixed(1)}%`;
    const b = g.getBoundingClientRect(), c = box.getBoundingClientRect();
    tip.style.left = `${Math.min(c.width - 120, Math.max(0, b.left - c.left + b.width / 2 - 50))}px`;
    tip.style.top = '0px';
  };
  box.querySelectorAll('g[data-k]').forEach((g) => {
    g.addEventListener('mouseenter', () => show(g));
    g.addEventListener('focus', () => show(g));
    g.addEventListener('mouseleave', () => { tip.hidden = true; });
    g.addEventListener('blur', () => { tip.hidden = true; });
  });
}

/* ---------------------------------------------------------------- wiring */

async function calculate() {
  const btn = $('go');
  btn.disabled = true; $('status').textContent = 'Calculating…'; $('status').className = 'muted';
  try {
    const r = await api('/api/combat/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequest()) });
    renderResults(r);
    $('status').textContent = '';
  } catch (err) {
    $('status').textContent = err.message; $('status').className = 'error';
  } finally { btn.disabled = false; }
}

async function init() {
  try {
    ({ units } = await api('/api/combat/units'));
  } catch (err) {
    $('status').textContent = `Could not load units: ${err.message}`; $('status').className = 'error';
    return;
  }
  fillSelect($('a-unit'), '', 'intercessor-squad');
  fillSelect($('d-unit'), '', 'terminator-squad');
  $('a-search').addEventListener('input', async () => {
    const before = $('a-unit').value;
    fillSelect($('a-unit'), $('a-search').value, before);
    if ($('a-unit').value !== before) await renderAttackerWeapons();
  });
  $('d-search').addEventListener('input', async () => {
    const before = $('d-unit').value;
    fillSelect($('d-unit'), $('d-search').value, before);
    if ($('d-unit').value !== before) await defenderChanged();
  });
  $('a-unit').addEventListener('change', async () => {
    const u = units.find((x) => x.id === $('a-unit').value);
    if (u) $('a-models').value = u.models.default;
    await renderAttackerWeapons();
  });
  $('a-models').addEventListener('change', () => {
    const n = Number($('a-models').value) || 1;
    document.querySelectorAll('#a-weapons input[type=number]').forEach((i) => { i.max = n; if (Number(i.value) > n) i.value = n; });
  });
  $('d-unit').addEventListener('change', defenderChanged);
  $('form').addEventListener('submit', (ev) => { ev.preventDefault(); calculate(); });

  // Default example: 10 Intercessors with bolt rifles vs 5 Terminators.
  $('a-models').value = 10; $('d-models').value = 5;
  await Promise.all([renderAttackerWeapons(['bolt-rifle']), renderDefender()]);
  calculate();
}

async function defenderChanged() {
  const u = units.find((x) => x.id === $('d-unit').value);
  if (u) $('d-models').value = u.models.default;
  await renderDefender();
}

init();
