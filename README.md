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

To track more kits, add them to `src/price/catalog.js` / `src/price/kits.js` (or `src/price/watchlist.js`). A refresh
searches at most 200 kits per store (at 6 requests/min, about 33 minutes) within 40 minutes; kits with no data, then the least recently refreshed, go
first, so successive refreshes rotate through the whole catalogue. Each refresh also records stores' list prices
and product photos.

Preview the static build locally:

```bash
npm run snapshot:demo      # or: npm run snapshot (live lookups)
npm run build:static
npm run preview:static     # http://localhost:4000/Warhammer-40k-Notification/
```

## Deal Finder data and API (v2)

Everything below is computed from the published price snapshot; none of it contacts a retailer.
The Express routes (`src/price/routes.js`) and the static site (`public/static-api.js`) build their
responses with the same functions (`src/price/api.js`, `src/price/army.js`), and
`test/price-static-parity.test.js` checks that both return identical payloads for the same snapshot.

| Endpoint | Returns |
|---|---|
| `GET /api/prices/overview` | `products` (ProductCards), `topDeals` (ids), `drops` (biggest 7-day drops), `newLows` (new all-time lows in the last 7 days), `facets` (factions/categories with counts), store freshness, assumptions |
| `GET /api/prices/product/:id` | ProductCard + `offers`, `history` `[[date, price, retailerId]]`, `related`, `rrpEvidence`; 404 for unknown ids |
| `GET /api/prices/faction/:id` | the faction and its ProductCards |
| `POST /api/prices/army` | `{list, owned?}` → parsed lines, unmatched lines, boxes to buy, the cheapest delivered plan and RRP totals |
| `POST /api/prices/cart` | cart optimizer (unchanged) |
| `GET /api/prices/feed.xml`, `/data/deals.xml` | RSS 2.0 feed of new lows and price drops (static site: `data/deals.xml`, written by `build-static.js`) |

A **ProductCard** has `id, name, category, faction, factionName, factionColor, imageUrl, rrp, rrpSource,
rrpConf, best {price, delivered, retailerId, retailerName, url, inStock, pctOff, savings, fetchedAt, carried},
offerCount, inStockCount, dealScore, dealLabel, lowest {price, date, retailerId}, atLowest,
change7d {from, to, pct}, models, points, units`. Unknown values are `null`, never missing.

- **RRP evidence** (`src/price/rrp.js`): stores often print the official list price next to their own
  (Shopify `compare_at_price`, Miniature Market "Retail Price"). Two US stores agreeing within 3%, or one
  store within 10% of the catalogue estimate, gives `rrpSource: 'retailer-list'`, `rrpConf: 'high'`.
  A single uncorroborated store list price is `medium`; otherwise the catalogue estimate is used with its own
  confidence, or the RRP is `null`. UK/EU list prices are never used as a US RRP.
- **Images**: a store's product photo is kept only if it is https and hosted on that store's own domain or
  its registered image CDN (`imageHosts` in `retailers.js`); anything else is dropped. Listing photos found
  just before a product card are only used when their alt text names that product.
- **Catalogue** (`src/price/catalog.js` + `src/price/kits.js`): 626 products. The 107 hand-priced entries
  keep their approximate RRPs; about 520 unit kits (squads, characters, vehicles for every army) carry
  **no** hand-entered price, so their RRP comes only from store list prices. Every unit kit lists the
  combat-calculator datasheets it builds (`units`), checked by `test/price-catalogue.test.js`.
- **Price history**: each refresh adds one point per product per day (lowest in-stock price);
  `change7d` compares today with the last point at least 7 days old.

### Army list pricer

Paste a list; each datasheet is matched to the kit that builds it, model counts become boxes (pooled per
kit, so two 5-model squads need one 10-model box), boxes you already own are subtracted, and the cart
optimizer finds the cheapest delivered split across stores. Supported formats:

```text
Warhammer app export      Intercessor Squad (80 points)
                            • 4x Intercessor
                              ◦ 4x Bolt rifle
BattleScribe text         Necron Warriors [180pts]:
                          . 20x Necron Warrior: 20x Gauss flayer
New Recruit (WTC)         Char1: 1x Warboss (75 pts): Warlord, Big choppa
                          20x Boyz (170 pts): 18x Slugga, Boss Nob
Plain lines               10x Intercessor Squad / 3 Hellblasters / Necron Warriors (20)
```

A leading number counts models; for single-model datasheets it counts units, and a number below the
unit's minimum size is read as that many units ("3 Hellblasters" = three squads of five). Every line says
how it was read; lines that match no datasheet are listed as unmatched. Kits whose box contents we are not
sure of count one box per unit and say so.

## US retailers (checked from GitHub's servers, Nov 2026)

| Store | Status | How it's read |
|---|---|---|
| Miniature Market | ✅ live | search results page (`listing` adapter) |
| Discount Games Inc (Frontline Gaming) | ⛔ avoided | refused automated requests (HTTP 403) on Nov 11 and Nov 12 2026, so it is never contacted and its prices are not shown |
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
| Circuit breaker | A store that answers HTTP 403, or keeps rate-limiting us, is paused for an hour: no further requests are sent to it |
| Blocked stores | A store that refuses us during a price refresh (HTTP 403, or robots.txt disallows us) is recorded in the snapshot's `blockedStores` and skipped by every later refresh; its prices are dropped from the site. Temporary rate limits (429) don't count. To give a store another chance, run the snapshot with `--retry-blocked` |
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
