// Extract schema.org Product/Offer data from <script type="application/ld+json">.
// Regex-based on purpose (no DOM/CSS dependency); robust to @graph, ItemList,
// arrays, AggregateOffer and nested offers.

const SCRIPT_RE = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

export function extractJsonLdBlocks(html) {
  const out = [];
  for (const m of String(html).matchAll(SCRIPT_RE)) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try { out.push(JSON.parse(raw)); } catch { /* skip malformed block */ }
  }
  return out;
}

const hasType = (n, t) => {
  const ty = n?.['@type'];
  return Array.isArray(ty) ? ty.includes(t) : ty === t;
};

function collectProducts(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) { for (const n of node) collectProducts(n, out, depth + 1); return; }
  if (hasType(node, 'Product') || hasType(node, 'ProductGroup')) { out.push(node); }
  for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity', 'hasVariant']) {
    if (node[k]) collectProducts(node[k], out, depth + 1);
  }
}

function parsePrice(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  // "1,299.00" -> 1299.00 ; "45,00" (EU) -> 45.00
  let s = v.replace(/[^\d.,]/g, '');
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return Number.parseFloat(s);
}

function stockOf(avail) {
  if (avail == null) return null;
  const a = String(avail).toLowerCase();
  if (/instock|limitedavailability|onlineonly|presale|preorder/.test(a)) return true;
  if (/outofstock|soldout|discontinued|instoreonly/.test(a)) return false;
  return null;
}

function firstImage(img) {
  if (!img) return undefined;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return firstImage(img[0]);
  return img.url ?? img.contentUrl;
}

/**
 * @param {string} html
 * @param {string} baseUrl  page URL, to resolve relative product URLs
 * @returns {Array<{title,price,currency,url,inStock,imageUrl}>}
 */
export function parseJsonLdProducts(html, baseUrl) {
  const products = [];
  collectProducts(extractJsonLdBlocks(html), products);
  const out = [];
  for (const p of products) {
    let offers = p.offers ?? p.hasVariant?.flatMap?.((v) => v.offers ?? []) ?? [];
    if (!Array.isArray(offers)) offers = [offers];
    // Pick the cheapest offer that has a price; AggregateOffer uses lowPrice.
    let best = null;
    for (const o of offers.flatMap((x) => (Array.isArray(x?.offers) ? x.offers : [x]))) {
      if (!o) continue;
      const price = parsePrice(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
      if (!Number.isFinite(price)) continue;
      const cand = {
        price, currency: o.priceCurrency ?? o.priceSpecification?.priceCurrency,
        inStock: stockOf(o.availability), url: o.url,
      };
      if (!best || cand.price < best.price) best = cand;
    }
    if (!best || !p.name) continue;
    let url;
    try { url = new URL(p.url ?? best.url ?? baseUrl, baseUrl).href; } catch { continue; }
    let imageUrl;
    try { const i = firstImage(p.image); imageUrl = i ? new URL(i, baseUrl).href : undefined; } catch { /* ignore */ }
    out.push({ title: String(p.name).trim(), price: best.price, currency: best.currency,
      url, inStock: best.inStock, imageUrl });
  }
  return out;
}
