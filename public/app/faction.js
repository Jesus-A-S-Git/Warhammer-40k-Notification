// Factions: index of all armies (no id) or one faction's shop (?id=...).
import { el, toast } from '../ui.js';
import { overview, faction as getFaction } from './api.js';
import { mountBrowse, browseSkeleton } from './browse.js';
import { skeletonCards, dataBanners, emptyState, factionHref, plural, money0, verdict } from './kit.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');

function tile(f, ps) {
  const best = Math.max(0, ...ps.map((p) => p.best?.pctOff ?? 0));
  const from = ps.filter((p) => p.best).map((p) => p.best.price);
  return el('a', { class: 'ftile', href: factionHref(f.id), style: { '--fc': f.color || 'var(--muted)' } },
    best >= 5 ? el('span', { class: 'off-badge ft-best' }, `up to −${Math.round(best)}%`) : null,
    el('span', { class: 'ft-name' }, f.name),
    el('span', { class: 'ft-meta' }, `${plural(ps.length, 'product')}${from.length ? ` · from ${money0(Math.min(...from))}` : ''}`));
}

async function index(ov) {
  const byGroup = new Map();
  for (const f of ov.facets.factions) {
    if (['multi', 'hobby'].includes(f.id)) continue;
    const ps = ov.products.filter((p) => p.faction === f.id);
    if (!ps.length) continue;
    if (!byGroup.has(f.group)) byGroup.set(f.group, []);
    byGroup.get(f.group).push(tile(f, ps));
  }
  $('fac-body').replaceChildren(...[...byGroup].map(([g, tiles]) => el('section', { class: 'sec', 'aria-label': g },
    el('div', { class: 'sec-head' }, el('h2', {}, g || 'Other')), el('div', { class: 'tile-grid' }, tiles))));
}

async function one(ov) {
  let fac; let products;
  try {
    const r = await getFaction(id);
    fac = { ...ov.factionById.get(id), ...r.faction };
    const kids = new Set([...(r.faction.children ?? []), ...ov.factions.filter((x) => x.parent === id).map((x) => x.id)]);
    const ids = new Set(r.products.map((p) => p.id));
    products = [...r.products, ...ov.products.filter((p) => kids.has(p.faction) && !ids.has(p.id))];
  } catch (err) {
    if (err.status === 404) {
      $('fac-body').replaceChildren(emptyState('Unknown faction', 'That army is not in the catalogue.', el('a', { class: 'btn sm', href: 'faction.html' }, 'All factions')));
      return;
    }
    throw err;
  }
  document.title = `${fac.name} deals · 40k Toolkit`;
  const priced = products.filter((p) => p.best);
  const best = [...priced].sort((a, b) => (b.best.pctOff ?? 0) - (a.best.pctOff ?? 0))[0];
  const lows = products.filter((p) => p.atLowest).length;
  const cp = products.find((p) => p.category === 'combat-patrol' && p.best);
  const stat = (label, value, sub) => el('div', { class: 'stat' }, el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value), sub ? el('div', { class: 'stat-sub' }, sub) : null);
  const kidsList = ov.factions.filter((x) => x.parent === id);
  $('fac-root').replaceChildren(
    el('header', { class: 'fac-hero', style: { '--fc': fac.color || 'var(--muted)' } },
      el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, el('a', { href: './' }, 'Home'), el('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
        el('a', { href: 'faction.html' }, 'Factions'), el('span', { class: 'sep', 'aria-hidden': 'true' }, '/'), el('span', { 'aria-current': 'page' }, fac.name)),
      el('div', { class: 'row tight' }, el('span', { class: 'faction-dot', style: { '--c': fac.color } }), el('span', { class: 'muted small' }, fac.group ?? '')),
      el('h1', {}, fac.name),
      el('p', { class: 'lede', style: { margin: 0 } }, `${plural(products.length, 'kit')} tracked across vetted US stores${kidsList.length ? `, including ${kidsList.map((k) => k.name).join(', ')}` : ''}.`),
      el('div', { class: 'stats' },
        stat('Priced now', `${priced.length}`, `of ${products.length} kits`),
        stat('Best discount', best ? `−${Math.round(best.best.pctOff ?? 0)}%` : '—', best ? best.name : 'no stock yet'),
        stat('At all-time low', `${lows}`, lows ? 'kits at their lowest' : 'none right now'),
        cp ? stat('Combat Patrol', money0(cp.best.price), verdict(cp).label) : null),
      kidsList.length ? el('div', { class: 'chips', style: { marginTop: '14px' } }, kidsList.map((k) => el('a', { class: 'chip', href: factionHref(k.id) }, el('span', { class: 'faction-dot', style: { '--c': k.color } }), k.name))) : null),
    el('div', { id: 'banners', class: 'stack tight', style: { marginBottom: '16px' } }, dataBanners(ov)),
    el('div', { id: 'browse' }));
  mountBrowse({ root: $('browse'), ov, products, lockFaction: id, keep: { id } });
}

(async () => {
  if (id) browseSkeleton($('fac-body'), skeletonCards(8));
  try {
    const ov = await overview();
    if ($('banners')) $('banners').replaceChildren(...dataBanners(ov));
    if (id) await one(ov); else await index(ov);
  } catch (err) {
    toast(`Could not load prices: ${err.message}`, 'bad');
    $('fac-body')?.replaceChildren(emptyState('Prices are unavailable right now', err.message));
  }
})();
