// politeFetch: the ONLY sanctioned way to make outbound HTTP requests.
//
// Guarantees:
//  * per-host rate limiting (token bucket + concurrency cap)
//  * response caching (TTL) so repeated searches don't re-hit retailers
//  * in-flight de-duplication (two identical requests share one fetch)
//  * honours 429/503 Retry-After, exponential backoff, bounded retries
//  * request timeout and an honest User-Agent
//  * robots.txt check (cached per host)

import { RateLimiter } from './rateLimiter.js';
import { TTLCache } from './cache.js';

const DEFAULT_LIMIT = { requestsPerMinute: 10, burst: 2, maxConcurrent: 1 };
const USER_AGENT =
  process.env.HTTP_USER_AGENT ||
  'Wh40kToolkit/0.1 (+price comparison hobby project; respects robots.txt)';

const limiters = new Map();      // host -> RateLimiter
const hostLimits = new Map();    // host -> limit config
const cache = new TTLCache({ maxEntries: 2000 });
const inFlight = new Map();      // cacheKey -> Promise
const robotsCache = new TTLCache({ maxEntries: 500 });

let fetchImpl = (...a) => globalThis.fetch(...a);

/** Tests inject a fake fetch here. */
export function __setFetch(fn) { fetchImpl = fn; }
export function __reset() {
  limiters.clear(); hostLimits.clear(); cache.clear(); inFlight.clear(); robotsCache.clear();
  fetchImpl = (...a) => globalThis.fetch(...a);
}

/** Register a per-host limit (call once per adapter, e.g. at module load). */
export function setHostLimit(host, limit) {
  hostLimits.set(host, { ...DEFAULT_LIMIT, ...limit });
  limiters.delete(host);
}

function limiterFor(host) {
  let l = limiters.get(host);
  if (!l) {
    l = new RateLimiter(hostLimits.get(host) ?? DEFAULT_LIMIT);
    limiters.set(host, l);
  }
  return l;
}

/** Exposed for /api/health and tests. */
export function limiterStats() {
  return [...limiters.entries()].map(([host, l]) => ({
    host, tokens: Number(l.tokens.toFixed(2)), inFlight: l.inFlight,
    blockedForMs: Math.max(0, l.blockedUntil - Date.now()),
  }));
}

function parseRetryAfter(h) {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null;
}

async function rawFetch(url, { timeoutMs, headers }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/html;q=0.9', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
  } finally { clearTimeout(timer); }
}

/** Minimal robots.txt check for `User-agent: *` Disallow rules. */
async function allowedByRobots(u, timeoutMs) {
  if (process.env.SKIP_ROBOTS === '1') return true;
  const key = u.origin;
  let rules = robotsCache.get(key);
  if (rules === undefined) {
    rules = [];
    try {
      const res = await limiterFor(u.host).schedule(() =>
        rawFetch(`${u.origin}/robots.txt`, { timeoutMs, headers: { Accept: 'text/plain' } }));
      if (res.ok) {
        let applies = false;
        for (const line of (await res.text()).split(/\r?\n/)) {
          const [k, ...rest] = line.split(':');
          const v = rest.join(':').trim();
          const field = k.trim().toLowerCase();
          if (field === 'user-agent') applies = v === '*';
          else if (applies && field === 'disallow' && v) rules.push(v);
        }
      }
    } catch { /* unreachable robots.txt => no rules */ }
    robotsCache.set(key, rules, 6 * 3600_000);
  }
  const path = u.pathname + u.search;
  return !rules.some((r) => path.startsWith(r));
}

export class PoliteFetchError extends Error {
  constructor(msg, { status, url, code } = {}) {
    super(msg); this.status = status; this.url = url; this.code = code;
  }
}

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {'json'|'text'} [opts.as='json']
 * @param {number} [opts.ttlMs=900000]  cache lifetime (default 15 min)
 * @param {number} [opts.timeoutMs=10000]
 * @param {number} [opts.maxRetries=2]
 * @param {object} [opts.headers]
 * @returns {Promise<any>} parsed body
 */
export async function politeFetch(url, opts = {}) {
  const { as = 'json', ttlMs = 15 * 60_000, timeoutMs = 10_000, maxRetries = 2, headers = {} } = opts;
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new PoliteFetchError('Only https is allowed', { url, code: 'INSECURE' });
  const key = `${as}:${u.href}`;

  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (inFlight.has(key)) return inFlight.get(key);

  const p = (async () => {
    if (!(await allowedByRobots(u, timeoutMs))) {
      throw new PoliteFetchError('Disallowed by robots.txt', { url, code: 'ROBOTS' });
    }
    const limiter = limiterFor(u.host);
    for (let attempt = 0; ; attempt++) {
      const res = await limiter.schedule(() => rawFetch(u.href, { timeoutMs, headers }));
      if (res.status === 429 || res.status === 503) {
        const wait = parseRetryAfter(res.headers.get('retry-after')) ?? 2 ** attempt * 2000;
        limiter.penalize(Math.min(wait, 5 * 60_000));
        if (attempt >= maxRetries) {
          throw new PoliteFetchError(`Rate limited by ${u.host}`, { status: res.status, url, code: 'RATE_LIMITED' });
        }
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        limiter.penalize(2 ** attempt * 1000);
        continue;
      }
      if (!res.ok) throw new PoliteFetchError(`HTTP ${res.status} from ${u.host}`, { status: res.status, url, code: 'HTTP' });
      // Anti-scam: a redirect that leaves the requested host (e.g. to a lookalike
      // domain) is rejected. Same-host redirects are fine.
      if (res.url) {
        const finalHost = new URL(res.url).host;
        if (finalHost !== u.host) {
          throw new PoliteFetchError(`Cross-host redirect ${u.host} -> ${finalHost} rejected`, { url, code: 'REDIRECT' });
        }
      }
      const body = as === 'json' ? await res.json() : await res.text();
      cache.set(key, body, ttlMs);
      return body;
    }
  })();

  inFlight.set(key, p);
  try { return await p; } finally { inFlight.delete(key); }
}
