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
│   │   ├── (dashboard)/          Signed-in pages: v2 · settings (layout: sidebar, top bar, alert notifier)
│   │   ├── api/[...path]/        Catch-all REST route → src/server/api/routes.ts
│   │   ├── api/auth/{login,logout}/  Password session cookie
│   │   ├── api/cron/tick/        V2 scanner entry (CRON_SECRET)
│   │   ├── login/                Sign-in page
│   │   ├── zerodhaRedirection/, redirect/zerodha/   Kite OAuth landing pages
│   │   ├── layout.tsx, providers.tsx, globals.css, icon.svg
│   ├── proxy.ts                  Access control for every page and /api (Next.js 16 "proxy")
│   ├── client/
│   │   ├── v2/                   The V2 UI (tabs, strategy editor, connections, compare, live feed card, help.ts)
│   │   ├── components/           ui.tsx primitives, Tooltip, KiteConnectionCard, layout/ (Sidebar, Topbar, AlertNotifier)
│   │   ├── views/                Settings, KiteRedirect
│   │   ├── lib/                  api (Kite + preferences), help.ts (app-shell tooltips), notify, format
│   │   ├── hooks/, theme/
│   ├── server/
│   │   ├── v2/                   The V2 module (see v2-architecture.md § 5) incl. live/ (streaming worker)
│   │   ├── workers/v2Live.ts     `npm run live` process
│   │   ├── api/                  context.ts (wiring), http.ts (router), routes.ts, schemas.ts, controllers/ (kite, preferences, v2)
│   │   ├── services/kite/        auth + encrypted session, client, historical provider (rate gate), token crypto
│   │   ├── services/indicator/   indicator maths used by V2's engine (RSI, EMA, SMA, MACD, Bollinger, ADX/DMI, Supertrend, VWAP, patterns, Heikin Ashi)
│   │   ├── db/                   pool.ts, appStore.ts (Kite session + preferences)
│   │   ├── auth/session.ts, config/index.ts, utils/{marketTime,logger}.ts, types/kiteconnect.d.ts
│   └── shared/                   v2/ (V2 types, catalog, validation, text) · @ash/shared (market, indicator, Kite, preference types)
├── db/migrations/                001…008 SQL migrations (keep them all)
├── scripts/migrate.mjs           Migration runner
├── tests/                        vitest suites: v2/ + indicator and market-time tests; helpers/v2Fakes.ts
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
| React components | PascalCase `.tsx` | `ConnectionsTab.tsx`, `LiveCard.tsx` |
| Server modules | PascalCase for classes, camelCase otherwise | `LiveWorker.ts`, `resolve.ts` |
| Controllers | `<area>Controller.ts` exporting `<area>Controller(ctx)` | `v2Controller.ts` |
| Migrations | `NNN_description.sql` | `008_v2_live.sql` |
| Tests | `tests/v2/<area>.test.ts` | `tests/v2/live.test.ts` |
| Tooltip text | `H.<area>.<key>` in `src/client/v2/help.ts`; app shell `HELP.<area>.<key>` in `src/client/lib/help.ts` | `H.live.contracts` |
| React Query keys | array keys; first element = resource | `['v2-connections']`, `['v2-alerts', 'active', '']` |

---

## 5. How-to recipes

### Add an API endpoint

1. Add a method to [V2Service.ts](../src/server/v2/V2Service.ts) (or the relevant service).
2. Add a handler in [v2Controller.ts](../src/server/api/controllers/v2Controller.ts) (validate the body with zod).
3. Register it in [routes.ts](../src/server/api/routes.ts) — literal segments before `:param` siblings.
4. Add the typed call to [src/client/v2/api.ts](../src/client/v2/api.ts) and document it in [api.md](api.md).

### Add an indicator to V2

Add the maths in [services/indicator/library.ts](../src/server/services/indicator/library.ts) (+ registry), then
the V2 catalogue entry (params, outputs, value unit) in [src/shared/v2/catalog.ts](../src/shared/v2/catalog.ts) and
its evaluation in [src/server/v2/engine/indicators.ts](../src/server/v2/engine/indicators.ts). Cover it with a test
in `tests/v2/`.

### Change the database schema

1. Add `db/migrations/NNN_<description>.sql`. Make it idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
   There are no down migrations.
2. Update [V2Store.ts](../src/server/v2/persistence/V2Store.ts), [PgV2Store.ts](../src/server/v2/persistence/PgV2Store.ts)
   and the in-memory `MemoryV2Store` in [tests/helpers/v2Fakes.ts](../tests/helpers/v2Fakes.ts).
3. `npm run dev` / `npm run live` / `npm run build` apply it; document it in [database.md](database.md).

### Working with existing services

- Get services from `getContext()` (API) or constructor injection (tests).
- Anything that calls Kite goes through `kiteAuth.call(fn)` (or V2's `KiteDataProvider`), which injects the token
  and invalidates the session on `TokenException`. Historical requests share the ~3 req/s gate in
  `KiteHistoricalProvider`.

---

## 6. UI conventions

These are owner requirements. Keep them for any UI change.

- **Every control, icon and badge has a rich tooltip.** Use `Tooltip`, `InfoTip` (ⓘ) or `FieldLabel` from
  [Tooltip.tsx](../src/client/components/Tooltip.tsx), or `Help` / `IconButton` from
  [ui.tsx](../src/client/components/ui.tsx). Put the wording in [src/client/v2/help.ts](../src/client/v2/help.ts)
  (or [src/client/lib/help.ts](../src/client/lib/help.ts) for the app shell). **Never use the native `title=`
  attribute.**
- **Color language:**
  - Green = bullish/up and red = bearish/down, only.
  - Leg identity is FUT sky, CE violet, PE pink, SPOT neutral.
  - Amber = needs attention; grey = neutral/idle.
- **Theme tokens:** colors are CSS variables per theme in [globals.css](../src/app/globals.css), mapped in
  [tailwind.config.js](../tailwind.config.js) (`ink-*` surfaces, a themed `slate-*` text scale, `fg`, `accent`,
  `bull`, `bear`, `warn`, `leg-*`, and `brand` — the header colour). Light is the default theme.
- **Brand:** the logo ([src/client/assets/logo-mark.png](../src/client/assets/logo-mark.png), component
  [Logo.tsx](../src/client/components/Logo.tsx); app icons `src/app/icon.png` / `apple-icon.png`). The header is solid
  `bg-brand` (the logo's deep blue) and the active tab solid `accent`; `.btn-glass` is the button style on the header.
  No gradients in the UI chrome.
- **Loading states** ([loaders.tsx](../src/client/components/loaders.tsx)): pages and long operations use
  `BrandLoader` / `PageLoader` (the logo line drawing itself); lists, tables and cards use skeletons shaped like the
  content (`SkeletonRows`, `SkeletonStatGrid`, `SkeletonCards`); buttons use `InlineSpinner`; short inline waits use
  `Spinner` (ring, in ui.tsx). The header's `ActivityBar` shows automatically while data loads for the first
  time or a save runs. Don't use a bare `Loader2`.
- **Visual changes:** an app-wide "color-rich" redesign was rejected by the owner and reverted. Agree on the
  direction, or show one screen, before restyling broadly.
