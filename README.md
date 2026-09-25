# Algo Hunt — RSI Synchronized Trading Alert Platform

Continuously monitors **Futures, ATM Call and ATM Put** for an underlying and fires **ONE combined alert** the
moment their RSIs align on a closed candle. It is an **alerting** platform — it never places trades.

Built with **Next.js 16** (App Router), **Neon Postgres** and **Zerodha Kite Connect**, and designed to deploy on
**Vercel** as-is. Everything runs on real market data — there is no simulated feed.

The core distinction the whole system is built around: an **RSI crossing** (RSI just moved across a level — even
`59.99 → 60.01`) is *not* the same as an **RSI already above/below** a level. Both drive alerts, via two scenarios,
but they are detected differently.

---

## The strategy

Levels (configurable per monitor): **Future ≥ 60**, **Call ≥ 60**, **Put ≤ 40**. RSI period **14**.
Evaluation happens **only on confirmed, closed candles** (no intra-candle repainting).

| Scenario | Future | Call | Put | Result |
| --- | --- | --- | --- | --- |
| **1** | crossing **above** 60 | crossing **above** 60 | crossing **below** 40 | one combined alert |
| **2** | **already** above 60 | crossing **above** 60 | crossing **below** 40 | one combined alert |

The Future condition (cross vs already) is mutually exclusive, so at most one scenario fires per candle → exactly
**one** `"<UNDERLYING> Strategy Triggered"` alert, never three per-leg alerts.

---

## Architecture

```
src/
  app/                 Next.js App Router — pages, API route handlers, layout
    (dashboard)/       Dashboard, Live Alerts, Strategies (Library · Builder · Backtest tabs), History, Analytics, Configuration, Settings
    api/[...path]/     REST API (dispatches to src/server/api/routes.ts)
    api/cron/tick/     Scheduled live evaluator (CRON_SECRET-protected)
    api/auth/*         Password login / logout
    zerodhaRedirection Kite OAuth redirect landing page
    login/             Sign-in page
  proxy.ts             Access control (password session cookie) for every page + API
  client/              React UI — views, components, TanStack Query hooks
  server/              Backend (Node runtime only)
    api/               router, controllers, zod schemas, dependency container
    services/
      kite/            auth (encrypted session in DB), historical candles, instrument master sync
      live/            MonitorService (candle-close evaluator) + liveTick (lease-guarded run)
      indicator/       RSI (Wilder), EMA, SMA, VWAP, MACD, Bollinger, Supertrend, Volume, Price, OI
      strategy/        crossing · rsiSyncStrategy · StrategyEngine · generic custom-strategy evaluator
      analyzer/        backtest runner, stats, explanations
      history/         alert persistence
      notification/    server-side channels (Telegram)
    db/                Postgres repositories behind one DataStore interface
  shared/              types + constants shared by server and client (@ash/shared)
db/migrations/         SQL migrations (applied by scripts/migrate.mjs)
tests/                 vitest suite
```

### How live monitoring works on serverless

Vercel functions don't stay running, so there is no WebSocket ticker. Instead:

1. **Every minute** a scheduler calls `GET /api/cron/tick` (see [Scheduler](#4-scheduler-every-minute)).
2. The tick takes a DB lease (so overlapping calls never double-run), then for each active monitor fetches the
   Future/Call/Put candles from **Kite's historical API** — the same candles the Kite chart shows.
3. Every **newly closed** candle is run through the same RSI + strategy engine the analyzer uses. Matches become
   alerts in Neon; a unique index plus a per-monitor cursor guarantee each candle fires **at most once**.
4. An RSI snapshot (closed + provisional incl. the forming candle) is stored for the dashboard gauges.
5. The dashboard polls for new alerts every 10s and raises a browser notification + chime. Optional **Telegram**
   delivery reaches you with no dashboard open.

While a dashboard tab is open during market hours it *also* triggers the tick every 30s (the lease makes this a
no-op if the cron already ran) — so alerts keep flowing even before you set up a scheduler.

Details that matter for correctness:

- Candles follow Kite's 09:15-aligned sessions; the last candle of the day is truncated at 15:30 IST.
- A monitor locks its strike/contracts at activation (ATM from the live future LTP) and only alerts on candles that
  close **after** activation. Expired contracts are rolled automatically on the next run.
- Candles that closed more than 30 minutes ago (e.g. the scheduler was down) are not alerted on — a stale alert is
  worse than none.

---

## Deploy to Vercel

### 1. Neon database

Create a project at [neon.tech](https://neon.tech) in **AWS Asia Pacific (Singapore)** (`ap-southeast-1`), the
closest Neon region to India. The Vercel functions are pinned next to it (`sin1`, set in `vercel.json`) because
most requests are database round-trips; if you pick another Neon region, change `vercel.json` to match. Copy the
**pooled** connection string.

### 2. Zerodha Kite Connect app

At [developers.kite.trade/apps](https://developers.kite.trade/apps) create (or open) your app and note the
**API key** and **API secret**. Set the app's **Redirect URL** to exactly:

```
https://<your-vercel-domain>/zerodhaRedirection
```

(`https://<your-vercel-domain>/redirect/zerodha` works too.)

(Kite Connect is a paid API; the historical-data add-on is required for candles.)

### 3. Vercel project

Import the repo in Vercel (framework preset: Next.js — no other settings needed) and add these environment
variables (see [.env.example](.env.example)):

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled connection string |
| `KITE_API_KEY` | yes | Kite Connect app |
| `KITE_API_SECRET` | yes | Kite Connect app — also encrypts the stored access token |
| `APP_PASSWORD` | yes | Dashboard login password |
| `CRON_SECRET` | yes | Random string, e.g. `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | no | Server-side alert delivery |

Deploy. **Migrations run automatically during the build** (`npm run build` applies pending `db/migrations/*.sql`;
they're idempotent). To run them by hand: `DATABASE_URL=… npm run db:migrate`.

### 4. Scheduler (every minute)

The evaluator must be called every minute during market hours (09:15–15:40 IST, Mon–Fri — calls outside that
window return immediately).

- **Vercel Pro:** add to `vercel.json` (Vercel sends the `CRON_SECRET` header automatically):

  ```json
  "crons": [{ "path": "/api/cron/tick", "schedule": "* 3-10 * * 1-5" }]
  ```

  (`3-10` UTC covers 08:30–16:29 IST.) Hobby plans only allow daily crons, so don't add this there — a
  more frequent schedule fails the deployment.

- **Any plan (free):** create a job at [cron-job.org](https://cron-job.org) (or any scheduler) that runs every
  minute, Mon–Fri, calling `https://<your-domain>/api/cron/tick` with header
  `Authorization: Bearer <CRON_SECRET>` (or append `?secret=<CRON_SECRET>`).

### 5. Daily use

Kite access tokens expire every morning (~06:00 IST). Each trading day, open the dashboard and click
**Connect Kite** (top bar or **Settings → Broker Connection**): you log in on Kite and are sent back automatically.
The login also refreshes the instrument master. If the token is rejected mid-day, the app flips to
*Not connected* and shows the prompt again.

Then **Configuration** → choose underlying, expiry, strike, timeframe, strategy → **Create Monitor** →
**Activate**. Alerts appear in **Live Alerts** / **Alert History** / **Analytics** and on Telegram if enabled.

---

## Local development

```bash
cp .env.example .env.local     # fill in DATABASE_URL + Kite credentials (APP_PASSWORD optional locally)
npm install
npm run dev                    # http://localhost:3000 — applies pending migrations first
```

For local Kite login, add `http://localhost:3000/zerodhaRedirection` as the Redirect URL in the Kite app.
With `APP_PASSWORD` unset the app is open in development (production refuses to serve without it).

| Command | Description |
| --- | --- |
| `npm run dev` | Apply pending migrations, then start the Next.js dev server |
| `npm run build` / `npm start` | Migrate + production build / serve |
| `npm test` | vitest suite |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Apply pending migrations |

To trigger an evaluation manually (e.g. outside market hours):
`curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/cron/tick?force=1"`.

---

## Strategy Builder (no-code strategy engine)

Compose strategies from rules — **no code** — that run in *both* live monitoring and the analyzer through one
**generic evaluation engine**. Strategies are stored as structured **JSON** (never executable code), interpreted by
the engine, and **versioned** on every save.

- **Indicators**: RSI, EMA, SMA, VWAP, MACD, Bollinger Bands, Supertrend, Volume, Price (O/H/L/C), OI (open
  interest from Kite). Adding one = a class + a registry line ([src/server/services/indicator/](src/server/services/indicator/)).
- **Operators**: numeric (`> < ≥ ≤ = ≠`), cross (above/below), trend (rising/falling), state (above/below),
  range (between/outside), percentage (increased/decreased by %).
- **Nested AND/OR groups**, multi-instrument conditions (Future/Call/Put), and compare-to-indicator RHS.
- **Library** with edit / duplicate / publish / disable / delete / backtest and version history; a strategy must be
  **published** to be used by a monitor.
- Every alert carries a **per-condition trace** (`Future RSI(14) · 59.98 → 60.02 · cross above 60 ✓`).

A custom strategy is evaluated by the same [customEvaluator.ts](src/server/services/strategy/customEvaluator.ts)
in live monitoring and the backtest runner, so live and historical results are identical.

## Historical Strategy Analyzer (backtesting)

Replays a strategy over **Kite historical candles** through the *same* RSI and strategy engines as live
monitoring ([backtestRunner.ts](src/server/services/analyzer/backtestRunner.ts)).

- Date-range presets (today … last year) or custom; underlying/group, expiry, strike, timeframe, strategy.
- **Dynamic ATM tracking** for the built-in strategy — the strike follows the future's price candle by candle.
- Summary cards, sortable alert table with per-leg explanations, TradingView Lightweight Charts (candles, volume,
  synced RSI pane, alert markers), timeline, heatmaps, and CSV / JSON / Excel export.
- Results are ephemeral — never written to the live alerts table. Long ranges are chunked to respect Kite's
  per-request limits (~3 req/s), so a year of 15m data across many strikes can take a while.

---

## Key API endpoints

All under `/api`, authenticated by the session cookie (except `/api/health` and `/api/cron/*`).

```
GET    /health
GET    /instruments/underlyings | /:underlying/expiries | /:underlying/strikes?expiry= | /instruments/meta
GET    /configs · POST /configs · GET|PUT|DELETE /configs/:id
POST   /configs/:id/activate | /deactivate · GET /configs/snapshots
POST   /config-groups · POST /config-groups/:groupId/activate | /deactivate · DELETE /config-groups/:groupId
GET    /groups · POST /groups · GET|PUT|DELETE /groups/:id
GET    /alerts (from,to,underlying,expiry,timeframe,scenario,strategyId,groupId,configId,limit,offset) · GET /alerts/:id
GET    /analytics/summary
GET    /strategies | /strategies/:key
GET    /builder/catalog | /builder/template
GET|POST /custom-strategies · GET|PUT|DELETE /custom-strategies/:id
POST   /custom-strategies/:id/duplicate | /publish | /disable · GET /custom-strategies/:id/versions | /stats
GET|PUT /preferences
POST   /analyzer/run · POST /analyzer/chart
GET    /live/status · POST /live/tick
GET    /kite/status | /kite/login | /kite/login-url | /kite/callback | /kite/instruments
POST   /kite/session | /kite/logout | /kite/instruments/sync
GET    /cron/tick            (Authorization: Bearer $CRON_SECRET)
```

## Security notes

- The whole app sits behind `APP_PASSWORD` (HMAC-signed, HttpOnly session cookie, 30 days). Changing the password
  signs everyone out.
- The Kite access token is stored AES-256-GCM encrypted with a key derived from `KITE_API_SECRET`, and is never
  returned by any endpoint. The app only calls Kite's read-only data APIs.
- `/api/cron/tick` requires `CRON_SECRET`.

## Tests

`npm test` covers RSI (Wilder), crossings, indicators, the RSI-sync strategy, the generic custom evaluator
(proven equivalent to the built-in strategy), the analyzer, and the live `MonitorService` end-to-end on fixed
candle fixtures: one combined alert per scenario, no double-fire across runs, no decisions on forming candles,
activation floor, stale-candle skip, custom strategies, and shared candle fetches.
