// Watchlist page: watched kits, target prices, alerts, notifications, RSS.
import { el, toast } from '../ui.js';
import { overview, feedUrl } from './api.js';
import { watch, hits, notifyHits, notifySupported, notifyPermission, enableNotifications } from './watch.js';
import { media, money, money0, fmtDate, productHref, dataBanners, emptyState, icon, plural, changeBadge, lowBadge, productCard, rail } from './kit.js';
import { sparkline } from './chart.js';

const $ = (id) => document.getElementById(id);
let ov = null;

function tools() {
  const perm = notifyPermission();
  const notifBtn = !notifySupported() ? null
    : perm === 'granted' ? el('span', { class: 'badge good' }, icon('bell', 'ico xs'), 'Browser alerts on')
      : perm === 'denied' ? el('span', { class: 'badge warn', title: 'Allow notifications for this site in your browser settings' }, 'Browser alerts blocked')
        : el('button', { type: 'button', class: 'btn secondary sm', onclick: async () => {
          const r = await enableNotifications();
          toast(r === 'granted' ? 'Browser alerts on: you’ll get one when a watched kit hits its target while this site is open.' : 'Notifications were not allowed.', r === 'granted' ? 'good' : 'warn');
          render();
        } }, icon('bell'), 'Turn on browser alerts');
  $('wl-tools').replaceChildren(notifBtn,
    el('a', { class: 'btn ghost sm', href: feedUrl(), type: 'application/rss+xml' }, icon('rss'), 'RSS: new lows & drops'),
    el('span', { class: 'spacer' }),
    watch.list().length ? el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { if (confirm('Remove every kit from your watchlist?')) { watch.clear(); render(); } } }, 'Clear all') : null);
}

function row(w) {
  const p = ov?.byId.get(w.id);
  const name = p?.name ?? w.id;
  const price = p?.best?.price ?? null;
  const hit = w.target != null && price != null && p.best.inStock !== false && price <= w.target + 0.005;
  const input = el('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', value: w.target ?? '', placeholder: price ? String(Math.floor(price * 0.9)) : 'none',
    'aria-label': `Target price for ${name}` });
  input.addEventListener('change', () => { watch.setTarget(w.id, input.value === '' ? null : Number(input.value)); render(); });
  const since = w.priceAtAdd != null && price != null && Math.abs(price - w.priceAtAdd) >= 0.01
    ? el('span', { class: price < w.priceAtAdd ? 'text-good' : 'text-warn' }, `${price < w.priceAtAdd ? '↓' : '↑'} ${money(Math.abs(price - w.priceAtAdd))} since you started watching`) : null;
  return el('div', { class: `wl-row${hit ? ' hit' : ''}` },
    el('a', { class: 'wl-thumb', href: productHref(w.id), tabindex: '-1', 'aria-hidden': 'true' }, p ? media(p, { size: 'sm' }) : null),
    el('div', { class: 'wl-main' },
      el('a', { class: 'name', href: productHref(w.id) }, name),
      el('div', { class: 'wl-meta' },
        price != null ? el('strong', { class: 'text-accent', style: { fontSize: '1rem', color: 'var(--text)' } }, money(price)) : el('span', {}, 'No in-stock price'),
        p?.best ? el('span', {}, `${money(p.best.delivered)} delivered · ${p.best.retailerName}`) : null,
        p?.rrp && p.best?.pctOff > 0 ? el('span', { class: 'savings' }, `−${Math.round(p.best.pctOff)}% vs RRP`) : null),
      el('div', { class: 'wl-meta' },
        hit ? el('span', { class: 'badge good' }, icon('bell', 'ico xs'), 'Target reached') : w.target != null && price != null ? el('span', { class: 'badge info' }, `${money(price - w.target)} above target`) : el('span', { class: 'badge' }, w.target == null ? 'No target set' : 'Waiting for stock'),
        p ? lowBadge(p) : null, p ? changeBadge(p.change7d) : null, since,
        el('span', {}, `watching since ${fmtDate(w.addedAt)}`))),
    el('div', { class: 'wl-side' },
      p?.history?.length > 1 ? sparkline(p.history) : null,
      el('div', { class: 'input-group' }, el('span', { class: 'addon' }, '$'), input),
      el('button', { type: 'button', class: 'btn ghost sm icon', 'aria-label': `Stop watching ${name}`, title: 'Remove', onclick: () => { watch.remove(w.id); render(); } }, icon('close'))));
}

function render() {
  tools();
  const list = watch.list();
  if (!list.length) {
    const sug = (ov?.newLows?.length ? ov.newLows : ov?.topDeals ?? []).slice(0, 10);
    $('wl-root').replaceChildren(emptyState('Nothing watched yet', 'Tap the ☆ on any kit to watch it, then set a target price here or on the product page.',
      el('a', { class: 'btn sm', href: 'deals.html' }, 'Browse deals')),
    sug.length ? el('section', { class: 'sec' }, el('div', { class: 'sec-head' }, el('h2', {}, 'Worth watching')), rail(sug.map((p) => productCard(p, { view: 'rail', categoryName: ov.categoryName })), 'Worth watching')) : null);
    // Starring from the suggestions should refresh the list.
    return;
  }
  const h = ov ? hits(ov.byId) : [];
  const sorted = [...list].sort((a, b) => {
    const ha = h.some((x) => x.w.id === a.id); const hb = h.some((x) => x.w.id === b.id);
    return (hb - ha) || String(b.addedAt).localeCompare(String(a.addedAt));
  });
  const total = sorted.reduce((t, w) => t + (ov?.byId.get(w.id)?.best?.price ?? 0), 0);
  $('wl-root').replaceChildren(
    h.length ? el('div', { class: 'alert-banner', role: 'status' }, icon('bell'), el('strong', {}, `${plural(h.length, 'kit')} at or below your target`),
      el('span', { class: 'muted' }, 'Prices change quickly; check the store before buying.')) : null,
    el('div', { class: 'row tight muted small' }, `${plural(list.length, 'kit')} watched`, total ? ` · ${money0(total)} at today’s best prices` : ''),
    ...sorted.map(row),
    el('p', { class: 'hint' }, 'Targets compare with the best in-stock item price (before shipping and tax). Your watchlist is stored in this browser only; prices update when the site refreshes. Alerts appear on this site; browser alerts also need this site open in a tab.'));
  if (ov) notifyHits(h, { sample: !!ov.snapshot.demo });
}

watch.onChange(() => { if (document.visibilityState === 'visible') render(); });
(async () => {
  try { ov = await overview(); $('banners').replaceChildren(...dataBanners(ov)); } catch (err) { toast(`Could not load prices: ${err.message}`, 'bad'); }
  render();
})();
