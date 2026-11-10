# 40k Toolkit

A two-part Warhammer 40,000 website:

1. **Price Finder** (`/prices.html`): finds the cheapest place to buy a kit, searching
   **only an allowlist of reputable retailers** (official Warhammer store + long-standing
   authorized stockists). Results whose links point anywhere other than a registered
   retailer domain are discarded, and prices far below MSRP are flagged as suspicious.
2. **Combat Calculator** (`/combat.html`): pick an attacker (e.g. 10 Primaris
   Intercessors with bolt rifles) and a target (e.g. Terminators) and get expected hits,
   wounds, failed saves, damage, models killed and the full kill-probability distribution,
   using 10th-edition rules.

## Running

```bash
npm install
npm start              # http://localhost:3000
PRICE_DEMO=1 npm start # price finder uses offline fixture data
npm test
```

## Rate limiting (outbound API/scrape budget)

Every outbound request goes through `src/shared/httpClient.js` → `politeFetch()`:

| Safeguard | Detail |
|---|---|
| Per-host token bucket | Retailers 6 req/min, Wahapedia 2 req/min, default ≤ 10; 1 concurrent; bounded queue (fails fast when busy) |
| Caching | Search results cached ~30 min, unit data 24 h; identical in-flight requests share one fetch |
| Back-off | Honours `429`/`503` `Retry-After`, exponential backoff, bounded retries |
| robots.txt | RFC 9309 rules checked per host (unreachable/5xx robots.txt ⇒ treated as disallowed) |
| Redirects | Followed hop by hop through the limiter; any redirect off the retailer's domain is rejected |
| Inbound limit | 30 API calls/min per client IP, plus 5 price searches/min per IP (set `TRUST_PROXY` behind a reverse proxy) |
| Combat compute | Keyword values bounded, attack caps, exact-solver work budget, Monte Carlo dice budget (worst case ≈ 0.5 s) |

`GET /api/health` shows live limiter state per host.

## How it was built

Development uses an agent-to-agent workflow (orchestrator → parallel feature agents →
reviewer agent). See [docs/AGENTS.md](docs/AGENTS.md) for the contracts and ownership rules
to reuse when adding features.

## Disclaimers

Unofficial fan tool, not affiliated with Games Workshop. Prices change constantly, so
verify at checkout. Datasheet values in the seed data should be checked against
current official datasheets and balance updates.
