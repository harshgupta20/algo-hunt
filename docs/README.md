# Algo Hunt — documentation

Algo Hunt is a personal trading **alert** platform (it never places orders). **Strategy + Product = Alert:** build a
strategy once (1–4 legs: Spot, Future, Call, Put), connect it to any NSE index, NSE stock or MCX commodity, and get
Telegram / email / desktop alerts when it fires — seconds after the candle closes with the live worker, checked on
Kite's own candles.

## Documentation map

| Page | What's inside |
| --- | --- |
| [v2-user-guide.md](v2-user-guide.md) | **For the trader:** setup, live alerts on your computer, build a strategy, compare products, connect and switch on, alerts |
| [v2-architecture.md](v2-architecture.md) | The strategy system: legs, units, evaluation, scanner, **live worker** (streaming + verification), module map, persistence |
| [architecture.md](architecture.md) | The whole app: components, how alerts are produced, request flow, integrations, authentication, decisions |
| [setup.md](setup.md) | Prerequisites, installation, environment variables, local run, Kite login, common setup problems |
| [development.md](development.md) | Repository structure, conventions, UI rules, how-to recipes |
| [api.md](api.md) | Every REST endpoint with parameters, responses and status codes |
| [database.md](database.md) | Tables in use, retired tables (kept), migrations |
| [testing.md](testing.md) | vitest setup and what each suite covers |
| [deployment.md](deployment.md) | Vercel + Neon, build, scheduler window, rollback, daily operations |
| [troubleshooting.md](troubleshooting.md) | Problems and exact messages, with fixes |
| [code-notes.md](code-notes.md) | Tricky parts of the shared low-level code |
| [status.md](status.md) | **Current state:** open items, limitations, decisions log, verification status |

## Quick start

```bash
npm install
cp .env.example .env.local      # DATABASE_URL, KITE_API_KEY, KITE_API_SECRET (APP_PASSWORD optional locally)
npm run dev                     # applies migrations, then http://localhost:3000 (opens V2)
npm run live                    # optional: the live worker for instant, verified alerts
```

Then **Connect Kite** (top bar or Settings) → **V2 → Products → Sync from Kite** → build a strategy → connect it to
products → switch the connections on. Full details: [v2-user-guide.md](v2-user-guide.md), [setup.md](setup.md).

```bash
npm test            # 101 tests
npm run typecheck   # tsc --noEmit
npm run build       # migrations (if DATABASE_URL is set) + next build
```

## Important developer resources

- [AGENTS.md](../AGENTS.md) — **Next.js 16 differs from older versions**; read `node_modules/next/dist/docs/` before
  changing framework code.
- [.env.example](../.env.example) — environment template.
- [src/server/api/routes.ts](../src/server/api/routes.ts) — the API route table.
- [src/shared/v2/catalog.ts](../src/shared/v2/catalog.ts) — products, legs, timeframes, indicators, patterns.
- [src/client/v2/help.ts](../src/client/v2/help.ts) — V2 tooltip text (every control must have one).
