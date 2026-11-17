// Shared UI building blocks for the shop pages: product cards, fallback art,
// price signals, deal verdicts, skeletons, banners. Retailer strings are only
// ever inserted as text; links and images are https-only.
import { el, fmtMoney } from '../ui.js';
import { safeHttps, demo, setDemo, STATIC } from './api.js';
import { watch } from './watch.js';

export const money = (n) => fmtMoney(n, 'USD');
export const money0 = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? (Math.abs(n - Math.round(n)) < 0.005 ? `$${Math.round(n).toLocaleString()}` : money(n)) : '—');
export function ago(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return 'unknown';
  const m = Math.max(0, (Date.now() - t) / 60_000);
  if (m < 2) return 'just now';
  if (m < 90) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
export const fmtDate = (iso, opts = { month: 'short', day: 'numeric' }) => {
  const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined, opts);
};
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ links */
export const productHref = (id) => `product.html?id=${encodeURIComponent(id)}`;
export const factionHref = (id) => `faction.html?id=${encodeURIComponent(id)}`;
export const dealsHref = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const s = q.toString();
  return `deals.html${s ? `?${s}` : ''}`;
};
export const simHref = (unitId, side = 'attacker') => `combat.html?${side}=${encodeURIComponent(unitId)}`;

/* ------------------------------------------------------------------ icons */
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
export const ICON = {
  star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>'),
  starFill: svg('<path fill="currentColor" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
  filter: svg('<path d="M4 5h16l-6 8v5l-4 2v-7Z"/>'),
  dice: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="16" cy="16" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="16" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="16" r="1.1" fill="currentColor"/>'),
  scroll: svg('<path d="M8 3h10a2 2 0 0 1 2 2v1H8M8 3a2 2 0 0 0-2 2v13a3 3 0 0 1-3 3h12a3 3 0 0 0 3-3V6M10 9h6M10 13h6"/>'),
  cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4ZM10 20a2 2 0 0 0 4 0"/>'),
  rss: svg('<path d="M5 19h.01M5 12a7 7 0 0 1 7 7M5 5a14 14 0 0 1 14 14"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 4.6 3.3 8.4 8 9 4.7-.6 8-4.4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  chevL: svg('<path d="m15 6-6 6 6 6"/>'),
  chevR: svg('<path d="m9 6 6 6-6 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
};
export function icon(name, cls = 'ico') {
  const s = el('span', { class: cls, 'aria-hidden': 'true' });
  s.innerHTML = ICON[name] ?? '';
  return s;
}

const CAT_GLYPH = {
  'combat-patrol': '<path d="M12 3 4 6v6c0 4.6 3.3 8.4 8 9 4.7-.6 8-4.4 8-9V6Z"/>',
  starter: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 11h18M9 7V4h6v3"/>',
  battleforce: '<path d="M3 8l9-5 9 5-9 5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  codex: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  kit: '<circle cx="12" cy="9" r="5"/><path d="M7 21v-2a5 5 0 0 1 10 0v2M9.5 9h5"/>',
  paint: '<path d="M8 3h8v4H8zM7 7h10v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1Z"/><path d="M7 12h10"/>',
};

/* ------------------------------------------------------------------ art + images */
const STOP = new Set(['the', 'of', 'and', 'a', 'set', 'box', 'edition', 'warhammer', '40', '000', '40k']);
export function initials(name, factionName = '') {
  let s = String(name ?? '');
  if (factionName && s.toLowerCase().includes(factionName.toLowerCase()) && s.length > factionName.length + 3) {
    s = s.replace(new RegExp(factionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  }
  const words = s.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  if (words.length === 1 && factionName) return `${factionName[0]}${words[0][0]}`.toUpperCase();
  return (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
}

/** Faction-coloured placeholder for products without an image. */
export function art(p, { size = '' } = {}) {
  const color = p.factionColor || '#7a6a4a';
  const glyph = el('span', { class: 'art-glyph', 'aria-hidden': 'true' });
  glyph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${CAT_GLYPH[p.category] ?? CAT_GLYPH.kit}</svg>`;
  return el('span', { class: `art ${size}`.trim(), style: { '--fc': color }, role: 'img', 'aria-label': `${p.name} (no photo)` },
    glyph, el('span', { class: 'art-initials', 'aria-hidden': 'true' }, initials(p.name, p.factionName)));
}

/** Product image (lazy, no referrer) that swaps to the fallback art if it fails. */
export function media(p, { size = '', eager = false } = {}) {
  const src = safeHttps(p.imageUrl);
  if (!src) return art(p, { size });
  const img = el('img', { src, alt: p.name, loading: eager ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', class: 'media-img' });
  img.addEventListener('error', () => img.replaceWith(art(p, { size })), { once: true });
  return img;
}

/* ------------------------------------------------------------------ signals */
export function pctBadge(pct, cls = '') {
  if (pct == null || pct <= 0) return null;
  return el('span', { class: `off-badge ${cls}`.trim() }, `−${Math.round(pct)}%`);
}
export function changeBadge(ch) {
  if (!ch || Math.abs(ch.pct) < 1) return null;
  const down = ch.pct < 0;
  return el('span', { class: `badge ${down ? 'good' : 'warn'}`, title: `Best price ${down ? 'fell' : 'rose'} from ${money(ch.from)} to ${money(ch.to)} over about 7 days` },
    icon(down ? 'down' : 'up', 'ico xs'), `${Math.abs(ch.pct).toFixed(Math.abs(ch.pct) < 10 ? 1 : 0)}% 7d`);
}
export function lowBadge(p) {
  if (!p.best || !p.lowest) return null;
  const enough = p.history == null || p.history.length >= 3;
  if (p.atLowest && enough) return el('span', { class: 'badge gold', title: p.prevLow ? `Previous low ${money(p.prevLow.price)}` : 'Lowest best price in the tracked history' }, icon('trophy', 'ico xs'), 'Lowest ever');
  if (p.lowest.price != null && p.best.price <= p.lowest.price * 1.02 + 0.005 && enough)
    return el('span', { class: 'badge info', title: `Within 2% of the lowest tracked (${money(p.lowest.price)})` }, 'Near low');
  return null;
}

/**
 * Deal verdict: { kind: 'great'|'fair'|'wait'|'none', label, reasons[] }.
 * Uses RRP discount, distance from the lowest tracked price, the 7-day trend and stock.
 */
export function verdict(p) {
  if (!p.best || p.best.price == null) {
    return { kind: 'none', label: 'No price yet', reasons: ['None of the vetted stores has this in stock in the latest snapshot.'] };
  }
  const price = p.best.price;
  const off = p.best.pctOff;
  const low = p.lowest?.price ?? null;
  const n = p.history?.length ?? 30;
  const above = low != null && low > 0 ? (price - low) / low : null;
  const reasons = [];
  let score = 0;
  if (off != null) {
    if (off >= 20) { score += 2; reasons.push(`${Math.round(off)}% below RRP (${money(p.rrp)}), a strong discount for this kit.`); }
    else if (off >= 10) { score += 1; reasons.push(`${Math.round(off)}% below RRP (${money(p.rrp)}), a typical stockist discount.`); }
    else if (off > 0) { reasons.push(`Only ${Math.round(off)}% below RRP (${money(p.rrp)}).`); }
    else { score -= 1; reasons.push(`At or above RRP (${money(p.rrp)}).`); }
  } else reasons.push('RRP unknown, so the discount cannot be checked; judge it on price history.');
  if (n >= 3 && above != null) {
    if (above <= 0.005 || p.atLowest) { score += 2; reasons.push(p.prevLow ? `A new all-time low: ${money(p.prevLow.price)} was the previous best.` : 'The lowest price we have tracked for this kit.'); }
    else if (above <= 0.03) { score += 1; reasons.push(`Within ${Math.max(1, Math.round(above * 100))}% of the lowest tracked (${money(low)}, ${fmtDate(p.lowest.date)}).`); }
    else if (above >= 0.08) { score -= 2; reasons.push(`${money(price - low)} more than the lowest tracked (${money(low)} on ${fmtDate(p.lowest.date)}): it has been cheaper recently.`); }
    else reasons.push(`A little above the lowest tracked (${money(low)}).`);
  }
  if (p.change7d && Math.abs(p.change7d.pct) >= 3) {
    if (p.change7d.pct < 0) { score += 1; reasons.push(`Down ${Math.abs(p.change7d.pct).toFixed(0)}% this week.`); }
    else { score -= 1; reasons.push(`Up ${p.change7d.pct.toFixed(0)}% this week; prices that just rose often come back down.`); }
  }
  if (p.inStockCount === 1) reasons.push('Only one vetted store has it in stock.');
  const kind = score >= 3 ? 'great' : score <= -1 ? 'wait' : 'fair';
  return { kind, label: { great: 'Great deal', fair: 'Fair price', wait: 'Wait' }[kind], reasons };
}
export function verdictPill(v) {
  return el('span', { class: `verdict ${v.kind}` }, v.label);
}

/* ------------------------------------------------------------------ product card */
function watchButton(p, { small = true } = {}) {
  const b = el('button', { type: 'button', class: `watch-btn${small ? ' sm' : ''}` });
  const sync = () => {
    const on = watch.has(p.id);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? `Stop watching ${p.name}` : `Watch ${p.name}`);
    b.title = on ? 'Watching: click to remove' : 'Watch for a price drop';
    b.innerHTML = on ? ICON.starFill : ICON.star;
  };
  b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (watch.has(p.id)) watch.remove(p.id); else watch.add(p.id, { price: p.best?.price ?? null });
    sync();
  });
  sync();
  return b;
}
export { watchButton };

/**
 * Image-led product card. view: 'grid' | 'list' | 'rail'.
 * The whole card is one link (title is the accessible name); the watch star sits on top.
 */
export function productCard(p, { view = 'grid', categoryName = (c) => c, eager = false } = {}) {
  const b = p.best;
  const href = productHref(p.id);
  const signals = [lowBadge(p), changeBadge(p.change7d), b?.carried ? el('span', { class: 'badge warn', title: `Price from ${ago(b.fetchedAt)}` }, 'Older price') : null].filter(Boolean);
  const priceRow = b
    ? el('div', { class: 'pc-price' },
      el('span', { class: 'price' }, money(b.price)),
      p.rrp && b.pctOff > 0 ? el('span', { class: 'strike', title: 'Approximate RRP' }, money0(p.rrp)) : null,
      view === 'list' ? pctBadge(b.pctOff) : null)
    : el('div', { class: 'pc-price' }, el('span', { class: 'price muted-price' }, p.rrp ? money0(p.rrp) : '—'), el('span', { class: 'pc-rrp-note' }, p.rrp ? 'RRP · no stock' : 'No price yet'));
  return el('article', { class: `pc pc-${view}`, style: p.factionColor ? { '--fc': p.factionColor } : null },
    el('div', { class: 'pc-media' }, media(p, { eager }), view !== 'list' ? pctBadge(b?.pctOff, 'on-media') : null),
    el('div', { class: 'pc-body' },
      el('div', { class: 'pc-meta' }, el('span', { class: 'faction-dot', style: { '--c': p.factionColor || 'var(--muted)' }, 'aria-hidden': 'true' }),
        el('span', { class: 'truncate' }, p.factionName && !['multi', 'hobby'].includes(p.faction) ? `${p.factionName} · ${categoryName(p.category)}` : categoryName(p.category))),
      el('h3', { class: 'pc-title' }, el('a', { href, class: 'pc-link' }, p.name)),
      priceRow,
      el('div', { class: 'pc-sub' }, b
        ? [b.delivered != null ? `${money(b.delivered)} delivered` : '', b.retailerName ? ` · ${b.retailerName}` : '']
        : 'Check back after the next refresh'),
      signals.length ? el('div', { class: 'pc-signals' }, signals) : null),
    watchButton(p));
}

export function skeletonCards(n = 8, view = 'grid') {
  return Array.from({ length: n }, () => el('div', { class: `pc pc-${view} pc-skeleton`, 'aria-hidden': 'true' },
    el('div', { class: 'pc-media skeleton' }),
    el('div', { class: 'pc-body' }, el('span', { class: 'skeleton', style: { width: '45%' } }), el('span', { class: 'skeleton lg', style: { width: '90%' } }),
      el('span', { class: 'skeleton lg', style: { width: '55%' } }), el('span', { class: 'skeleton', style: { width: '70%' } }))));
}

export function emptyState(title, body, action = null) {
  return el('div', { class: 'empty' }, el('strong', {}, title), body ? el('span', {}, body) : null, action);
}

/* ------------------------------------------------------------------ banners */
/** Sample-data / no-snapshot / stale banners for the top of shop pages. */
export function dataBanners(ov) {
  const out = [];
  const s = ov?.snapshot ?? {};
  if (s.demo) {
    out.push(el('div', { class: 'sample-banner', role: 'note' },
      el('strong', {}, 'Sample data'),
      el('span', {}, ' Prices on this page are made up for demonstration. They are not real offers.'),
      !STATIC && demo ? el('button', { type: 'button', class: 'btn sm ghost', onclick: () => setDemo(false) }, 'Exit sample mode') : null));
  } else if (!ov || ov.empty || !ov.hasPrices) {
    out.push(el('div', { class: 'callout warn' }, el('strong', {}, 'No price snapshot yet.'),
      STATIC ? ' The site owner needs to run a price refresh. You can still browse the catalogue at RRP.'
        : ' Run “npm run snapshot” for live prices, or try the site with sample data.',
      !STATIC ? el('div', { style: { marginTop: '8px' } }, el('button', { type: 'button', class: 'btn sm', onclick: () => setDemo(true) }, 'Use sample data')) : null));
  } else if (s.freshness === 'stale') {
    out.push(el('div', { class: 'callout warn' }, el('strong', {}, `Prices are ${ago(s.generatedAt)} old.`), ' Stock and prices have probably changed; check the store before buying.'));
  }
  return out;
}

/** "Updated 2 h ago · 4 vetted stores" line. */
export function freshnessLine(ov) {
  const s = ov?.snapshot ?? {};
  const live = (ov?.stores ?? []).filter((x) => x.status !== 'skipped' && !x.blocked);
  return el('span', { class: 'fresh' }, el('span', { class: `fresh-dot ${s.freshness === 'stale' ? 'stale' : ''}`, 'aria-hidden': 'true' }),
    s.generatedAt ? `Updated ${ago(s.generatedAt)}` : 'Not refreshed yet',
    live.length ? ` · ${live.length} vetted US stores` : '', s.demo ? ' · sample data' : '');
}

/** Horizontal scroll rail with arrow buttons. */
export function rail(cards, label) {
  const track = el('div', { class: 'rail-track', role: 'list', 'aria-label': label });
  for (const c of cards) { c.setAttribute('role', 'listitem'); track.append(c); }
  const scrollBy = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const prev = el('button', { type: 'button', class: 'rail-btn prev', 'aria-label': `Scroll ${label} left`, onclick: () => scrollBy(-1) });
  const next = el('button', { type: 'button', class: 'rail-btn next', 'aria-label': `Scroll ${label} right`, onclick: () => scrollBy(1) });
  prev.innerHTML = ICON.chevL; next.innerHTML = ICON.chevR;
  const sync = () => {
    prev.disabled = track.scrollLeft < 4;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  };
  track.addEventListener('scroll', sync, { passive: true });
  requestAnimationFrame(sync);
  return el('div', { class: 'rail' }, prev, track, next);
}

export function sectionHead(title, { sub = null, href = null, linkText = 'See all', id = null } = {}) {
  return el('div', { class: 'sec-head' },
    el('div', {}, el('h2', { id }, title), sub ? el('p', { class: 'sec-sub' }, sub) : null),
    href ? el('a', { class: 'sec-link', href }, linkText, icon('arrow', 'ico xs')) : null);
}
