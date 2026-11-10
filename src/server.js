import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { priceRouter } from './price/routes.js';
import { combatRouter } from './combat/routes.js';
import { limiterStats } from './shared/httpClient.js';
import { RateLimiter } from './shared/rateLimiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Behind a reverse proxy set TRUST_PROXY (e.g. "1" or "loopback") so req.ip is the real client.
  if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);

  // Inbound limit: protects our outbound budget from a single noisy client.
  const INBOUND_RPM = 30;
  const MAX_CLIENTS = 10_000;
  const clients = new Map(); // ip -> { tokens, last }
  const prune = setInterval(() => {
    const cutoff = Date.now() - 60_000; // idle > 1 min means bucket is full again: forget it
    for (const [ip, l] of clients) if (l.last < cutoff) clients.delete(ip);
  }, 60_000);
  prune.unref();
  app.use('/api', (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    let l = clients.get(ip);
    if (!l) {
      if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value);
      l = { tokens: INBOUND_RPM, last: now };
    } else {
      clients.delete(ip); // move to end (LRU order)
      l.tokens = Math.min(INBOUND_RPM, l.tokens + ((now - l.last) / 60_000) * INBOUND_RPM);
      l.last = now;
    }
    clients.set(ip, l);
    if (l.tokens < 1) return res.status(429).set('Retry-After', '10').json({ error: 'Too many requests' });
    l.tokens -= 1;
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, outbound: limiterStats() }));
  app.use('/api/prices', priceRouter);
  app.use('/api/combat', combatRouter);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // JSON error responses for the API (incl. malformed JSON bodies from express.json()).
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : (err.type === 'entity.parse.failed' ? 'Malformed JSON body' : err.message) });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Wh40k toolkit on http://localhost:${port}`));
}

export { RateLimiter };
