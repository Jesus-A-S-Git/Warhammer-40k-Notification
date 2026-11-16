# Agent-to-agent development workflow

This site is built by a small team of cooperating AI agents coordinated by an
orchestrator. Each agent owns a slice of the tree and communicates only
through the **contracts** below. Re-use this workflow for future features.

```
                 ┌──────────────────────┐
                 │  Orchestrator agent  │  writes contracts + shared code,
                 │  (src/shared, docs)  │  dispatches work, merges, final QA
                 └─────────┬────────────┘
            ┌──────────────┴──────────────┐
   ┌────────▼─────────┐          ┌────────▼──────────┐
   │ Price agent      │          │ Combat agent      │   run in parallel,
   │ src/price/**     │          │ src/combat/**     │   disjoint files
   │ public/prices.*  │          │ public/combat.*   │
   │ test/price*      │          │ test/combat*      │
   └────────┬─────────┘          └────────┬──────────┘
            └──────────────┬──────────────┘
                 ┌─────────▼────────────┐
                 │  Reviewer/QA agent   │  audits rate limits, scam filtering,
                 │  (read + tests)      │  dice math; reports findings
                 └─────────┬────────────┘
                           ▼
                 Orchestrator applies fixes → commit → push
```

## Ownership rules
| Agent | May write | Must not touch |
|---|---|---|
| Orchestrator | `src/shared/`, `src/server.js`, `docs/`, `public/index.html`, `public/styles.css`, `package.json` | — |
| Price agent | `src/price/`, `public/prices.html`, `public/prices.js`, `test/price*.test.js` | anything else |
| Combat agent | `src/combat/`, `public/combat.html`, `public/combat.js`, `test/combat*.test.js` | anything else |
| Reviewer | nothing (read-only); returns a findings list | — |
| Data agent (v2) | `src/price/`, `scripts/`, `public/static-api.js`, `.github/workflows/`, `test/price*.test.js`, `test/army-*.test.js` | other `public/*` |
| Experience agent (v2) | `public/*` pages, styles and UI scripts | `public/static-api.js`, `src/` |

## Contracts

### Outbound HTTP (hard rule)
* All network I/O goes through `politeFetch()` in `src/shared/httpClient.js`.
  Never call `fetch` directly.
* Each data source registers its own budget with `setHostLimit(host, {requestsPerMinute, burst, maxConcurrent})`
  using the source's published limit, or **≤ 10 req/min** when none is published.
* `politeFetch` provides caching (default 15 min TTL), in-flight de-dupe,
  `Retry-After` handling, backoff, robots.txt checks and timeouts.
* Tests inject a fake with `__setFetch()` and call `__reset()` between tests.
* Known hosts: retailers (see `src/price/retailers.js`), `wahapedia.ru` (2/min, optional
  runtime merge, `UNIT_DATA_REMOTE=1`), `raw.githubusercontent.com` (6/min, one at a time,
  used only by `npm run import:units`, which regenerates `src/combat/data/units.generated.js`
  from the BSData wh40k-10e files at a pinned commit).

### Inbound limits (`src/server.js`)
* `/api/prices/*` and other API routes: 30 req/min per IP (protects the outbound budget).
* `/api/combat/*`: separate 300 req/min per IP bucket (no outbound I/O; the simulator
  recalculates live on every change).

### Routers
* `src/price/routes.js` exports `priceRouter` (Express Router) mounted at `/api/prices`.
* `src/combat/routes.js` exports `combatRouter` mounted at `/api/combat`.
* Errors: JSON `{ error: string }` with a 4xx or 5xx status.

### Deal Finder API v2 (Data agent ↔ Experience agent)
* Payload builders live in `src/price/api.js` (overview, product, faction, RSS) and `src/price/army.js`
  (army list pricer). Both `src/price/routes.js` and `public/static-api.js` call them, so the static site
  and the server return the same shapes; `test/price-static-parity.test.js` enforces it.
* ProductCard / Offer shapes and the endpoint list are documented in the README ("Deal Finder data and API").
  Unknown values are `null`, never missing keys. Add fields; don't rename or remove them.
* Pages link the feed with the relative path `data/deals.xml` (served by the server and published by the static build).

### Frontend
* Static files in `public/`, no build step, vanilla ES modules.
* Shared look: `public/styles.css` (design tokens + component classes, dark/light).
  `public/ui.js` handles nav highlighting, the theme toggle and the mobile menu, and exports
  `toast`, `el`, `fmtMoney`, `debounce`, `currentTheme`, `setTheme`.
* Each page uses the shared skeleton: inline theme script in `<head>`, `styles.css`, `ui.js`,
  `header.site` nav (Deals · Factions · Army pricer · Damage simulator, search button for the Ctrl/⌘K palette,
  watchlist star, `.theme-toggle`), `footer.site`.
* `test/ui.test.js` asserts every contract class/token exists; extend it when adding to the contract.
* Pages: `index.html` (deal hub), `deals.html`, `faction.html[?id=]`, `product.html?id=`, `army.html`,
  `watchlist.html`, `prices.html` (price tools: cart optimizer, value per model, store search, method),
  `combat.html[?attacker=&defender=]`.
* Shared modules in `public/app/`: `api.js` is the only data layer (calls the API in server mode and
  `static-api.js` in static mode; caches the overview for 3 minutes), plus `kit.js`, `chart.js`,
  `search.js`, `palette.js`, `watch.js`, `browse.js` and one script per page.
* Price API v2 shapes are documented in README.md (ProductCard, /product/:id, /faction/:id, /army, RSS).
  Server routes and `static-api.js` share builders in `src/price/api.js` / `army.js`;
  `test/price-static-parity.test.js` keeps them identical.
* `test/ui-pages.test.js` checks every page has the shared shell, relative links only, resolvable
  module imports and lazy no-referrer https images.
