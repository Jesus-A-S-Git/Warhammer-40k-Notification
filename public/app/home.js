// Home: the deal hub. Hero search -> new lows -> drops -> top deals -> factions -> categories.
import { el, toast } from '../ui.js';
import { overview } from './api.js';
import { combobox } from './search.js';
import { productCard, skeletonCards, rail, dataBanners, freshnessLine, money0, plural, factionHref, dealsHref, icon, emptyState } from './kit.js';
import { hits, notifyHits } from './watch.js';

const $ = (id) => document.getElementById(id);

// Search first: usable before prices arrive.
const hs = $('hs');
combobox(hs, $('hs-list'));
$('hs-go').addEventListener('click', (e) => {
  const q = hs.value.trim();
  if (q.length >= 2) { e.preventDefault(); location.href = dealsHref({ q }); }
});

// Skeletons while the overview loads.
const lowsTrack = $('rail-lows').querySelector('.rail-track');
const dropsTrack = $('rail-drops').querySelector('.rail-track');
lowsTrack.append(...skeletonCards(6, 'rail'));
dropsTrack.append(...skeletonCards(6, 'rail'));
$('top-grid').append(...skeletonCards(8));
$('fac-grid').append(...Array.from({ length: 8 }, () => el('div', { class: 'ftile skeleton', 'aria-hidden': 'true' })));

const CAT_ICON = {
  'combat-patrol': '<path d="M12 3 4 6v6c0 4.6 3.3 8.4 8 9 4.7-.6 8-4.4 8-9V6Z"/>',
  starter: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 11h18M9 7V4h6v3"/>',
  battleforce: '<path d="M3 8l9-5 9 5-9 5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  codex: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  kit: '<circle cx="12" cy="9" r="5"/><path d="M7 21v-2a5 5 0 0 1 10 0v2"/>',
  paint: '<path d="M8 3h8v4H8zM7 7h10v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1Z"/>',
};

function factionTiles(ov) {
  const kids = new Map();
  for (const f of ov.factions) if (f.parent) kids.set(f.parent, [...(kids.get(f.parent) ?? []), f.id]);
  const rows = ov.facets.factions.map((f) => {
    const ids = new Set([f.id, ...(kids.get(f.id) ?? [])]);
    const ps = ov.products.filter((p) => ids.has(p.faction));
    const best = Math.max(0, ...ps.map((p) => p.best?.pctOff ?? 0));
    return { f, n: ps.length, best, priced: ps.filter((p) => p.best).length };
  }).filter((x) => x.n > 0 && !['multi', 'hobby'].includes(x.f.id));
  rows.sort((a, b) => b.n - a.n || a.f.name.localeCompare(b.f.name));
  return rows.map(({ f, n, best, priced }) => el('a', { class: 'ftile', href: factionHref(f.id), style: { '--fc': f.color || 'var(--muted)' } },
    f.group ? el('span', { class: 'ft-group' }, f.group) : null,
    best >= 5 ? el('span', { class: 'off-badge ft-best', title: 'Best discount in this faction' }, `up to −${Math.round(best)}%`) : null,
    el('span', { class: 'ft-name' }, f.name),
    el('span', { class: 'ft-meta' }, `${plural(n, 'product')}${priced ? ` · ${priced} priced` : ''}`)));
}

function categoryTiles(ov) {
  return ov.facets.categories.filter((c) => c.count > 0).map((c) => {
    const ps = ov.products.filter((p) => p.category === c.id && p.best);
    const from = ps.length ? Math.min(...ps.map((p) => p.best.price)) : null;
    const ico = el('span', { class: 'ct-ico', 'aria-hidden': 'true' });
    ico.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${CAT_ICON[c.id] ?? CAT_ICON.kit}</svg>`;
    return el('a', { class: 'ctile', href: dealsHref({ cat: c.id }) }, ico,
      el('span', {}, el('strong', {}, c.name), el('span', { class: 'ct-sub' }, `${plural(c.count, 'product')}${from != null ? ` · from ${money0(from)}` : ''}`)));
  });
}

function fillRail(container, list, label, fallbackText) {
  const sec = container.closest('section');
  if (!list.length) {
    container.replaceChildren(emptyState(fallbackText, 'History builds up with each daily refresh.'));
    if (sec) sec.classList.add('is-empty');
    return;
  }
  container.replaceWith(Object.assign(rail(list.map((p) => productCard(p, { view: 'rail', categoryName })), label), { id: container.id }));
}
let categoryName = (c) => c;

(async function init() {
  let ov;
  try { ov = await overview(); } catch (err) {
    toast(`Could not load prices: ${err.message}`, 'bad');
    for (const id of ['top-grid', 'fac-grid']) $(id).replaceChildren(emptyState('Prices are unavailable right now', 'Try again in a minute.'));
    return;
  }
  categoryName = ov.categoryName;
  $('banners').replaceChildren(...dataBanners(ov));
  $('hero-fresh').replaceChildren(freshnessLine(ov));

  // Watchlist alerts.
  const h = hits(ov.byId);
  if (h.length) {
    $('banners').append(el('div', { class: 'alert-banner', role: 'status' }, icon('bell'),
      el('strong', {}, `${plural(h.length, 'watched kit')} at or below your target`),
      el('span', { class: 'muted' }, h.slice(0, 3).map(({ p }) => p.name).join(', ')),
      el('a', { class: 'btn sm', href: 'watchlist.html', style: { marginLeft: 'auto' } }, 'Open watchlist')));
    notifyHits(h, { sample: !!ov.snapshot.demo });
  }

  fillRail($('rail-lows'), ov.newLows, 'New all-time lows', 'No new lows right now');
  fillRail($('rail-drops'), ov.drops, 'Biggest price drops', 'No price drops this week');

  const top = ov.topDeals.length ? ov.topDeals : ov.products.filter((p) => p.popular).slice(0, 12);
  $('top-grid').replaceChildren(...(top.length ? top.slice(0, 10).map((p, i) => productCard(p, { categoryName, eager: i < 4 }))
    : [emptyState('No deals yet', 'Deals appear after the first price refresh.')]));
  $('top-grid').classList.add('reveal');
  $('fac-grid').replaceChildren(...factionTiles(ov));
  $('cat-grid').replaceChildren(...categoryTiles(ov));
}());
