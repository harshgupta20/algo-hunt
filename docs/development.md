# Development guide

> Related: [setup.md](setup.md) · [architecture.md](architecture.md) · [testing.md](testing.md) · [code-notes.md](code-notes.md)

## 1. Workflow

No branching strategy, PR template, linter or CI pipeline is defined in the repository (*not identifiable from the
repository*). The checks that exist and are worth running before every commit:

```bash
npm run typecheck && npm test && npm run build
```

- `typecheck` — `tsc --noEmit` over `src/` and `tests/` (strict mode).
- `test` — vitest ([testing.md](testing.md)).
- `build` — the production build also type-checks and catches Next.js-specific errors. It runs migrations first,
  but only when `DATABASE_URL` is set.

`// eslint-disable-next-line` comments exist in a few files, but ESLint is **not** installed or configured.

---

## 2. Repository structure

```
algo-hunt/
├── src/
│   ├── app/                      Next.js App Router (routes only — thin files)
│   │   ├── (dashboard)/          Signed-in pages: / · alerts · strategies · configuration · mcx · settings
│   │   ├── api/[...path]/        Catch-all REST route → src/server/api/routes.ts
│   │   ├── api/auth/{login,logout}/  Password session cookie
│   │   ├── api/cron/tick/        Scheduler entry (CRON_SECRET)
│   │   ├── login/                Sign-in page
│   │   ├── zerodhaRedirection/, redirect/zerodha/   Kite OAuth landing pages
│   │   ├── layout.tsx, providers.tsx, globals.css, icon.svg
│   ├── proxy.ts                  Access control for every page and /api (Next.js 16 "proxy")
│   ├── client/                   Browser code
│   │   ├── views/                One component per page/tab (+ analyzer/, builder/, mcx/ sub-views)
│   │   ├── components/           Shared UI (ui.tsx primitives, Tooltip, MonitorCard, RsiGauge, layout/…)
│   │   ├── context/LiveContext.tsx   Polling, new-alert notifications, dashboard-driven ticks
│   │   ├── lib/                  api client, help.ts (all tooltip text), signals.ts (color language), format, export
│   │   ├── hooks/, theme/
│   ├── server/                   Node-only code
│   │   ├── api/                  context.ts (DI), http.ts (router), routes.ts, schemas.ts, controllers/
│   │   ├── services/
│   │   │   ├── kite/             auth, client, historical provider, instrument store + sync, token crypto
│   │   │   ├── live/             monitorService (evaluation), liveTick (lease-guarded pass)
│   │   │   ├── strategy/         conditionEngine, customEvaluator, rsiSyncStrategy, StrategyEngine, builderCatalog, runContext…
│   │   │   ├── indicator/        rsi, library (indicators), registry (UI specs), patterns, candles (HA, weekly)
│   │   │   ├── analyzer/         backtestRunner, stats, dateRange, explain
│   │   │   ├── history/          alertService
│   │   │   ├── notification/     NotificationService (Telegram)
│   │   │   └── mcx/              mcxCatalog
│   │   ├── db/                   store.ts (interfaces + pure helpers), pg/pgStore.ts, pool.ts, types.ts, constants.ts
│   │   ├── auth/session.ts, config/index.ts, utils/{marketTime,logger}.ts, types/kiteconnect.d.ts
│   └── shared/                   @ash/shared — types/, constants.ts, strategyMarket.ts (used by server AND client)
├── db/migrations/                001…005 SQL migrations
├── scripts/migrate.mjs           Migration runner
├── tests/                        vitest suites + helpers/ (fixtures, synthetic RSI series)
├── docs/                         This documentation
├── next.config.ts, vercel.json, tailwind.config.js, postcss.config.mjs, tsconfig.json, vitest.config.ts, .editorconfig
└── AGENTS.md / CLAUDE.md         Agent instructions (Next.js 16 warning)
```

**Path aliases** ([tsconfig.json](../tsconfig.json), mirrored in [vitest.config.ts](../vitest.config.ts)):
`@/*` → `src/*`, `@ash/shared` → `src/shared/index.ts`.

---

## 3. Coding conventions (as used in the code)

- **TypeScript strict** with `noUncheckedIndexedAccess` and `noImplicitOverride`. The package is ESM
  (`"type": "module"`).
- **Formatting** ([.editorconfig](../.editorconfig)): UTF-8, LF, 2-space indent, final newline. Observed style:
  single quotes, semicolons, trailing commas, lines up to ~140 characters. No formatter is configured.
- **Every module starts with a header doc comment** explaining what it is for and any non-obvious rules. Keep that
  habit.
- **Server/client split:** anything touching Postgres, Kite or secrets lives in `src/server`. Client components
  start with `'use client'`. Shared logic that both sides need goes in `src/shared` (no Node APIs there).
- **Validate at the boundary** with zod in `schemas.ts`; controllers call `parse(schema, req.body)`.
- **Errors:**
  - Throw `HttpError(status, message)` for client errors.
  - Services throw `Error` with a user-readable message; controllers map some to 400.
  - `KiteNotConnectedError` becomes 409.
- **Logging:** `childLogger('component')` and `log.info({ ...fields }, 'message')` — one JSON line per entry.
- **Time:**
  - Candle `time` is **epoch seconds** (`OHLCV`, chart-native). Alert `bucket` and cursors are **epoch ms**.
  - Session math always goes through the IST helpers in `marketTime.ts`, because Vercel runs in UTC.
- **Real data only:** there are no mock providers in application code (a deliberate owner decision). Tests inject
  fixtures through the same interfaces.

## 4. Naming conventions

| Thing | Pattern | Example |
| --- | --- | --- |
| React views/components | PascalCase `.tsx` | `McxOverview.tsx`, `MonitorCard.tsx` |
| Service modules | camelCase `.ts`; classes may use PascalCase files | `monitorService.ts`, `StrategyEngine.ts`, `KiteHistoricalProvider.ts` |
| Controllers | `<area>Controller.ts` exporting `<area>Controller(ctx)` | `mcxController.ts` |
| Repositories | `Pg<Name>Repository` implementing `<Name>Repository` | `PgAlertRepository` |
| Migrations | `NNN_description.sql` | `004_serverless_runtime.sql` |
| Tests | `tests/<area>.test.ts` | `tests/mcx.test.ts` |
| Tooltip text | `HELP.<area>.<key>` in `help.ts` | `HELP.mcx.session` |
| React Query keys | array keys; first element = resource | `['configs']`, `['snapshots']`, `['alerts', filters]`, `['analytics', 'MCX']` |
| Market ids | `Segment` = `'NSE'` (NSE/BSE) or `'MCX'` | `segmentOf('GOLD') === 'MCX'` |

---

## 5. How-to recipes

### Add an API endpoint

1. Write the handler in the area's controller under `src/server/api/controllers/` (or a new
   `<area>Controller.ts`). Use `ctx` services, `parse()` for input and `HttpError` for errors. Return data,
   `created(data)`, `undefined` (204) or a `Response`.
2. Add a zod schema to [schemas.ts](../src/server/api/schemas.ts) if it takes a body.
3. Register the path in [routes.ts](../src/server/api/routes.ts). **Literal segments must come before `:param`
   siblings** (e.g. `/configs/snapshots` before `/configs/:id`).
4. Add a typed method to `api` in [src/client/lib/api.ts](../src/client/lib/api.ts).
5. Document it in [api.md](api.md).

### Add a page or tab

1. Add `src/app/(dashboard)/<route>/page.tsx` rendering a view from `src/client/views`. Wrap it in `<Suspense>` if
   the view uses `useSearchParams` (see [mcx/page.tsx](../src/app/%28dashboard%29/mcx/page.tsx)).
2. Add a `NAV` entry in [Sidebar.tsx](../src/client/components/layout/Sidebar.tsx) and its `HELP.nav.*` tooltip.
3. Pages are protected automatically by `proxy.ts`.

### Add an indicator

1. Implement a class extending `BaseIndicator` in [library.ts](../src/server/services/indicator/library.ts) and add
   it to `INDICATOR_CLASSES`. `compute(bar)` must not read `this.outputs` (`peek()` runs it on a copy without them).
2. Add its `IndicatorSpec` (label, description, params with defaults and help, fields, `numeric`/`boolean`) to
   `INDICATOR_SPECS` in [registry.ts](../src/server/services/indicator/registry.ts). The builder UI is data-driven
   from this catalog.
3. Add the kind to `IndicatorKind` in [builder.ts](../src/shared/types/builder.ts) and to `indicatorKindSchema` in
   `schemas.ts`.
4. Give it a unit in `scaleOf()` (and optionally a `defaultLevel()`) in
   [comparison.ts](../src/client/views/builder/comparison.ts). Add a label rule in `indicatorLabel` (server
   registry and client `strategyText.ts`) if the default `KIND(params) field` text isn't readable.
5. Add tests (see `tests/indicators*.test.ts`).

### Add an operator

Add it to `Operator` (shared types), `operatorSchema`, `OPERATORS` in `builderCatalog.ts` (with arity and
description), `applyOp`/`OP_PHRASE`/`buildText` in `conditionEngine.ts`, and `OP_PHRASE`/`conditionText` in
`src/client/lib/strategyText.ts`.

### Add an underlying or MCX product

- NSE/BSE: append to `UNDERLYINGS` in [src/shared/constants.ts](../src/shared/constants.ts) with its
  `derivativeExchange` and `strikeInterval`. Stock F&O would also need `kind: 'stock'`.
- MCX: append to `MCX_PRODUCTS` (symbol = Kite `name`, `group`, `optionsLiquid`). The strike interval is derived
  automatically. Products with different session hours (agri) would need per-product sessions in `marketTime.ts`
  (not supported yet — see [status.md](status.md)).
- The next instrument sync picks it up (the sync filters by these symbols).

### Add a built-in (class) strategy

Implement the `Strategy` interface (`definition` + `evaluate(ctx)`) and register it in `createStrategyEngine()`
([StrategyEngine.ts](../src/server/services/strategy/StrategyEngine.ts)). The monitor service and backtest runner
currently branch on `strategy === 'rsi-sync'`, so a second built-in needs wiring there too. Prefer shipping new
logic as a **custom strategy (JSON)** where possible.

### Add a notification channel

Implement `NotificationChannel` (`name`, `send(alert)`) in
[NotificationService.ts](../src/server/services/notification/NotificationService.ts) and return it from
`channelsFromConfig()` when its env vars are present. The channel name must be one of `NotificationChannel` in
[db/types.ts](../src/server/db/types.ts) (`browser | telegram | email | firebase`).

### Change the database schema

1. Add `db/migrations/NNN_<description>.sql`. Make it idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
   There are no down migrations.
2. Update the row mapping and SQL in [pgStore.ts](../src/server/db/pg/pgStore.ts), the repository interface in
   [store.ts](../src/server/db/store.ts), and the shared type if the field is exposed.
3. Update the in-memory fake in [tests/helpers/fixtures.ts](../tests/helpers/fixtures.ts) if tests use that
   repository.
4. Run `npm run db:migrate` locally. Production applies it during the Vercel build.
5. Document it in [database.md](database.md).

### Working with existing services

- Get services from `getContext()` (API) or constructor injection (tests). Don't `new` a `PgDataStore` elsewhere.
- Market data: `InstrumentStore` (contracts, expiries, strikes) and `HistoricalDataProvider` (candles). Tests pass
  `FixtureHistorical`/`fixtureInstrumentStore`.
- Anything that calls Kite goes through `kiteAuth.call(fn)`, which injects the token and invalidates the session on
  `TokenException`.

---

## 6. UI conventions

These are owner requirements. Keep them for any UI change.

- **Every control, icon and badge has a rich tooltip.** Use `Tooltip`, `InfoTip` (ⓘ) or `FieldLabel` from
  [Tooltip.tsx](../src/client/components/Tooltip.tsx), or `Help` / `IconButton` from
  [ui.tsx](../src/client/components/ui.tsx). Put the wording in [help.ts](../src/client/lib/help.ts). Indicator,
  operator and param help comes from the server catalog. **Never use the native `title=` attribute.**
- **Color language** ([signals.ts](../src/client/lib/signals.ts)):
  - Green = bullish/up and red = bearish/down, only.
  - Leg identity is FUT sky, CE violet, PE pink.
  - Built-in S1/S2 signals are green (S1 solid, S2 outlined); custom-strategy rules are blue.
  - Amber = needs attention; grey = neutral/idle.
- **Theme tokens:** colors are CSS variables per theme in [globals.css](../src/app/globals.css), mapped in
  [tailwind.config.js](../tailwind.config.js) (`ink-*` surfaces, a themed `slate-*` text scale, `fg`, `accent`,
  `bull`, `bear`, `warn`, `leg-*`). Light is the default theme.
- **Visual changes:** an app-wide "color-rich" redesign was rejected by the owner and reverted. Agree on the
  direction, or show one screen, before restyling broadly.
