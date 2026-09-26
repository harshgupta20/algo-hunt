# Project status — known issues, limitations and pending work

Snapshot as of **2026-09-25** (commit `51aec1d` + uncommitted MCX V2 work). Use this page as the working list of what still needs updating or
correcting. Each item says where the behaviour lives in the code.

> Related: [domain.md](domain.md) · [code-notes.md](code-notes.md) · [troubleshooting.md](troubleshooting.md)

---

## 1. What is in place

| Area | Status |
| --- | --- |
| NSE/BSE index F&O monitoring (NIFTY, BANKNIFTY, FINNIFTY, SENSEX, BANKEX) | Done |
| Built-in RSI Multi Confirmation strategy (S1/S2) | Done |
| No-code Strategy Builder (JSON strategies, AND/OR groups, versions, publish/disable) | Done |
| Strategy market profiles (specific / universal / basket) with server enforcement | Done |
| MCX commodities: 13 products, own tab (Overview · Monitors · Backtest), own session, monthly contracts, futures-only products | Done — not yet verified against live Kite data (see § 2.1) |
| Indicators: RSI, EMA, SMA, VWAP, MACD, Bollinger (incl. %B, Bandwidth), Supertrend, Price, Volume, OI, ADX, DMI | Done |
| Operators incl. >, <, ≥, ≤, cross above/below (Chartink-style), trend, range, % change, pattern "is detected" | Done |
| Multi-timeframe conditions (incl. Daily / Weekly) with forming-candle semantics | Done |
| Candle types: Normal, Heikin Ashi | Done |
| Candlestick pattern detection (17 patterns + bullish/bearish roll-ups) | Done |
| Backtesting (built-in with ATM tracking; custom; groups/baskets; CSV/JSON/Excel) | Done |
| Alerts: Telegram (optional), browser notification + chime, history with filters incl. Market | Done |
| Per-market status in the top bar (open/closed and whether monitors are running) | Done |
| Builder: adaptive comparison, price-level warning | Done |
| **V2 (beta)** at `/v2`: product-agnostic strategies (1–4 legs: Spot / Future / Call / Put, conditions between any legs) connected to NSE indices, NSE stocks or MCX commodities; compare a strategy across products (alerts only); explain now; Telegram + Email ([v2-architecture.md](v2-architecture.md), [trader guide](v2-user-guide.md)) | Built and tested (fixtures + local UI check) — **not yet verified against live Kite (product sync, candles) or real Telegram / Resend sends** |
| **MCX V2 (beta)** at `/mcx-v2`: isolated subsystem — futures, or strikes (around ATM / specific / range / all) with FUT + CE + PE legs in conditions, per-operand timeframe + candle type (incl. volume candles, 2h/4h/weekly), AND/OR/NOT, Telegram + Email (Resend), cooldown / once-per-candle / acknowledge, explain, replay, scanner runs ([mcx-v2-architecture.md](mcx-v2-architecture.md)) | Built and tested (fixtures) — **migration 006 not yet run on production; not yet verified against live Kite or real Telegram/Resend sends** |

---

## 2. Open issues (to correct)

Severity: **High** = can cause missed alerts or wrong data · **Medium** = misleading output · **Low** = polish.

### 2.1 High

| # | Issue | Details / where | Suggested fix |
| --- | --- | --- | --- |
| H1 | **Scheduler window must include MCX evenings** | The evaluator must run 09:00–00:05 IST on weekdays. The root README still says 09:15–15:40 and shows cron `* 3-10 * * 1-5`. Production scheduler settings live outside the repo | Set the cron to `* 3-18 * * 1-5` (Vercel) or equivalent — see [deployment.md § 5](deployment.md#5-scheduler-every-minute) |
| H2 | **MCX product names not verified against a live Kite instrument dump** | `MCX_PRODUCTS` symbols ([constants.ts](../src/shared/constants.ts)) must equal Kite's `name` column; a tradingsymbol-prefix fallback exists ([instrumentSync.ts](../src/server/services/kite/instrumentSync.ts)) | After the first MCX sync, check **MCX → Overview** shows 13/13 products "in the instrument master"; fix any symbol that doesn't match |
| H3 | **MCX never exercised on real Kite data** | All MCX verification used synthetic contracts and candles (tests + local preview) | Run one MCX monitor and one MCX backtest on a live session; confirm candle alignment (09:00), expiries and ATM strikes |

### 2.2 Medium

| # | Issue | Details / where | Suggested fix |
| --- | --- | --- | --- |
| M1 | Custom-strategy alerts show non-RSI values in RSI columns | `recordCustom` fills `future_rsi/call_rsi/put_rsi` from trace values (price, ADX, 1/0…). Alerts table and CSV show them as RSI with zone colors ([alertService.ts](../src/server/services/history/alertService.ts), [Alerts.tsx](../src/client/views/Alerts.tsx)) | Show the condition trace for custom alerts in the table; store a generic snapshot or leave the RSI columns empty |
| M2 | Monitor gauges for custom strategies show RSI vs the built-in levels (60/60/40) | `MonitorCard` / `RsiGauge` always plot RSI and `params` levels, regardless of the strategy's rules | Show the strategy's own condition values for custom monitors |
| M3 | Scenario counters and "Scenario Split" only count built-in alerts | `summarize()` counts `scenario` 1/2 only; custom alerts are invisible there | Add a "custom" bucket or a per-strategy breakdown |
| M4 | Backtest vs live warm-up differ at the start of a range | Backtests fetch run-timeframe candles only from the range start (indicators warm up inside the range); live monitors warm up with 300 bars. Extra timeframes *do* get warm-up in backtests | Fetch warm-up history before `from` for the run timeframe too |
| M5 | Backtests need candles on all three legs even for Future-only strategies | `fetchLegs` keeps only times present in future, call **and** put when the product has options; live monitors use only the referenced legs ([backtestRunner.ts](../src/server/services/analyzer/backtestRunner.ts)) | Filter times by the legs the strategy references, like the monitor service |
| M6 | Bollinger auto-pairing reads "band crosses above close" | Choosing Bollinger puts the band on the left and Close on the right; *Cross Above* then means price fell back below the band | Add a "⇄ Swap sides" button that swaps sides and mirrors the operator (offered, not built) |
| M7 | Backtests of custom strategies use contracts resolved **today** | Past option contracts that have expired have no intraday data on Kite. Ranges older than the current contracts return little data | Document in the UI; limit presets per contract life |
| M8 | Local development can write to the production database | Per project history, the local `.env` has used the production Neon database. The dev server uses whatever `DATABASE_URL` says, and an open dashboard triggers live ticks and instrument syncs | Use a Neon branch or local Postgres for development |

### 2.3 Low

| # | Issue | Details / where |
| --- | --- | --- |
| L1 | "Live" vs "scheduler idle" per market uses the **global** last-run time | [Topbar.tsx](../src/client/components/layout/Topbar.tsx) |
| L2 | Price-level warning is a heuristic (Future leg, value ≤ 100) | [comparison.ts](../src/client/views/builder/comparison.ts) |
| L3 | Candlestick pattern thresholds are inline numbers; the trend context is a simple 5-candle close comparison | [patterns.ts](../src/server/services/indicator/patterns.ts) |
| L4 | Non-multiple timeframe mixes (e.g. 10m run + 15m condition) approximate the forming candle until Kite's candle is available | [customEvaluator.ts](../src/server/services/strategy/customEvaluator.ts) |
| L5 | Group/basket backtest hour heatmap uses the first member's market | [backtestRunner.ts](../src/server/services/analyzer/backtestRunner.ts) `runGroup` |
| L6 | `KITE_API_ROOT` is read by the code but missing from `.env.example` | [kiteClient.ts](../src/server/services/kite/kiteClient.ts) |
| L7 | Root README predates MCX and the newer indicators in places | [README.md](../README.md) — this `docs/` folder is the up-to-date reference |
| L8 | Unused tables `devices` and `strategies` | [database.md § 3](database.md#unused-tables) |

---

## 3. Known limitations (by design or out of scope for now)

- **Exchange holidays and special sessions are not modelled** (e.g. MCX evening-only sessions, Muhurat trading). The
  session window is a weekday clock; on a holiday Kite returns no candles and nothing happens.
- **MCX session model covers non-agri products only** (09:00–23:30/23:55). Agri commodities have different hours.
- **Option legs have short histories**, so long Daily/Weekly indicators on Call/Put may never warm up. Futures use
  continuous data.
- **Kite requires a manual login every trading day** (~06:00 IST token reset).
- **Single-tenant:** one default user, one Telegram chat (from env vars), shared strategies/groups.
- **Kite historical rate limits** make long, many-strike backtests slow.
- **Alerts page shows up to 500 alerts** per query (API max 1000). **Analytics use the latest 5000 alerts.**
- **No automated tests** for Postgres SQL, Kite integration or the UI (see [testing.md § 5](testing.md#5-known-limitations)).

---

## 4. Pending / deferred work

| Item | Status | Notes |
| --- | --- | --- |
| Email alerts | **MCX V2 only** (Resend) | V1 / NSE alerts still Telegram + browser only |
| Volume candles | **MCX V2 only** | Volume-based bars from the series' candles, restarting daily; V1 has none |
| MCX V2 go-live | Pending | Run migration 006, sync MCX V2 instruments with Kite, configure Telegram/Resend, enter holidays, run side by side with V1 ([mcx-v2-architecture.md § C3](mcx-v2-architecture.md#c3-before-relying-on-it)) |
| MCX V2 → V1 migration (Phase 10) | Not started | V2 replaces `/mcx` only after a side-by-side validation |
| V2 handover to the trader | Pending | Sync products with Kite, configure channels, enter holidays, then the trader reviews [v2-user-guide.md](v2-user-guide.md) flows |
| V2 arithmetic operands (differences, % gaps, strike levels) | Not started | Left open in the operand model by request |
| Full MCX list (~26 products incl. Cardamom, Mentha Oil, Cotton, Rubber, Crude Palm Oil, Castor Seed, Black Pepper; indices Bulldex/Metldex) | Not started | Agri products need per-product session hours |
| "Swap sides" button in the condition editor | Offered, not built | See M6 |
| Scanner across all strikes/expiries | **Not planned** — the owner chose to keep one strike relative to ATM | |
| Multi-user support | Roadmap note in code | `DEFAULT_USER_ID` comment in [constants.ts](../src/server/db/constants.ts) |
| UI visual refresh | On hold | An app-wide "color-rich" redesign was rejected and reverted; agree on the direction first |

---

## 5. Decisions log

| Date | Decision |
| --- | --- |
| 2026-09-23 | Vercel-only deployment, cron-driven evaluation; all mock data removed ("real data only") |
| 2026-09-25 | MCX as a **dedicated tab and module**, sharing the indicator/strategy engine and alert store; NSE files kept intact where possible |
| 2026-09-25 | Keep NSE/BSE underlyings; add the 13 listed MCX products; the Strategy Library is shared across markets |
| 2026-09-25 | A strategy is NSE/BSE-pinned, MCX-pinned or universal; baskets can't mix markets; weekly expiries map to MCX months |
| 2026-09-25 | Multi-timeframe conditions use the forming higher-timeframe candle built from closed run candles (no look-ahead) |
| 2026-09-25 | Volume candles and email alerts deferred; strikes stay "one strike relative to ATM" |
| 2026-09-25 | Color-rich redesign rejected and reverted; the existing look is the baseline |
| 2026-09-25 | Top bar shows NSE/BSE and MCX separately with open/closed and monitor activity |
| 2026-09-25 | Bollinger %B / Bandwidth added; the builder adapts comparisons and warns on price-vs-small-number |
| 2026-09-26 | New **V2** at `/v2`: strategy (product-agnostic, 1–4 legs chosen by the trader) + product connection = alert; compare products by alerts only; comparing legs is enough for now, arithmetic kept in scope for later; nothing existing replaced |
| 2026-09-26 | MCX V2 conditions use FUT / CE / PE legs of a strike (simpler universe: product → futures or options → expiry → strikes; reference-future and fixed-contract choices removed; old definitions auto-upgraded) |
| 2026-09-25 | MCX V2 built as an isolated subsystem next to V1 (decisions D1–D9 accepted: Resend email, volume candles from base candles, spec cross semantics, ≤ 40 targets / ≤ 150 requests per cycle, same cron with its own lease, manual holiday calendar, 1-minute live mode, `/mcx-v2` beta page, Telegram env with MCX chat override) |

---

## 6. Verification status

| Claim | How verified |
| --- | --- |
| Engines, MCX rules, sessions, multi-timeframe, patterns, ADX/DMI, Bollinger outputs | Automated tests (212 passing: 61 MCX V2, 24 V2) |
| V2 leg resolution, product catalogue, one strategy across NSE + MCX products, compare, boundaries | Automated tests (`tests/v2/`) + local production build with a throwaway database (Kite disconnected) |
| MCX V2 engine, alert policy, both Definition-of-Done strategies end to end, module boundaries | Automated tests (`tests/mcx2/`) |
| MCX V2 UI (all tabs, light + dark), create / validate / enable flows, scan without Kite | Manually, local production build + throwaway database (Kite disconnected) |
| UI pages, MCX tab, top-bar market states, builder behaviour | Manually, in a local production build against a throwaway database with synthetic instruments and snapshots (Kite disconnected) |
| Live Kite behaviour for MCX (sync, candles, LTP) | **Not verified** |
| Top-bar "Live" (green) state with Kite connected | **Not visually verified** |
