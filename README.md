# ASH — Real-Time RSI Synchronized Trading Alert Platform

A production-quality platform that continuously monitors **Futures, ATM Call, and ATM Put** for an
underlying and fires **ONE combined alert** the moment their RSIs align on a closed candle. It is a
professional **alerting** platform — it does not place trades.

The core distinction the whole system is built around: an **RSI crossing** (RSI just moved across a
level — even `59.99 → 60.01`) is *not* the same as an **RSI already above/below** a level. Both drive
alerts, via two scenarios, but they are detected differently.

> Runs end-to-end with **zero credentials and no database** out of the box: a simulated market-data
> feed and an in-memory store let you see alerts flow immediately. Real Zerodha Kite and Neon Postgres
> plug in via environment variables.

---

## The strategy

Levels (configurable per monitor): **Future ≥ 60**, **Call ≥ 60**, **Put ≤ 40**. RSI period **14**.
Evaluation happens **only on confirmed, closed candles** (no intra-candle repainting).

| Scenario | Future | Call | Put | Result |
| --- | --- | --- | --- | --- |
| **1** | crossing **above** 60 | crossing **above** 60 | crossing **below** 40 | one combined alert |
| **2** | **already** above 60 | crossing **above** 60 | crossing **below** 40 | one combined alert |

The Future condition (cross vs already) is mutually exclusive, so at most one scenario fires per
candle → exactly **one** `"<UNDERLYING> Strategy Triggered"` alert, never three per-leg alerts.

---

## Architecture

npm workspaces monorepo:

```
shared/   @ash/shared — types + constants shared by server & client
server/   Express API + WebSocket + background market worker
client/   React (Vite) dashboard
```

### Server (`server/src`)

```
config/         env loading (zod-validated)
services/
  kite/         MarketDataProvider interface, MockProvider, KiteProvider, InstrumentStore, factory
  indicator/    rsi.ts (Wilder, incremental) · candleBuilder.ts (ticks → OHLC)
  strategy/     crossing.ts · rsiSyncStrategy.ts · StrategyEngine (pluggable) · syntheticSeries
  notification/ wsHub (socket.io) · NotificationService (pluggable channels)
  history/      alertService (persist + dispatch + read-side)
workers/        marketWorker.ts (the ONLY place live monitoring runs) · instrumentState.ts
db/             pool · migrations/ · pg + in-memory repositories behind one DataStore interface
api/            controllers/ · routes/ · schemas (thin — no business logic here)
middleware/ utils/
```

**Data flow:** `provider tick → CandleBuilder → (on close) RSI.update → bucket-keyed evaluation
(all three legs present) → StrategyEngine → AlertService → persist + socket push + browser notify`.

The market worker evaluates each config **once per candle bucket**, only when all three legs have a
confirmed closed-candle RSI for that bucket. A DB unique index on `(config, bucket, scenario)` (and an
in-memory guard) guarantees no duplicate alerts, even across restarts.

### Client (`client/src`)

React + React Router + TanStack Query + socket.io + Tailwind + Recharts + TradingView Lightweight
Charts. Pages: **Dashboard, Live Alerts, Strategy Builder, Strategy Library, Strategy Analyzer, Alert
History, Analytics, Configuration, Strategies, Settings**. New alerts arrive over WebSocket and raise a
browser notification + chime.

---

## Quick start (mock mode — no setup)

```bash
npm install
npm run dev
```

- API + WebSocket: http://localhost:4000
- Dashboard: http://localhost:5173

Then in the dashboard:

1. **Configuration** → pick an underlying (e.g. NIFTY), expiry, ATM, 15m → **Create Monitor** → **Activate**.
2. Watch the **Dashboard** RSI gauges move (simulated feed).
3. Click **Simulate S1** / **Simulate S2** on the active monitor → one combined alert appears in
   **Live Alerts** with a browser notification, and lands in **Alert History** and **Analytics**.

The simulate action drives crafted price series through the **real** RSI + strategy engine — it is not
a fake alert.

---

## Strategy Builder (no-code strategy engine)

The **Strategy Builder** lets users compose strategies from rules — **no code** — that run in *both* live
alerts and the analyzer through one **generic evaluation engine**. Strategies are stored as structured
**JSON** (never executable code), interpreted by the engine, and **versioned** on every save.

- **Indicators** (pluggable): RSI, EMA, SMA, VWAP, MACD, Bollinger Bands, Supertrend, Volume, Price
  (O/H/L/C), OI. Adding one = a class + a registry line ([server/src/services/indicator/](server/src/services/indicator/)).
- **Operators**: numeric (`> < ≥ ≤ = ≠`), cross (above/below), trend (rising/falling), state (above/below),
  range (between/outside), percentage (increased/decreased by %).
- **Nested AND/OR groups**, multi-instrument conditions (Future/Call/Put), and compare-to-indicator RHS
  (e.g. `EMA20 > EMA50`).
- **Library** with edit / duplicate / publish / disable / delete / run-backtest and version history.
- **Per-strategy dashboard**: live stats + a historical backtest (reusing the analyzer's charts, table,
  timeline, heatmaps).
- Every alert carries a **per-condition trace** (`Future RSI(14) · 59.98 → 60.02 · cross above 60 ✓`) shown
  in live alerts and the analyzer.

**Single source of truth:** a custom strategy is evaluated by the same
[customEvaluator.ts](server/src/services/strategy/customEvaluator.ts) in the live worker and the backtest
runner — so live and historical results are identical. The built-in `rsi-sync` is kept on its proven
class-based path (the two coexist by design); a JSON reproduction of it is provided as a builder
**template** and proven equivalent by tests.

Endpoints: `GET /api/builder/catalog`, `GET /api/builder/template`, and
`GET/POST/PUT/DELETE /api/custom-strategies` (+ `/:id/duplicate|publish|disable|versions|stats`).
A config or analysis references a strategy by id (`rsi-sync` = built-in, or a custom id).

---

## Historical Strategy Analyzer (backtesting)

The **Strategy Analyzer** page replays the strategy over historical data — the primary environment for
validating and debugging strategies. Its defining property: it contains **no strategy logic**. It feeds
historical candles through the *same* `RsiCalculator` and `StrategyEngine.evaluate` the live worker
uses ([server/src/services/analyzer/backtestRunner.ts](server/src/services/analyzer/backtestRunner.ts)),
so historical and live results are guaranteed identical.

- **Filters** — date-range presets (today … last year) or custom, underlying, expiry, strike, timeframe,
  strategy → **Analyze**.
- **Summary cards** — total / Scenario 1 / Scenario 2 / avg-max-min per day / avg per week.
- **Alert table** — sortable, searchable, paginated; row → detail drawer with the exact
  `59.98 → 60.02 · crossed above 60` per-leg explanation.
- **Interactive chart** — TradingView Lightweight Charts: candlesticks + volume + a synced RSI pane
  (Future/Call/Put with level lines) + alert markers; the chart window is **lazy-loaded** per selection.
- **Timeline, heatmaps** (alerts by weekday / trading hour), **analytics**, and **CSV / JSON / Excel** export.

Backtest results are **ephemeral** — computed on demand and never written to the live `alerts` table, so
running analyses never pollutes live history/analytics. Historical data is deterministic mock by default
and swaps to Kite `getHistoricalData` via `MARKET_PROVIDER=kite`.

Endpoints: `POST /api/analyzer/run` (alerts + stats) and `POST /api/analyzer/chart` (windowed chart data).

---

## Going live (Zerodha Kite + Neon) — runbook

Kite Connect is a **paid** API whose access token is regenerated **each trading day** via a login flow.
One-time setup, then a ~10-second daily token step.

**One-time**

1. In your Kite Connect app ([developers.kite.trade/apps](https://developers.kite.trade/apps)), note the
   `API key` + `API secret`, and set the app's **Redirect URL** to **exactly**
   `http://localhost:5173/zerodhaRedirection` (the client auto-handles the redirect and completes login).
2. Fill `.env`:
   ```
   DATABASE_URL=postgres://…neon.tech/…?sslmode=require
   KITE_API_KEY=xxxxxxxx
   KITE_API_SECRET=xxxxxxxx
   MARKET_PROVIDER=kite
   ```
3. Create the schema on Neon (idempotent):
   ```bash
   npm run db:migrate    # applies 001_init + 002_strategy_builder
   npm run db:seed       # default user + strategy definitions
   ```

**Each trading day** — just click a button

4. `npm run dev`, open the dashboard. Because there's no valid token yet, a **Connect Kite** prompt shows in
   the top bar and on **Settings → Broker Connection**. Click it → you're redirected to Kite → log in → Kite
   redirects back → the app exchanges the token, connects the live feed, and shows **Connected**. The token
   is saved to `.env` so restarts within the day stay logged in.

If the token later expires or the session drops, the app **detects it automatically**, flips to
*Not connected*, and shows the **Connect Kite** prompt again — one click re-authenticates, no restart.

Everything downstream (candles, RSI, indicators, strategies, alerts, analyzer, UI) is **identical** to mock
mode — only the data source changes. Live ticks flow only during market hours; the historical adapter
auto-chunks long ranges to respect Kite's per-request limits.

> CLI alternative: `npm run kite:login` does the same token exchange from the terminal. Fully-automated
> (TOTP) refresh is possible later but would store your Kite password/TOTP secret, so it's intentionally
> not implemented.

---

## Database (optional — Neon Postgres)

Without `DATABASE_URL` the app uses an in-memory store (history/analytics reset on restart). To
persist:

```bash
cp .env.example .env          # then set DATABASE_URL=postgres://...neon.tech/...?sslmode=require
npm run db:migrate            # apply schema
npm run db:seed               # default user + strategy definitions
npm run dev
```

Tables: `users, devices, strategies, alert_configurations, alerts, notification_logs, user_preferences`.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run server + client together |
| `npm test` | Run the server test suite (39 tests) |
| `npm run typecheck` | Type-check shared + server |
| `npm run build` | Build server (tsup) + client (vite) |
| `npm run db:migrate` / `db:seed` | Postgres migrations / seed |

### Tests

The correctness-critical logic is unit- and integration-tested:

- **RSI** — Wilder smoothing vs hand-verified + canonical reference values.
- **Crossing** — the exact spec cases (`59.99→60.01`, `40.01→39.99`, `prev===level`, warmup, 0.01 moves).
- **Candle builder** — bucketing, rollover close, OHLC, out-of-order ticks.
- **Strategy** — Scenario 1 & 2 fire, 2-of-3 rejected, one match (never three).
- **Worker (integration)** — synthetic ticks → candles → RSI → strategy → **exactly one** combined
  alert; dedupe; replay simulation.

---

## Key API endpoints

```
GET    /api/health
GET    /api/instruments/underlyings | /:underlying/expiries | /:underlying/strikes | /instruments/meta
GET    /api/configs · POST /api/configs · DELETE /api/configs/:id
POST   /api/configs/:id/activate | /deactivate · GET /api/configs/snapshots
GET    /api/alerts (filters: from,to,underlying,expiry,timeframe,scenario) · GET /api/alerts/:id
GET    /api/analytics/summary
GET    /api/strategies | /:key                          # built-in strategy definitions
GET    /api/builder/catalog | /builder/template          # indicators/operators/instruments · starter JSON
GET/POST/PUT/DELETE /api/custom-strategies[/:id]         # no-code strategies (JSON)
POST   /api/custom-strategies/:id/duplicate|publish|disable
GET    /api/custom-strategies/:id/versions | /stats
GET/PUT /api/preferences
POST   /api/simulate/trigger   { configId, scenario }   # dev/demo
POST   /api/analyzer/run       { AnalyzerParams }        # backtest → alerts + stats
POST   /api/analyzer/chart     { params, center, span }  # lazy windowed chart data
WS     /live   → alert:new · rsi:update · status:provider
```

---

## Design decisions

- **Evaluate on candle close** (not intra-candle) — stable, no repainting. Live gauges use a
  provisional peeked RSI on the forming candle; strategy decisions never do.
- **Provider abstraction** — `MockProvider` and `KiteProvider` behind one interface; the worker is
  broker-agnostic.
- **Pluggable strategy engine + notification channels** — new strategies/indicators/channels register
  without touching the pipeline or routes.
- **Optional DB & Kite** — in-memory + mock defaults make the platform demoable instantly; production
  wires both via env.
- **Candle boundaries** aligned to the clock; **ATM locked at activation** (re-ATM-on-drift is future).

## Roadmap (not implemented)

Multiple users · additional strategies · Firebase/Telegram/Email/WhatsApp channels · React Native app ·
more indicators (EMA, VWAP, MACD, OI, Volume) · portfolio-specific alerts.
