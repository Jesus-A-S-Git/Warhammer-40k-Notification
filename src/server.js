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

  // Inbound limit: protects our outbound budget from a single noisy client.
  const clients = new Map();
  app.use('/api', (req, res, next) => {
    const ip = req.ip || 'unknown';
    let l = clients.get(ip);
    if (!l) { l = { tokens: 30, last: Date.now() }; clients.set(ip, l); }
    const now = Date.now();
    l.tokens = Math.min(30, l.tokens + ((now - l.last) / 60_000) * 30);
    l.last = now;
    if (l.tokens < 1) return res.status(429).set('Retry-After', '10').json({ error: 'Too many requests' });
    l.tokens -= 1;
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, outbound: limiterStats() }));
  app.use('/api/prices', priceRouter);
  app.use('/api/combat', combatRouter);
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Wh40k toolkit on http://localhost:${port}`));
}

export { RateLimiter };
