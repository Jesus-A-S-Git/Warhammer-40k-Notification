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

## Hosting on GitHub Pages (public site)

The site also builds as a fully static site, deployed by `.github/workflows/pages.yml`.

- **Combat Calculator** runs entirely in the visitor's browser, using the same engine and validation as the server.
- **Price Finder** searches a **price snapshot** (`data/prices.json`).
  - Prices are **never refreshed automatically**. The site's **Refresh prices** button opens this repo's
    "Deploy to GitHub Pages" workflow, where the repo owner clicks **Run workflow**.
  - A refresh searches each kit in `src/price/watchlist.js` through the rate-limited pipeline and republishes.
  - The page can't start the workflow itself, because that would need a GitHub token in public code.
  - Pushes to `main` redeploy the site but keep the published prices.
  - The browser re-runs the full trust filter on every snapshot offer.
- **Located for Seattle, WA** (`src/price/location.js`). Edit `location.js` to target another city.
  - Only US retailers that ship domestically are checked, and prices default to USD.
  - US offers show an estimated total with Seattle sales tax (≈10.55%, approximate; verify at checkout).
  - "Best price" prefers domestic retailers, which charge no import fees; overseas offers are flagged.
- If a refresh can't fetch any live prices (some retailers block cloud IPs), it publishes clearly labelled
  **sample data**, and the page shows a red "SAMPLE DATA, not real prices" warning.

**One-time setup:**
1. The repository must be **public** for free GitHub Pages: Settings → General → Danger Zone → Change visibility.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Merge to `main` to deploy. Then press **Refresh prices** on the site (or Actions → "Deploy to GitHub Pages" →
   Run workflow) to fetch the first prices.
4. The site appears at `https://<your-username>.github.io/Warhammer-40k-Notification/`.

To track more kits, add them to `src/price/watchlist.js`. Each extra kit adds about 10–20 s to a refresh.

Preview the static build locally:

```bash
npm run snapshot:demo      # or: npm run snapshot (live lookups)
npm run build:static
npm run preview:static     # http://localhost:4000/Warhammer-40k-Notification/
```

## US retailers (checked from GitHub's servers, Nov 2026)

| Store | Status | How it's read |
|---|---|---|
| Miniature Market | ✅ live | search results page (`listing` adapter) |
| Discount Games Inc (Frontline Gaming) | ✅ live | search results page (`listing` adapter) |
| Wargame Portal | ✅ live (mixed shipping reviews, shown on the site) | Shopify `suggest.json` |
| Noble Knight Games | ⏭ skipped: robots.txt disallows automated search | n/a |
| GameNerdz | ✖ not added: robots.txt disallows automated search | n/a |
| Atomic Empire | ✖ not added: search loads via JavaScript, no readable results page | n/a |

Re-check any time: Actions → **Retailer probe** → Run workflow. It makes a handful of polite
requests per store, reports robots.txt rules, status codes, bot challenges and whether prices
are readable, then runs one real end-to-end search. It deploys nothing.

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
