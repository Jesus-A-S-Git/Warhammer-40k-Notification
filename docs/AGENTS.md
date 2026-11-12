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

### Frontend
* Static files in `public/`, no build step, vanilla ES modules.
* Shared look: `public/styles.css` (design tokens + component classes, dark/light).
  `public/ui.js` handles nav highlighting, the theme toggle and the mobile menu, and exports
  `toast`, `el`, `fmtMoney`, `debounce`, `currentTheme`, `setTheme`.
* Each page uses the shared skeleton: inline theme script in `<head>`, `styles.css`, `ui.js`,
  `header.site` nav (Home · Deal Finder · Damage Simulator + `.theme-toggle`), `.page-head`, `footer.site`.
* `test/ui.test.js` asserts every contract class/token exists; extend it when adding to the contract.
