// Damage Simulator page. Maths runs in POST /api/combat/simulate on the server,
// or in-browser on the static build (static-api.js); both use
// src/combat/engine.js + service.js, so results are identical.
//
// State lives in one object (`state`), mirrored to the URL hash (shareable)
// and localStorage (last setup + pinned comparisons). Every change re-runs the
// simulation after a short debounce: there is no submit button.
import { STATIC } from './config.js';
// Shared fuzzy unit search (src/combat/unitSearch.js + src/search/fuzzy.js), served
// at lib/ by the server and copied there by the static build.
import { rankUnits } from './lib/combat/unitSearch.js';

let ui = {};
try { ui = await import('./ui.js'); } catch { /* fall back to local helpers */ }
const toast = ui.toast || ((msg) => console.info(msg));
const debounce = ui.debounce || ((fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; });

// On the static (GitHub Pages) build the same API is answered in-browser.
const doFetch = STATIC ? (await import('./static-api.js')).staticFetch : (p, o) => fetch(p, o);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, d = 2) => (Number.isFinite(x) ? (Math.round(x * 10 ** d) / 10 ** d).toString() : '–');
const pct = (p) => (!Number.isFinite(p) ? '–' : p >= 0.9995 ? '100%' : p > 0.995 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);
const pct1 = (p) => `${(p * 100).toFixed(1)}%`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------------------------------------------------------------- storage */

const store = {
  get(k, dflt) { try { const v = localStorage.getItem(`combat:${k}`); return v ? JSON.parse(v) : dflt; } catch { return dflt; } },
  set(k, v) { try { localStorage.setItem(`combat:${k}`, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

/* ---------------------------------------------------------------- api */

async function api(path, opts) {
  const res = await doFetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.retryAfter = Number(res.headers?.get?.('retry-after')) || null;
    throw err;
  }
  return body;
}

const unitCache = new Map();
function getUnit(id) {
  if (!unitCache.has(id)) {
    const p = api(`/api/combat/units/${encodeURIComponent(id)}`).then((b) => b.unit);
    p.catch(() => unitCache.delete(id));
    unitCache.set(id, p);
  }
  return unitCache.get(id);
}

/* ---------------------------------------------------------------- state */

const DEFAULT_MODS = {
  hitMod: 0, woundMod: 0, rerollHits: 'none', rerollWounds: 'none', critHit: 6, critWound: 6,
  halfRange: false, stationary: false, charged: false, cover: false,
  lethalHits: false, devastatingWounds: false, ignoresCover: false, sustainedHits: '0',
  stealth: false, minusWound: false, damageReduction: false, apReduction: false, fnp: '', invuln: '',
};
const DEFAULT_STATE = {
  a: { faction: '', unitId: 'intercessor-squad', models: 10, type: 'ranged', sel: { 'bolt-rifle': 10 }, custom: [] },
  d: { faction: '', unitId: 'terminator-squad', models: 5, custom: null },
  mods: { ...DEFAULT_MODS },
};
const MAX_WEAPONS = 10;
const clone = (o) => JSON.parse(JSON.stringify(o));
let state = clone(DEFAULT_STATE);
let units = [];                 // brief rows for every unit
let byId = new Map();
let aUnit = null, dUnit = null; // full datasheets of the current picks

function encodeState(s) {
  const json = JSON.stringify(s);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeState(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
}
/** Merge an untrusted (hash/localStorage) setup onto defaults, keeping only known keys and types. */
function sanitize(raw) {
  const s = clone(DEFAULT_STATE);
  if (!raw || typeof raw !== 'object') return s;
  const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), lo, hi) : d);
  const a = raw.a || {}, d = raw.d || {};
  s.a.faction = str(a.faction);
  s.a.unitId = a.unitId === null ? null : str(a.unitId) || s.a.unitId;
  s.a.models = num(a.models, 1, 30, s.a.models);
  s.a.type = a.type === 'melee' ? 'melee' : 'ranged';
  s.a.sel = {};
  if (a.sel && typeof a.sel === 'object') {
    for (const [k, v] of Object.entries(a.sel).slice(0, MAX_WEAPONS)) s.a.sel[str(k, 60)] = num(v, 1, 30, 1);
  }
  s.a.custom = Array.isArray(a.custom) ? a.custom.slice(0, MAX_WEAPONS).filter((w) => w && typeof w === 'object').map((w, i) => ({
    id: `cw${i + 1}`, name: str(w.name, 60) || 'Custom weapon', type: w.type === 'melee' ? 'melee' : 'ranged',
    A: str(w.A, 8) || '1', skill: w.skill == null ? null : num(w.skill, 2, 6, 3), S: num(w.S, 1, 30, 4),
    AP: num(w.AP, -6, 0, 0), D: str(w.D, 8) || '1', keywords: Array.isArray(w.keywords) ? w.keywords.slice(0, 20).map((k) => str(k, 40)).filter(Boolean) : [],
  })) : [];
  // Custom weapon ids are renumbered: remap the selection.
  if (Array.isArray(a.custom)) {
    const sel = {};
    for (const [k, v] of Object.entries(s.a.sel)) {
      const i = a.custom.findIndex((w) => w && w.id === k);
      sel[i >= 0 ? `cw${i + 1}` : k] = v;
    }
    s.a.sel = sel;
  }
  s.d.faction = str(d.faction);
  s.d.unitId = d.unitId === null ? null : str(d.unitId) || s.d.unitId;
  s.d.models = num(d.models, 1, 30, s.d.models);
  if (d.custom && typeof d.custom === 'object') {
    const c = d.custom;
    s.d.custom = { name: str(c.name, 60) || 'Custom defender', T: num(c.T, 1, 30, 4), Sv: num(c.Sv, 2, 7, 3),
      inv: c.inv ? num(c.inv, 2, 6, null) : null, W: num(c.W, 1, 40, 1), fnp: c.fnp ? num(c.fnp, 2, 6, null) : null,
      keywords: Array.isArray(c.keywords) ? c.keywords.slice(0, 20).map((k) => str(k, 40)).filter(Boolean) : [] };
  }
  const m = raw.mods || {};
  for (const [k, v] of Object.entries(DEFAULT_MODS)) {
    if (!(k in m)) continue;
    if (typeof v === 'boolean') s.mods[k] = m[k] === true;
    else if (k === 'hitMod' || k === 'woundMod') s.mods[k] = num(m[k], -1, 1, 0);
    else if (k === 'critHit' || k === 'critWound') s.mods[k] = num(m[k], 4, 6, 6);
    else if (k === 'rerollHits' || k === 'rerollWounds') s.mods[k] = ['none', 'ones', 'failed'].includes(m[k]) ? m[k] : 'none';
    else if (k === 'sustainedHits') s.mods[k] = ['0', '1', '2', 'D3'].includes(String(m[k])) ? String(m[k]) : '0';
    else if (k === 'fnp' || k === 'invuln') s.mods[k] = /^[2-6]$/.test(String(m[k])) ? String(m[k]) : '';
  }
  return s;
}

/* ---------------------------------------------------------------- factions */

function factionColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 62% 52%)`;
}
const dot = (faction) => `<span class="faction-dot" style="--c:${factionColor(faction)}" aria-hidden="true"></span>`;

function fillFactionSelects(factions) {
  for (const id of ['a-faction', 'd-faction']) {
    const sel = $(id);
    sel.innerHTML = `<option value="">All factions (${units.length})</option>`
      + factions.map((f) => `<option value="${esc(f.name)}">${esc(f.name)} (${f.units})</option>`).join('');
  }
}

function rememberFaction(f) {
  if (!f) return;
  const list = [f, ...store.get('recentFactions', []).filter((x) => x !== f)].slice(0, 5);
  store.set('recentFactions', list);
  renderRecent();
}
function renderRecent() {
  const list = store.get('recentFactions', []).filter((f) => units.some((u) => u.faction === f));
  for (const side of ['a', 'd']) {
    const box = $(`${side}-recent`);
    const cur = state[side].faction;
    box.innerHTML = list.length ? [`<button type="button" class="chip" data-f="" aria-pressed="${!cur}">All</button>`,
      ...list.map((f) => `<button type="button" class="chip" data-f="${esc(f)}" aria-pressed="${cur === f}">${dot(f)} ${esc(f)}</button>`)].join('') : '';
    box.hidden = !list.length;
  }
}

/* ---------------------------------------------------------------- autocomplete */

function setupAutocomplete(side) {
  const input = $(`${side}-search`), list = $(`${side}-list`);
  let items = [], active = -1;
  const pool = () => (state[side].faction ? units.filter((u) => u.faction === state[side].faction) : units);
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const setActive = (i) => {
    active = i;
    list.querySelectorAll('.ac-item').forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    const li = list.children[i];
    if (li?.id) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
  };
  const render = () => {
    const q = input.value.trim();
    const current = side === 'a' ? state.a.unitId : state.d.unitId;
    const matches = (q && q !== currentName(side) ? rankUnits(pool(), q).map((m) => m.unit) : pool()).slice(0, 60);
    items = [...matches.map((u) => ({ u })), { custom: true }];
    list.innerHTML = matches.map((u, i) => `<li class="ac-item" role="option" id="${side}-opt-${i}" aria-selected="false" data-i="${i}">
        ${dot(u.faction)}<span class="truncate">${esc(u.name)}${u.id === current ? ' <span class="badge">current</span>' : ''}</span>
        <span class="ac-sub">${esc(u.faction)} · ${u.models.min === u.models.max ? u.models.min : `${u.models.min}–${u.models.max}`} models${u.points ? ` · ${u.points} pts` : ''}</span></li>`).join('')
      + (matches.length ? '' : `<li class="ac-empty" role="presentation">No units match “${esc(q)}”${state[side].faction ? ` in ${esc(state[side].faction)}` : ''}.</li>`)
      + `<li class="ac-item" role="option" id="${side}-opt-custom" aria-selected="false" data-i="${matches.length}"><strong>Custom profile…</strong><span class="ac-sub">enter stats by hand</span></li>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(q && matches.length ? 0 : -1);
  };
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    if (it.custom) chooseCustom(side); else chooseUnit(side, it.u.id);
  };
  input.addEventListener('focus', () => { input.select(); render(); });
  input.addEventListener('input', render);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (list.hidden) render(); setActive(Math.min(items.length - 1, active + 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (ev.key === 'Enter') { if (!list.hidden && active >= 0) { ev.preventDefault(); pick(active); input.blur(); } }
    else if (ev.key === 'Escape') { close(); input.value = currentName(side); }
  });
  input.addEventListener('blur', () => setTimeout(() => { close(); input.value = currentName(side); }, 150));
  list.addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('.ac-item');
    if (!li) return;
    ev.preventDefault();
    pick(Number(li.dataset.i));
    input.blur();
  });
}

function currentName(side) {
  if (side === 'a') return state.a.unitId ? (aUnit?.name ?? byId.get(state.a.unitId)?.name ?? '') : 'Custom attacker';
  if (state.d.custom && !state.d.unitId) return 'Custom defender';
  return dUnit?.name ?? byId.get(state.d.unitId)?.name ?? '';
}

/* ---------------------------------------------------------------- choosing units */

async function chooseUnit(side, id, { keepModels = false } = {}) {
  const row = byId.get(id);
  if (!row) return;
  rememberFaction(row.faction);
  if (side === 'a') {
    state.a.unitId = id;
    if (!keepModels) state.a.models = row.models.default ?? row.models.min;
    aUnit = await getUnit(id);
    if (!keepModels) defaultWeapons();
    renderAttacker();
  } else {
    state.d.unitId = id;
    state.d.custom = null;
    if (!keepModels) state.d.models = row.models.default ?? row.models.min;
    dUnit = await getUnit(id);
    renderDefender();
  }
  changed();
}

function chooseCustom(side) {
  if (side === 'a') {
    state.a.unitId = null; aUnit = null;
    state.a.sel = {};
    for (const w of state.a.custom) state.a.sel[w.id] = state.a.models;
    renderAttacker();
    if (!state.a.custom.length) openCustomEditor();
  } else {
    const p = dUnit?.profile;
    state.d.custom = { name: 'Custom defender', T: p?.T ?? 4, Sv: p?.Sv ?? 3, inv: p?.inv ?? null, W: p?.W ?? 2, fnp: p?.fnp ?? null, keywords: dUnit?.keywords ?? ['Infantry'] };
    state.d.unitId = null;
    renderDefender();
    toggleDefenderEditor(true);
  }
  changed();
}

/** Default loadout: the most widely carried ranged weapon (else melee), fired by everyone carrying it. */
function defaultWeapons() {
  state.a.sel = {};
  const ws = aUnit?.weapons ?? [];
  const pick = ws.find((w) => w.type === 'ranged') || ws[0];
  if (!pick) return;
  state.a.type = pick.type;
  state.a.sel[pick.id] = Math.min(state.a.models, pick.carriers ?? state.a.models);
}

/* ---------------------------------------------------------------- attacker panel */

function armoury() {
  return [...(state.a.unitId ? aUnit?.weapons ?? [] : []), ...state.a.custom.map((w) => ({ ...w, isCustom: true }))];
}

function weaponStats(w) {
  const range = w.type === 'melee' ? 'Melee' : w.range ? `${w.range}"` : '–';
  const v = (k, x) => `${k}${/^\d/.test(String(x)) ? '' : ' '}${x}`; // "A2", "A D6"
  return `${range} · ${v('A', w.A)} · ${w.skill ? `${w.type === 'melee' ? 'WS' : 'BS'}${w.skill}+` : 'auto-hit'} · S${w.S} · AP${w.AP} · ${v('D', w.D)}`;
}

function renderAttacker() {
  const a = state.a;
  $('a-title').textContent = a.unitId ? (aUnit?.name ?? '…') : 'Custom attacker';
  $('a-search').value = currentName('a');
  $('a-faction').value = a.faction;
  const mIn = $('a-models');
  const row = a.unitId ? byId.get(a.unitId) : null;
  mIn.min = 1; mIn.max = 30;
  mIn.value = a.models;
  $('a-hint').textContent = row
    ? `${row.faction} · unit size ${row.models.min === row.models.max ? row.models.min : `${row.models.min}–${row.models.max}`}${row.points ? ` · ${row.points} pts` : ''}. Tick the weapons that attack; set how many models use each.`
    : 'Custom attacker: add one or more weapons with your own profile.';

  const all = armoury();
  const counts = { ranged: all.filter((w) => w.type === 'ranged').length, melee: all.filter((w) => w.type === 'melee').length };
  document.querySelectorAll('#a-type button').forEach((b) => {
    const t = b.dataset.type;
    b.setAttribute('aria-pressed', String(a.type === t));
    const nSel = all.filter((w) => w.type === t && w.id in a.sel).length;
    b.textContent = `${t === 'ranged' ? 'Ranged' : 'Melee'} (${counts[t]})${nSel ? ` · ${nSel}✓` : ''}`;
  });
  const shown = all.filter((w) => w.type === a.type);
  const nSel = Object.keys(a.sel).length;
  const box = $('a-weapons');
  box.innerHTML = shown.length ? shown.map((w, i) => {
    const on = w.id in a.sel;
    const n = on ? a.sel[w.id] : Math.min(a.models, w.carriers ?? a.models);
    const kws = (w.keywords || []).map((k) => `<span class="tag">${esc(k)}</span>`).join('')
      + (w.otherKeywords || []).map((k) => `<span class="tag" title="Not modelled by the simulator" style="opacity:.6">${esc(k)}</span>`).join('');
    return `<div class="weapon${on ? ' on' : ''}" data-id="${esc(w.id)}">
      <input type="checkbox" id="aw-${i}" ${on ? 'checked' : ''} ${!on && nSel >= MAX_WEAPONS ? 'disabled' : ''} aria-describedby="aw-${i}-s">
      <label class="w-name" for="aw-${i}">${esc(w.name)}${w.isCustom ? ' <span class="badge info">custom</span>' : ''}</label>
      <span class="w-models">${w.isCustom ? `<button type="button" class="btn ghost sm" data-remove="${esc(w.id)}" aria-label="Remove ${esc(w.name)}">✕</button>` : ''}
        <span class="stepper" title="Models attacking with this weapon"><button type="button" data-wstep="-1" aria-label="Fewer models with ${esc(w.name)}">−</button><input type="number" min="1" max="${a.models}" value="${n}" aria-label="Models with ${esc(w.name)}" data-wmodels><button type="button" data-wstep="1" aria-label="More models with ${esc(w.name)}">+</button></span></span>
      <div class="w-stats" id="aw-${i}-s">${esc(weaponStats(w))}</div>
      ${kws ? `<div class="w-kw">${kws}</div>` : ''}
    </div>`;
  }).join('') : `<p class="empty muted small">No ${a.type} weapons on this datasheet${a.unitId ? '' : ' yet'}.</p>`;
  $('a-selected').textContent = nSel ? `${nSel} weapon${nSel > 1 ? 's' : ''} selected${nSel >= MAX_WEAPONS ? ' (max)' : ''}` : 'No weapon selected';
}

function openCustomEditor() {
  $('a-custom-editor').hidden = false;
  $('cw-type').value = state.a.type;
  $('cw-error').textContent = '';
  $('cw-name').focus();
}

function saveCustomWeapon() {
  const kws = $('cw-kw').value.split(',').map((x) => x.trim()).filter(Boolean);
  const torrent = kws.some((k) => k.toLowerCase() === 'torrent');
  const w = {
    name: $('cw-name').value.trim() || 'Custom weapon', type: $('cw-type').value,
    A: $('cw-A').value.trim().toUpperCase(), skill: torrent ? null : Number($('cw-skill').value),
    S: Number($('cw-S').value), AP: -Math.abs(Number($('cw-AP').value) || 0), D: $('cw-D').value.trim().toUpperCase(), keywords: kws,
  };
  if (!/^(\d{1,2}|\d?D[36](\+\d{1,2})?)$/.test(w.A)) { $('cw-error').textContent = 'A must be a number or dice like D6+1'; return; }
  if (!/^(\d{1,2}|\d?D[36](\+\d{1,2})?)$/.test(w.D)) { $('cw-error').textContent = 'D must be a number or dice like D3'; return; }
  if (!(w.S >= 1 && w.S <= 30)) { $('cw-error').textContent = 'S must be 1–30'; return; }
  if (state.a.custom.length >= MAX_WEAPONS) { $('cw-error').textContent = `At most ${MAX_WEAPONS} custom weapons`; return; }
  w.id = `cw${state.a.custom.length + 1}`;
  while (state.a.custom.some((x) => x.id === w.id)) w.id += 'x';
  state.a.custom.push(w);
  if (Object.keys(state.a.sel).length < MAX_WEAPONS) state.a.sel[w.id] = state.a.models;
  state.a.type = w.type;
  $('a-custom-editor').hidden = true;
  renderAttacker();
  changed();
}

/* ---------------------------------------------------------------- defender panel */

function defenderProfile() {
  if (state.d.custom) return { ...state.d.custom, M: dUnit?.profile.M, Ld: dUnit?.profile.Ld, OC: dUnit?.profile.OC };
  return dUnit ? { ...dUnit.profile, keywords: dUnit.keywords } : null;
}

function renderDefender() {
  const d = state.d;
  const p = defenderProfile();
  const row = d.unitId ? byId.get(d.unitId) : null;
  $('d-title').textContent = d.custom ? d.custom.name : (dUnit?.name ?? '…');
  $('d-search').value = currentName('d');
  $('d-faction').value = d.faction;
  $('d-models').value = d.models;
  $('d-points').textContent = row ? `${row.faction} · unit size ${row.models.min === row.models.max ? row.models.min : `${row.models.min}–${row.models.max}`}${row.points ? ` · ${row.points} pts` : ''}` : '';
  const cell = (k, v, suffix = '') => `<div><div class="k">${k}</div><div class="v${v == null ? ' dim' : ''}">${v == null ? '–' : `${v}${suffix}`}</div></div>`;
  $('d-statline').innerHTML = p ? [cell('M', p.M, '"'), cell('T', p.T), cell('SV', p.Sv, '+'), cell('INV', p.inv, '++'), cell('W', p.W),
    cell('LD', p.Ld, '+'), cell('OC', p.OC), cell('FNP', p.fnp, '+')].join('') : '';
  $('d-keywords').innerHTML = (p?.keywords || []).map((k) => `<span class="tag">${esc(k)}</span>`).join('');
  $('d-custom-note').textContent = d.custom ? 'Using a custom profile.' : '';
  if (d.custom) {
    $('cd-T').value = d.custom.T; $('cd-Sv').value = d.custom.Sv; $('cd-inv').value = d.custom.inv ?? '';
    $('cd-W').value = d.custom.W; $('cd-fnp').value = d.custom.fnp ?? ''; $('cd-kw').value = d.custom.keywords.join(', ');
  }
  $('cd-reset').hidden = !d.unitId && !dUnit;
}

function toggleDefenderEditor(open) {
  const box = $('d-custom');
  box.hidden = !open;
  $('d-edit').setAttribute('aria-expanded', String(open));
  $('d-edit').textContent = open ? 'Hide profile editor' : 'Edit profile';
  if (open && !state.d.custom) {
    const p = defenderProfile();
    state.d.custom = { name: `${dUnit?.name ?? 'Defender'} (edited)`, T: p?.T ?? 4, Sv: p?.Sv ?? 3, inv: p?.inv ?? null, W: p?.W ?? 2,
      fnp: p?.fnp ?? null, keywords: [...(p?.keywords ?? [])].slice(0, 20) };
    renderDefender();
  }
}

function readDefenderEditor() {
  const n = (id) => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
  const c = state.d.custom;
  if (!c) return;
  c.T = clamp(n('cd-T') ?? 4, 1, 30); c.Sv = clamp(n('cd-Sv') ?? 3, 2, 7); c.W = clamp(n('cd-W') ?? 1, 1, 40);
  const inv = n('cd-inv'), fnp = n('cd-fnp');
  c.inv = inv && inv >= 2 && inv <= 6 ? inv : null;
  c.fnp = fnp && fnp >= 2 && fnp <= 6 ? fnp : null;
  c.keywords = $('cd-kw').value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20).map((k) => k.slice(0, 40));
  renderDefender();
  changed();
}

/* ---------------------------------------------------------------- modifiers */

function renderMods() {
  const m = state.mods;
  document.querySelectorAll('.seg[data-mod]').forEach((seg) => {
    const v = String(m[seg.dataset.mod]);
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  });
  document.querySelectorAll('.chip[data-mod]').forEach((c) => c.setAttribute('aria-pressed', String(!!m[c.dataset.mod])));
  const badge = (id, n) => { const b = $(id); b.hidden = !n; b.textContent = `${n} on`; b.className = 'badge accent'; };
  badge('b-rolls', ['hitMod', 'woundMod', 'rerollHits', 'rerollWounds', 'critHit', 'critWound'].filter((k) => String(m[k]) !== String(DEFAULT_MODS[k])).length);
  badge('b-sit', ['halfRange', 'stationary', 'charged', 'cover'].filter((k) => m[k]).length);
  badge('b-att', ['lethalHits', 'devastatingWounds', 'ignoresCover'].filter((k) => m[k]).length + (m.sustainedHits !== '0' ? 1 : 0));
  badge('b-def', ['stealth', 'minusWound', 'damageReduction', 'apReduction'].filter((k) => m[k]).length + (m.fnp ? 1 : 0) + (m.invuln ? 1 : 0));
}

/* ---------------------------------------------------------------- request */

function buildRequest() {
  const { a, d, mods: m } = state;
  const attacker = { models: a.models, modifiers: {
    hitMod: m.hitMod, woundMod: m.woundMod, rerollHits: m.rerollHits, rerollWounds: m.rerollWounds,
    critHit: m.critHit, critWound: m.critWound, stationary: m.stationary, halfRange: m.halfRange, charged: m.charged,
    lethalHits: m.lethalHits, devastatingWounds: m.devastatingWounds, ignoresCover: m.ignoresCover,
  } };
  if (m.sustainedHits !== '0') attacker.modifiers.sustainedHits = m.sustainedHits;
  const customSpec = ({ name, type, A, skill, S, AP, D, keywords }) => ({ name, type, A, ...(skill == null ? {} : { skill }), S, AP, D, keywords });
  const sel = Object.entries(a.sel).filter(([id]) => armoury().some((w) => w.id === id));
  if (a.unitId) {
    attacker.unitId = a.unitId;
    attacker.weapons = sel.map(([id, n]) => {
      const cw = a.custom.find((w) => w.id === id);
      const models = clamp(n, 1, a.models);
      return cw ? { custom: customSpec(cw), models } : { id, models };
    });
  } else {
    attacker.custom = { name: 'Custom attacker', weapons: a.custom.map((w) => ({ id: w.id, ...customSpec(w) })) };
    attacker.weapons = sel.map(([id, n]) => ({ id, models: clamp(n, 1, a.models) }));
  }
  const defender = { models: d.models, modifiers: {
    cover: m.cover, hitMod: m.stealth ? -1 : 0, woundMod: m.minusWound ? -1 : 0,
    damageReduction: m.damageReduction ? 1 : 0, apReduction: m.apReduction ? 1 : 0,
    ...(m.fnp ? { fnp: Number(m.fnp) } : {}), ...(m.invuln ? { invuln: Number(m.invuln) } : {}),
  } };
  if (d.custom) {
    const c = d.custom;
    defender.custom = { name: c.name, T: c.T, Sv: c.Sv, W: c.W, keywords: c.keywords, ...(c.inv ? { inv: c.inv } : {}), ...(c.fnp ? { fnp: c.fnp } : {}) };
  } else defender.unitId = d.unitId;
  return { attacker, defender };
}

/* ---------------------------------------------------------------- run */

let seq = 0;
let lastResult = null;
const run = debounce(calculate, 180);

function changed() {
  persist();
  run();
}

function persist() {
  const enc = encodeState(state);
  try { history.replaceState(null, '', `#s=${enc}`); } catch { /* sandboxed */ }
  store.set('last', state);
}

// Recent results by request body: flipping a toggle back and forth costs no request
// (the server allows ~30 API calls a minute per visitor).
const resultCache = new Map();
let retryTimer = null;

async function calculate() {
  const my = ++seq;
  clearTimeout(retryTimer);
  const card = $('results-card');
  if (!Object.keys(state.a.sel).length) {
    showStatus('Select at least one attacker weapon.', 'warn');
    return;
  }
  const body = JSON.stringify(buildRequest());
  card.setAttribute('aria-busy', 'true');
  try {
    let r = resultCache.get(body);
    if (!r) {
      r = await api('/api/combat/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      resultCache.set(body, r);
      if (resultCache.size > 40) resultCache.delete(resultCache.keys().next().value);
    }
    if (my !== seq) return;
    lastResult = r;
    showStatus('');
    renderResults(r);
  } catch (err) {
    if (my !== seq) return;
    if (err.status === 429) {
      const wait = Math.min(60, err.retryAfter || 10);
      showStatus(`Lots of changes in a short time: the server asked us to slow down. Updating again in ${wait}s…`, 'warn');
      retryTimer = setTimeout(() => { if (my === seq) calculate(); }, wait * 1000);
    } else showStatus(err.message, 'bad');
  } finally {
    if (my === seq) card.setAttribute('aria-busy', 'false');
  }
}

function showStatus(msg, kind = 'info') {
  const box = $('status');
  box.innerHTML = msg ? `<div class="callout ${kind}">${esc(msg)}</div>` : '';
  if (msg && kind !== 'info') $('results').style.opacity = '.45'; else $('results').style.opacity = '';
}

/* ---------------------------------------------------------------- results */

function weaponLabel() {
  const names = armoury().filter((w) => w.id in state.a.sel).map((w) => `${w.name}${state.a.sel[w.id] !== state.a.models ? ` ×${state.a.sel[w.id]}` : ''}`);
  return names.join(', ');
}

function renderResults(r) {
  const n = r.defender.models, e = r.expected, W = r.defender.W;
  $('results').hidden = false;
  $('res-title').textContent = `${r.attacker.name} → ${r.defender.name}`;
  $('res-sub').textContent = `${r.attacker.models} model${r.attacker.models > 1 ? 's' : ''} with ${weaponLabel()} into ${n} × ${r.defender.name} (T${r.defender.T}, ${r.defender.Sv}+${r.defender.inv ? `/${r.defender.inv}++` : ''}, W${W}${r.defender.fnp ? `, FNP ${r.defender.fnp}+` : ''})`;

  const tiles = [
    ['Hits', fmt(e.hits), `from ${fmt(e.attacks)} attacks`, ''],
    ['Wounds', fmt(e.wounds), e.devastatingWounds > 0 ? `${fmt(e.devastatingWounds)} devastating` : 'successful wound rolls', ''],
    ['Unsaved', fmt(e.unsavedWounds), 'failed saves + mortals', ''],
    ['Damage', fmt(e.damageInflicted), `of ${n * W} wounds in the unit`, 'accent'],
    ['Models killed', fmt(e.modelsKilled), `of ${n}`, 'accent'],
    ['Wipe chance', pct(r.pWipe), 'all models destroyed', r.pWipe >= 0.5 ? 'good' : ''],
  ];
  $('tiles').innerHTML = tiles.map(([k, v, s, cls]) =>
    `<div class="stat ${cls}"><div class="stat-label">${k}</div><div class="stat-value">${v}</div><div class="stat-sub">${s}</div></div>`).join('');

  const steps = [['Attacks', e.attacks, ''], ['Hits', e.hits, ''], ['Wounds', e.wounds, ''], ['Failed saves', e.unsavedWounds, 'warn'], ['Damage', e.damageInflicted, 'bad']];
  const max = Math.max(...steps.map((s) => s[1]), 1e-9);
  $('funnel').innerHTML = steps.map(([k, v, cls], i) => {
    const prev = i ? steps[i - 1][1] : null;
    const rate = prev && i < 4 ? ` title="${Math.round((v / prev) * 100)}% of ${steps[i - 1][0].toLowerCase()}"` : '';
    return `<span class="fl">${k}</span><div class="bar lg ${cls}" style="--pct:${((v / max) * 100).toFixed(1)}%"${rate} role="img" aria-label="${k}: ${fmt(v)}"><span></span></div><span class="fv">${fmt(v)}</span>`;
  }).join('');

  renderChart(r.killDistribution, e.modelsKilled);
  const atLeast = r.killDistribution.map((_, k) => r.killDistribution.slice(k).reduce((s, p) => s + p, 0));
  let median = 0;
  atLeast.forEach((p, k) => { if (p >= 0.5) median = k; });
  $('dist-table').innerHTML = '<thead><tr><th>Models killed</th><th class="num">Exactly</th><th class="num">At least</th><th style="width:40%"></th></tr></thead><tbody>'
    + r.killDistribution.map((p, k) => `<tr${k === median && k > 0 ? ' class="best"' : ''}><td>${k}${k === n ? ' <span class="badge good">wipe</span>' : ''}${k === median && k > 0 ? ' <span class="badge">likely</span>' : ''}</td>
      <td class="num">${pct1(p)}</td><td class="num">${pct1(atLeast[k])}</td><td><div class="bar" style="--pct:${(atLeast[k] * 100).toFixed(1)}%"><span></span></div></td></tr>`).join('')
    + '</tbody>';

  $('breakdown').innerHTML = `<thead><tr><th>Weapon</th><th class="num">Attacks</th><th class="num">Hit</th><th class="num">Wound</th><th class="num">Save</th><th class="num">Damage</th></tr></thead><tbody>${
    r.weapons.map((w) => {
      const hit = w.hitTarget ? `${w.hitTarget}+${w.hitModifier ? ` (${w.hitModifier > 0 ? '+' : ''}${w.hitModifier})` : ''}` : 'auto';
      const wound = `${w.woundTarget}+${w.woundModifier ? ` (${w.woundModifier > 0 ? '+' : ''}${w.woundModifier})` : ''}`;
      const save = w.saveTarget && w.saveTarget <= 6 ? `${w.saveTarget}+${w.saveUsed === 'invulnerable' ? '++' : ''}${w.coverApplied ? ' cover' : ''}` : 'none';
      const extras = [w.lethalHits && 'Lethal Hits', w.sustainedHits && `Sustained Hits ${w.sustainedHits}`,
        w.devastatingWounds > 0 && `${fmt(w.devastatingWounds)} dev. wounds`, ...(w.notes || [])].filter(Boolean).join(' · ');
      return `<tr><td>${esc(w.weapon)} <span class="muted">×${w.models}</span>${extras ? `<br><span class="muted small">${esc(extras)}</span>` : ''}</td>
        <td class="num">${fmt(w.attacks)}</td><td class="num">${hit}<br><span class="muted">${fmt(w.hits)}</span></td>
        <td class="num">${wound}<br><span class="muted">${fmt(w.wounds)}</span></td><td class="num">${save}<br><span class="muted">${fmt(w.unsavedWounds)}</span></td>
        <td class="num">${fmt(w.damagePerUnsaved)} each<br><span class="muted">${fmt(w.damage)}</span></td></tr>`;
    }).join('')}</tbody>`;

  $('method').textContent = (r.method === 'exact'
    ? 'Exact probability calculation.'
    : `Monte Carlo estimate, ${r.trials.toLocaleString()} trials${r.fallbackReason ? ` (${r.fallbackReason})` : ''}.`)
    + ` ${r.rulesVersion}. Damage does not spill over between models; "Damage" counts wounds actually removed (raw damage before allocation: ${fmt(e.damage)}).`;
}

function renderChart(dist, mean) {
  // Draw at the container's real width so labels stay legible on phones.
  const W = clamp(Math.round($('chart').clientWidth || 640), 300, 760), H = W < 480 ? 200 : 230, padL = 40, padR = 8, padB = 30, padT = 26;
  const n = dist.length;
  const maxP = Math.max(...dist, 0.01);
  const step = maxP > 0.5 ? 0.25 : maxP > 0.2 ? 0.1 : 0.05;
  const top = Math.min(1, Math.ceil(maxP / step) * step);
  const plotW = W - padL - padR, plotH = H - padB - padT;
  const slot = plotW / n, bw = Math.max(2, Math.min(56, slot * 0.72));
  const y = (p) => padT + plotH - (p / top) * plotH;
  const best = dist.indexOf(Math.max(...dist));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Probability of killing each number of models, 0 to ${n - 1}. Most likely: ${best} (${pct1(dist[best])}). Average ${fmt(mean)}.">`;
  for (let t = 0; t <= Math.round(top / step); t++) {
    const p = step * t, yy = y(p);
    svg += `<line class="${t ? 'gridline' : 'axis'}" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text class="label" x="${padL - 6}" y="${yy + 4}" text-anchor="end">${Math.round(p * 100)}%</text>`;
  }
  const every = Math.ceil(n / 16);
  dist.forEach((p, k) => {
    const cx = padL + k * slot + slot / 2;
    const h = Math.max(0, (p / top) * plotH);
    svg += `<g tabindex="0" data-k="${k}" data-p="${p}" role="img" aria-label="${k} killed: ${pct1(p)}">
      <rect x="${padL + k * slot}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent"/>
      ${h > 0 ? `<rect class="series" x="${cx - bw / 2}" y="${y(p)}" width="${bw}" height="${h}" rx="${Math.min(3, bw / 3)}"/>` : ''}</g>`;
    if (k % every === 0 || k === n - 1) svg += `<text class="label" x="${cx}" y="${H - padB + 16}" text-anchor="middle">${k}</text>`;
    if (p >= 0.04 && n <= 12) svg += `<text class="label strong" x="${cx}" y="${y(p) - 5}" text-anchor="middle">${Math.round(p * 100)}%</text>`;
  });
  const mx = padL + (mean + 0.5) * slot;
  svg += `<line class="series-alt" x1="${mx}" x2="${mx}" y1="${padT - 10}" y2="${padT + plotH}" stroke-dasharray="4 4"/>
    <text class="label" x="${mx > W - 90 ? mx - 4 : mx + 4}" y="${padT - 14}" text-anchor="${mx > W - 90 ? 'end' : 'start'}">avg ${fmt(mean, 1)}</text>`;
  svg += `<text class="label" x="${padL + plotW / 2}" y="${H - 2}" text-anchor="middle">models killed</text></svg><div class="chart-tip" hidden></div>`;
  const box = $('chart');
  box.innerHTML = svg;
  const tip = box.querySelector('.chart-tip');
  const show = (g) => {
    const k = Number(g.dataset.k), p = Number(g.dataset.p);
    const at = dist.slice(k).reduce((s, x) => s + x, 0);
    tip.hidden = false;
    tip.textContent = `${k} killed: ${pct1(p)} · at least ${k}: ${pct1(at)}`;
    const b = g.getBoundingClientRect(), c = box.getBoundingClientRect();
    tip.style.left = `${clamp(b.left - c.left + b.width / 2 - tip.offsetWidth / 2, 0, c.width - tip.offsetWidth)}px`;
  };
  box.querySelectorAll('g[data-k]').forEach((g) => {
    g.addEventListener('mouseenter', () => show(g));
    g.addEventListener('focus', () => show(g));
    g.addEventListener('mouseleave', () => { tip.hidden = true; });
    g.addEventListener('blur', () => { tip.hidden = true; });
  });
}

/* ---------------------------------------------------------------- pins */

const MAX_PINS = 3;
let pins = store.get('pins', []).filter((p) => p && p.summary && p.setup).slice(0, MAX_PINS);

function pinCurrent() {
  const r = lastResult;
  if (!r) return;
  if (pins.length >= MAX_PINS) { toast(`You can pin up to ${MAX_PINS} results. Remove one first.`, 'warn'); return; }
  const e = r.expected;
  pins.push({
    id: Date.now().toString(36),
    title: `${r.attacker.name} → ${r.defender.name}`,
    weapons: weaponLabel(),
    mods: activeModsLabel(),
    setup: clone(state),
    summary: { attacks: e.attacks, hits: e.hits, wounds: e.wounds, unsaved: e.unsavedWounds, damage: e.damageInflicted,
      killed: e.modelsKilled, n: r.defender.models, pWipe: r.pWipe, models: r.attacker.models },
  });
  store.set('pins', pins);
  renderPins();
  toast('Pinned. Change the setup and pin again to compare.', 'good');
}

function activeModsLabel() {
  const m = state.mods, out = [];
  if (m.hitMod) out.push(`${m.hitMod > 0 ? '+' : ''}${m.hitMod} hit`);
  if (m.woundMod) out.push(`${m.woundMod > 0 ? '+' : ''}${m.woundMod} wound`);
  if (m.rerollHits !== 'none') out.push(`RR hits ${m.rerollHits === 'ones' ? '1s' : 'all'}`);
  if (m.rerollWounds !== 'none') out.push(`RR wounds ${m.rerollWounds === 'ones' ? '1s' : 'all'}`);
  for (const [k, label] of [['halfRange', 'half range'], ['stationary', 'stationary'], ['charged', 'charged'], ['cover', 'cover'],
    ['lethalHits', 'Lethal'], ['devastatingWounds', 'Dev. Wounds'], ['ignoresCover', 'Ignores Cover'], ['stealth', '−1 to hit'],
    ['minusWound', '−1 to wound'], ['damageReduction', '−1 D'], ['apReduction', '−1 AP']]) if (m[k]) out.push(label);
  if (m.sustainedHits !== '0') out.push(`Sustained ${m.sustainedHits}`);
  if (m.critHit !== 6) out.push(`crit hit ${m.critHit}+`);
  if (m.critWound !== 6) out.push(`crit wound ${m.critWound}+`);
  if (m.fnp) out.push(`FNP ${m.fnp}+`);
  if (m.invuln) out.push(`${m.invuln}++`);
  return out.join(', ');
}

function renderPins() {
  $('pins-card').hidden = !pins.length;
  $('pin').disabled = pins.length >= MAX_PINS;
  $('pin').textContent = pins.length >= MAX_PINS ? 'Compare full' : `Pin to compare${pins.length ? ` (${pins.length}/${MAX_PINS})` : ''}`;
  const rows = [['Hits', 'hits', fmt], ['Wounds', 'wounds', fmt], ['Unsaved', 'unsaved', fmt], ['Damage', 'damage', fmt],
    ['Models killed', 'killed', fmt], ['Wipe chance', 'pWipe', pct]];
  const best = {};
  for (const [, k] of rows) best[k] = Math.max(...pins.map((p) => p.summary[k]));
  $('pins').innerHTML = pins.map((p) => `<div class="card compact pin">
      <div class="pin-title">${esc(p.title)}</div>
      <div class="muted small">${esc(p.summary.models)} models · ${esc(p.weapons)}${p.mods ? `<br>${esc(p.mods)}` : ''}</div>
      <dl>${rows.map(([label, k, f]) => `<dt>${label}</dt><dd class="${pins.length > 1 && p.summary[k] === best[k] && best[k] > 0 ? 'win' : ''}">${f(p.summary[k])}${k === 'killed' ? ` / ${p.summary.n}` : ''}</dd>`).join('')}</dl>
      <div class="bar good" style="--pct:${best.damage ? ((p.summary.damage / best.damage) * 100).toFixed(1) : 0}%" title="Damage relative to the best pin"><span></span></div>
      <div class="row tight" style="margin-top:8px">
        <button type="button" class="btn secondary sm" data-load="${p.id}">Load</button>
        <button type="button" class="btn ghost sm" data-unpin="${p.id}">Remove</button>
      </div></div>`).join('');
}

/* ---------------------------------------------------------------- applying a setup */

async function applyState(s) {
  state = sanitize(s);
  aUnit = null; dUnit = null;
  if (state.a.unitId && !byId.has(state.a.unitId)) state.a.unitId = DEFAULT_STATE.a.unitId;
  if (state.d.unitId && !byId.has(state.d.unitId)) state.d.unitId = DEFAULT_STATE.d.unitId;
  if (state.a.faction && !units.some((u) => u.faction === state.a.faction)) state.a.faction = '';
  if (state.d.faction && !units.some((u) => u.faction === state.d.faction)) state.d.faction = '';
  const [au, du] = await Promise.all([
    state.a.unitId ? getUnit(state.a.unitId).catch(() => null) : null,
    state.d.unitId ? getUnit(state.d.unitId).catch(() => null) : null,
  ]);
  aUnit = au; dUnit = du;
  if (state.a.unitId && !aUnit) { state.a.unitId = null; }
  if (!state.d.unitId && !state.d.custom) state.d.custom = { name: 'Custom defender', T: 4, Sv: 3, inv: null, W: 2, fnp: null, keywords: ['Infantry'] };
  // Drop selections that no longer exist on the datasheet.
  const ids = new Set(armoury().map((w) => w.id));
  for (const id of Object.keys(state.a.sel)) if (!ids.has(id)) delete state.a.sel[id];
  if (!Object.keys(state.a.sel).length && aUnit) defaultWeapons();
  renderAttacker(); renderDefender(); renderMods(); renderRecent();
  toggleDefenderEditor(!!state.d.custom && !state.d.unitId);
  changed();
}

async function swap() {
  const { a, d } = state;
  if (!a.unitId || !d.unitId) { toast('Swap needs a datasheet on both sides (not a custom profile).', 'warn'); return; }
  const next = clone(state);
  next.a = { ...next.a, faction: d.faction, unitId: d.unitId, models: d.models, sel: {}, custom: [] };
  next.d = { faction: a.faction, unitId: a.unitId, models: a.models, custom: null };
  await applyState(next);
  toast(`Swapped: ${aUnit?.name} now attacks ${dUnit?.name}.`, 'info');
}

/* ---------------------------------------------------------------- wiring */

function wire() {
  setupAutocomplete('a');
  setupAutocomplete('d');

  for (const side of ['a', 'd']) {
    $(`${side}-faction`).addEventListener('change', (ev) => {
      state[side].faction = ev.target.value;
      rememberFaction(ev.target.value);
      persist();
      const cur = byId.get(side === 'a' ? state.a.unitId : state.d.unitId);
      if (ev.target.value && cur?.faction !== ev.target.value) { $(`${side}-search`).value = ''; $(`${side}-search`).focus(); }
    });
    $(`${side}-recent`).addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-f]');
      if (!b) return;
      state[side].faction = b.dataset.f;
      $(`${side}-faction`).value = b.dataset.f;
      renderRecent(); persist();
      const cur = byId.get(side === 'a' ? state.a.unitId : state.d.unitId);
      if (b.dataset.f && cur?.faction !== b.dataset.f) { $(`${side}-search`).value = ''; $(`${side}-search`).focus(); }
    });
  }

  // Model steppers
  const stepper = (input, onChange) => {
    const wrap = input.closest('.stepper');
    wrap.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-step]');
      if (!b) return;
      input.value = clamp((Number(input.value) || 1) + Number(b.dataset.step), Number(input.min) || 1, Number(input.max) || 30);
      onChange();
    });
    input.addEventListener('change', () => { input.value = clamp(Math.round(Number(input.value) || 1), Number(input.min) || 1, Number(input.max) || 30); onChange(); });
  };
  stepper($('a-models'), () => {
    const old = state.a.models, now = Number($('a-models').value);
    state.a.models = now;
    for (const [id, n] of Object.entries(state.a.sel)) state.a.sel[id] = n >= old ? now : Math.min(n, now);
    renderAttacker(); changed();
  });
  stepper($('d-models'), () => { state.d.models = Number($('d-models').value); changed(); });

  $('a-type').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-type]');
    if (!b) return;
    state.a.type = b.dataset.type; renderAttacker(); persist();
  });

  const box = $('a-weapons');
  box.addEventListener('change', (ev) => {
    const row = ev.target.closest('.weapon');
    if (!row) return;
    const id = row.dataset.id;
    if (ev.target.type === 'checkbox') {
      if (ev.target.checked) {
        if (Object.keys(state.a.sel).length >= MAX_WEAPONS) { ev.target.checked = false; toast(`Up to ${MAX_WEAPONS} weapons at once.`, 'warn'); return; }
        state.a.sel[id] = clamp(Number(row.querySelector('[data-wmodels]').value) || state.a.models, 1, state.a.models);
      } else delete state.a.sel[id];
    } else if (ev.target.matches('[data-wmodels]')) {
      const v = clamp(Math.round(Number(ev.target.value) || 1), 1, state.a.models);
      ev.target.value = v;
      if (!(id in state.a.sel)) { if (Object.keys(state.a.sel).length >= MAX_WEAPONS) return; }
      state.a.sel[id] = v;
    }
    renderAttacker(); changed();
  });
  box.addEventListener('click', (ev) => {
    const rm = ev.target.closest('[data-remove]');
    if (rm) {
      const id = rm.dataset.remove;
      state.a.custom = state.a.custom.filter((w) => w.id !== id);
      delete state.a.sel[id];
      renderAttacker(); changed();
      return;
    }
    const b = ev.target.closest('button[data-wstep]');
    if (!b) return;
    const row = b.closest('.weapon'), id = row.dataset.id;
    const input = row.querySelector('[data-wmodels]');
    const v = clamp((Number(input.value) || 1) + Number(b.dataset.wstep), 1, state.a.models);
    if (!(id in state.a.sel) && Object.keys(state.a.sel).length >= MAX_WEAPONS) return;
    state.a.sel[id] = v;
    renderAttacker(); changed();
  });

  $('a-add-custom').addEventListener('click', openCustomEditor);
  $('cw-save').addEventListener('click', saveCustomWeapon);
  $('cw-cancel').addEventListener('click', () => { $('a-custom-editor').hidden = true; });
  $('a-custom-editor').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); saveCustomWeapon(); } });

  $('d-edit').addEventListener('click', () => toggleDefenderEditor($('d-custom').hidden));
  $('d-custom').addEventListener('input', debounce(readDefenderEditor, 250));
  $('cd-reset').addEventListener('click', async () => {
    state.d.custom = null;
    if (!state.d.unitId) state.d.unitId = DEFAULT_STATE.d.unitId;
    dUnit = await getUnit(state.d.unitId);
    toggleDefenderEditor(false); renderDefender(); changed();
  });

  // Modifiers
  document.querySelectorAll('.seg[data-mod]').forEach((seg) => seg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-v]');
    if (!b) return;
    const k = seg.dataset.mod;
    const v = b.dataset.v;
    state.mods[k] = ['hitMod', 'woundMod', 'critHit', 'critWound'].includes(k) ? Number(v) : v;
    renderMods(); changed();
  }));
  document.querySelectorAll('.chip[data-mod]').forEach((c) => c.addEventListener('click', () => {
    state.mods[c.dataset.mod] = !state.mods[c.dataset.mod];
    renderMods(); changed();
  }));
  $('mods-reset').addEventListener('click', () => { state.mods = { ...DEFAULT_MODS }; renderMods(); changed(); });

  // Results
  $('swap').addEventListener('click', swap);
  $('pin').addEventListener('click', pinCurrent);
  $('share').addEventListener('click', async () => {
    persist();
    const url = location.href;
    try { await navigator.clipboard.writeText(url); toast('Link copied: it opens this exact setup.', 'good'); }
    catch { window.prompt('Copy this link:', url); }
  });
  $('pins').addEventListener('click', (ev) => {
    const un = ev.target.closest('[data-unpin]');
    const ld = ev.target.closest('[data-load]');
    if (un) { pins = pins.filter((p) => p.id !== un.dataset.unpin); store.set('pins', pins); renderPins(); }
    if (ld) { const p = pins.find((x) => x.id === ld.dataset.load); if (p) applyState(p.setup); }
  });
  $('pins-clear').addEventListener('click', () => { pins = []; store.set('pins', pins); renderPins(); });

  // Chart / table tabs
  const tabs = [['tab-chart', 'panel-chart'], ['tab-table', 'panel-table']];
  const pick = (id) => tabs.forEach(([t, p]) => { $(t).setAttribute('aria-selected', String(t === id)); $(t).tabIndex = t === id ? 0 : -1; $(p).hidden = t !== id; });
  tabs.forEach(([t]) => $(t).addEventListener('click', () => pick(t)));
  document.querySelector('.tabs').addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    const next = $('tab-chart').getAttribute('aria-selected') === 'true' ? 'tab-table' : 'tab-chart';
    pick(next); $(next).focus();
  });

  window.addEventListener('hashchange', () => {
    const s = fromHash();
    if (s && encodeState(sanitize(s)) !== encodeState(state)) applyState(s);
  });
}

function fromHash() {
  const m = /[#&]s=([\w-]+)/.exec(location.hash);
  if (!m) return null;
  try { return decodeState(m[1]); } catch { return null; }
}

async function init() {
  let factions = [];
  try {
    const [list, fac] = await Promise.all([api('/api/combat/units?view=brief'), api('/api/combat/factions')]);
    units = list.units;
    factions = fac.factions;
    const bs = (fac.sources || []).find((s) => s.id === 'bsdata');
    if (bs) $('data-meta').textContent = ` Snapshot: ${bs.generatedAt}${bs.ref && bs.ref !== 'local' ? ` (commit ${String(bs.ref).slice(0, 7)})` : ''}.`;
  } catch (err) {
    showStatus(`Could not load units: ${err.message}`, 'bad');
    return;
  }
  byId = new Map(units.map((u) => [u.id, u]));
  $('unit-count').textContent = `${units.length.toLocaleString()}`;
  fillFactionSelects(factions);
  wire();
  renderPins();
  const hash = fromHash();
  await applyState(hash || store.get('last', null) || DEFAULT_STATE);
  if (hash) toast('Loaded the shared setup.', 'info', { timeout: 2500 });
}

init();
