// politeFetch: the ONLY sanctioned way to make outbound HTTP requests.
//
// Guarantees:
//  * per-host rate limiting (token bucket + concurrency cap + bounded queue)
//  * response caching (TTL) so repeated searches don't re-hit retailers
//  * in-flight de-duplication (two identical requests share one fetch)
//  * honours 429/503 Retry-After, exponential backoff, bounded retries
//  * redirects followed manually: every hop is rate-limited and robots-checked,
//    and any hop that leaves the original host is rejected (anti-lookalike)
//  * RFC 9309 robots.txt (5xx/unreachable robots => disallow all, briefly cached)
//  * request timeout, AbortSignal support and an honest User-Agent

import { RateLimiter, LimiterError } from './rateLimiter.js';
import { TTLCache } from './cache.js';
import { parseRobots, isAllowed } from './robots.js';

const DEFAULT_LIMIT = { requestsPerMinute: 10, burst: 2, maxConcurrent: 1, maxQueue: 20 };
const PRODUCT_TOKEN = 'Wh40kToolkit';
const USER_AGENT =
  process.env.HTTP_USER_AGENT ||
  `${PRODUCT_TOKEN}/0.1 (+price comparison hobby project; respects robots.txt)`;
const MAX_REDIRECTS = 5;
const MAX_RETRY_AFTER_MS = 5 * 60_000;

const limiters = new Map();      // canonical host -> RateLimiter
const hostLimits = new Map();    // canonical host -> limit config
const cache = new TTLCache({ maxEntries: 2000 });
const inFlight = new Map();      // cacheKey -> Promise
const robotsCache = new TTLCache({ maxEntries: 500 });

let fetchImpl = (...a) => globalThis.fetch(...a);

/** Tests inject a fake fetch here. */
export function __setFetch(fn) { fetchImpl = fn; }
/** Clears limiter state and caches. Registered host limits are kept unless `limits` is true. */
export function __reset({ limits = false } = {}) {
  limiters.clear(); cache.clear(); inFlight.clear(); robotsCache.clear();
  if (limits) hostLimits.clear();
  fetchImpl = (...a) => globalThis.fetch(...a);
}

/** Lower-case, no trailing dot, port only if non-default: one bucket per real host. */
export function canonicalHost(hostOrUrl) {
  const u = hostOrUrl instanceof URL ? hostOrUrl
    : new URL(String(hostOrUrl).includes('://') ? String(hostOrUrl) : `https://${hostOrUrl}`);
  const h = u.hostname.toLowerCase().replace(/\.+$/, '');
  return u.port ? `${h}:${u.port}` : h;
}

/** Register a per-host limit (call once per adapter, e.g. at module load). */
export function setHostLimit(host, limit) {
  const key = canonicalHost(host);
  hostLimits.set(key, { ...DEFAULT_LIMIT, ...limit });
  limiters.delete(key);
}

export function getHostLimit(host) {
  return hostLimits.get(canonicalHost(host)) ?? DEFAULT_LIMIT;
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
    host, tokens: Number(l.tokens.toFixed(2)), inFlight: l.inFlight, queued: l.waiting,
    blockedForMs: Math.max(0, l.blockedUntil - Date.now()),
  }));
}

export class PoliteFetchError extends Error {
  constructor(msg, { status, url, code } = {}) {
    super(msg); this.status = status; this.url = url; this.code = code;
  }
}

function parseRetryAfter(h) {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null;
}

async function rawFetch(url, { timeoutMs, headers, signal }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/html;q=0.9', ...headers },
      signal: ctrl.signal,
      redirect: 'manual',
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Run a request through the host's limiter, translating limiter errors. */
async function scheduled(host, fn, signal, url) {
  try {
    return await limiterFor(host).schedule(fn, signal);
  } catch (e) {
    if (e instanceof LimiterError) {
      throw new PoliteFetchError(
        e.code === 'BUSY' ? `${host} is busy (request queue full)` : 'Request aborted',
        { url, code: e.code });
    }
    throw e;
  }
}

async function robotsRules(u, timeoutMs, signal) {
  const host = canonicalHost(u);
  let rules = robotsCache.get(host);
  if (rules !== undefined) return rules;
  let ttl = 6 * 3600_000;
  try {
    const res = await scheduled(host, () =>
      rawFetch(`${u.origin}/robots.txt`, { timeoutMs, headers: { Accept: 'text/plain' }, signal }), signal);
    if (res.ok) rules = parseRobots(await res.text(), PRODUCT_TOKEN);
    else if (res.status === 429 || res.status >= 500) { rules = [{ allow: false, path: '/' }]; ttl = 10 * 60_000; }
    else rules = []; // 4xx (incl. redirects we don't follow for robots) => no restrictions per RFC 9309
  } catch (e) {
    if (e instanceof PoliteFetchError && (e.code === 'ABORTED' || e.code === 'BUSY')) throw e;
    rules = [{ allow: false, path: '/' }]; // unreachable => assume disallow, retry soon
    ttl = 10 * 60_000;
  }
  robotsCache.set(host, rules, ttl);
  return rules;
}

async function assertRobots(u, timeoutMs, signal) {
  if (process.env.SKIP_ROBOTS === '1') return;
  const rules = await robotsRules(u, timeoutMs, signal);
  if (!isAllowed(rules, u.pathname + u.search)) {
    throw new PoliteFetchError('Disallowed by robots.txt', { url: u.href, code: 'ROBOTS' });
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
 * @param {AbortSignal} [opts.signal] abort to drop the request (even while queued)
 * @returns {Promise<any>} parsed body
 */
export async function politeFetch(url, opts = {}) {
  const { as = 'json', ttlMs = 15 * 60_000, timeoutMs = 10_000, maxRetries = 2, headers = {}, signal } = opts;
  const start = new URL(url);
  if (start.protocol !== 'https:') throw new PoliteFetchError('Only https is allowed', { url, code: 'INSECURE' });
  const host = canonicalHost(start);
  const key = `${as}:${start.href}`;

  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // Share in-flight work only for un-cancellable callers, so one caller's abort can't fail another.
  if (!signal && inFlight.has(key)) return inFlight.get(key);

  const p = (async () => {
    let u = start;
    let hops = 0;
    for (let attempt = 0; ; ) {
      await assertRobots(u, timeoutMs, signal);
      const res = await scheduled(host, () => rawFetch(u.href, { timeoutMs, headers, signal }), signal, u.href);

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location'), u);
        if (next.protocol !== 'https:' || canonicalHost(next) !== host) {
          throw new PoliteFetchError(`Cross-host redirect ${host} -> ${next.host} rejected`, { url, code: 'REDIRECT' });
        }
        if (++hops > MAX_REDIRECTS) throw new PoliteFetchError('Too many redirects', { url, code: 'REDIRECT' });
        u = next;
        continue;
      }
      if (res.status === 429 || res.status === 503) {
        const asked = parseRetryAfter(res.headers.get('retry-after'));
        const wait = asked ?? 2 ** attempt * 2000;
        limiterFor(host).penalize(wait);
        if (attempt >= maxRetries || wait > MAX_RETRY_AFTER_MS) {
          throw new PoliteFetchError(`Rate limited by ${host}`, { status: res.status, url, code: 'RATE_LIMITED' });
        }
        attempt++;
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        limiterFor(host).penalize(2 ** attempt * 1000);
        attempt++;
        continue;
      }
      if (!res.ok) throw new PoliteFetchError(`HTTP ${res.status} from ${host}`, { status: res.status, url, code: 'HTTP' });
      const body = as === 'json' ? await res.json() : await res.text();
      cache.set(key, body, ttlMs);
      return body;
    }
  })();

  if (!signal) inFlight.set(key, p);
  try { return await p; } finally { if (!signal) inFlight.delete(key); }
}
