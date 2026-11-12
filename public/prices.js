// Deal Finder UI. Retailer-provided strings are only ever inserted as text
// (el() uses textContent / setAttribute), links are https-only.
//
// Data: /api/prices/catalog (products), /api/prices/overview (deals from the
// latest snapshot), POST /api/prices/cart (optimizer), /api/prices/search (live
// search in server mode; snapshot search on the static site). On GitHub Pages
// static-api.js answers the same paths in the browser.
import { STATIC, REPO } from './config.js';
import { el, fmtMoney, toast, debounce } from './ui.js';
import { bestMatches } from './lib/search/fuzzy.js';

const doFetch = STATIC ? (await import('./static-api.js')).staticFetch : (p, o) => fetch(p, o);
const REFRESH_URL = STATIC && /^[\w.-]+\/[\w.-]+$/.test(REPO || '')
  ? `https://github.com/${REPO}/actions/workflows/pages.yml` : null;

const $ = (id) => document.getElementById(id);
/** replaceChildren that skips null/false and flattens arrays (DOM's version would print "null"). */
function fill(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false && k !== true));
}

/* ------------------------------------------------------------------ storage */
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) ?? 'null'); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const K = { cart: 'prices.cart.v1', watch: 'prices.watch.v1', ship: 'prices.ship.v1', prefs: 'prices.prefs.v2' };

const state = {
  catalog: null, overview: null, products: new Map(), retailers: [],
  cart: store.get(K.cart, []).filter((x) => x && typeof x.id === 'string'),
  watch: store.get(K.watch, []).filter((x) => x && typeof x.id === 'string'),
  ship: store.get(K.ship, {}),
  prefs: store.get(K.prefs, {}),
  demo: false, tab: 'deals', product: null,
};

/* ------------------------------------------------------------------ helpers */
function safeHref(u) {
  try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; }
}
function extLink(url, text, attrs = {}) {
  const href = safeHref(url);
  return href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow', ...attrs }, text) : el('span', {}, text);
}
const money = (n) => fmtMoney(n, state.overview?.home?.currency ?? 'USD');
function ago(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return 'never';
  const m = Math.max(0, (Date.now() - t) / 60_000);
  if (m < 2) return 'just now';
  if (m < 90) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)} days ago`;
}
const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const CONF = { medium: 'medium confidence', low: 'low confidence: verify' };
const CAT_NAME = (id) => state.catalog?.categories.find((c) => c.id === id)?.name ?? id;
const factionColor = (id) => state.catalog?.factions.find((f) => f.id === id)?.color ?? '#888';
const storeName = (id) => state.retailers.find((r) => r.id === id)?.name ?? state.overview?.stores.find((s) => s.id === id)?.name ?? id;
const storeCaution = (id) => state.overview?.stores.find((s) => s.id === id)?.caution ?? null;
const dot = (faction) => el('span', { class: 'faction-dot', style: { '--c': factionColor(faction) }, 'aria-hidden': 'true' });
function scoreBadge(deal) {
  if (deal?.score == null) return null;
  const kind = deal.score >= 80 ? 'good' : deal.score >= 55 ? 'accent' : deal.score >= 30 ? 'info' : 'warn';
  return el('span', { class: `badge ${kind}`, title: `Deal score ${deal.score}/100` }, `${deal.label} · ${deal.score}`);
}
function stockBadge(s) {
  if (s === true) return el('span', { class: 'badge good' }, 'In stock');
  if (s === false) return el('span', { class: 'badge bad' }, 'Out of stock');
  return el('span', { class: 'badge warn' }, 'Stock unknown');
}
function api(path, opts) {
  const sep = path.includes('?') ? '&' : '?';
  return doFetch(state.demo && !STATIC ? `${path}${sep}demo=1` : path, opts);
}
async function getJson(path, opts) {
  const res = await api(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

/* ------------------------------------------------------------------ charts */
function lineChart(points, { width = 400, height = 160, rrp = null, spark = false } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
  const pad = spark ? { l: 2, r: 2, t: 3, b: 3 } : { l: 44, r: 10, t: 10, b: 22 };
  const vals = points.map((p) => p.p).concat(rrp && !spark ? [rrp] : []);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const x = (i) => pad.l + (points.length < 2 ? 0 : (i / (points.length - 1)) * (width - pad.l - pad.r));
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const svg = mk('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', class: spark ? 'spark' : '',
    'aria-label': `Best price history: ${points.map((p) => `${fmtDate(p.t)} ${money(p.p)}`).join(', ')}` });
  if (!spark) {
    for (const v of [lo, hi]) {
      svg.append(mk('line', { class: 'gridline', x1: pad.l, x2: width - pad.r, y1: y(v), y2: y(v) }));
      const t = mk('text', { class: 'label', x: 4, y: y(v) + 4 }); t.textContent = money(v); svg.append(t);
    }
    svg.append(mk('line', { class: 'axis', x1: pad.l, x2: width - pad.r, y1: height - pad.b, y2: height - pad.b }));
    if (rrp) {
      svg.append(mk('line', { class: 'series-alt', x1: pad.l, x2: width - pad.r, y1: y(rrp), y2: y(rrp), 'stroke-dasharray': '4 4' }));
      const t = mk('text', { class: 'label', x: width - pad.r - 30, y: y(rrp) - 4 }); t.textContent = 'RRP'; svg.append(t);
    }
    const first = mk('text', { class: 'label', x: pad.l, y: height - 6 }); first.textContent = fmtDate(points[0].t); svg.append(first);
    const last = mk('text', { class: 'label', x: width - pad.r, y: height - 6, 'text-anchor': 'end' }); last.textContent = fmtDate(points.at(-1).t); svg.append(last);
  }
  svg.append(mk('polyline', { class: 'series', points: points.map((p, i) => `${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ') }));
  if (!spark) points.forEach((p, i) => svg.append(mk('circle', { class: 'series', cx: x(i), cy: y(p.p), r: 2.5 })));
  return el('div', { class: spark ? 'chart' : 'card chart hist' }, svg);
}

/* ------------------------------------------------------------------ tabs + routing */
const TABS = ['deals', 'browse', 'product', 'cart', 'watch', 'value', 'search', 'stores'];
function showTab(name, { push = true } = {}) {
  if (!TABS.includes(name)) name = 'deals';
  state.tab = name;
  for (const t of TABS) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`tab-${t}`).tabIndex = t === name ? 0 : -1;
    $(`panel-${t}`).hidden = t !== name;
  }
  if (push) {
    const hash = name === 'product' && state.product ? `#product=${encodeURIComponent(state.product)}` : `#${name}`;
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }
  render();
}
document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab);
});
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const vis = TABS.filter((t) => !$(`tab-${t}`).hidden);
  const i = vis.indexOf(state.tab);
  const next = vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length];
  showTab(next); $(`tab-${next}`).focus();
});
function openProduct(id) {
  if (!state.products.has(id) && !state.catalog?.products.some((p) => p.id === id)) return;
  state.product = id;
  $('tab-product').hidden = false;
  $('tab-product').textContent = 'Product';
  showTab('product');
  window.scrollTo({ top: $('tab-product').getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
}

/* ------------------------------------------------------------------ cart + watch actions */
function saveCart() { store.set(K.cart, state.cart); updateCounts(); }
function saveWatch() { store.set(K.watch, state.watch); updateCounts(); }
function addToCart(id, qty = 1) {
  const it = state.cart.find((x) => x.id === id);
  if (it) it.qty = Math.min(99, it.qty + qty); else state.cart.push({ id, qty });
  saveCart();
  toast(`Added ${productName(id)} to the cart`, 'good');
  cartDirty = true;
}
const watched = (id) => state.watch.find((w) => w.id === id);
function toggleWatch(id, target) {
  const w = watched(id);
  if (w && target === undefined) { state.watch = state.watch.filter((x) => x.id !== id); toast(`Removed ${productName(id)} from the watchlist`); }
  else if (w) w.target = target;
  else {
    state.watch.push({ id, target: target ?? null, addedAt: new Date().toISOString() });
    toast(`Watching ${productName(id)}`, 'good');
  }
  saveWatch();
  render();
}
function updateCounts() {
  const n = state.cart.reduce((t, x) => t + x.qty, 0);
  $('tab-cart').textContent = n ? `Cart optimizer (${n})` : 'Cart optimizer';
  $('tab-watch').textContent = state.watch.length ? `Watchlist (${state.watch.length})` : 'Watchlist';
}
const productName = (id) => state.products.get(id)?.name ?? state.catalog?.products.find((p) => p.id === id)?.name ?? id;

/* ------------------------------------------------------------------ autocomplete */
function makeCombo(input, list, onPick) {
  let items = []; let active = -1;
  const close = () => { list.hidden = true; items = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const setActive = (i) => {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) { input.setAttribute('aria-activedescendant', list.children[i].id); list.children[i].scrollIntoView({ block: 'nearest' }); }
  };
  const pick = (p) => { close(); onPick(p); };
  function update() {
    const q = input.value.trim();
    const prods = state.catalog?.products ?? [];
    if (q.length < 2 || !prods.length) return close();
    items = bestMatches(q, prods, { key: (p) => [p.name, ...(p.aliases ?? [])], limit: 8, threshold: 0.6 }).map((m) => m.item);
    if (!items.length) return close();
    fill(list, ...items.map((p, i) => {
      const best = state.products.get(p.id)?.best;
      return el('li', { class: 'ac-item', role: 'option', id: `${list.id}-${i}`, 'aria-selected': 'false',
        onpointerdown: (e) => e.preventDefault(), onclick: () => pick(p) },
      dot(p.faction), ` ${p.name}`,
      el('span', { class: 'ac-sub' }, best ? `${money(best.deal.price)} · ${CAT_NAME(p.category)}` : CAT_NAME(p.category)));
    }));
    list.hidden = false; active = -1; input.setAttribute('aria-expanded', 'true');
  }
  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.hidden) update();
      if (!items.length) return;
      e.preventDefault();
      setActive(e.key === 'ArrowDown' ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1));
    } else if (e.key === 'Enter') {
      if (!list.hidden && items.length) { e.preventDefault(); pick(items[Math.max(0, active)]); }
    } else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); close(); }
  });
  return { close, update };
}

/* ------------------------------------------------------------------ deal selection under filters */
function filters() {
  return {
    faction: $('f-faction').value, cats: [...$('f-cat').querySelectorAll('[aria-pressed=true]')].map((b) => b.dataset.cat),
    max: Number($('f-max').value) || null, store: $('f-store').value, stock: $('f-stock').checked,
    trusted: $('f-trusted').checked, withOffers: $('f-offers').checked,
    sort: $('f-sort').querySelector('[aria-pressed=true]')?.dataset.sort ?? 'score',
  };
}
/** Best offer for a product among offers allowed by the filters (lowest delivered total). */
function pickBest(p, f = {}) {
  const ok = p.offers.filter((o) => !o.flags?.includes('suspicious') && o.deal
    && (!f.store || o.retailerId === f.store) && (!f.trusted || !storeCaution(o.retailerId))
    && (f.stock === false ? true : o.inStock === true));
  ok.sort((a, b) => a.deal.total - b.deal.total);
  return ok[0] ?? null;
}
const SORTS = {
  score: (a, b) => (b.b?.deal.score ?? -1) - (a.b?.deal.score ?? -1),
  total: (a, b) => (a.b?.deal.total ?? Infinity) - (b.b?.deal.total ?? Infinity),
  off: (a, b) => (b.b?.deal.pctOff ?? -999) - (a.b?.deal.pctOff ?? -999),
  price: (a, b) => (a.b?.deal.price ?? Infinity) - (b.b?.deal.price ?? Infinity),
};

/* ------------------------------------------------------------------ product card */
function productCard(p, best = p.best) {
  const w = watched(p.id);
  const d = best?.deal;
  const hit = w?.target != null && d && d.price <= w.target;
  return el('article', { class: 'card deal-card' },
    el('div', { class: 'card-title' }, dot(p.faction),
      el('button', { type: 'button', class: 'linkish', onclick: () => openProduct(p.id) }, p.name)),
    el('div', { class: 'row tight' }, el('span', { class: 'tag' }, CAT_NAME(p.category)),
      p.factionName && p.faction !== 'multi' && p.faction !== 'hobby' ? el('span', { class: 'tag' }, p.factionName) : null,
      scoreBadge(d)),
    d ? el('div', { class: 'stack tight' },
      el('div', { class: 'row tight' }, el('span', { class: 'price' }, money(d.price)),
        p.msrp ? el('span', { class: 'strike', title: 'Approximate RRP' }, money(p.msrp)) : null,
        d.pctOff > 0 ? el('span', { class: 'savings' }, `Save ${d.pctOff}% (${money(d.savings)})`) : null),
      el('div', { class: 'small muted' }, `≈ ${money(d.total)} delivered (est.) at ${best.retailerName}`),
      d.score != null ? el('div', { class: `bar ${d.score >= 55 ? 'good' : d.score >= 30 ? '' : 'warn'}`, style: { '--pct': `${d.score}%` },
        role: 'img', 'aria-label': `Deal score ${d.score} of 100` }, el('span')) : null,
      el('div', { class: 'row tight' },
        el('span', { class: 'badge good' }, `${p.inStockCount} store${p.inStockCount === 1 ? '' : 's'} in stock`),
        p.atLowest && p.history.length > 1 ? el('span', { class: 'badge accent', title: 'Lowest price recorded in the snapshot history' }, 'Lowest seen') : null,
        hit ? el('span', { class: 'badge good' }, `≤ your target ${money(w.target)}`) : null,
        best.carried ? el('span', { class: 'badge warn', title: `Price from ${ago(best.fetchedAt)}` }, 'Older price') : null))
      : el('p', { class: 'muted small' }, `No current in-stock price from the tracked stores. RRP ≈ ${money(p.msrp)}.`),
    el('div', { class: 'row tight actions' },
      el('button', { type: 'button', class: 'btn secondary sm', onclick: () => openProduct(p.id) }, 'Details'),
      el('button', { type: 'button', class: 'btn sm', onclick: () => addToCart(p.id) }, 'Add to cart'),
      el('button', { type: 'button', class: 'btn ghost sm', 'aria-pressed': String(!!w), onclick: () => toggleWatch(p.id) }, w ? '★ Watching' : '☆ Watch')),
  );
}

/* ------------------------------------------------------------------ status header */
function renderStatus() {
  const ov = state.overview; const box = $('status-callouts'); const stats = $('fresh-stats');
  fill(box); fill(stats);
  if (!ov) {
    const parts = [el('strong', {}, 'No price snapshot yet. '),
      STATIC ? 'The site owner needs to run a price refresh.' : 'Run “npm run snapshot” for live prices, or use sample data to try the tools.'];
    const actions = el('div', { class: 'row tight', style: { marginTop: '8px' } },
      !STATIC ? el('button', { type: 'button', class: 'btn sm', onclick: () => { $('demo').checked = true; setDemo(true); } }, 'Use sample data') : null,
      REFRESH_URL ? el('a', { class: 'btn sm secondary', href: REFRESH_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Refresh prices') : null);
    box.append(el('div', { class: 'callout warn' }, ...parts, actions));
    return;
  }
  const s = ov.snapshot;
  if (s.demo) {
    box.append(el('div', { class: 'callout bad', role: 'alert' }, el('strong', {}, 'SAMPLE DATA: these are not real prices. '),
      s.fallbackReason ?? 'Demo mode generates made-up prices so you can try the tools.'));
  }
  if (s.freshness === 'stale') {
    box.append(el('div', { class: 'callout warn' }, el('strong', {}, `Prices are ${ago(s.generatedAt)} old. `),
      'Stock and prices have probably changed; check the store before buying.',
      REFRESH_URL ? [' ', el('a', { href: REFRESH_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Refresh prices')] : null));
  }
  if (s.partial) {
    box.append(el('div', { class: 'callout info' }, 'This refresh covered part of the catalogue (polite per-store limits). '
      + 'Products not re-checked keep their recent price, marked “Older price”; the next refresh continues where this one stopped.'));
  }
  const failing = ov.stores.filter((x) => !x.blocked && (x.status === 'error' || x.stoppedReason));
  if (failing.length && !s.demo) {
    box.append(el('div', { class: 'callout warn' }, el('strong', {}, 'Some stores did not answer: '),
      failing.map((x) => `${x.name} (${x.stoppedReason ?? x.reason ?? 'error'}; last success ${ago(x.lastOkAt)})`).join('; ')));
  }
  const live = ov.stores.filter((x) => x.status !== 'skipped' && !x.blocked);
  const ok = live.filter((x) => x.status === 'ok').length;
  const priced = ov.products.filter((p) => p.best).length;
  const top = ov.products.find((p) => p.id === ov.topDeals[0]);
  const stat = (label, value, sub, cls = '') => el('div', { class: `stat ${cls}` },
    el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value), sub ? el('div', { class: 'stat-sub' }, sub) : null);
  stats.append(
    stat('Prices updated', s.generatedAt ? ago(s.generatedAt) : 'never',
      s.generatedAt ? `${new Date(s.generatedAt).toLocaleString()}${s.demo ? ' · sample' : ''}` : null,
      s.freshness === 'stale' ? 'bad' : ''),
    stat('Stores responding', `${ok} / ${live.length}`, 'ship to ' + (ov.home?.label ?? 'you')),
    stat('Products priced', `${priced} / ${ov.products.length}`, `${s.offers} listings checked`),
    top ? stat('Best deal now', `${top.best.deal.pctOff}% off`, top.name, 'accent') : stat('Best deal now', '—', 'no priced products'),
  );
}

/* ------------------------------------------------------------------ panels */
function renderDeals() {
  const panel = $('panel-deals'); const ov = state.overview;
  if (!ov) { fill(panel, el('div', { class: 'empty' }, el('strong', {}, 'No deals yet'), el('span', {}, 'Prices appear here after the first refresh.'))); return; }
  const top = ov.topDeals.map((id) => ov.products.find((p) => p.id === id)).filter(Boolean);
  const alerts = state.watch.map((w) => [w, ov.products.find((p) => p.id === w.id)])
    .filter(([w, p]) => w.target != null && p?.best && p.best.deal.price <= w.target);
  fill(panel, 
    alerts.length ? el('div', { class: 'callout good' }, el('strong', {}, 'Price alert: '),
      alerts.map(([w, p], i) => [i ? ', ' : '', el('button', { type: 'button', class: 'linkish', onclick: () => openProduct(p.id) }, p.name),
        ` ${money(p.best.deal.price)} (target ${money(w.target)})`])) : null,
    el('h2', { class: 'section-title' }, 'Top deals right now'),
    el('p', { class: 'muted small' }, 'Biggest savings across the catalogue, ranked by deal score: estimated delivered price to ',
      ov.home?.label ?? 'you', ' (price + shipping + sales tax) against buying at RRP. In-stock offers from vetted stores only.'),
    top.length ? el('div', { class: 'grid' }, top.map((p) => productCard(p))) : el('div', { class: 'empty' }, el('strong', {}, 'No discounted in-stock products in this snapshot.')),
    ...categoryHighlights(ov),
  );
}
function categoryHighlights(ov) {
  // Cheapest Combat Patrol / codex / starter right now: the most common "first buys".
  const out = [];
  for (const cat of ['combat-patrol', 'starter', 'codex']) {
    const ps = ov.products.filter((p) => p.category === cat && p.best).sort((a, b) => a.best.deal.total - b.best.deal.total);
    if (!ps.length) continue;
    out.push(el('h2', { class: 'section-title' }, `Cheapest ${CAT_NAME(cat).toLowerCase()}`),
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Product'), el('th', { class: 'num' }, 'Price'), el('th', { class: 'num opt' }, 'RRP'),
          el('th', { class: 'num' }, 'Delivered (est.)'), el('th', { class: 'opt' }, 'Store'))),
        el('tbody', {}, ps.slice(0, 6).map((p, i) => el('tr', { class: i === 0 ? 'best' : null },
          el('td', {}, dot(p.faction), ' ', el('button', { type: 'button', class: 'linkish', onclick: () => openProduct(p.id) }, p.name)),
          el('td', { class: 'num' }, money(p.best.deal.price), p.best.deal.pctOff > 0 ? el('span', { class: 'cell-sub savings' }, `-${p.best.deal.pctOff}%`) : null),
          el('td', { class: 'num opt' }, money(p.msrp)),
          el('td', { class: 'num' }, money(p.best.deal.total)),
          el('td', { class: 'opt' }, p.best.retailerName)))))));
  }
  return out;
}

function renderBrowse() {
  const ov = state.overview; const f = filters();
  if (!ov) { fill($('browse-list')); $('browse-count').textContent = 'No snapshot loaded.'; return; }
  let rows = ov.products.map((p) => ({ p, b: pickBest(p, f) }))
    .filter(({ p, b }) => (!f.faction || p.faction === f.faction || state.catalog.factions.find((x) => x.id === p.faction)?.parent === f.faction)
      && (!f.cats.length || f.cats.includes(p.category))
      && (!f.withOffers || b) && (!f.max || (b && b.deal.price <= f.max)));
  rows.sort((a, b) => SORTS[f.sort](a, b) || a.p.name.localeCompare(b.p.name));
  $('browse-count').textContent = `${rows.length} product${rows.length === 1 ? '' : 's'}`;
  const LIMIT = 60;
  fill($('browse-list'), ...(rows.length ? rows.slice(0, LIMIT).map(({ p, b }) => productCard(p, b))
    : [el('div', { class: 'empty' }, el('strong', {}, 'Nothing matches these filters'), el('span', {}, 'Try another faction, untick “In stock only”, or raise the max price.'))]),
  rows.length > LIMIT ? el('p', { class: 'muted' }, `Showing the first ${LIMIT}. Narrow the filters to see the rest.`) : null);
  store.set(K.prefs, { ...state.prefs, filters: f });
}

function offerRow(o, isBest) {
  const d = o.deal;
  const flags = [];
  if (o.flags?.includes('suspicious')) flags.push(el('span', { class: 'badge bad', title: 'Far below RRP: may be used, partial or mislabelled. Check the listing.' }, 'Too good to be true?'));
  if (!o.domestic) flags.push(el('span', { class: 'badge warn' }, 'Ships internationally'));
  if (o.carried) flags.push(el('span', { class: 'badge warn' }, 'Older price'));
  const caution = storeCaution(o.retailerId);
  return el('tr', { class: isBest ? 'best' : null },
    el('td', {}, el('div', {}, o.retailerName), caution ? el('span', { class: 'cell-sub text-warn' }, caution) : null,
      el('span', { class: 'cell-sub' }, `updated ${ago(o.fetchedAt)}`)),
    el('td', {}, extLink(o.url, o.title), flags.length ? el('div', { class: 'row tight' }, flags) : null),
    el('td', { class: 'num' }, money(d?.price), d?.pctOff != null ? el('span', { class: `cell-sub ${d.pctOff > 0 ? 'savings' : ''}` }, d.pctOff > 0 ? `-${d.pctOff}% RRP` : d.pctOff < 0 ? `+${-d.pctOff}% RRP` : 'at RRP') : null),
    el('td', { class: 'num opt' }, d ? (d.shipping ? money(d.shipping) : 'Free') : '—',
      d?.freeOver != null && d.toFree > 0 ? el('span', { class: 'cell-sub' }, `free over ${money(d.freeOver)}`) : null),
    el('td', { class: 'num opt' }, d ? money(d.tax + d.duty) : '—', d?.duty ? el('span', { class: 'cell-sub' }, 'incl. import duty') : null),
    el('td', { class: 'num' }, el('strong', {}, money(d?.total))),
    el('td', {}, stockBadge(o.inStock), d?.score != null ? el('span', { class: 'cell-sub score' }, `score ${d.score}`) : null),
  );
}
function offersTable(offers, bestUrl) {
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Store'), el('th', {}, 'Listing'), el('th', { class: 'num' }, 'Price'),
      el('th', { class: 'num opt' }, 'Ship (est.)'), el('th', { class: 'num opt' }, 'Tax (est.)'), el('th', { class: 'num' }, 'Delivered'), el('th', {}, 'Stock'))),
    el('tbody', {}, offers.map((o) => offerRow(o, o.url === bestUrl)))));
}

function renderProduct() {
  const panel = $('panel-product');
  const p = state.products.get(state.product);
  const c = state.catalog?.products.find((x) => x.id === state.product);
  if (!p && !c) { fill(panel, el('div', { class: 'empty' }, el('strong', {}, 'Pick a product above'))); return; }
  const info = p ?? { ...c, offers: [], best: null, history: [], lowest: null, msrp: c.USD, inStockCount: 0 };
  const d = info.best?.deal;
  const w = watched(info.id);
  let qty = 1;
  const qtyInput = el('input', { type: 'number', min: '1', max: '99', value: '1', 'aria-label': 'Quantity', class: 'w-num',
    oninput: (e) => { qty = Math.max(1, Math.min(99, Number(e.target.value) || 1)); } });
  const target = el('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', id: 'p-target', placeholder: d ? String(Math.floor(d.price * 0.9)) : 'e.g. 120',
    value: w?.target ?? '' });
  const liveBox = el('div', { class: 'stack' });
  fill(panel, 
    el('div', { class: 'row' }, dot(info.faction), el('h2', { style: { margin: 0 } }, info.name), el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn ghost sm', onclick: () => showTab('browse') }, '← Back to browse')),
    el('div', { class: 'row tight' }, el('span', { class: 'tag' }, CAT_NAME(info.category)),
      info.factionName ? el('span', { class: 'tag' }, info.factionName) : null,
      el('span', { class: 'muted small' }, `RRP ≈ ${money(info.msrp)} (${CONF[info.conf] ?? 'approximate'}, ${state.catalog?.asOf ?? 'approx.'})`),
      info.models ? el('span', { class: 'muted small' }, `${info.models} models`) : null,
      info.points ? el('span', { class: 'muted small' }, `≈${info.points} pts (rough)`) : null),
    el('div', { class: 'stats' },
      el('div', { class: 'stat accent' }, el('div', { class: 'stat-label' }, 'Best delivered (est.)'),
        el('div', { class: 'stat-value' }, d ? money(d.total) : '—'),
        el('div', { class: 'stat-sub' }, d ? `${money(d.price)} at ${info.best.retailerName}` : 'no in-stock offer')),
      el('div', { class: 'stat good' }, el('div', { class: 'stat-label' }, 'Off RRP'),
        el('div', { class: 'stat-value' }, d?.pctOff != null ? `${d.pctOff}%` : '—'),
        el('div', { class: 'stat-sub' }, d?.savings != null ? `you save ≈ ${money(d.savings)}` : '')),
      el('div', { class: 'stat' }, el('div', { class: 'stat-label' }, 'Lowest seen'),
        el('div', { class: 'stat-value' }, info.lowest ? money(info.lowest.p) : '—'),
        el('div', { class: 'stat-sub' }, info.lowest ? `${fmtDate(info.lowest.t)} · ${storeName(info.lowest.r)}${info.atLowest ? ' · that’s now!' : ''}` : 'no history yet')),
      el('div', { class: 'stat' }, el('div', { class: 'stat-label' }, 'Deal score'),
        el('div', { class: 'stat-value' }, d?.score != null ? `${d.score}` : '—'),
        el('div', { class: 'stat-sub' }, d?.label ?? ''))),
    el('div', { class: 'card compact' }, el('div', { class: 'row' },
      el('div', { class: 'field', style: { margin: 0 } }, el('label', {}, 'Quantity'), el('div', { class: 'row tight' }, qtyInput,
        el('button', { type: 'button', class: 'btn', onclick: () => addToCart(info.id, qty) }, 'Add to cart'))),
      el('span', { class: 'spacer' }),
      el('div', { class: 'field', style: { margin: 0 } }, el('label', { for: 'p-target' }, 'Alert me at or below (item price)'),
        el('div', { class: 'row tight' }, el('div', { class: 'input-group' }, el('span', { class: 'addon' }, '$'), target),
          el('button', { type: 'button', class: 'btn secondary', onclick: () => {
            const t = target.value === '' ? null : Math.max(0, Number(target.value));
            if (watched(info.id)) toggleWatch(info.id, t); else { toggleWatch(info.id); if (t != null) toggleWatch(info.id, t); }
          } }, w ? 'Update watch' : 'Watch'),
          w ? el('button', { type: 'button', class: 'btn ghost', onclick: () => toggleWatch(info.id) }, 'Unwatch') : null)))),
    info.note ? el('div', { class: 'callout info small' }, info.note) : null,
    info.history.length > 1 ? el('div', { class: 'stack tight' }, el('h3', { class: 'section-title' }, 'Best in-stock price history'),
      lineChart(info.history, { rrp: info.msrp }),
      el('p', { class: 'hint' }, `${info.history.length} refreshes; one point per day, last 30 kept${state.overview?.snapshot.demo ? ' (sample history)' : ''}.`)) : null,
    el('h3', { class: 'section-title' }, `Offers (${info.offers.length})`),
    info.offers.length ? offersTable(info.offers, info.best?.url)
      : el('div', { class: 'empty' }, el('strong', {}, 'No listings in the latest snapshot'), el('span', {}, STATIC ? 'Try “Search stores”.' : 'Try checking live prices below.')),
    el('p', { class: 'hint' }, 'Delivered = price + estimated shipping for this item alone + estimated sales tax (or import duty). Buying several items? Use the cart optimizer.'),
    !STATIC ? el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn secondary', onclick: (e) => liveCheck(info, e.currentTarget, liveBox) }, 'Check live prices now'),
      el('span', { class: 'hint' }, 'Searches the stores once, politely rate-limited; can take up to a minute.')) : null,
    liveBox,
  );
}
async function liveCheck(info, btn, box) {
  btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
  fill(box, el('p', { class: 'muted' }, el('span', { class: 'spinner' }), ' Asking the stores…'));
  try {
    const data = await getJson(`/api/prices/search?${new URLSearchParams({ q: info.name, region: 'US', currency: 'USD' })}`);
    fill(box, searchResults(data));
  } catch (err) {
    fill(box, el('p', { class: 'error' }, err.message));
  } finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
}

/* ---- search stores (live in server mode, snapshot on the static site) ---- */
function renderSearchPanel() {
  const panel = $('panel-search');
  if (panel.dataset.ready) return;
  panel.dataset.ready = '1';
  const q = el('input', { id: 's-q', type: 'search', maxlength: '100', placeholder: 'Any product name', autocomplete: 'off' });
  const region = el('select', { id: 's-region' }, el('option', { value: 'US' }, 'US stores (ship to Seattle)'), el('option', { value: 'All' }, 'All regions'),
    el('option', { value: 'UK' }, 'UK stores'), el('option', { value: 'EU' }, 'EU stores'));
  const out = el('div', { class: 'stack', 'aria-live': 'polite' });
  const btn = el('button', { type: 'submit' }, 'Search');
  const form = el('form', { class: 'card compact stack', novalidate: true },
    el('div', { class: 'field-row' }, el('div', { class: 'field' }, el('label', { for: 's-q' }, 'Search the stores for'), q),
      el('div', { class: 'field' }, el('label', { for: 's-region' }, 'Stores'), region)),
    el('div', { class: 'row' }, btn, el('span', { class: 'hint' }, STATIC
      ? 'On this site results come from the latest published snapshot (visitors never contact the stores).'
      : 'Live search: every store is asked once, rate-limited; results may take a moment.')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = q.value.trim();
    if (v.length < 2) { fill(out, el('p', { class: 'error' }, 'Please enter 2–100 characters.')); return; }
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    fill(out, el('span', { class: 'skeleton lg' }), el('span', { class: 'skeleton' }));
    try {
      fill(out, searchResults(await getJson(`/api/prices/search?${new URLSearchParams({ q: v, region: region.value, currency: 'USD' })}`), (s) => { q.value = s; form.requestSubmit(); }));
    } catch (err) { fill(out, el('p', { class: 'error' }, err.message)); }
    finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
  });
  fill(panel, form, out);
}
function searchResults(data, rerun) {
  const b = data.best;
  const statuses = (data.retailers ?? []).filter((r) => !/^Not in region/.test(r.reason ?? ''));
  return el('div', { class: 'stack' },
    data.didYouMean?.corrected && rerun ? el('p', {}, 'Did you mean ', el('button', { type: 'button', class: 'linkish text-accent', onclick: () => rerun(data.didYouMean.corrected) }, data.didYouMean.corrected), '?') : null,
    b ? el('div', { class: 'callout good' }, el('strong', {}, 'Best deal: '), `${money(b.deal?.total)} delivered (est.) — ${money(b.deal?.price ?? b.price)} at ${b.retailerName}. `,
      extLink(b.url, 'View listing')) : el('div', { class: 'callout warn' }, 'No trusted in-stock offer found.'),
    data.msrp ? el('p', { class: 'muted small' }, `RRP ≈ $${data.msrp.USD} for “${data.msrp.name}” (approximate).`) : null,
    data.results?.length ? offersTable(data.results, b?.url) : null,
    statuses.length ? el('div', { class: 'row tight' }, statuses.map((r) => el('span', {
      class: `badge ${r.status === 'ok' ? 'good' : r.status === 'error' ? 'bad' : 'warn'}`, title: r.error ?? r.reason ?? '' },
    `${r.name}: ${r.status === 'ok' ? 'ok' : r.status === 'error' ? 'failed' : 'skipped'}`))) : null,
    filteredNote(data.filtered),
    data.snapshot?.demo ? el('div', { class: 'callout bad' }, 'Sample data: not real prices.') : null,
  );
}
function filteredNote(f = {}) {
  const unsafe = ['domain-mismatch', 'insecure-url', 'unlisted-retailer', 'retailer-mismatch', 'bad-url'].reduce((t, k) => t + (f[k] ?? 0), 0);
  const notNew = (f['not-new-or-official'] ?? 0) + (f.bundle ?? 0);
  const parts = [];
  if (unsafe) parts.push(`${unsafe} listing(s) pointed to an untrusted or insecure site and were discarded`);
  if (notNew) parts.push(`${notNew} used, bits, 3rd-party or bundle listing(s) were left out`);
  return parts.length ? el('p', { class: 'muted small' }, `${parts.join('; ')}.`) : null;
}

/* ---- cart optimizer ---- */
let cartDirty = true; let cartResult = null; let cartError = null; let cartSeq = 0;
const runCart = debounce(async () => {
  const seq = ++cartSeq;
  if (!state.cart.length || !state.overview) { cartResult = null; cartError = null; if (state.tab === 'cart') renderCart(); return; }
  try {
    const body = JSON.stringify({ items: state.cart, shipping: state.ship, demo: state.demo || undefined });
    const r = await getJson('/api/prices/cart', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (seq === cartSeq) { cartResult = r; cartError = null; }
  } catch (err) { if (seq === cartSeq) { cartError = err.message; cartResult = null; } }
  if (seq === cartSeq && state.tab === 'cart') renderCart();
}, 250);

function renderCart() {
  const panel = $('panel-cart');
  if (cartDirty) { cartDirty = false; runCart(); }
  const addInput = el('input', { id: 'cart-add', type: 'search', placeholder: 'Add a product…', autocomplete: 'off', role: 'combobox',
    'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'cart-list' });
  const addList = el('ul', { id: 'cart-list', class: 'ac-list', role: 'listbox', hidden: true });
  makeCombo(addInput, addList, (p) => { addToCart(p.id); renderCart(); setTimeout(() => $('cart-add')?.focus(), 0); });
  const items = state.cart.map((it) => {
    const p = state.products.get(it.id);
    const set = (q) => { it.qty = Math.max(1, Math.min(99, q)); saveCart(); cartDirty = true; renderCart(); };
    return el('div', { class: 'card compact stack tight' },
      el('div', { class: 'row tight' },
        el('button', { type: 'button', class: 'linkish', onclick: () => openProduct(it.id) }, productName(it.id)),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn icon ghost sm', 'aria-label': `Remove ${productName(it.id)}`,
          onclick: () => { state.cart = state.cart.filter((x) => x !== it); saveCart(); cartDirty = true; renderCart(); } }, '×')),
      el('div', { class: 'row tight' },
        el('div', { class: 'stepper', style: { maxWidth: '140px' } },
          el('button', { type: 'button', 'aria-label': 'Fewer', onclick: () => set(it.qty - 1) }, '−'),
          el('input', { type: 'number', min: '1', max: '99', value: String(it.qty), 'aria-label': `Quantity of ${productName(it.id)}`,
            onchange: (e) => set(Number(e.target.value) || 1) }),
          el('button', { type: 'button', 'aria-label': 'More', onclick: () => set(it.qty + 1) }, '+')),
        el('span', { class: 'small muted' }, p?.best ? `from ${money(p.best.deal.price)}` : 'no in-stock offer',
          p?.msrp ? ` · RRP ${money(p.msrp)}` : '')));
  });
  fill(panel, el('div', { class: 'layout-sidebar' },
    el('aside', { class: 'card stack' },
      el('div', { class: 'card-title' }, 'Your list'),
      el('div', { class: 'field' }, el('label', { for: 'cart-add' }, 'Add products'), el('div', { class: 'ac' }, addInput, addList)),
      state.cart.length ? el('div', { class: 'stack tight' }, items)
        : el('p', { class: 'muted' }, 'Add the sets you want to buy. The optimizer finds the cheapest combination of stores, '
          + 'counting each store’s shipping (and free-shipping threshold) and sales tax once per order.'),
      state.cart.length ? el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { state.cart = []; saveCart(); cartDirty = true; renderCart(); } }, 'Clear list') : null,
      shippingEditor()),
    el('div', { class: 'stack' }, cartPlan())));
}
function cartPlan() {
  if (!state.cart.length) return el('div', { class: 'empty' }, el('strong', {}, 'Your list is empty'), el('span', {}, 'Add products with “Add to cart” or the box on the left.'));
  if (cartError) return el('p', { class: 'error' }, cartError);
  const r = cartResult;
  if (!r) return el('div', { class: 'card' }, el('span', { class: 'skeleton lg' }), el('span', { class: 'skeleton' }));
  const single = r.comparisons.bestSingleStore;
  const stat = (label, value, sub, cls = '') => el('div', { class: `stat ${cls}` }, el('div', { class: 'stat-label' }, label),
    el('div', { class: 'stat-value' }, value), sub ? el('div', { class: 'stat-sub' }, sub) : null);
  return el('div', { class: 'stack' },
    el('div', { class: 'stats' },
      stat('Optimized total (est.)', money(r.total), `${r.plan.length} order${r.plan.length === 1 ? '' : 's'} · goods ${money(r.goods)} + shipping ${money(r.shipping)} + tax ${money(r.tax)}`, 'accent'),
      stat('Each item where cheapest', money(r.comparisons.cheapestEach),
        r.comparisons.savedVsCheapestEach > 0.005 ? `optimizer saves ${money(r.comparisons.savedVsCheapestEach)}` : 'same as optimized'),
      stat('Best single store', single ? money(single.total) : '—', single ? storeName(single.retailerId) : 'no store has everything')),
    !r.exact ? el('div', { class: 'callout info' }, 'Large list: this is the best plan found within the time budget (may not be the absolute minimum).') : null,
    r.unavailable.length ? el('div', { class: 'callout warn' }, el('strong', {}, 'Not in stock at any tracked store: '),
      r.unavailable.map((u) => u.name).join(', '), '. They are left out of the totals.') : null,
    el('div', { class: 'plan-grid' }, r.plan.map((g) => el('div', { class: 'card stack tight' },
      el('div', { class: 'card-title' }, g.retailerName, storeCaution(g.retailerId) ? el('span', { class: 'badge warn' }, 'Check reviews') : null),
      el('div', { class: 'table-wrap' }, el('table', {}, el('tbody', {},
        g.items.map((it) => el('tr', {}, el('td', {}, extLink(it.url, it.name), it.qty > 1 ? ` × ${it.qty}` : ''),
          el('td', { class: 'num' }, money(it.lineTotal)))),
        el('tr', {}, el('td', { class: 'muted' }, 'Shipping (est.)'), el('td', { class: 'num' }, g.shipping ? money(g.shipping) : 'Free')),
        el('tr', {}, el('td', { class: 'muted' }, g.duty ? 'Import duty + fees (est.)' : `Sales tax (est. ${(g.taxRate * 100).toFixed(2)}%)`),
          el('td', { class: 'num' }, money(g.tax + g.duty))),
        el('tr', { class: 'best' }, el('td', {}, el('strong', {}, 'Order total')), el('td', { class: 'num' }, el('strong', {}, money(g.total))))))),
      g.toFree > 0 ? el('p', { class: 'hint' }, `Add ${money(g.toFree)} more here for free shipping (saves ≈ ${money(g.shipping)}).`) : null,
      el('p', { class: 'hint' }, g.shippingNote ?? '')))),
    el('p', { class: 'hint' }, 'All shipping, tax and duty figures are estimates for orders shipped to ', state.overview?.home?.label ?? 'you',
      '. Washington taxes shipping charges too. Adjust the shipping rules on the left if you know better.'));
}
function shippingEditor() {
  const stores = (state.overview?.stores ?? []).filter((s) => s.status !== 'skipped' && !s.blocked);
  if (!stores.length) return null;
  const rows = stores.map((s) => {
    const o = state.ship[s.id] ?? {};
    const inp = (key, val, label) => el('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', class: 'w-num', 'aria-label': `${s.name} ${label}`,
      value: o[key] ?? val ?? '', placeholder: val == null ? 'never' : String(val),
      onchange: (e) => {
        const v = e.target.value === '' ? undefined : Number(e.target.value);
        state.ship[s.id] = { ...state.ship[s.id], [key]: v };
        store.set(K.ship, state.ship); cartDirty = true; renderCart();
      } });
    return el('tr', {}, el('td', {}, s.name, el('span', { class: 'cell-sub' }, s.shipping?.conf === 'low' ? 'rough estimate' : 'published policy')),
      el('td', {}, inp('flat', s.shipping?.flat, 'flat shipping')), el('td', {}, inp('freeOver', s.shipping?.freeOver, 'free shipping over')));
  });
  return el('details', { class: 'stack tight' }, el('summary', {}, 'Shipping assumptions'),
    el('p', { class: 'hint' }, 'Estimated standard shipping per order and the free-shipping threshold. Edit if a store’s policy differs.'),
    el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Store'), el('th', {}, 'Flat $'), el('th', {}, 'Free over $'))), el('tbody', {}, rows))),
    el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { state.ship = {}; store.set(K.ship, {}); cartDirty = true; renderCart(); } }, 'Reset to estimates'));
}

/* ---- watchlist ---- */
function renderWatch() {
  const panel = $('panel-watch');
  if (!state.watch.length) {
    fill(panel, el('div', { class: 'empty' }, el('strong', {}, 'Nothing watched yet'),
      el('span', {}, 'Press “☆ Watch” on any product and set a target price. Products at or below target are highlighted here and on Top deals.')));
    return;
  }
  const rows = state.watch.map((w) => {
    const p = state.products.get(w.id);
    const d = p?.best?.deal;
    const hit = w.target != null && d && d.price <= w.target;
    const target = el('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', class: 'w-num', value: w.target ?? '', placeholder: 'none',
      'aria-label': `Target price for ${productName(w.id)}`,
      onchange: (e) => { w.target = e.target.value === '' ? null : Math.max(0, Number(e.target.value)); saveWatch(); render(); } });
    return el('tr', { class: hit ? 'best' : null },
      el('td', {}, el('button', { type: 'button', class: 'linkish', onclick: () => openProduct(w.id) }, productName(w.id)),
        p?.msrp ? el('span', { class: 'cell-sub' }, `RRP ≈ ${money(p.msrp)}`) : null),
      el('td', {}, el('div', { class: 'input-group' }, el('span', { class: 'addon' }, '$'), target)),
      el('td', { class: 'num' }, d ? money(d.price) : '—', d ? el('span', { class: 'cell-sub' }, `${p.best.retailerName} · ${money(d.total)} delivered`) : el('span', { class: 'cell-sub' }, 'no in-stock offer')),
      el('td', {}, hit ? el('span', { class: 'badge good' }, 'At or below target') : w.target != null && d
        ? el('span', { class: 'badge info' }, `${money(d.price - w.target)} to go`) : el('span', { class: 'muted small' }, w.target == null ? 'no target' : 'no price'),
      p?.atLowest && p.history.length > 1 ? el('span', { class: 'cell-sub text-accent' }, 'lowest seen') : null),
      el('td', { class: 'num opt' }, p?.lowest ? money(p.lowest.p) : '—', p?.lowest ? el('span', { class: 'cell-sub' }, fmtDate(p.lowest.t)) : null),
      el('td', { class: 'opt' }, p?.history?.length > 1 ? lineChart(p.history, { width: 120, height: 32, spark: true }) : el('span', { class: 'muted small' }, 'no history')),
      el('td', {}, el('button', { type: 'button', class: 'btn icon ghost', 'aria-label': `Stop watching ${productName(w.id)}`, onclick: () => toggleWatch(w.id) }, '×')));
  });
  const hits = state.watch.filter((w) => { const d = state.products.get(w.id)?.best?.deal; return w.target != null && d && d.price <= w.target; });
  fill(panel, 
    hits.length ? el('div', { class: 'callout good' }, el('strong', {}, `${hits.length} item${hits.length === 1 ? ' is' : 's are'} at or below your target.`)) : null,
    el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Product'), el('th', {}, 'Target'), el('th', { class: 'num' }, 'Best now'), el('th', {}, 'Status'),
        el('th', { class: 'num opt' }, 'Lowest seen'), el('th', { class: 'opt' }, 'Trend'), el('th', {}, el('span', { class: 'visually-hidden' }, 'Remove')))),
      el('tbody', {}, rows))),
    el('p', { class: 'hint' }, 'Targets compare with the best in-stock item price (before shipping and tax). The watchlist is stored in this browser only; prices update when the snapshot refreshes.'));
}

/* ---- value per model / point ---- */
function renderValue() {
  const panel = $('panel-value'); const ov = state.overview;
  if (!ov) { fill(panel); return; }
  const fSel = el('select', { id: 'v-faction', onchange: () => { state.prefs.valueFaction = fSel.value; store.set(K.prefs, state.prefs); renderValue(); } },
    el('option', { value: '' }, 'All factions'),
    state.catalog.factions.filter((f) => ov.products.some((p) => p.faction === f.id && p.points)).map((f) => el('option', { value: f.id }, f.name)));
  fSel.value = state.prefs.valueFaction ?? '';
  const fac = fSel.value;
  const ppts = (p) => (p.perPoint ?? p.rrpPerPoint);
  const rows = ov.products.filter((p) => (p.points || p.models) && (!fac || p.faction === fac || state.catalog.factions.find((x) => x.id === p.faction)?.parent === fac))
    .sort((a, b) => (ppts(a) ?? Infinity) - (ppts(b) ?? Infinity));
  const maxP = Math.max(...rows.map(ppts).filter(Number.isFinite), 0.01);
  // Combat Patrol vs the same faction's kits ($ per point, best price or RRP).
  const compare = state.catalog.factions.map((f) => {
    const cp = ov.products.find((p) => p.category === 'combat-patrol' && p.faction === f.id && p.points);
    const kits = ov.products.filter((p) => p.category === 'kit' && p.points && (p.faction === f.id || state.catalog.factions.find((x) => x.id === p.faction)?.parent === f.id));
    if (!cp || !kits.length) return null;
    const kitAvg = kits.reduce((t, k) => t + ppts(k), 0) / kits.length;
    return { f, cp, kitAvg, diff: Math.round((1 - ppts(cp) / kitAvg) * 100), n: kits.length };
  }).filter(Boolean).filter((x) => !fac || x.f.id === fac);
  fill(panel, 
    el('div', { class: 'callout info' }, el('strong', {}, 'Rough guide. '), 'Model counts and points are approximate (points change with balance updates; Combat Patrols are counted as ≈500 pts). '
      + 'Uses the best current in-stock price, or RRP (marked) when there is none.'),
    el('div', { class: 'field', style: { maxWidth: '320px' } }, el('label', { for: 'v-faction' }, 'Faction'), fSel),
    compare.length ? el('div', { class: 'stack tight' }, el('h3', { class: 'section-title' }, 'Combat Patrol vs buying kits'),
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Faction'), el('th', { class: 'num' }, 'Combat Patrol $/pt'), el('th', { class: 'num' }, 'Kits $/pt (avg)'), el('th', { class: 'num' }, 'CP saves'))),
        el('tbody', {}, compare.map((x) => el('tr', { class: x.diff > 0 ? null : null },
          el('td', {}, dot(x.f.id), ' ', x.f.name),
          el('td', { class: 'num' }, `$${ppts(x.cp).toFixed(3)}`),
          el('td', { class: 'num' }, `$${x.kitAvg.toFixed(3)}`, el('span', { class: 'cell-sub' }, `${x.n} kit${x.n === 1 ? '' : 's'}`)),
          el('td', { class: `num ${x.diff > 0 ? 'text-good' : 'text-warn'}` }, `${x.diff > 0 ? '' : '+'}${Math.abs(x.diff)}%${x.diff > 0 ? '' : ' more'}`))))))) : null,
    el('h3', { class: 'section-title' }, 'Price per point'),
    el('div', { class: 'table-wrap tall' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Product'), el('th', { class: 'num opt' }, 'Models'), el('th', { class: 'num opt' }, '≈ Points'),
        el('th', { class: 'num' }, 'Price'), el('th', { class: 'num' }, '$/model'), el('th', { class: 'num' }, '$/pt'), el('th', { class: 'opt' }, ''))),
      el('tbody', {}, rows.map((p, i) => {
        const price = p.best?.deal.price ?? p.msrp; const rrp = !p.best;
        return el('tr', { class: i === 0 ? 'best' : null },
          el('td', {}, dot(p.faction), ' ', el('button', { type: 'button', class: 'linkish', onclick: () => openProduct(p.id) }, p.name)),
          el('td', { class: 'num opt' }, p.models ?? '—'), el('td', { class: 'num opt' }, p.points ?? '—'),
          el('td', { class: 'num' }, money(price), rrp ? el('span', { class: 'cell-sub' }, 'RRP') : null),
          el('td', { class: 'num' }, p.models ? money(price / p.models) : '—'),
          el('td', { class: 'num' }, ppts(p) != null ? `$${ppts(p).toFixed(3)}` : '—'),
          el('td', { class: 'opt', style: { minWidth: '90px' } }, ppts(p) != null ? el('div', { class: 'bar', style: { '--pct': `${Math.round((ppts(p) / maxP) * 100)}%` } }, el('span')) : null));
      })))));
}

/* ---- stores & method ---- */
async function renderStores() {
  const panel = $('panel-stores'); const ov = state.overview;
  const a = ov?.assumptions;
  const stores = ov?.stores ?? [];
  const table = stores.length ? el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Store'), el('th', {}, 'Status'), el('th', {}, 'Last success'), el('th', { class: 'num' }, 'Listings'),
      el('th', { class: 'opt' }, 'Shipping to you (est.)'))),
    el('tbody', {}, stores.map((s) => el('tr', {},
      el('td', {}, s.name, s.caution ? el('span', { class: 'cell-sub text-warn' }, s.caution) : null),
      el('td', {}, el('span', { class: `badge ${s.status === 'ok' ? 'good' : s.status === 'error' || s.blocked ? 'bad' : 'warn'}`, title: s.reason ?? '' },
        s.blocked ? 'Avoided' : s.status === 'ok' ? 'OK' : s.status === 'error' ? 'Failed' : s.status === 'skipped' ? 'Not searched' : 'Unknown'),
      s.reason || s.stoppedReason ? el('span', { class: 'cell-sub' }, s.stoppedReason ?? s.reason) : null),
      el('td', {}, ago(s.lastOkAt), s.stale ? el('span', { class: 'cell-sub text-warn' }, 'stale') : null),
      el('td', { class: 'num' }, String(s.offers)),
      el('td', { class: 'opt' }, s.shipping ? `${money(s.shipping.flat)}${s.shipping.freeOver != null ? `, free over ${money(s.shipping.freeOver)}` : ''}` : '—',
        el('span', { class: 'cell-sub' }, s.shipping?.conf === 'low' ? 'rough estimate' : '')))))))
    : null;
  fill(panel, el('div', { class: 'stack' },
    el('h3', { class: 'section-title' }, 'Price data freshness'), table ?? el('p', { class: 'muted' }, 'No snapshot loaded.'),
    a ? el('div', { class: 'card stack tight' }, el('div', { class: 'card-title' }, 'How deals are worked out'),
      el('p', {}, a.dealScore),
      el('p', { class: 'small' }, `Sales tax: ${a.salesTax}, charged by US stores (they meet Washington’s economic-nexus rules) on goods and shipping. `
        + `Overseas stores: ${Object.values(a.importDuty).join(' ')}`),
      el('p', { class: 'small' }, `Shipping: ${a.shipping}, per store above. RRP: ${a.rrp}; each product shows our confidence in its figure.`),
      el('p', { class: 'small' }, 'Listings that are used, bits, upgrade sprues, 3rd-party/3D-printed, bundles or from other chapters/factions are excluded; '
        + 'prices below 55% of RRP are flagged “Too good to be true?” and never chosen as the best deal.')) : null,
    el('div', { class: 'card stack tight', id: 'trust-box' }, el('div', { class: 'card-title' }, 'Which stores are searched, and why they’re trusted'),
      el('p', { class: 'muted' }, 'Loading…'))));
  try {
    const data = await getJson('/api/prices/retailers');
    state.retailers = data.retailers;
    const box = $('trust-box'); if (!box) return;
    const p = data.policy;
    fill(box, el('div', { class: 'card-title' }, 'Which stores are searched, and why they’re trusted'),
      el('p', { class: 'small' }, p.domainRule), el('p', { class: 'small' }, p.suspiciousRule), el('p', { class: 'small muted' }, p.excluded),
      el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Store'), el('th', {}, 'Region'), el('th', {}, 'Why trusted'))),
        el('tbody', {}, data.retailers.map((r) => el('tr', {},
          el('td', {}, r.name, el('span', { class: 'cell-sub' }, r.tier === 'official' ? 'Official' : 'Trusted stockist')),
          el('td', {}, `${r.region} · ${r.currency}`),
          el('td', {}, r.notes, el('span', { class: 'cell-sub' }, r.shippingNote), r.liveLookups ? null : el('span', { class: 'cell-sub' }, r.liveDisabledReason ?? 'Live lookups disabled'))))))));
  } catch { /* keep "Loading…" replaced below */ const box = $('trust-box'); if (box) box.lastChild.textContent = 'Could not load the store list.'; }
}

/* ------------------------------------------------------------------ render dispatch */
function render() {
  renderStatus();
  updateCounts();
  switch (state.tab) {
    case 'deals': renderDeals(); break;
    case 'browse': renderBrowse(); break;
    case 'product': renderProduct(); break;
    case 'cart': renderCart(); break;
    case 'watch': renderWatch(); break;
    case 'value': renderValue(); break;
    case 'search': renderSearchPanel(); break;
    case 'stores': renderStores(); break;
    default: break;
  }
}

/* ------------------------------------------------------------------ browse filter wiring */
function setupFilters() {
  const f = state.prefs.filters ?? {};
  const fac = $('f-faction');
  const groups = new Map();
  for (const x of state.catalog.factions) {
    if (!state.catalog.products.some((p) => p.faction === x.id)) continue;
    if (!groups.has(x.group)) groups.set(x.group, el('optgroup', { label: x.group }));
    groups.get(x.group).append(el('option', { value: x.id }, x.name));
  }
  fac.append(...groups.values());
  fill($('f-cat'), ...state.catalog.categories.map((c) => el('button', { type: 'button', class: 'chip', 'data-cat': c.id,
    'aria-pressed': String((f.cats ?? []).includes(c.id)), title: c.blurb,
    onclick: (e) => { const b = e.currentTarget; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); renderBrowse(); } }, c.name)));
  const stores = (state.overview?.stores ?? []).filter((s) => s.status !== 'skipped' && !s.blocked);
  $('f-store').append(...stores.map((s) => el('option', { value: s.id }, s.name)));
  if (f.faction) fac.value = f.faction;
  if (f.max) $('f-max').value = f.max;
  if (f.store) $('f-store').value = f.store;
  if (typeof f.stock === 'boolean') $('f-stock').checked = f.stock;
  if (typeof f.trusted === 'boolean') $('f-trusted').checked = f.trusted;
  if (typeof f.withOffers === 'boolean') $('f-offers').checked = f.withOffers;
  if (f.sort) for (const b of $('f-sort').children) b.setAttribute('aria-pressed', String(b.dataset.sort === f.sort));
  const rerender = debounce(renderBrowse, 120);
  for (const id of ['f-faction', 'f-store', 'f-stock', 'f-trusted', 'f-offers']) $(id).addEventListener('change', renderBrowse);
  $('f-max').addEventListener('input', rerender);
  $('f-sort').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]'); if (!b) return;
    for (const x of $('f-sort').children) x.setAttribute('aria-pressed', String(x === b));
    renderBrowse();
  });
  $('f-reset').addEventListener('click', () => {
    fac.value = ''; $('f-max').value = ''; $('f-store').value = ''; $('f-stock').checked = true; $('f-trusted').checked = false; $('f-offers').checked = true;
    for (const b of $('f-cat').children) b.setAttribute('aria-pressed', 'false');
    for (const b of $('f-sort').children) b.setAttribute('aria-pressed', String(b.dataset.sort === 'score'));
    renderBrowse();
  });
}

/* ------------------------------------------------------------------ load */
async function loadOverview() {
  try {
    state.overview = await getJson('/api/prices/overview');
  } catch (err) {
    state.overview = null;
    if (err.status !== 404) toast(`Could not load prices: ${err.message}`, 'bad');
  }
  // A snapshot with no offers at all (fresh static build) is "no data".
  if (state.overview && !state.overview.snapshot.generatedAt && !state.overview.snapshot.offers) state.overview = null;
  state.products = new Map((state.overview?.products ?? []).map((p) => [p.id, p]));
  if (state.overview) $('home-label').textContent = state.overview.home?.label ?? 'Seattle, WA';
  $('disclaimer').textContent = state.overview?.disclaimer ?? '';
  cartDirty = true;
}
async function setDemo(on) {
  state.demo = on;
  state.prefs.demo = on; store.set(K.prefs, state.prefs);
  const u = new URL(location.href);
  if (on) u.searchParams.set('demo', '1'); else u.searchParams.delete('demo');
  history.replaceState(null, '', u);
  await loadOverview();
  render();
}

(async function init() {
  const u = new URLSearchParams(location.search);
  if (!STATIC) {
    $('demo-wrap').hidden = false;
    state.demo = u.get('demo') === '1' || (u.get('demo') == null && !!state.prefs.demo);
    $('demo').checked = state.demo;
    $('demo').addEventListener('change', (e) => setDemo(e.target.checked));
  }
  try { state.catalog = await getJson('/api/prices/catalog'); } catch (err) { toast(`Could not load the catalogue: ${err.message}`, 'bad'); return; }
  await loadOverview();
  setupFilters();
  makeCombo($('q'), $('q-list'), (p) => { $('q').value = ''; openProduct(p.id); });
  // Legacy links (?q=...) open the matching product, else the store search.
  const legacy = u.get('q');
  const hash = location.hash.slice(1);
  if (hash.startsWith('product=')) { openProduct(decodeURIComponent(hash.slice(8))); }
  else if (legacy) {
    const m = bestMatches(legacy, state.catalog.products, { key: (p) => [p.name, ...(p.aliases ?? [])], limit: 1, threshold: 0.75 })[0];
    if (m) openProduct(m.item.id); else showTab('search');
  } else showTab(TABS.includes(hash) && hash !== 'product' ? hash : (state.prefs.tab ?? 'deals'), { push: false });
  // Watchlist alerts on arrival.
  const hits = state.watch.filter((w) => { const d = state.products.get(w.id)?.best?.deal; return w.target != null && d && d.price <= w.target; });
  if (hits.length) toast(`${hits.length} watched item${hits.length === 1 ? ' is' : 's are'} at or below your target price`, 'good', { timeout: 6000 });
  window.addEventListener('beforeunload', () => store.set(K.prefs, { ...state.prefs, tab: state.tab === 'product' ? 'browse' : state.tab }));
}());
