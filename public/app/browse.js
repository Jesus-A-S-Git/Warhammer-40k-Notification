// Filterable product browser shared by deals.html and faction pages.
// Filters live in the URL (shareable, back/forward friendly); filtering is
// client-side over the overview's ProductCards, so it is instant.
import { el, debounce } from '../ui.js';
import { bestMatches } from '../lib/search/fuzzy.js';
import { productCard, emptyState, icon, ICON, money0, plural } from './kit.js';

const PAGE = 48;
const SORTS = [
  ['score', 'Best deal'],
  ['off', 'Biggest % off'],
  ['drop', 'Biggest 7-day drop'],
  ['price', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
  ['name', 'Name A–Z'],
];
const OFFS = [['', 'Any'], ['10', '10%+'], ['20', '20%+'], ['30', '30%+']];
const KEYS = ['q', 'faction', 'cat', 'min', 'max', 'off', 'stock', 'store', 'low', 'sort', 'view'];

function readUrl() {
  const u = new URLSearchParams(location.search);
  const f = {};
  for (const k of KEYS) f[k] = u.get(k) ?? '';
  f.cat = f.cat ? f.cat.split(',').filter(Boolean) : [];
  return f;
}
function writeUrl(f, keep = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (v) u.set(k, v);
  for (const k of KEYS) {
    const v = k === 'cat' ? f.cat.join(',') : f[k];
    if (v && !(k === 'sort' && v === 'score') && !(k === 'view' && v === 'grid')) u.set(k, v);
  }
  if (new URLSearchParams(location.search).get('demo')) u.set('demo', new URLSearchParams(location.search).get('demo'));
  const s = u.toString();
  history.replaceState(null, '', `${location.pathname}${s ? `?${s}` : ''}`);
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root   container (gets .browse layout)
 * @param {object} o.ov          shaped overview (api.overview())
 * @param {object[]} o.products  ProductCards to browse
 * @param {string|null} o.lockFaction  hide the faction filter (faction pages)
 * @param {object} o.keep        extra URL params to keep (e.g. {id})
 */
export function mountBrowse({ root, ov, products, lockFaction = null, keep = {} }) {
  const f = readUrl();
  if (lockFaction) f.faction = '';
  if (!f.sort) f.sort = f.q ? 'relevance' : 'score';
  if (!f.view) { try { f.view = localStorage.getItem('browse.view') || 'grid'; } catch { f.view = 'grid'; } }
  let shown = PAGE;
  const kids = new Map();
  for (const x of ov.factions) if (x.parent) kids.set(x.parent, [...(kids.get(x.parent) ?? []), x.id]);

  /* ---------- filter panel ---------- */
  const qInput = el('input', { type: 'search', id: 'f-q', placeholder: 'Filter by name…', value: f.q, autocomplete: 'off', maxlength: '100' });
  const facSel = el('select', { id: 'f-faction' }, el('option', { value: '' }, 'All factions'));
  const groups = new Map();
  for (const x of ov.facets.factions) {
    const n = products.filter((p) => p.faction === x.id || (kids.get(x.id) ?? []).includes(p.faction)).length;
    if (!n) continue;
    if (!groups.has(x.group)) groups.set(x.group, el('optgroup', { label: x.group || 'Other' }));
    groups.get(x.group).append(el('option', { value: x.id }, `${x.parent ? '— ' : ''}${x.name} (${n})`));
  }
  facSel.append(...groups.values());
  facSel.value = f.faction;
  const cats = ov.facets.categories.filter((c) => products.some((p) => p.category === c.id));
  const catChips = el('div', { class: 'chips', role: 'group', 'aria-labelledby': 'f-cat-h' }, cats.map((c) => el('button', {
    type: 'button', class: 'chip', 'data-cat': c.id, 'aria-pressed': String(f.cat.includes(c.id)), title: c.blurb ?? '',
    onclick: (e) => { const b = e.currentTarget; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); change(); },
  }, c.name)));
  const minIn = el('input', { type: 'number', id: 'f-min', min: '0', step: '5', inputmode: 'decimal', placeholder: 'Min', value: f.min, 'aria-label': 'Minimum price' });
  const maxIn = el('input', { type: 'number', id: 'f-max', min: '0', step: '5', inputmode: 'decimal', placeholder: 'Max', value: f.max, 'aria-label': 'Maximum price' });
  const offSeg = el('div', { class: 'seg', role: 'group', 'aria-labelledby': 'f-off-h' }, OFFS.map(([v, l]) => el('button', {
    type: 'button', 'data-off': v, 'aria-pressed': String(f.off === v),
    onclick: (e) => { for (const b of offSeg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); change(); },
  }, l)));
  const stockCb = el('input', { type: 'checkbox', id: 'f-stock', checked: f.stock === '1' });
  const lowCb = el('input', { type: 'checkbox', id: 'f-low', checked: f.low === '1' });
  const stores = (ov.stores ?? []).filter((s) => s.status !== 'skipped' && !s.blocked);
  const storeSel = el('select', { id: 'f-store' }, el('option', { value: '' }, 'Any store'), stores.map((s) => el('option', { value: s.id }, s.name)));
  storeSel.value = f.store;

  const panel = el('aside', { class: 'filters', id: 'filters', 'aria-label': 'Filters' },
    el('div', { class: 'filter-head' }, el('strong', {}, 'Filters'),
      el('button', { type: 'button', class: 'btn ghost sm icon', 'aria-label': 'Close filters', onclick: () => drawer(false) }, icon('close'))),
    el('div', { class: 'field' }, el('label', { for: 'f-q' }, 'Search within results'), qInput),
    lockFaction ? null : el('div', { class: 'field' }, el('label', { for: 'f-faction' }, 'Faction'), facSel),
    el('div', {}, el('h3', { id: 'f-cat-h' }, 'Category'), catChips),
    el('div', {}, el('h3', {}, 'Price (item, USD)'), el('div', { class: 'range-pair' }, minIn, el('span', { class: 'muted' }, '–'), maxIn)),
    el('div', {}, el('h3', { id: 'f-off-h' }, 'Discount off RRP'), offSeg),
    el('div', { class: 'stack tight' }, el('h3', {}, 'Availability'),
      el('label', { class: 'check' }, stockCb, ' In stock only'),
      el('label', { class: 'check' }, lowCb, ' At lowest price ever')),
    el('div', { class: 'field' }, el('label', { for: 'f-store' }, 'Best price at'), storeSel),
    el('button', { type: 'button', class: 'btn secondary sm', onclick: reset }, 'Clear all filters'),
    el('button', { type: 'button', class: 'btn block filters-done', onclick: () => drawer(false) }, 'Show results'));
  const scrim = el('div', { class: 'filters-scrim', hidden: true, onclick: () => drawer(false) });
  function drawer(open) {
    panel.classList.toggle('open', open);
    scrim.hidden = !open;
    document.documentElement.classList.toggle('palette-open', open);
    if (open) qInput.focus(); else filtersBtn.focus();
  }
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) drawer(false); });

  /* ---------- toolbar ---------- */
  const count = el('div', { class: 'count', role: 'status', 'aria-live': 'polite' });
  const sortSel = el('select', { id: 'f-sort', 'aria-label': 'Sort by' },
    f.q ? el('option', { value: 'relevance' }, 'Best match') : null, SORTS.map(([v, l]) => el('option', { value: v }, l)));
  sortSel.value = f.sort;
  const filtersBtn = el('button', { type: 'button', class: 'btn secondary sm btn-filters', 'aria-controls': 'filters', onclick: () => drawer(true) }, icon('filter'), 'Filters');
  const viewSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'View' },
    [['grid', 'Card view'], ['list', 'List view']].map(([v, l]) => {
      const b = el('button', { type: 'button', 'data-view': v, 'aria-pressed': String(f.view === v), 'aria-label': l, title: l,
        onclick: () => { f.view = v; for (const x of viewSeg.children) x.setAttribute('aria-pressed', String(x.dataset.view === v)); try { localStorage.setItem('browse.view', v); } catch { /* */ } render(); } });
      b.innerHTML = v === 'grid' ? ICON.grid : ICON.list;
      return b;
    }));
  const toolbar = el('div', { class: 'toolbar' }, count, el('span', { class: 'spacer' }), filtersBtn,
    el('label', { class: 'visually-hidden', for: 'f-sort' }, 'Sort by'), sortSel, viewSeg);
  const activeBox = el('div', { class: 'active-filters', 'aria-label': 'Active filters' });
  const results = el('div', { class: 'pc-grid', id: 'results' });
  const more = el('div', { class: 'more-row' });

  root.classList.add('browse');
  root.replaceChildren(panel, scrim, el('div', { class: 'browse-main' }, toolbar, activeBox, results, more));

  /* ---------- state ---------- */
  function collect() {
    f.q = qInput.value.trim();
    f.faction = lockFaction ? '' : facSel.value;
    f.cat = [...catChips.querySelectorAll('[aria-pressed=true]')].map((b) => b.dataset.cat);
    f.min = minIn.value; f.max = maxIn.value;
    f.off = offSeg.querySelector('[aria-pressed=true]')?.dataset.off ?? '';
    f.stock = stockCb.checked ? '1' : ''; f.low = lowCb.checked ? '1' : '';
    f.store = storeSel.value; f.sort = sortSel.value;
  }
  function change() { collect(); shown = PAGE; render(); }
  function reset() {
    qInput.value = ''; facSel.value = ''; minIn.value = ''; maxIn.value = ''; stockCb.checked = false; lowCb.checked = false; storeSel.value = '';
    for (const b of catChips.children) b.setAttribute('aria-pressed', 'false');
    for (const b of offSeg.children) b.setAttribute('aria-pressed', String(b.dataset.off === ''));
    if (sortSel.value === 'relevance') sortSel.value = 'score';
    change();
  }
  const debounced = debounce(change, 140);
  qInput.addEventListener('input', () => {
    const had = !!sortSel.querySelector('[value=relevance]');
    if (qInput.value.trim() && !had) { sortSel.prepend(el('option', { value: 'relevance' }, 'Best match')); sortSel.value = 'relevance'; }
    debounced();
  });
  for (const x of [minIn, maxIn]) x.addEventListener('input', debounced);
  for (const x of [facSel, stockCb, lowCb, storeSel, sortSel]) x.addEventListener('change', change);

  function filtered() {
    const facIds = f.faction ? new Set([f.faction, ...(kids.get(f.faction) ?? [])]) : null;
    const min = Number(f.min) || null; const max = Number(f.max) || null; const off = Number(f.off) || null;
    let rows = products.filter((p) => {
      const price = p.best?.price ?? null;
      if (facIds && !facIds.has(p.faction)) return false;
      if (f.cat.length && !f.cat.includes(p.category)) return false;
      if ((min || max) && price == null) return false;
      if (min && price < min) return false;
      if (max && price > max) return false;
      if (off && !((p.best?.pctOff ?? 0) >= off)) return false;
      if (f.stock === '1' && !(p.best && p.best.inStock !== false && p.inStockCount > 0)) return false;
      if (f.low === '1' && !p.atLowest) return false;
      if (f.store && p.best?.retailerId !== f.store) return false;
      return true;
    });
    let rel = null;
    if (f.q.length >= 2) {
      const m = bestMatches(f.q, rows, { key: (p) => [p.name, `${p.factionName} ${p.name}`], limit: Infinity, threshold: 0.6 });
      rel = new Map(m.map((x, i) => [x.item.id, i]));
      rows = m.map((x) => x.item);
    }
    const priceOf = (p) => p.best?.price ?? Infinity;
    const cmp = {
      relevance: (a, b) => (rel?.get(a.id) ?? 0) - (rel?.get(b.id) ?? 0),
      score: (a, b) => (b.dealScore ?? -1) - (a.dealScore ?? -1) || priceOf(a) - priceOf(b),
      off: (a, b) => (b.best?.pctOff ?? -999) - (a.best?.pctOff ?? -999),
      drop: (a, b) => (a.change7d?.pct ?? 999) - (b.change7d?.pct ?? 999),
      price: (a, b) => priceOf(a) - priceOf(b),
      'price-desc': (a, b) => (b.best?.price ?? -1) - (a.best?.price ?? -1),
      name: (a, b) => a.name.localeCompare(b.name),
    }[f.sort] ?? (() => 0);
    return [...rows].sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name));
  }

  function activeChips() {
    const chips = [];
    const add = (label, clear) => chips.push(el('button', { type: 'button', class: 'chip', 'aria-label': `Remove filter: ${label}`, onclick: () => { clear(); change(); } }, label));
    if (f.q) add(`“${f.q}”`, () => { qInput.value = ''; });
    if (f.faction) add(ov.factionById.get(f.faction)?.name ?? f.faction, () => { facSel.value = ''; });
    for (const c of f.cat) add(ov.categoryName(c), () => catChips.querySelector(`[data-cat="${c}"]`)?.setAttribute('aria-pressed', 'false'));
    if (f.min || f.max) add(`${f.min ? money0(Number(f.min)) : '$0'} – ${f.max ? money0(Number(f.max)) : 'any'}`, () => { minIn.value = ''; maxIn.value = ''; });
    if (f.off) add(`${f.off}%+ off`, () => { for (const b of offSeg.children) b.setAttribute('aria-pressed', String(b.dataset.off === '')); });
    if (f.stock) add('In stock', () => { stockCb.checked = false; });
    if (f.low) add('Lowest ever', () => { lowCb.checked = false; });
    if (f.store) add(stores.find((s) => s.id === f.store)?.name ?? f.store, () => { storeSel.value = ''; });
    return chips;
  }

  function render() {
    writeUrl(f, keep);
    const rows = filtered();
    const chips = activeChips();
    activeBox.replaceChildren(...chips);
    filtersBtn.lastChild.textContent = chips.length ? `Filters (${chips.length})` : 'Filters';
    const done = panel.querySelector('.filters-done');
    if (done) done.textContent = `Show ${plural(rows.length, 'result')}`;
    count.replaceChildren(plural(rows.length, 'product'), el('span', { class: 'muted' }, rows.length !== products.length ? ` of ${products.length}` : ''));
    results.className = f.view === 'list' ? 'pc-list' : 'pc-grid';
    results.replaceChildren(...(rows.length
      ? rows.slice(0, shown).map((p, i) => productCard(p, { view: f.view, categoryName: ov.categoryName, eager: i < 4 }))
      : [emptyState('Nothing matches these filters', 'Try removing a filter, widening the price range, or searching a nickname.',
        el('button', { type: 'button', class: 'btn sm secondary', onclick: reset }, 'Clear all filters'))]));
    more.replaceChildren(rows.length > shown ? el('button', { type: 'button', class: 'btn secondary', onclick: () => { shown += PAGE; render(); } },
      `Show ${Math.min(PAGE, rows.length - shown)} more`) : null);
  }
  render();
  return { render };
}

/** Grid placeholders shown while the overview loads. */
export function browseSkeleton(root, cards) {
  root.classList.add('browse');
  root.replaceChildren(el('aside', { class: 'filters', 'aria-hidden': 'true' }, Array.from({ length: 6 }, () => el('span', { class: 'skeleton lg' }))),
    el('div', {}, el('div', { class: 'toolbar' }, el('span', { class: 'skeleton', style: { width: '120px' } })), el('div', { class: 'pc-grid' }, cards)));
}
