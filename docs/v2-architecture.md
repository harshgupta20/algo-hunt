# V2 — Strategy + Product = Alert

Status: **beta at `/v2`** (sidebar "V2 · beta"). Runs alongside everything else — NSE monitors, the MCX tab and
MCX V2 are unchanged. Trader guide: [v2-user-guide.md](v2-user-guide.md).

> Related: [architecture.md](architecture.md) · [api.md § 4.13](api.md#413-v2--strategy--product--alert) ·
> [database.md](database.md#v2-tables-007) · [mcx-v2-architecture.md](mcx-v2-architecture.md) (the earlier MCX-only design V2 generalises)

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
- The engine (candles, indicators, evaluator, alert policy) is the one proven in MCX V2, re-typed for legs:
  completed-candle mode evaluates once per trigger candle on closed candles; live mode every minute on forming
  candles; crosses = previous ≤ and current >; missing data is `UNKNOWN` and never alerts; `ON_TRANSITION` needs the
  previous result to be `FALSE`; signal identity = connection · strategy version · unit · candle (deduped in the DB).
- **Market sessions** come from `MarketCalendar` per market: NSE / BSE 09:15–15:30, MCX 09:00–23:30 / 23:55
  (US-DST rule), plus holidays / special sessions per market from `v2_calendar`. Candles align to each session's open.
- Connections whose market is closed are skipped; NSE connections stop at 15:35 while MCX ones continue.

## 4. Scanner

Same staged, failure-isolated cycle as MCX V2 ([mcx-v2-architecture.md § 6](mcx-v2-architecture.md#6-scanner-pipeline)),
per connection: gate by market → connections + strategies + products → provider + instrument freshness → trigger
clock → one batched LTP call for every ATM reference → units → due units → fetch plan within the request budget
(`v2_settings.requestBudget`, default 150) → fetch (each contract once per cycle, shared across connections) →
evaluate → policy → signal → alert → Telegram / Email. It runs as a **third isolated job** in `/api/cron/tick`
(own lease `v2-scan`) and while `/v2` is open.

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
├── scanner/          V2Scanner
├── debug/            tools (explain now, compare across products)
├── persistence/      V2Store · PgV2Store (v2_* tables, migration 007)
├── V2Service.ts      operations behind /api/v2/*
└── index.ts          createV2Module() — wired into the API context
src/client/v2/        V2Hub (tabs) · strategies/ (editor, legs, conditions) · connections/ · compare/ · alerts, products,
                      scanner, settings, dashboard · ProductPicker · ExplainView · help.ts (tooltips)
```

A boundary test (`tests/v2/boundary.test.ts`) keeps V2 independent: it never imports MCX V2 or V1 business modules,
so either can be retired without touching V2; the rest of the app imports V2 only at the wiring points.

## 6. Persistence

Migration `007_v2.sql` (additive):

`v2_instruments` (all markets) · `v2_products` (catalogue built at sync) · `v2_calendar` (market + date) ·
`v2_strategies` / `v2_strategy_versions` · `v2_connections` (config JSON: expiry, strike shifts, alert policy) ·
`v2_unit_state` · `v2_signals` (unique identity) · `v2_alerts` / `v2_deliveries` · `v2_scan_runs` · `v2_settings`.
Deleting a strategy cascades to its connections, their unit states, signals and alerts.

## 7. Compare — how to read it

- Contracts are the ones **listed today** (Kite serves no intraday history for expired contracts). Option legs are
  fixed at the strikes around the ATM of the **first trigger candle** of the period.
- Candles before a contract existed, or during indicator warm-up, count as "too little data" (the **coverage**
  column); low coverage means the alert count isn't comparable.
- Longest period depends on the trigger timeframe (e.g. 20 days of 15-minute candles, 1 year of daily).

## 8. Verification

- `tests/v2/` — 24 tests: product mapping from Kite dumps, NSE calendar, leg resolution (spot-based ATM on NSE,
  future-based on MCX, strike positions, missing legs, spot / futures-only), validation, the boundary guard, and an
  end-to-end suite with one FUT-vs-CE strategy connected to NIFTY, BANKNIFTY and GOLD (alerts only where both
  conditions hold, market gating, no re-alerting, compatibility refusal, channel check on switch-on, explain, compare).
- Checked locally (production build, throwaway database, Kite disconnected): every tab renders; strategies with
  1–4 legs, connections (including the refusal for incompatible products), compare and scan report missing data
  honestly.

## 9. Before handing over

1. Migration 007 runs on the next `npm run dev` / Vercel build (additive).
2. Log in to Kite, then **V2 → Products → Sync from Kite** (downloads NSE, BSE, NFO, BFO and MCX lists; ~1 minute).
3. Configure Telegram (`TELEGRAM_BOT_TOKEN` + chat id) and/or email (`RESEND_API_KEY` + recipients) in V2 → Settings.
4. Enter this year's NSE and MCX holidays in V2 → Settings → Market calendar.
