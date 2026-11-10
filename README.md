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
| Per-host token bucket | Each source registers its own budget; default ≤ 10 req/min, burst 2, 1 concurrent |
| Caching | Search results cached ~30 min, unit data 24 h; identical in-flight requests share one fetch |
| Back-off | Honours `429`/`503` `Retry-After`, exponential backoff, bounded retries |
| robots.txt | Checked and cached per host |
| Inbound limit | 30 API calls/min per client IP, so one user can't burn the outbound budget |

`GET /api/health` shows live limiter state per host.

## How it was built

Development uses an agent-to-agent workflow (orchestrator → parallel feature agents →
reviewer agent). See [docs/AGENTS.md](docs/AGENTS.md) for the contracts and ownership rules
to reuse when adding features.

## Disclaimers

Unofficial fan tool, not affiliated with Games Workshop. Prices change constantly, so
verify at checkout. Datasheet values in the seed data should be checked against
current official datasheets and balance updates.
