# V2 — Strategy + Product = Alert

Status: **the app** — `/v2` (sidebar "V2"; `/` redirects there). The earlier V1 pages (Dashboard, Alerts, Strategies,
Configuration, MCX) and MCX V2 were removed on 2026-09-27. Trader guide: [v2-user-guide.md](v2-user-guide.md).

> Related: [architecture.md](architecture.md) · [api.md § 4.2](api.md#42-v2--strategy--product--alert) ·
> [database.md](database.md#v2-tables-007-008)

---

## 1. The idea

```
Strategy  (logic only: 1–4 legs + conditions + evaluation clock — no product)
   + Connection  (strategy → product: expiry, strike positions, alert settings)
   = Alert
```

- **Strategies are product-agnostic.** A strategy names **legs** — placeholders — and writes conditions between them.
- **Products are an independent catalogue**: NSE indices (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50),
  BSE indices (SENSEX, BANKEX), every NSE cash stock (plus its futures and options where listed), and the MCX
  commodities.
- **Connections** join them: one strategy can be connected to many products; each connection switches on and off
  by itself and produces its own alerts.
- **Compare** runs one strategy over past candles on up to 20 products and ranks them by how often it would have
  alerted (alerts only — no trade scoring, by request).

## 2. Legs

| Leg type | Becomes, on a product | Notes |
| --- | --- | --- |
| `SPOT` | the index value (e.g. `NIFTY 50`) or the stock's cash price | MCX commodities have no spot |
| `FUT` | the future | with option legs: the future the options expire into (first future expiring on/after the option expiry); otherwise the connection's futures expiry |
| `CE` / `PE` + strike offset | an option of the connection's expiry at *ATM + position + offset*, stepping along the listed strikes | ATM = nearest listed strike to the spot price, or to the future when there is no spot (MCX) |

A strategy has 1–4 legs (`A`–`D`), each optionally named. Conditions compare **any leg with any other leg** (or a
number), each value on its own timeframe and candle type — e.g. `A · FUT RSI(14) > B · CE ATM RSI(14)`. The operand
model leaves room for arithmetic operands later (differences, % gaps, strike levels).

In the editor, every Leg list ends with **+ Add FUT / CE ATM / PE ATM / SPOT leg** (adds the leg and assigns it), a
hint with the same buttons appears while a strategy has a single leg, and groups can be named (shown in the preview,
explain view and traces).

A product can run a strategy only if it has every leg type the strategy uses; the UI marks the rest "can't run" and
the server refuses them.

## 3. Units and evaluation

- A connection resolves to **units**: one per *strike position* (`strikeShifts`, e.g. `[-1, 0, 1]` scans the same
  legs one strike lower and higher), or a single unit for spot / futures strategies. Unit keys: `<expiry>|<base
  strike>`, `FUT|<expiry>` or `SPOT`.
- The engine (candles, indicators, evaluator, alert policy) started from the MCX V2 engine (since removed), re-typed for legs:
  completed-candle mode evaluates once per trigger candle on closed candles; live mode every minute on forming
  candles; crosses = previous ≤ and current >; missing data is `UNKNOWN` and never alerts; `ON_TRANSITION` needs the
  previous result to be `FALSE`; signal identity = connection · strategy version · unit · candle (deduped in the DB).
- **Market sessions** come from `MarketCalendar` per market: NSE / BSE 09:15–15:30, MCX 09:00–23:30 / 23:55
  (US-DST rule), plus holidays / special sessions per market from `v2_calendar`. Candles align to each session's open.
- Connections whose market is closed are skipped; NSE connections stop at 15:35 while MCX ones continue.

## 4. Scanner

A staged, failure-isolated cycle per connection: gate by market → connections + strategies + products → provider + instrument freshness → trigger
clock → one batched LTP call for every ATM reference → units → due units → fetch plan within the request budget
(`v2_settings.requestBudget`, default 150) → fetch (each contract once per cycle, shared across connections) →
evaluate → policy → signal → alert → Telegram / Email. It is the job behind `/api/cron/tick` (lease `v2-scan`,
table `app_locks`) and also runs while `/v2` is open; while the live worker streams it only backs it up (§ 4b).

## 4b. Live worker (streaming) — `npm run live`

A long-running process on your computer (same `.env`, database and Kite login as the app) that makes alerts
**seconds** after a candle closes instead of minutes, for as many products as Kite's stream allows.

- **Stream:** Kite WebSocket, full mode (last-trade time, day volume, OI, exchange time), up to 3 sockets × 3,000
  contracts. Each socket reconnects by itself (1 s → 30 s backoff, forever), resubscribes, and reports which contracts
  were observed from when.
- **What is streamed (`live/plan.ts`):** per switched-on connection, every leg contract at the current ATM for each
  strike position, the ATM reference (spot, or the future on MCX), plus the same option legs **2 strikes further out
  on each side** so an ATM move switches to an already-warm contract. Buffers are dropped before needed contracts;
  connections that don't fit are "uncovered" and left to the cron scanner.
- **Candles (`live/LiveCandles.ts`):** 1-minute candles built from ticks exactly as Kite forms them — bucketed by the
  exchange's last-trade time (index values by exchange time), session minutes only, the day's first candle opens at
  the exchange's day open, volume from the cumulative day volume. Kite's official candles (history at warm-up,
  re-fetches when confirming) always override live-built ones up to the point Kite demonstrably covers (if Kite lacks a
  period we saw trades in, it's still catching up and isn't trusted past it). Unobserved stretches — before the
  subscription, while a socket was down, a trade stamped in an already-closed minute — are recorded as gaps.
- **Evaluation (`live/LiveWorker.ts`):** 2.5 s after a trigger candle closes, every due unit is evaluated with the same
  engine, alert policy and commit code as the scanner (`scanner/commit.ts`).
- **Accuracy rule (`live/verify.ts`):** a result is decided on live candles only when it is clearly false on fully
  observed data. It is re-checked on Kite's official candles (fetched ~4 s after the close) when it is **true** (every
  alert), when the data has a **gap**, or when a condition is a **near miss that could change the result** (within 1 point
  on 0–100 oscillators, 0.25 % on prices, 3 % on volume / OI; candle patterns always count; a near miss that can't
  change the outcome — e.g. inside an AND whose other side is clearly false — is not checked). If Kite's trigger candle
  differs from the live one it is read again 10 s after the close. Evaluations record `source`: `LIVE_VERIFIED`,
  `LIVE` (clear results; forming candles in live-candle mode) or `LIVE_UNVERIFIED` (Kite's candles didn't arrive within
  2 minutes — still decided, clearly marked in the alert).
- **Kite requests (`live/FetchQueue.ts`):** one priority queue over the shared ~3/s historical rate gate — confirmations
  first, then history for contracts in use, then nearby strikes, then gap repairs; identical requests are shared.
- **Daily routine:** new trading day → fresh candles and history; at 08:15 IST the contract list is re-synced; a new Kite
  token (morning login) restarts the stream within 30 s.
- **Health (`v2_live_status`):** heartbeat every 5 s with state (LIVE / WARMING_UP / DEGRADED / WAITING_LOGIN / STOPPED),
  sockets, contracts vs capacity, accuracy counters and the last candle closes (Dashboard → Live feed). Only one worker
  runs at a time (a second refuses to start unless `--force`).
- **Backup:** while the worker is LIVE or WARMING_UP the cron scanner skips the connections it covers and scans only
  uncovered ones. When the heartbeat stops without a clean stop, the scanner takes over and sends **one** Telegram
  warning; the worker itself warns when its stream has been down for 60 s during market hours (and when it's back), and
  reminds you to log in to Kite 15 minutes before the first session if you haven't.

## 5. Module map

```
src/shared/v2/        types · catalog (products, legs, timeframes, indicators, patterns) · schema (zod) · validate · text
src/server/v2/
├── calendar/         MarketCalendar (NSE + MCX sessions, per-market holidays)
├── data/             DataProvider (interface) · KiteDataProvider (NSE, BSE, NFO, BFO, MCX dumps; shared rate gate)
│                     · ProductService (sync + product catalogue + per-product contracts) · CandleService
├── universe/         resolve (legs → contracts, ATM, strike positions)
├── engine/           candles · indicators · series · evaluator
├── alerts/           alertPolicy · notifications (Telegram, Resend email)
├── scanner/          V2Scanner · commit (alert decision shared with the live worker)
├── live/             LiveWorker · KiteStream · ticks (Kite binary protocol) · LiveCandles · plan · verify
│                     · FetchQueue · health
├── debug/            tools (explain now, compare across products)
├── persistence/      V2Store · PgV2Store (v2_* tables, migrations 007 + 008)
├── V2Service.ts      operations behind /api/v2/*
└── index.ts          createV2Module() — wired into the API context · createV2LiveWorker()
src/server/workers/v2Live.ts   the `npm run live` process (also `--check`, `--force`)
src/client/v2/        V2Hub (tabs) · strategies/ (editor, legs, conditions) · connections/ · compare/ · alerts, products,
                      scanner, settings, dashboard · ProductPicker · ExplainView · help.ts (tooltips)
```

A boundary test (`tests/v2/boundary.test.ts`) keeps V2 independent of the retired V1 / MCX V2 module paths,
and the rest of the app imports V2 only at the wiring points (API context, router, cron route, live worker, app shell).

## 6. Persistence

Migration `007_v2.sql` (additive):

`v2_instruments` (all markets) · `v2_products` (catalogue built at sync) · `v2_calendar` (market + date) ·
`v2_strategies` / `v2_strategy_versions` · `v2_connections` (config JSON: expiry, strike shifts, alert policy) ·
`v2_unit_state` · `v2_signals` (unique identity) · `v2_alerts` / `v2_deliveries` · `v2_scan_runs` · `v2_settings`.
Deleting a strategy cascades to its connections, their unit states, signals and alerts.
Migration `008_v2_live.sql` adds `v2_live_status` (one heartbeat / status row written by the live worker).

## 7. Compare — how to read it

- Contracts are the ones **listed today** (Kite serves no intraday history for expired contracts). Option legs are
  fixed at the strikes around the ATM of the **first trigger candle** of the period.
- Candles before a contract existed, or during indicator warm-up, count as "too little data" (the **coverage**
  column); low coverage means the alert count isn't comparable.
- Longest period depends on the trigger timeframe (e.g. 20 days of 15-minute candles, 1 year of daily).

## 8. Verification

- `tests/v2/` — 59 tests: product mapping from Kite dumps, NSE calendar, leg resolution (spot-based ATM on NSE,
  future-based on MCX, strike positions, missing legs, spot / futures-only), validation, the boundary guard, and an
  end-to-end suite with one FUT-vs-CE strategy connected to NIFTY, BANKNIFTY and GOLD (alerts only where both
  conditions hold, market gating, no re-alerting, compatibility refusal, channel check on switch-on, explain, compare),
  plus the live worker: Kite tick packets, socket subscribe / drop / resubscribe, minute building (trade-time buckets,
  day open, volume, late trades), gaps and Kite catching up, the re-check rule, the subscription plan (ATM ± 2 strikes,
  capacity), the fetch queue, and end to end (clear false decided live without a Kite request; true alerted only after
  Kite confirms; a live true Kite doesn't confirm is dropped; a near miss Kite confirms alerts; gaps re-checked;
  unverified fallback; cron steps aside and warns once when the worker dies; one worker at a time).
- Live worker checked locally against a throwaway database (Kite and Telegram disabled): starts, writes its heartbeat,
  shows on the Dashboard, a second worker refuses to start, Ctrl+C records a clean stop. **Not yet verified against the
  real Kite stream** (needs market hours) — see § 9.
- Checked locally (production build, throwaway database, Kite disconnected): every tab renders; strategies with
  1–4 legs, connections (including the refusal for incompatible products), compare and scan report missing data
  honestly.

## 9. Before handing over

1. Migration 007 runs on the next `npm run dev` / Vercel build (additive).
2. Log in to Kite, then **V2 → Products → Sync from Kite** (downloads NSE, BSE, NFO, BFO and MCX lists; ~1 minute).
3. Configure Telegram (`TELEGRAM_BOT_TOKEN` + chat id) and/or email (`RESEND_API_KEY` + recipients) in V2 → Settings.
4. Enter this year's NSE and MCX holidays in V2 → Settings → Market calendar.
5. Live worker, first market morning: log in to Kite in the app, run `npm run live -- --check` (prints NIFTY 50 ticks),
   then `npm run live` and leave it running. Dashboard → Live feed should show LIVE within a few minutes (history loads
   first) and each candle close with its "decided in" time. Keep the computer awake during market hours.
