// Retailer diagnostics: shows exactly what each store returns to our fetcher.
//
// Runs on GitHub Actions (.github/workflows/retailer-probe.yml), where the real
// price refresh runs, because some stores treat cloud/CI traffic differently.
//
// Politeness: at most ~7 requests per store (robots.txt, homepage to read the
// store's own search form, the search page with up to 2 same-host redirects, and
// one Shopify JSON check if robots.txt allows it), sent one at a time, honest
// User-Agent, and the same RFC 9309 robots.txt rules as the real fetcher.
// Nothing is retried. The probe deliberately bypasses politeFetch's cache and
// its error handling so it can report raw status codes and page markers.
//
// Usage: node scripts/probe-retailers.js [query]
import { RETAILERS } from '../src/price/retailers.js';
import { parseRobots, isAllowed } from '../src/shared/robots.js';
import { parseJsonLdProducts } from '../src/price/adapters/jsonld.js';
import { parseShopifySuggest } from '../src/price/adapters/shopify.js';
import { RateLimiter } from '../src/shared/rateLimiter.js';

const query = process.argv[2] || 'intercessors';
const UA = 'Wh40kToolkit/0.1 (+price comparison hobby project; respects robots.txt)';
const PRODUCT_TOKEN = 'Wh40kToolkit';

// Candidate US stores mentioned by the community, probed to learn how their
// sites work before deciding whether to add them. Search URLs are best guesses.
// Real search URLs found by reading each store's own search form (probe run 2).
const FOUND_SEARCH = {
  'miniature-market': 'https://www.miniaturemarket.com/search?search={q}',
  'discount-games-inc': 'https://www.discountgamesinc.com/search/?q={q}',
};

const CANDIDATES = [
  { id: 'cand-atomic-empire', name: 'Atomic Empire (candidate)', domains: ['www.atomicempire.com'],
    adapter: { type: 'html', searchUrl: 'https://www.atomicempire.com/Store/Search?q={q}' } },
  { id: 'cand-gamenerdz', name: 'GameNerdz (candidate)', domains: ['www.gamenerdz.com'],
    adapter: { type: 'html', searchUrl: 'https://www.gamenerdz.com/search.php?search_query={q}' } },
  { id: 'cand-wargame-portal', name: 'Wargame Portal (candidate)', domains: ['wargameportal.com'],
    adapter: { type: 'html', searchUrl: 'https://wargameportal.com/search?q={q}' } },
];

const limiter = new RateLimiter({ requestsPerMinute: 30, burst: 1 }); // across all stores: ≤ 1 request / 2 s

async function get(url, accept = 'text/html,application/json;q=0.9') {
  return limiter.schedule(async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const started = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'manual', signal: ctrl.signal });
      const body = await res.text();
      return { status: res.status, location: res.headers.get('location'), type: res.headers.get('content-type'),
        server: res.headers.get('server'), cfRay: !!res.headers.get('cf-ray'), body, ms: Date.now() - started };
    } catch (err) {
      return { status: 0, error: String(err?.cause?.code ?? err?.name ?? err), ms: Date.now() - started };
    } finally { clearTimeout(t); }
  });
}

function markers(body = '') {
  const b = body.slice(0, 400_000);
  return {
    bytes: body.length,
    title: (b.match(/<title[^>]*>([^<]{0,120})/i)?.[1] ?? '').trim(),
    jsonLdBlocks: (b.match(/application\/ld\+json/gi) ?? []).length,
    // Only real interstitials: an ordinary page can mention "captcha" in its scripts.
    challenge: /<title>\s*(Just a moment|Attention Required|Access denied|Pardon Our Interruption)/i.test(b) || /cf-chl-|px-captcha"/i.test(b),
    platform: /cdn\.shopify\.com|Shopify\.shop/.test(b) ? 'shopify'
      : /bigcommerce|cdn11\.bigcommerce/i.test(b) ? 'bigcommerce'
        : /Magento|mage\/|static\/version\d+/i.test(b) ? 'magento'
          : /woocommerce|wp-content/i.test(b) ? 'woocommerce' : 'unknown',
    clientRendered: /<div id="(root|app|__next)"/.test(b) || /window\.__NUXT__|__NEXT_DATA__/.test(b),
    productLinks: (b.match(/href="[^"]*\/(products?|p|item|catalog)\/[^"]+"/gi) ?? []).length,
    mentionsQuery: b.toLowerCase().includes(query.toLowerCase().slice(0, 8)),
    gwMentions: (b.match(/games workshop|warhammer/gi) ?? []).length,
  };
}

// Find the store's real search form on its homepage: action URL + query field name.
function discoverSearch(html, origin) {
  for (const m of String(html).matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)) {
    const form = m[0];
    const input = form.match(/<input\b[^>]*(type="search"|name="(q|query|search|keyword|keywords|search_query|searchtext|s)")[^>]*>/i);
    if (!input) continue;
    const name = input[0].match(/name="([^"]+)"/i)?.[1];
    const action = form.match(/<form\b[^>]*action="([^"]*)"/i)?.[1] ?? '/';
    if (!name) continue;
    try {
      const u = new URL(action.replace(/&amp;/g, '&'), origin);
      if (u.origin !== origin) continue;
      u.searchParams.set(name, '{q}');
      return u.href.replace('%7Bq%7D', '{q}');
    } catch { /* ignore */ }
  }
  return null;
}

// GET with up to 2 same-host redirects followed (each hop rate-limited).
async function getFollow(url, accept) {
  let res = await get(url, accept); let hops = [];
  for (let i = 0; i < 2 && res.status >= 300 && res.status < 400 && res.location; i++) {
    const next = new URL(res.location, url);
    if (next.host !== new URL(url).host) { hops.push(`cross-host ${next.host}`); break; }
    hops.push(next.pathname + next.search); url = next.href; res = await get(url, accept);
  }
  return { ...res, hops, finalUrl: url };
}

const report = [];
// Stores that blocked us are never contacted again, not even by this probe.
for (const r of [...RETAILERS.filter((x) => !x.blocked && (x.region === 'US' || x.id === 'element-games')), ...CANDIDATES]) {
  const row = { id: r.id, name: r.name };
  const cfg = r.adapter ?? {};
  const configured = cfg.type === 'shopify'
    ? `https://${cfg.host}/search?q={q}` : cfg.searchUrl;
  const origin = new URL(configured).origin;

  const robots = await get(`${origin}/robots.txt`, 'text/plain');
  row.robotsStatus = robots.status || robots.error;
  const rules = robots.status === 200 ? parseRobots(robots.body, PRODUCT_TOKEN)
    : (robots.status === 429 || robots.status >= 500 || robots.status === 0) ? [{ allow: false, path: '/' }] : [];

  // Read the store's own search form (homepage is normally allowed by robots.txt).
  if (isAllowed(rules, '/')) {
    const home = await getFollow(`${origin}/`);
    row.homeStatus = home.status || home.error;
    row.discoveredSearch = discoverSearch(home.body, new URL(home.finalUrl ?? origin).origin);
    row.homePlatform = markers(home.body).platform;
  }
  const template = FOUND_SEARCH[r.id] ?? row.discoveredSearch ?? configured;
  const searchUrl = template.replace('{q}', encodeURIComponent(query));
  const u = new URL(searchUrl);
  row.searchUrl = searchUrl;
  row.searchAllowedByRobots = isAllowed(rules, u.pathname + u.search);

  if (row.searchAllowedByRobots) {
    const page = await getFollow(searchUrl);
    row.redirectHops = page.hops;
    row.sampleLinks = [...new Set([...String(page.body ?? '').matchAll(/href="([^"]*\/(?:products?|p|item|catalog)\/[^"]+)"/gi)].map((x) => x[1]))].slice(0, 3);
    row.pricesSeen = (String(page.body ?? '').match(/\$\s?\d{1,3}\.\d{2}/g) ?? []).slice(0, 5);
    // Markup samples around the first results, to write a page reader for stores without JSON-LD.
    if (process.env.PROBE_EXCERPTS === '1' && page.body && FOUND_SEARCH[r.id]) {
      const body = String(page.body).replace(/\s+/g, ' ');
      const word = query.toLowerCase().slice(0, 8);
      const out = []; let from = body.indexOf('<body');
      while (out.length < 2 && from >= 0) {
        const i = body.toLowerCase().indexOf(word, from);
        if (i < 0) break;
        const tagStart = body.lastIndexOf('<a ', i);
        if (tagStart >= 0 && i - tagStart < 600 && /\$\d/.test(body.slice(i, i + 2500))) {
          out.push(body.slice(Math.max(0, tagStart - 400), tagStart + 1800));
          from = tagStart + 2500;
        } else from = i + word.length;
      }
      row.excerpts = out;
    }
    Object.assign(row, { searchStatus: page.status || page.error, searchMs: page.ms, redirectTo: page.location,
      contentType: page.type, server: page.server, cloudflare: page.cfRay, ...markers(page.body) });
    try { row.jsonLdProducts = page.body ? parseJsonLdProducts(page.body, searchUrl).length : 0; } catch { row.jsonLdProducts = 'parse error'; }
  }

  if (cfg.type === 'shopify' || row.platform === 'shopify' || row.homePlatform === 'shopify') {
    const host = cfg.host ?? u.host;
    const suggestPath = `/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=10`;
    row.suggestAllowedByRobots = isAllowed(rules, suggestPath);
    if (row.suggestAllowedByRobots) {
      const s = await get(`https://${host}${suggestPath}`, 'application/json');
      row.suggestStatus = s.status || s.error;
      try { row.suggestProducts = parseShopifySuggest(JSON.parse(s.body), { host, currency: 'USD' }).length; }
      catch (e) { row.suggestProducts = `unparseable (${String(e.message).slice(0, 60)})`; }
    }
  }
  report.push(row);
  console.log(JSON.stringify(row));
}

console.log('\n=== SUMMARY ===');
for (const r of report) {
  const verdict = typeof r.robotsStatus !== 'number' ? `UNREACHABLE (${r.robotsStatus})`
    : !r.searchAllowedByRobots && !r.suggestAllowedByRobots ? `BLOCKED by robots.txt (robots status ${r.robotsStatus})`
    : r.searchStatus === 403 || r.challenge ? 'BLOCKED (403 / bot challenge)'
      : r.searchStatus >= 300 && r.searchStatus < 400 ? `REDIRECT -> ${r.redirectTo}`
        : (r.jsonLdProducts > 0 || r.suggestProducts > 0) ? 'OK: products readable'
          : r.clientRendered ? 'NO DATA: page is rendered by JavaScript'
            : r.searchStatus === 200 ? 'NO DATA: page loads but no structured product data'
              : `FAILED (${r.searchStatus})`;
  console.log(`${r.name.padEnd(42)} ${verdict}  [platform=${r.platform ?? r.homePlatform ?? '?'} jsonld=${r.jsonLdProducts ?? '-'} suggest=${r.suggestProducts ?? '-'} links=${r.productLinks ?? '-'} prices=${(r.pricesSeen ?? []).length}] search=${r.searchUrl ?? '-'}`);
}
