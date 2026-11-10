import { Router } from 'express';
import { RETAILERS, REGIONS, publicRetailer } from './retailers.js';
import { CURRENCIES, RATES_PER_GBP, RATES_AS_OF } from './currency.js';
import { searchPrices, DISCLAIMER } from './search.js';
import { SUSPICIOUS_RATIO } from './trust.js';

export const priceRouter = Router();

priceRouter.get('/retailers', (_req, res) => {
  res.json({
    retailers: RETAILERS.map(publicRetailer),
    policy: {
      tiers: {
        official: 'Games Workshop’s own store; used as the MSRP reference.',
        authorized: 'Long-established independent stockists selling new GW product themselves.',
      },
      excluded: 'Marketplaces (Amazon, eBay, AliExpress, Etsy...) are excluded: listings come from '
        + 'arbitrary third-party sellers, so a domain allowlist cannot vouch for them.',
      domainRule: 'Offers are only shown when the product URL is https and its hostname exactly matches '
        + 'one of the retailer’s registered domains.',
      suspiciousRule: `Prices below ${Math.round(SUSPICIOUS_RATIO * 100)}% of approximate MSRP are flagged as suspicious.`,
    },
    currencies: { rates: RATES_PER_GBP, base: 'GBP', asOf: RATES_AS_OF, approximate: true },
    disclaimer: DISCLAIMER,
  });
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
  const demo = process.env.PRICE_DEMO === '1' || req.query.demo === '1' || req.query.demo === 'true';
  try {
    const out = await searchPrices({ query: q, region, currency, demo });
    res.set('Cache-Control', 'no-store').json(out);
  } catch (err) {
    console.error('price search failed', err);
    res.status(500).json({ error: 'Price search failed' });
  }
});
