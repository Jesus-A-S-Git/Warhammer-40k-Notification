// Army list pricer: paste a list -> POST /api/prices/army parses + matches it,
// then the user fixes matches / marks owned boxes here and the plan is
// re-optimised with POST /api/prices/cart (same shapes the server returns).
import { el, toast, debounce } from '../ui.js';
import { army, cart, overview, storage } from './api.js';
import { bestMatches } from '../lib/search/fuzzy.js';
import { money, money0, plural, productHref, dataBanners, emptyState, icon, simHref } from './kit.js';

const $ = (id) => document.getElementById(id);
const ta = $('army-list');
const out = $('army-out');
const KEY = 'army.last.v1';

const SAMPLES = {
  'Space Marines · official app': `Gladius Strike (1000 Points)

Space Marines
Gladius Task Force
Incursion (1000 Points)

CHARACTERS

Captain in Terminator Armour (95 Points)
  • Warlord
  • 1x Relic weapon
  • 1x Storm bolter

Lieutenant (65 Points)
  • 1x Master-crafted bolt rifle

BATTLELINE

Intercessor Squad (160 Points)
  • 1x Intercessor Sergeant
  • 9x Intercessor

OTHER DATASHEETS

Terminator Squad (170 Points)
  • 1x Terminator Sergeant
  • 4x Terminator

Redemptor Dreadnought (210 Points)

Eradicator Squad (95 Points)
  • 1x Eradicator Sergeant
  • 2x Eradicator

Bladeguard Veteran Squad (80 Points)
  • 1x Bladeguard Veteran Sergeant
  • 2x Bladeguard Veteran

Exported with App Version: v1.24.0 (1), Data Version: v600`,
  'Necrons · New Recruit': `++ Army Roster (Xenos - Necrons) [1,000pts] ++

+ Configuration +
Battle Size: Incursion (1000 Point limit)
Detachment: Awakened Dynasty

+ Character +
Overlord [85pts]: Warlord, Voidscythe
Technomancer [80pts]: Staff of light

+ Battleline +
Necron Warriors [200pts]: 20x Necron Warrior
Immortals [150pts]: 10x Immortal

+ Other Datasheets +
Skorpekh Destroyers [90pts]: 3x Skorpekh Destroyer
Canoptek Scarab Swarms [40pts]: 3x Scarab Swarm
Doomsday Ark [200pts]

++ Total: [1,000pts] ++`,
  'Plain lines': `10x Intercessors
5x Terminators
1x Redemptor Dreadnought
3x Eradicators
20 Ork Boyz
Combat Patrol: Necrons`,
};

let ov = null;
let state = null; // { res, lines:[{...line, pick, boxes}], owned:{productId:n} }

/* ------------------------------------------------------------------ input */
$('samples').append(...Object.entries(SAMPLES).map(([name, text]) => el('button', { type: 'button', class: 'chip',
  onclick: () => { ta.value = text; run(); } }, name)));
$('army-clear').addEventListener('click', () => { ta.value = ''; state = null; storage.del(KEY); history.replaceState(null, '', location.pathname + location.search); renderEmpty(); ta.focus(); });
$('army-form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } });
$('army-share').addEventListener('click', async () => {
  const url = shareUrl();
  try { await navigator.clipboard.writeText(url); toast('Link copied: it opens this list with your fixes.', 'good'); }
  catch { window.prompt('Copy this link:', url); }
});

function renderEmpty() {
  $('army-share').hidden = true;
  out.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Your plan appears here'),
    el('span', {}, 'Each line is matched to a datasheet and a boxed kit, with a confidence mark you can fix. Mark boxes you already own and the plan updates.')));
}

/* ------------------------------------------------------------------ share */
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
function snapshotState() {
  return { list: ta.value, picks: state ? state.lines.map((l) => [l.pick ?? '', l.boxes]) : [], owned: state?.owned ?? {} };
}
function shareUrl() {
  const u = new URL(location.href);
  u.hash = `a=${b64(JSON.stringify(snapshotState()))}`;
  return u.href;
}
function persist() {
  const s = snapshotState();
  storage.set(KEY, s);
  try { history.replaceState(null, '', `${location.pathname}${location.search}#a=${b64(JSON.stringify(s))}`); } catch { /* too long or sandboxed */ }
}

/* ------------------------------------------------------------------ matching helpers */
function candidates(line) {
  const q = line.unitName ?? line.raw.replace(/^\s*\d+\s*x?\s*/i, '').replace(/[[(].*$/, '');
  const prods = ov?.products ?? [];
  const m = bestMatches(q, prods, { key: (p) => [p.name, p.name.replace(new RegExp(`^${(p.factionName ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')], limit: 8, threshold: 0.45 });
  const list = m.map((x) => x.item);
  if (line.pick && !list.some((p) => p.id === line.pick)) { const p = ov?.byId.get(line.pick); if (p) list.unshift(p); }
  return list;
}

/* ------------------------------------------------------------------ run */
let runSeq = 0;
async function run(restore = null) {
  const text = ta.value.trim();
  if (text.length < 3) { toast('Paste a list first, or pick a sample.', 'warn'); return; }
  const my = ++runSeq;
  const btn = $('army-go');
  btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
  out.replaceChildren(el('div', { class: 'parsed' }, Array.from({ length: 5 }, () => el('div', { class: 'pl' }, el('span', { class: 'skeleton', style: { width: '10px' } }), el('span', { class: 'skeleton lg' }), el('span', { class: 'skeleton', style: { width: '60px' } })))));
  try {
    ov ??= await overview();
    const res = await army(text, {}); // owned boxes are applied client-side below
    if (my !== runSeq) return;
    const lines = res.lines.map((l) => ({ ...l, pick: l.productId ?? null, boxes: l.productId ? l.boxes || 1 : 0 }));
    const isHeader = (raw) => /\((\d[\d,]{2,})\s*(points|pts)\)\s*$/i.test(raw) && Number(/\((\d[\d,]*)/.exec(raw)[1].replace(/,/g, '')) >= 500;
    for (const raw of res.unmatched ?? []) if (!isHeader(raw) && !lines.some((l) => l.raw === raw)) lines.push({ raw, qty: 1, unitName: null, unitId: null, productId: null, boxes: 0, pick: null, note: 'Not recognised', unmatched: true });
    // Restore user fixes from a share link / last visit.
    if (restore?.picks?.length === lines.length) {
      restore.picks.forEach(([pick, boxes], i) => { if (pick === '' || ov.byId.has(pick)) { lines[i].pick = pick || null; lines[i].boxes = Math.max(0, Math.min(99, Number(boxes) || 0)); } });
    }
    // Datasheet known but no kit from the server: suggest the closest kit (marked for checking).
    for (const l of lines) {
      if (!l.pick && l.unitName && !restore) {
        const q = l.unitName.replace(/\b(squad|unit|band|mob)\b/ig, '').trim();
        const top = bestMatches(q, ov.products.filter((p) => p.category === 'kit' || p.category === 'combat-patrol'),
          { key: (p) => [p.name, p.name.replace(new RegExp(`^${(p.factionName ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')], limit: 1, threshold: 0.8 })[0];
        if (top) { const p = top.item; l.pick = p.id; l.boxes = Math.max(1, p.models ? Math.ceil((l.qty || 1) / p.models) : 1); l.guessed = true; }
      }
    }
    // A plain "Combat Patrol: X" line can match a product directly.
    for (const l of lines) {
      if (!l.pick && l.unmatched) {
        const top = bestMatches(l.raw, ov.products, { key: (p) => p.name, limit: 1, threshold: 0.8 })[0];
        if (top) { l.pick = top.item.id; l.boxes = 1; l.guessed = true; }
      }
    }
    state = { res, lines, owned: { ...(restore?.owned ?? {}) } };
    $('army-share').hidden = false;
    renderAll();
    replan();
  } catch (err) {
    out.replaceChildren(el('div', { class: 'callout bad' }, el('strong', {}, 'Could not price this list. '), err.message));
  } finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
}

/* ------------------------------------------------------------------ render */
const planBox = el('div', { class: 'stack' });
function itemsNeeded() {
  const need = new Map();
  for (const l of state.lines) if (l.pick && l.boxes > 0) need.set(l.pick, (need.get(l.pick) ?? 0) + l.boxes);
  return [...need].map(([id, qty]) => ({ id, qty, own: Math.min(qty, Number(state.owned[id]) || 0) }));
}

function lineRow(l, i) {
  const conf = l.pick && l.unitId && !l.guessed ? 'high' : l.pick || l.unitId ? 'mid' : 'none';
  const sel = el('select', { 'aria-label': `Kit for ${l.raw}` }, el('option', { value: '' }, l.unitId ? '— choose a kit —' : '— skip this line —'),
    candidates(l).map((p) => el('option', { value: p.id }, `${p.name}${p.best ? ` · ${money0(p.best.price)}` : ''}`)));
  sel.value = l.pick ?? '';
  sel.addEventListener('change', () => {
    l.pick = sel.value || null;
    const p = ov.byId.get(l.pick);
    l.boxes = l.pick ? Math.max(1, p?.models ? Math.ceil((l.qty || 1) / p.models) : 1) : 0;
    l.guessed = false;
    renderAll(); replan();
  });
  const setBoxes = (n) => { l.boxes = Math.max(0, Math.min(99, n)); renderAll(); replan(); };
  const p = l.pick ? ov.byId.get(l.pick) : null;
  return el('div', { class: `pl ${conf === 'high' ? '' : conf}`.trim() },
    el('span', { class: 'conf', role: 'img', 'aria-label': conf === 'high' ? 'Matched' : conf === 'mid' ? 'Needs a check' : 'Not matched', title: conf === 'high' ? 'Confident match' : conf === 'mid' ? 'Check this match' : 'Not matched' }),
    el('div', { class: 'what' },
      l.unitName ? el('a', { href: simHref(l.unitId), title: 'Open in the damage simulator' }, l.unitName) : el('span', { class: 'muted' }, 'Unknown unit'),
      l.qty > 1 ? el('span', { class: 'muted' }, ` × ${l.qty}`) : null,
      el('div', { class: 'raw', title: l.raw }, l.raw)),
    el('div', { class: 'boxes' }, l.pick ? plural(l.boxes, 'box', 'boxes') : '—', p?.best ? el('div', { class: 'muted small' }, money(p.best.price * l.boxes)) : null),
    el('div', { class: 'fix' }, sel,
      l.pick ? el('div', { class: 'stepper', role: 'group', 'aria-label': 'Boxes' },
        el('button', { type: 'button', 'aria-label': 'One box fewer', onclick: () => setBoxes(l.boxes - 1) }, '−'),
        el('input', { type: 'number', min: '0', max: '99', value: String(l.boxes), 'aria-label': `Boxes of ${p?.name ?? 'kit'}`, onchange: (e) => setBoxes(Number(e.target.value) || 0) }),
        el('button', { type: 'button', 'aria-label': 'One box more', onclick: () => setBoxes(l.boxes + 1) }, '+')) : null,
      p ? el('a', { class: 'small', href: productHref(p.id) }, 'View kit') : null),
    l.note && !l.pick ? el('div', { class: 'note' }, l.note) : p?.models ? el('div', { class: 'note' }, `${plural(p.models, 'model')} per box${l.qty > 1 ? ` · list needs ${l.qty}` : ''}`) : null);
}

function renderAll() {
  const matched = state.lines.filter((l) => l.pick).length;
  const res = state.res;
  out.replaceChildren(
    el('div', { class: 'row tight' }, el('h2', { style: { margin: 0, fontSize: 'var(--fs-lg)' } }, 'Your list'),
      el('span', { class: 'badge' }, `${matched}/${state.lines.length} matched to kits`),
      res.format ? el('span', { class: 'badge info' }, { 'warhammer-app': 'Official app export', battlescribe: 'BattleScribe', 'newrecruit-wtc': 'New Recruit', 'points-list': 'Points list', plain: 'Plain lines' }[res.format] ?? res.format) : null,
      (res.factions ?? []).length ? el('span', { class: 'badge accent', title: res.factions.join(', ') }, `${res.factions[0]}${res.factions.length > 1 ? ` +${res.factions.length - 1}` : ''}`) : null,
      res.derived ? el('span', { class: 'badge warn', title: 'The server endpoint is not deployed yet; parsed in your browser.' }, 'Basic parser') : null),
    el('div', { class: 'parsed' }, state.lines.length ? state.lines.map(lineRow) : el('div', { class: 'pl none' }, el('span', { class: 'conf' }), el('div', { class: 'what' }, 'No units found in that text.'))),
    el('p', { class: 'hint' }, el('span', { class: 'faction-dot', style: { '--c': 'var(--good)' } }), ' matched  ',
      el('span', { class: 'faction-dot', style: { '--c': 'var(--warn)' } }), ' check the kit  ',
      el('span', { class: 'faction-dot', style: { '--c': 'var(--bad)' } }), ' not recognised. Pick a different kit or box count on any line.'),
    planBox);
}

const replan = debounce(async () => {
  persist();
  const items = itemsNeeded();
  if (!items.length) { planBox.replaceChildren(emptyState('Nothing to buy yet', 'Choose a kit for at least one line.')); return; }
  const owned = el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Kit'), el('th', { class: 'num' }, 'Needed'), el('th', { class: 'num' }, 'Already own'), el('th', { class: 'num' }, 'Buy'))),
    el('tbody', {}, items.map((it) => {
      const p = ov.byId.get(it.id);
      const set = (n) => { state.owned[it.id] = Math.max(0, Math.min(it.qty, n)); replan(); };
      return el('tr', {}, el('td', {}, el('a', { href: productHref(it.id) }, p?.name ?? it.id)),
        el('td', { class: 'num' }, String(it.qty)),
        el('td', { class: 'num' }, el('div', { class: 'stepper' },
          el('button', { type: 'button', 'aria-label': `Own one fewer ${p?.name}`, onclick: () => set(it.own - 1) }, '−'),
          el('input', { type: 'number', min: '0', max: String(it.qty), value: String(it.own), 'aria-label': `Boxes of ${p?.name} you already own`, onchange: (e) => set(Number(e.target.value) || 0) }),
          el('button', { type: 'button', 'aria-label': `Own one more ${p?.name}`, onclick: () => set(it.own + 1) }, '+'))),
        el('td', { class: 'num' }, el('strong', {}, String(it.qty - it.own))));
    }))));
  const buy = items.map((it) => ({ id: it.id, qty: it.qty - it.own })).filter((x) => x.qty > 0);
  planBox.replaceChildren(el('h2', { style: { margin: '8px 0 0', fontSize: 'var(--fs-lg)' } }, 'Boxes to buy'), owned, el('div', { class: 'card' }, el('span', { class: 'skeleton lg' }), el('span', { class: 'skeleton' })));
  if (!buy.length) { planBox.lastChild.replaceWith(el('div', { class: 'callout good' }, 'You already own everything on this list. Time to paint.')); return; }
  let plan;
  try { plan = await cart(buy); } catch (err) { planBox.lastChild.replaceWith(el('p', { class: 'error' }, err.message)); return; }
  const rrp = buy.reduce((t, x) => t + (ov.byId.get(x.id)?.rrp ?? 0) * x.qty, 0);
  const rrpKnown = buy.every((x) => ov.byId.get(x.id)?.rrp != null);
  const single = plan.comparisons?.bestSingleStore;
  planBox.lastChild.replaceWith(el('div', { class: 'stack' },
    el('div', { class: 'totals' },
      el('div', {}, el('div', { class: 'stat-label' }, 'Cheapest delivered'), el('div', { class: 'big text-good' }, money(plan.total)),
        el('div', { class: 'stat-sub' }, `${plural(plan.plan.length, 'order')} · goods ${money(plan.goods)} + ship ${money(plan.shipping)} + tax ${money(plan.tax)}`)),
      el('div', {}, el('div', { class: 'stat-label' }, 'At RRP (goods)'), el('div', { class: 'big' }, rrp ? money(rrp) : '—'),
        el('div', { class: 'stat-sub' }, rrpKnown ? 'before shipping and tax' : 'some kits have no known RRP')),
      el('div', {}, el('div', { class: 'stat-label' }, 'You save'), el('div', { class: 'big' }, rrp && plan.goods ? money(Math.max(0, rrp - plan.goods)) : '—'),
        el('div', { class: 'stat-sub' }, rrp && plan.goods ? `${Math.round((1 - plan.goods / rrp) * 100)}% off RRP on the goods` : ''))),
    single && plan.plan.length > 1 ? el('p', { class: 'hint' }, `All from one store: ${money(single.total)} at ${single.retailerName ?? ov.stores.find((s) => s.id === single.retailerId)?.name ?? single.retailerId}.`) : null,
    plan.unavailable?.length ? el('div', { class: 'callout warn' }, el('strong', {}, 'Not in stock anywhere we track: '), plan.unavailable.map((u) => u.name).join(', '), '. Left out of the totals.') : null,
    plan.plan.map((g) => el('div', { class: 'order' },
      el('div', { class: 'order-head' }, icon('cart'), el('strong', {}, g.retailerName), g.toFree > 0 ? el('span', { class: 'badge info' }, `${money(g.toFree)} to free shipping`) : null, el('span', { class: 'num' }, money(g.total))),
      el('table', {}, el('tbody', {},
        g.items.map((it) => el('tr', {}, el('td', {}, it.url ? el('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, it.name) : it.name, it.qty > 1 ? ` × ${it.qty}` : ''), el('td', { class: 'num' }, money(it.lineTotal)))),
        el('tr', {}, el('td', { class: 'muted' }, 'Shipping (est.)'), el('td', { class: 'num' }, g.shipping ? money(g.shipping) : 'Free')),
        el('tr', {}, el('td', { class: 'muted' }, 'Tax (est.)'), el('td', { class: 'num' }, money((g.tax ?? 0) + (g.duty ?? 0)))))))),
    el('p', { class: 'hint' }, 'Totals are estimates (shipping rules and sales tax for the area the site is set up for). Confirm each order at checkout. ',
      el('a', { href: 'prices.html#cart' }, 'Fine-tune shipping rules in the cart optimizer'), '.')));
}, 200);

/* ------------------------------------------------------------------ boot */
(async () => {
  try { ov = await overview(); $('banners').replaceChildren(...dataBanners(ov)); } catch { /* run() reports errors */ }
  let restore = null;
  const m = /#a=([\w-]+)/.exec(location.hash);
  if (m) { try { restore = JSON.parse(unb64(m[1])); } catch { restore = null; } }
  restore ??= storage.get(KEY);
  if (restore?.list) { ta.value = String(restore.list).slice(0, 20000); run(restore); }
})();
