// Product page: product.html?id=<productId>. Shareable, works on both builds.
import { el, toast } from '../ui.js';
import { product as getProduct, unitsBrief, overview, storage } from './api.js';
import { resolveUnit } from '../lib/combat/unitSearch.js';
import {
  money, ago, fmtDate, plural, media, icon, verdict, verdictPill, changeBadge, lowBadge, pctBadge,
  productCard, rail, dataBanners, emptyState, factionHref, dealsHref, simHref, watchButton,
} from './kit.js';
import { priceChart } from './chart.js';
import { watch } from './watch.js';

const $ = (id) => document.getElementById(id);
const root = $('pp-root');
const id = new URLSearchParams(location.search).get('id');

function crumbs(p) {
  const sep = () => el('span', { class: 'sep', 'aria-hidden': 'true' }, '/');
  return el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, el('a', { href: './' }, 'Home'), sep(), el('a', { href: 'deals.html' }, 'Deals'),
    p.faction && !['multi', 'hobby'].includes(p.faction) ? [sep(), el('a', { href: factionHref(p.faction) }, p.factionName)] : null,
    sep(), el('span', { 'aria-current': 'page' }, p.name));
}

function buyLink(b, cls = 'btn buy') {
  if (!b?.url) return null;
  return el('a', { class: cls, href: b.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, `Buy at ${b.retailerName}`, icon('ext', 'ico'));
}

function buybox(p, ov) {
  const b = p.best;
  const v = verdict(p);
  const breakdown = b ? [money(b.price), ' item', b.shipping != null ? ` + ${b.shipping ? money(b.shipping) : 'free'} shipping` : '',
    b.tax != null ? ` + ${money(b.tax)} tax` : '', ' at ', el('strong', {}, b.retailerName)] : null;
  return el('div', { class: 'buybox' },
    el('div', { class: 'bb-label' }, b ? 'Best delivered price (est.)' : 'Price'),
    b ? el('div', { class: 'bb-price' }, el('span', { class: 'price' }, money(b.delivered ?? b.price)), verdictPill(v))
      : el('div', { class: 'bb-price' }, el('span', { class: 'price muted-price' }, p.rrp ? money(p.rrp) : '—'), el('span', { class: 'muted' }, p.rrp ? 'RRP · not in stock at a vetted store' : 'No price yet')),
    b ? el('div', { class: 'bb-sub' }, breakdown) : null,
    b ? el('div', { class: 'bb-sub', style: { marginTop: '4px' } },
      p.rrp != null ? [el('span', { class: 'strike' }, `RRP ${money(p.rrp)}`), ' ',
        b.pctOff > 0 ? el('span', { class: 'savings' }, `−${Math.round(b.pctOff)}% · save ${money(b.savings ?? p.rrp - b.price)}`) : el('span', {}, 'no discount')]
        : el('span', {}, 'RRP unknown')) : null,
    el('div', { class: 'bb-actions' }, buyLink(b), watchToggle(p), b ? el('button', { type: 'button', class: 'btn ghost', onclick: () => addToCart(p) }, icon('cart'), 'Add to cart') : null),
    el('div', { class: 'bb-signals' }, lowBadge(p), changeBadge(p.change7d),
      p.offerCount ? el('span', { class: `badge ${p.inStockCount ? 'good' : 'warn'}` }, `${p.inStockCount} of ${p.offerCount} store${p.offerCount === 1 ? '' : 's'} in stock`) : null,
      b?.fetchedAt ? el('span', { class: `badge ${b.carried ? 'warn' : ''}`.trim(), title: new Date(b.fetchedAt).toLocaleString() }, `Checked ${ago(b.fetchedAt)}`) : null,
      b && ov?.snapshot?.demo ? el('span', { class: 'badge bad' }, 'Sample price') : null),
    el('div', { class: `verdict-box ${v.kind}` }, el('strong', {}, `${v.label}: why`), el('ul', {}, v.reasons.map((r) => el('li', {}, r)))));
}

function addToCart(p) {
  const KEY = 'prices.cart.v1';
  let cart = storage.get(KEY, []);
  if (!Array.isArray(cart)) cart = [];
  const it = cart.find((x) => x && x.id === p.id);
  if (it) it.qty = Math.min(99, (Number(it.qty) || 0) + 1); else cart.push({ id: p.id, qty: 1 });
  storage.set(KEY, cart);
  const n = cart.reduce((t, x) => t + (Number(x?.qty) || 0), 0);
  toast(el('span', {}, `Added to your cart (${plural(n, 'item')}). `, el('a', { href: 'prices.html#cart' }, 'Optimise the cart')), 'good', { timeout: 5000 });
}

function watchToggle(p) {
  const b = el('button', { type: 'button', class: 'btn secondary' });
  const sync = () => {
    const on = watch.has(p.id);
    b.setAttribute('aria-pressed', String(on));
    b.replaceChildren(icon(on ? 'starFill' : 'star'), on ? 'Watching' : 'Watch');
  };
  b.addEventListener('click', () => {
    if (watch.has(p.id)) { watch.remove(p.id); toast(`Stopped watching ${p.name}`); }
    else { watch.add(p.id, { price: p.best?.price ?? null }); toast('Watching. Set a target price below to get an alert.', 'good'); }
    sync(); renderWatchForm(p);
  });
  watch.onChange(sync);
  sync();
  return b;
}

function facts(p) {
  const item = (k, v, sub) => el('div', {}, el('dt', {}, k), el('dd', {}, v, sub ? el('small', {}, sub) : null));
  return el('dl', { class: 'kv' },
    item('Lowest tracked', p.lowest?.price != null ? money(p.lowest.price) : '—', p.lowest?.date ? `${fmtDate(p.lowest.date)}${p.atLowest ? ' · that’s now' : ''}` : 'no history yet'),
    item('7-day change', p.change7d ? `${p.change7d.pct > 0 ? '+' : ''}${p.change7d.pct.toFixed(1)}%` : '—', p.change7d ? `${money(p.change7d.from)} → ${money(p.change7d.to)}` : 'not enough history'),
    item('RRP', p.rrp != null ? money(p.rrp) : 'Unknown', p.rrpSource === 'retailer-list' ? 'from store list prices' : p.rrp != null ? `catalogue estimate${p.rrpConf ? `, ${p.rrpConf} confidence` : ''}` : null),
    p.models || p.points ? item(p.models ? 'Models' : 'Points (approx.)', p.models ? String(p.models) : `≈${p.points}`,
      p.best && (p.models || p.points) ? (p.models ? `${money(p.best.price / p.models)} per model` : `$${(p.best.price / p.points).toFixed(3)} per point`) : null) : null);
}

function offersTable(p) {
  const offers = [...(p.offers ?? [])].sort((a, b) => (a.suspicious - b.suspicious) || ((b.inStock === true) - (a.inStock === true)) || ((a.delivered ?? 1e9) - (b.delivered ?? 1e9)));
  if (!offers.length) return emptyState('No listings in the latest snapshot', 'None of the vetted stores listed this kit in the last refresh.');
  const bestUrl = p.best?.url;
  const stock = (s) => (s === true ? el('span', { class: 'badge good' }, 'In stock') : s === false ? el('span', { class: 'badge bad' }, 'Out of stock') : el('span', { class: 'badge warn' }, 'Unknown'));
  return el('div', { class: 'stack tight' }, el('div', { class: 'table-wrap offers' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Store'), el('th', { class: 'num' }, 'Price'), el('th', { class: 'num' }, 'Shipping'), el('th', { class: 'num' }, 'Tax'),
      el('th', { class: 'num' }, 'Delivered'), el('th', {}, 'Stock'), el('th', {}, 'Updated'), el('th', {}, el('span', { class: 'visually-hidden' }, 'Link')))),
    el('tbody', {}, offers.map((o) => el('tr', { class: [o.url && o.url === bestUrl ? 'best' : '', o.suspicious ? 'sus' : ''].filter(Boolean).join(' ') || null },
      el('td', { class: 'c-store' }, el('div', { class: 'store' }, o.retailerName),
        o.url === bestUrl ? el('span', { class: 'badge good', style: { marginTop: '2px' } }, 'Best price') : null,
        o.suspicious ? el('span', { class: 'badge bad', title: 'Far below RRP: may be used, partial or mislabelled. Never picked as the best deal.' }, 'Too good to be true?') : null,
        o.caution ? el('span', { class: 'cell-sub text-warn' }, o.caution) : null),
      el('td', { class: 'num c-detail', 'data-l': 'Item' }, money(o.price), o.pctOff != null && o.pctOff > 0 ? el('span', { class: 'cell-sub savings' }, `−${Math.round(o.pctOff)}%`) : null),
      el('td', { class: 'num c-detail', 'data-l': '+ ship' }, o.shipping == null ? '—' : o.shipping ? money(o.shipping) : 'Free'),
      el('td', { class: 'num c-detail', 'data-l': '+ tax' }, money(o.tax)),
      el('td', { class: 'num c-delivered' }, el('strong', {}, money(o.delivered))),
      el('td', { class: 'c-stock' }, stock(o.inStock)),
      el('td', { class: 'c-hide' }, el('span', { class: o.carried ? 'text-warn' : 'muted' }, o.fetchedAt ? ago(o.fetchedAt) : '—')),
      el('td', { class: 'go' }, o.url ? el('a', { class: 'btn sm secondary', href: o.url, target: '_blank', rel: 'noopener noreferrer nofollow', 'aria-label': `View at ${o.retailerName} (opens in a new tab)` }, 'View', icon('ext', 'ico xs')) : null)))))),
    el('p', { class: 'hint' }, 'Delivered = item + estimated shipping for this item alone + estimated sales tax. Buying several kits? The ', el('a', { href: 'prices.html#cart' }, 'cart optimizer'), ' counts shipping once per store.'));
}

function historySection(p, storeName) {
  const all = p.history ?? [];
  // One point per day: the lowest price seen that day.
  const byDay = new Map();
  for (const h of all) {
    const d = h.t.slice(0, 10);
    if (!byDay.has(d) || h.p < byDay.get(d).p) byDay.set(d, h);
  }
  const days = [...byDay.values()];
  const box = el('div', { class: 'chart-body' });
  let range = 30;
  let lastW = 0;
  const draw = () => {
    const cutoff = days.length ? Date.parse(days.at(-1).t) - range * 864e5 : 0;
    lastW = box.clientWidth || 640;
    box.replaceChildren(priceChart(days.filter((d) => Date.parse(d.t) > cutoff), { rrp: p.rrp, storeName, width: lastW, height: lastW < 520 ? 200 : 240 }));
  };
  // Draw at the real width so labels stay at 11px; redraw on resize.
  new ResizeObserver(() => { if (Math.abs((box.clientWidth || 0) - lastW) > 24) draw(); }).observe(box);
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'History range' }, [7, 30].map((r) => el('button', {
    type: 'button', 'aria-pressed': String(r === range),
    onclick: (e) => { range = r; for (const x of seg.children) x.setAttribute('aria-pressed', String(x === e.currentTarget)); draw(); },
  }, `${r} days`)));
  const few = days.length < 2;
  return el('section', { class: 'pp-section', 'aria-labelledby': 'h-hist' },
    el('div', { class: 'chart-head' }, el('h2', { id: 'h-hist', style: { margin: 0, fontSize: 'var(--fs-lg)' } }, 'Price history'), few || days.length <= 8 ? null : seg),
    el('div', { class: few ? '' : 'card chart-card' }, box,
      few ? null : el('p', { class: 'hint', style: { marginTop: '6px' } }, `Lowest item price across the vetted stores, one point per daily refresh (${plural(days.length, 'day')} recorded). Hover or use the arrow keys to read a day.`)));
}

function rrpNote(p) {
  const ev = p.rrpEvidence ?? [];
  const parts = ev.map((e) => `${money(e.price)} (${e.source === 'retailer-list' ? `list price at ${e.retailerId ?? 'a store'}` : 'our catalogue'})`);
  return el('p', { class: 'hint' }, el('strong', {}, 'About the RRP: '),
    p.rrp == null ? 'No reliable RRP yet. New kits get one once stores show a list price, so the discount is not shown.'
      : `${money(p.rrp)}${parts.length ? `, based on ${parts.join(', ')}` : ''}. Games Workshop changes prices from time to time; treat discounts as approximate.`);
}

let watchFormHost = null;
function renderWatchForm(p) {
  if (!watchFormHost) return;
  const w = watch.get(p.id);
  const input = el('input', { type: 'number', id: 'w-target', min: '0', step: '1', inputmode: 'decimal', value: w?.target ?? '',
    placeholder: p.best ? String(Math.floor(p.best.price * 0.9)) : 'e.g. 100' });
  const save = () => {
    const t = input.value === '' ? null : Number(input.value);
    if (t != null && !(t >= 0)) { toast('Enter a price in dollars.', 'warn'); return; }
    if (!watch.has(p.id)) watch.add(p.id, { target: t, price: p.best?.price ?? null }); else watch.setTarget(p.id, t);
    toast(t == null ? 'Watching without a target.' : `We’ll alert you at ${money(t)} or less.`, 'good');
    renderWatchForm(p);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const hit = w?.target != null && p.best && p.best.price <= w.target;
  watchFormHost.replaceChildren(el('div', { class: 'card stack tight' },
    el('div', { class: 'card-title' }, icon('bell'), 'Price alert'),
    hit ? el('div', { class: 'callout good' }, el('strong', {}, 'Target reached.'), ` ${money(p.best.price)} is at or below your ${money(w.target)} target.`) : null,
    el('div', { class: 'watch-form' },
      el('div', { class: 'field' }, el('label', { for: 'w-target' }, 'Alert me when the item price is at or below'),
        el('div', { class: 'input-group' }, el('span', { class: 'addon' }, '$'), input)),
      el('button', { type: 'button', class: 'btn', onclick: save }, w ? 'Update alert' : 'Watch at this price'),
      w ? el('button', { type: 'button', class: 'btn ghost', onclick: () => { watch.remove(p.id); renderWatchForm(p); } }, 'Remove') : null),
    el('p', { class: 'hint' }, 'Stored in this browser only. Alerts show on this site, and as a browser notification if you turn them on in ', el('a', { href: 'watchlist.html' }, 'your watchlist'), '.')));
}

async function unitsSection(p) {
  const host = el('section', { class: 'pp-section', 'aria-labelledby': 'h-units', hidden: true });
  (async () => {
    let ids = p.units ?? [];
    let units = [];
    try { units = await unitsBrief(); } catch { return; }
    const byId = new Map(units.map((u) => [u.id, u]));
    let found = ids.map((x) => byId.get(x)).filter(Boolean);
    let guessed = false;
    if (!found.length && p.category === 'kit') {
      const stripped = p.name.replace(new RegExp(`^${(p.factionName ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '');
      const pool = units.filter((u) => !p.factionName || u.faction.toLowerCase().includes(p.factionName.toLowerCase().split(' ')[0]) || p.faction === 'multi');
      const u = resolveUnit(pool.length ? pool : units, stripped, { min: 0.82, minCoverage: 0.45 }) || resolveUnit(units, p.name, { min: 0.85 });
      if (u) { found = [u]; guessed = true; }
    }
    if (!found.length) return;
    host.hidden = false;
    host.append(el('h2', { id: 'h-units' }, 'Datasheets in this box'),
      el('div', { class: 'unit-chips' }, found.slice(0, 8).map((u) => [
        el('a', { class: 'unit-chip', href: simHref(u.id, 'attacker') }, icon('dice'), `Simulate ${u.name}`),
        el('a', { class: 'unit-chip', href: simHref(u.id, 'defender') }, icon('shield'), `${u.name} as the target`)])),
      el('p', { class: 'hint', style: { marginTop: '8px' } }, guessed ? 'Matched by name; the box may build other options too.' : 'Opens the damage simulator with this unit preloaded.'));
  })();
  return host;
}

function stickyBar(p) {
  const b = p.best;
  if (!b?.url) return null;
  const bar = el('div', { class: 'buybar', role: 'region', 'aria-label': 'Quick buy' },
    el('div', { class: 'bbar-price' }, el('strong', {}, money(b.delivered ?? b.price)), el('span', {}, `delivered · ${b.retailerName}`)),
    watchButton(p, { small: false }),
    el('a', { class: 'btn buy', href: b.url, target: '_blank', rel: 'noopener noreferrer nofollow', 'aria-label': `Buy at ${b.retailerName} (opens in a new tab)` }, 'Buy now', icon('ext', 'ico')));
  document.body.classList.add('has-buybar');
  // Show once the main buy button scrolls away.
  const io = new IntersectionObserver(([e]) => bar.classList.toggle('show', !e.isIntersecting), { threshold: 0 });
  requestAnimationFrame(() => { const t = document.querySelector('.buybox .btn.buy'); if (t) io.observe(t); });
  return bar;
}

(async () => {
  if (!id) { root.replaceChildren(emptyState('No product selected', 'Pick a kit from the deals page.', el('a', { class: 'btn sm', href: 'deals.html' }, 'Browse deals'))); return; }
  let r;
  try { r = await getProduct(id); } catch (err) {
    root.removeAttribute('aria-busy');
    root.replaceChildren(err.status === 404
      ? emptyState('We don’t track that product', 'It may have been renamed or removed from the catalogue.', el('a', { class: 'btn sm', href: dealsHref({ q: id.replace(/-/g, ' ') }) }, 'Search for it'))
      : emptyState('Could not load this product', err.message));
    return;
  }
  const ov = await overview().catch(() => null);
  const p = r.product;
  const storeName = (rid) => ov?.stores.find((s) => s.id === rid)?.name ?? (p.offers ?? []).find((o) => o.retailerId === rid)?.retailerName ?? rid;
  document.title = `${p.name}${p.best ? ` · ${money(p.best.price)}` : ''} · 40k Toolkit`;
  watchFormHost = el('div');
  const tags = el('div', { class: 'pp-tags' },
    p.faction && !['multi', 'hobby'].includes(p.faction) ? el('a', { class: 'tag', href: factionHref(p.faction) }, el('span', { class: 'faction-dot', style: { '--c': p.factionColor || 'var(--muted)' } }), p.factionName) : null,
    el('a', { class: 'tag', href: dealsHref({ cat: p.category }) }, ov?.categoryName(p.category) ?? p.category),
    p.models ? el('span', { class: 'tag' }, plural(p.models, 'model')) : null,
    p.points ? el('span', { class: 'tag', title: 'Approximate; points change with balance updates' }, `≈${p.points} pts`) : null);
  const mediaBox = el('div', { class: 'pp-media' }, media(p, { size: 'lg', eager: true }), pctBadge(p.best?.pctOff));
  const related = (p.related ?? []).filter(Boolean);
  root.removeAttribute('aria-busy');
  root.replaceChildren(...[
    crumbs(p),
    el('div', { class: 'stack tight', style: { marginBottom: '16px' } }, dataBanners(ov ?? { snapshot: r.snapshot, hasPrices: true })),
    el('div', { class: 'pp' },
      el('div', { class: 'pp-left stack' }, mediaBox, el('div', { class: 'pp-facts stack' }, facts(p), p.blurb ? el('p', { class: 'muted small', style: { margin: 0 } }, p.blurb) : null)),
      el('div', { class: 'pp-info' }, tags, el('h1', { class: 'pp-title' }, p.name), buybox(p, ov), el('div', { style: { marginTop: '16px' } }, watchFormHost))),
    historySection(p, storeName),
    el('section', { class: 'pp-section', 'aria-labelledby': 'h-offers' }, el('h2', { id: 'h-offers' }, `Offers from vetted stores`, el('span', { class: 'badge' }, String((p.offers ?? []).length))), offersTable(p), rrpNote(p)),
    await unitsSection(p),
    related.length ? el('section', { class: 'pp-section', 'aria-labelledby': 'h-rel' }, el('h2', { id: 'h-rel' }, 'Related kits'),
      rail(related.map((x) => productCard(x, { view: 'rail', categoryName: ov?.categoryName ?? ((c) => c) })), 'Related kits')) : null,
    r.derived ? el('p', { class: 'hint', style: { marginTop: '24px' } }, 'Some details are derived from the deals overview; full offer data appears after the next site update.') : null,
  ].filter(Boolean));
  renderWatchForm(p);
  const bar = stickyBar(p);
  if (bar) document.body.append(bar);
})();

