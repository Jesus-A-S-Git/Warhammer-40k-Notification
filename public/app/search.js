// Global search over products, factions, combat units and pages: typo-tolerant
// (shared fuzzy matcher), keyboard-first combobox used by the home hero search
// and the Ctrl/Cmd+K command palette.
import { el } from '../ui.js';
import { overview, catalog, unitsBrief } from './api.js';
import { bestMatches } from '../lib/search/fuzzy.js';
import { rankUnits } from '../lib/combat/unitSearch.js';
import { money, productHref, factionHref, simHref, dealsHref } from './kit.js';

const PAGES = [
  { label: 'Home: deal hub', href: './', words: 'home deals hub start' },
  { label: 'All deals', href: 'deals.html', words: 'deals browse shop sale discount' },
  { label: 'Biggest price drops', href: 'deals.html?sort=drop', words: 'drops price drop falling' },
  { label: 'Factions', href: 'faction.html', words: 'factions armies' },
  { label: 'Army list pricer', href: 'army.html', words: 'army list pricer cost battlescribe new recruit roster' },
  { label: 'Watchlist & alerts', href: 'watchlist.html', words: 'watchlist alerts watching target notify' },
  { label: 'Cart optimizer', href: 'prices.html#cart', words: 'cart optimizer basket cheapest stores' },
  { label: 'Value per model / point', href: 'prices.html#value', words: 'value per point model cost efficiency' },
  { label: 'Stores & method', href: 'prices.html#stores', words: 'stores retailers trusted method about' },
  { label: 'Damage simulator', href: 'combat.html', words: 'damage simulator combat dice mathhammer calculator' },
];

let index = null;
let unitList = null;
let unitLoad = null;

/** Products + factions; units load separately (bigger file) on first real query. */
export async function loadIndex() {
  if (index) return index;
  const [ov, cat] = await Promise.all([overview().catch(() => null), catalog().catch(() => null)]);
  const aliases = new Map((cat?.products ?? []).map((p) => [p.id, p.aliases ?? []]));
  const products = (ov?.products ?? []).map((p) => ({ p, keys: [p.name, ...(aliases.get(p.id) ?? []), `${p.factionName ?? ''} ${p.name}`] }));
  // Catalogue products the overview may not list (no snapshot yet).
  if (!products.length && cat) {
    for (const p of cat.products) products.push({ p: { id: p.id, name: p.name, faction: p.faction, factionName: p.factionName, rrp: p.USD, best: null }, keys: [p.name, ...(p.aliases ?? [])] });
  }
  const counts = new Map();
  for (const { p } of products) counts.set(p.faction, (counts.get(p.faction) ?? 0) + 1);
  const factions = (ov?.factions ?? cat?.factions ?? []).filter((f) => counts.get(f.id) || (ov?.factions ?? []).some((x) => x.parent === f.id));
  index = { products, factions, counts, ov };
  return index;
}
export function loadUnits() {
  unitLoad ??= unitsBrief().then((u) => { unitList = u; return u; }).catch(() => { unitLoad = null; return []; });
  return unitLoad;
}

/** Ranked results: [{group, label, sub, href, color, badge}] */
export function query(q, { limit = 6, withUnits = true } = {}) {
  const s = q.trim();
  const out = [];
  if (!index) return out;
  if (s.length < 2) {
    const top = (index.ov?.topDeals ?? []).slice(0, 4);
    for (const p of top) out.push(prodItem(p, 'Top deals'));
    for (const pg of PAGES.slice(1, 7)) out.push({ group: 'Go to', label: pg.label, href: pg.href, kind: 'page' });
    return out;
  }
  const prods = bestMatches(s, index.products, { key: (x) => x.keys, limit, threshold: 0.62 }).map((m) => m.item.p);
  for (const p of prods) out.push(prodItem(p, 'Products'));
  const facs = bestMatches(s, index.factions, { key: (f) => f.name, limit: 3, threshold: 0.72 }).map((m) => m.item);
  for (const f of facs) out.push({ group: 'Factions', label: f.name, sub: `${index.counts.get(f.id) ?? 0} products`, href: factionHref(f.id), color: f.color, kind: 'faction' });
  if (withUnits && unitList) {
    const us = rankUnits(unitList, s, { threshold: 0.72 }).slice(0, 4).map((m) => m.unit);
    for (const u of us) out.push({ group: 'Datasheets · simulate', label: u.name, sub: u.faction, href: simHref(u.id), kind: 'unit' });
  }
  const pages = bestMatches(s, PAGES, { key: (pg) => [pg.label, pg.words], limit: 3, threshold: 0.7 }).map((m) => m.item);
  for (const pg of pages) out.push({ group: 'Go to', label: pg.label, href: pg.href, kind: 'page' });
  out.push({ group: 'Search', label: `See all deals matching “${s}”`, href: dealsHref({ q: s }), kind: 'all' });
  return out;
}
function prodItem(p, group) {
  return {
    group, label: p.name, kind: 'product', color: p.factionColor, href: productHref(p.id),
    sub: p.best ? `${money(p.best.price)}${p.best.pctOff > 0 ? ` · −${Math.round(p.best.pctOff)}%` : ''}` : (p.rrp ? `RRP ${money(p.rrp)}` : ''),
  };
}

/**
 * Wire an input + listbox as an ARIA combobox over query().
 * opts.inline: list always shown (palette). opts.onGo(item) overrides navigation.
 */
export function combobox(input, list, { inline = false, onGo = null, onEmptyEnter = null } = {}) {
  let items = []; let active = -1; let seq = 0;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', String(inline));
  list.setAttribute('role', 'listbox');
  const go = (it) => { if (onGo) onGo(it); else location.href = it.href; };
  const setActive = (i) => {
    active = i;
    list.querySelectorAll('[role=option]').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    const node = list.querySelector(`#${list.id}-o${i}`);
    if (node) { input.setAttribute('aria-activedescendant', node.id); node.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  };
  const close = () => {
    if (inline) return;
    list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1;
  };
  const render = () => {
    const q = input.value;
    items = query(q);
    let lastGroup = null; let i = 0;
    const kids = [];
    for (const it of items) {
      if (it.group !== lastGroup) { kids.push(el('li', { class: 'cb-group', role: 'presentation' }, it.group)); lastGroup = it.group; }
      const k = i++;
      kids.push(el('li', { class: `cb-item kind-${it.kind}`, role: 'option', id: `${list.id}-o${k}`, 'aria-selected': 'false',
        onpointerdown: (e) => e.preventDefault(), onclick: () => go(it), onpointermove: () => { if (active !== k) setActive(k); } },
      it.kind === 'product' || it.kind === 'faction'
        ? el('span', { class: 'faction-dot', style: { '--c': it.color || 'var(--muted)' }, 'aria-hidden': 'true' })
        : el('span', { class: `cb-ico ${it.kind}`, 'aria-hidden': 'true' }),
      el('span', { class: 'cb-label' }, it.label),
      it.sub ? el('span', { class: 'cb-sub' }, it.sub) : null));
    }
    if (!items.length && q.trim().length >= 2) kids.push(el('li', { class: 'cb-empty', role: 'presentation' }, 'No matches. Try fewer words or a nickname like “termies”.'));
    list.replaceChildren(...kids);
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    setActive(inline && items.length ? 0 : -1);
  };
  const update = async () => {
    const my = ++seq;
    await loadIndex();
    if (input.value.trim().length >= 2 && !unitList) loadUnits().then(() => { if (my === seq) render(); });
    if (my === seq) render();
  };
  input.addEventListener('input', update);
  input.addEventListener('focus', () => { if (inline || input.value.trim().length >= 0) update(); });
  if (!inline) input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { update(); return; }
      if (!items.length) return;
      setActive(e.key === 'ArrowDown' ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) go(items[active]);
      else if (input.value.trim().length >= 2) (onEmptyEnter ?? ((q) => { location.href = dealsHref({ q }); }))(input.value.trim());
    } else if (e.key === 'Escape' && !inline && !list.hidden) { e.preventDefault(); close(); }
  });
  return { update, close };
}
