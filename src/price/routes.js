import { Router } from 'express';
import { retailersInfo } from './rank.js';
import { RETAILERS, REGIONS, publicRetailer } from './retailers.js';
import { CURRENCIES, RATES_PER_GBP, RATES_AS_OF } from './currency.js';
import { searchPrices, DISCLAIMER } from './search.js';
import { SUSPICIOUS_RATIO } from './trust.js';

export const priceRouter = Router();

// Stricter per-IP budget for the expensive search endpoint (each search can
// fan out to every retailer). Token bucket; entries that have refilled to full
// are pruned, and the map is hard-capped, so it cannot grow without bound.
export const SEARCH_RPM = 5;
const MAX_CLIENTS = 10_000;
export function createSearchLimiter({ rpm = SEARCH_RPM, burst = rpm, now = Date.now, maxClients = MAX_CLIENTS } = {}) {
  const clients = new Map(); // ip -> { tokens, last }
  const refill = (e, t) => { e.tokens = Math.min(burst, e.tokens + ((t - e.last) / 60_000) * rpm); e.last = t; };
  function prune(t) {
    for (const [ip, e] of clients) { refill(e, t); if (e.tokens >= burst) clients.delete(ip); }
    while (clients.size >= maxClients) clients.delete(clients.keys().next().value); // oldest first
  }
  return {
    clients,
    /** @returns {{ok:true}|{ok:false, retryAfterSec:number}} */
    take(ip) {
      const t = now();
      let e = clients.get(ip);
      if (!e) {
        if (clients.size >= maxClients) prune(t);
        e = { tokens: burst, last: t }; clients.set(ip, e);
      } else refill(e, t);
      if (e.tokens < 1) return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - e.tokens) * 60) / rpm)) };
      e.tokens -= 1;
      return { ok: true };
    },
    prune,
    reset() { clients.clear(); },
  };
}
const searchLimiter = createSearchLimiter();
// Periodic prune; unref so it never keeps the process (or tests) alive.
setInterval(() => searchLimiter.prune(Date.now()), 60_000).unref();
/** Tests only. */
export function __resetSearchLimiter() { searchLimiter.reset(); }


priceRouter.get('/retailers', (_req, res) => {
  res.json(retailersInfo());
});

priceRouter.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/\s+/g, ' ') : '';
  if (q.length < 2 || q.length > 100) {
    return res.status(400).json({ error: 'Query "q" must be 2-100 characters' });
  }
  const regionRaw = typeof req.query.region === 'string' ? req.query.region : 'All';
  const region = regionRaw.toLowerCase() === 'all' ? 'All' : regionRaw.toUpperCase();
  if (region !== 'All' && !REGIONS.includes(region)) {
    return res.status(400).json({ error: `region must be one of All, ${REGIONS.join(', ')}` });
  }
  const curRaw = typeof req.query.currency === 'string' && req.query.currency ? req.query.currency : 'native';
  const currency = curRaw.toLowerCase() === 'native' ? 'native' : curRaw.toUpperCase();
  if (currency !== 'native' && !CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: `currency must be native or one of ${CURRENCIES.join(', ')}` });
  }
  // Charged only for valid searches (the expensive part); invalid requests
  // are cheap and already covered by the app-wide /api limiter.
  const gate = searchLimiter.take(req.ip || 'unknown');
  if (!gate.ok) {
    return res.status(429).set('Retry-After', String(gate.retryAfterSec))
      .json({ error: 'Too many price searches; please wait a moment' });
  }
  const demo = process.env.PRICE_DEMO === '1' || req.query.demo === '1' || req.query.demo === 'true';
  try {
    const out = await searchPrices({ query: q, region, currency, demo });
    res.set('Cache-Control', 'no-store').json(out);
  } catch (err) {
    console.error('price search failed', err);
    res.status(500).json({ error: 'Price search failed' });
  }
});
