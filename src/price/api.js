// API v2 payloads for the Deal Finder, built from an overview (overview.js).
// Shared by the Express routes (routes.js) and the static site (public/static-api.js)
// so both return exactly the same shapes. Browser-safe.
//
//   overviewPayload(ov)            GET /api/prices/overview
//   productPayload(ov, id)         GET /api/prices/product/:id   (null = 404)
//   factionPayload(ov, id)         GET /api/prices/faction/:id   (null = 404)
//   dealsRss(ov, {siteUrl})        GET /api/prices/feed.xml, static data/deals.xml
import { CATEGORIES, FACTIONS, factionById } from './catalog.js';

// Contract ProductCard keys, plus a few list-friendly extras.
const CARD_KEYS = ['id', 'name', 'category', 'faction', 'factionName', 'factionColor', 'imageUrl',
  'rrp', 'rrpSource', 'rrpConf', 'best', 'offerCount', 'inStockCount', 'dealScore', 'dealLabel',
  'lowest', 'atLowest', 'change7d', 'models', 'points', 'units',
  'popular', 'perModel', 'perPoint', 'rrpPerModel', 'rrpPerPoint'];

/** ProductCard from an overview product (deep-copied, JSON-safe, so server and static match exactly). */
export function productCard(p) {
  const out = {};
  for (const k of CARD_KEYS) out[k] = p[k] === undefined ? null : p[k];
  if (p.newLow) out.prevLow = p.newLow;
  return clone(out);
}
const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

const OFFER_KEYS = ['retailerId', 'retailerName', 'title', 'url', 'imageUrl', 'price', 'currency', 'priceUsd',
  'delivered', 'shipping', 'tax', 'duty', 'inStock', 'pctOff', 'dealScore', 'dealLabel', 'suspicious', 'carried',
  'fetchedAt', 'caution', 'listPrice', 'tier', 'region', 'domestic'];
const publicOffer = (o) => Object.fromEntries(OFFER_KEYS.map((k) => [k, o[k] === undefined ? null : o[k]]));

/** Factions / categories with product counts (only those that have products). */
export function facets(ov) {
  const fc = new Map(); const cc = new Map();
  for (const p of ov?.products ?? []) {
    fc.set(p.faction, (fc.get(p.faction) ?? 0) + 1);
    cc.set(p.category, (cc.get(p.category) ?? 0) + 1);
  }
  return {
    factions: FACTIONS.filter((f) => fc.has(f.id))
      .map((f) => ({ id: f.id, name: f.name, color: f.color, group: f.group, parent: f.parent ?? null, count: fc.get(f.id) })),
    categories: CATEGORIES.filter((c) => cc.has(c.id)).map((c) => ({ id: c.id, name: c.name, count: cc.get(c.id) })),
  };
}

const byIds = (ov, ids) => {
  const m = new Map(ov.products.map((p) => [p.id, p]));
  return (ids ?? []).map((id) => m.get(id)).filter(Boolean).map(productCard);
};

/** GET /api/prices/overview */
export function overviewPayload(ov) {
  const { products, drops, newLows, ...rest } = ov;
  return {
    ...clone(rest),
    products: products.map(productCard),
    drops: byIds(ov, drops),
    newLows: byIds(ov, newLows),
    facets: facets(ov),
  };
}

const family = (id) => {
  const f = factionById(id);
  return new Set([id, f?.parent].filter(Boolean));
};

/** Up to `n` related products: same faction family, same category first, best deals first. */
export function relatedProducts(ov, p, n = 8) {
  const fam = family(p.faction);
  const shared = new Set(p.units ?? []);
  return ov.products
    .filter((q) => q.id !== p.id && (fam.has(q.faction) || family(q.faction).has(p.faction)))
    .map((q) => ({ q, k: [
      (q.units ?? []).some((u) => shared.has(u)) ? 0 : 1,
      q.category === p.category ? 0 : 1,
      q.best ? 0 : 1,
      -(q.dealScore ?? -1),
    ] }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.k[3] - b.k[3] || a.q.id.localeCompare(b.q.id))
    .slice(0, n)
    .map(({ q }) => productCard(q));
}

/** GET /api/prices/product/:id, or null when the id is unknown. */
export function productPayload(ov, id) {
  const p = ov?.products?.find((x) => x.id === id);
  if (!p) return null;
  return {
    product: {
      ...productCard(p),
      blurb: p.note ?? null,
      catalogueRrp: p.catalogueRrp ?? null, catalogueConf: p.catalogueConf ?? null,
      offers: p.offers.map(publicOffer),
      history: p.history.map((x) => [x[0], x[1], x[2] ?? null]),
      related: relatedProducts(ov, p),
      rrpEvidence: p.rrpEvidence.map((e) => ({ ...e })),
    },
    snapshot: { generatedAt: ov.snapshot?.generatedAt ?? null, demo: !!ov.snapshot?.demo },
  };
}

/** GET /api/prices/faction/:id, or null when the faction is unknown. */
export function factionPayload(ov, id) {
  const f = factionById(id);
  if (!f) return null;
  const products = ov.products.filter((p) => p.faction === id);
  const children = FACTIONS.filter((x) => x.parent === id).map((x) => x.id);
  return {
    faction: { id: f.id, name: f.name, color: f.color, group: f.group, parent: f.parent ?? null, children, count: products.length },
    products: products.map(productCard),
    snapshot: { generatedAt: ov.snapshot?.generatedAt ?? null, demo: !!ov.snapshot?.demo },
  };
}

// ---- RSS 2.0 deals feed ----------------------------------------------------------------

/** Escape text for XML element content / attribute values. */
export function xmlEscape(s) {
  return String(s ?? '')
    // Characters not allowed in XML 1.0 at all.
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const money = (n) => (n == null ? '?' : `$${Number(n).toFixed(2)}`);
const rfc822 = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? new Date(t).toUTCString() : null;
};
/** Plain https URLs only (no tracking parameters are ever added). */
const safeLink = (u, fallback) => {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : fallback; } catch { return fallback; }
};

/**
 * RSS 2.0 feed of new all-time lows and the biggest 7-day price drops.
 * @param {object} ov  overview
 * @param {object} [o]
 * @param {string} [o.siteUrl]   the Deal Finder page (channel link and product links)
 * @param {string} [o.selfUrl]   where the feed itself lives
 */
export function dealsRss(ov, { siteUrl = 'https://github.com/', selfUrl = null } = {}) {
  const site = safeLink(siteUrl, 'https://github.com/');
  const demo = !!ov?.snapshot?.demo;
  const tag = demo ? '[SAMPLE DATA, not real prices] ' : '';
  const byId = new Map((ov?.products ?? []).map((p) => [p.id, p]));
  const items = [];
  const seen = new Set();
  const add = (id, kind) => {
    const p = byId.get(id);
    if (!p || seen.has(id) || !p.best) return;
    seen.add(id);
    const low = p.lowest?.price ?? p.best.price;
    const title = kind === 'low'
      ? `${tag}New low: ${p.name} ${money(low)}${p.newLow ? ` (was ${money(p.newLow.price)})` : ''}`
      : `${tag}Price drop: ${p.name} ${money(p.change7d?.to)} (${p.change7d?.pct}% in 7 days)`;
    const desc = [
      `Best delivered price ${money(p.best.delivered)} at ${p.best.retailerName}`
        + `${p.best.price != null ? ` (${money(p.best.price)} before shipping and tax)` : ''}.`,
      p.rrp != null ? `RRP ${money(p.rrp)}${p.rrpSource === 'catalogue' ? ' (approximate)' : ''}${p.best.pctOff != null ? `, ${p.best.pctOff}% off` : ''}.` : null,
      demo ? 'SAMPLE DATA for testing the site: these are NOT real prices.' : 'Estimates; verify the price at checkout.',
    ].filter(Boolean).join(' ');
    const when = kind === 'low' ? p.lowest?.date : (p.best.fetchedAt ?? ov.snapshot?.generatedAt);
    const link = safeLink(p.best.url, site);
    items.push([
      '    <item>',
      `      <title>${xmlEscape(title)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      `      <guid isPermaLink="false">${xmlEscape(`${p.id}:${kind}:${String(when ?? '').slice(0, 10)}:${low}`)}</guid>`,
      rfc822(when) ? `      <pubDate>${rfc822(when)}</pubDate>` : null,
      `      <category>${xmlEscape(p.factionName ?? p.faction)}</category>`,
      `      <description>${xmlEscape(desc)}</description>`,
      '    </item>',
    ].filter(Boolean).join('\n'));
  };
  for (const id of ov?.newLows ?? []) add(id, 'low');
  for (const id of ov?.drops ?? []) add(id, 'drop');
  const built = rfc822(ov?.snapshot?.generatedAt);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xmlEscape(`${tag}40k Deal Finder: new lows and price drops`)}</title>`,
    `    <link>${xmlEscape(site)}</link>`,
    `    <description>${xmlEscape(`${tag}New all-time lows and the biggest 7-day price drops at vetted US Warhammer 40,000 retailers. Prices are estimates; verify at checkout.`)}</description>`,
    '    <language>en-us</language>',
    selfUrl ? `    <atom:link href="${xmlEscape(safeLink(selfUrl, site))}" rel="self" type="application/rss+xml"/>` : null,
    built ? `    <lastBuildDate>${built}</lastBuildDate>` : null,
    '    <ttl>360</ttl>',
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].filter((x) => x != null).join('\n');
}
