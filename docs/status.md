# Project status — known issues, limitations and pending work

Snapshot as of **2026-09-28**. Use this page as the working list of what still needs verifying or doing.

> Related: [v2-architecture.md](v2-architecture.md) · [code-notes.md](code-notes.md) · [troubleshooting.md](troubleshooting.md)

---

## 1. What is in place

| Area | Status |
| --- | --- |
| **V2** at `/v2` (the whole app): product-agnostic strategies (1–4 legs: Spot / Future / Call / Put, conditions between any legs, named AND/OR groups, Bollinger / RSI / ADX / MACD / Supertrend / patterns…) connected to NSE indices, NSE stocks or MCX commodities; compare a strategy across products; explain now; Telegram + email + desktop notifications ([v2-architecture.md](v2-architecture.md), [trader guide](v2-user-guide.md)) | Built and tested (fixtures + local UI checks) — **not yet verified against live Kite (product sync, candles) or real Telegram / Resend sends** |
| **Live worker** (`npm run live`): Kite WebSocket streaming, candles built from ticks, evaluation seconds after each close, results re-checked on Kite's candles before alerting, cron scanner as backup | Built and tested (fixtures + local boot) — **not yet run against the real Kite stream** (needs market hours) |
| **Paper trading** (on for every connection by default): alerts open simulated trades (₹10,000 each), closed by target / stop-loss / square-off / the other group / expiry, net of charges; values per strategy and per connection; Paper tab with headline figures, P&L charts, how trades closed, P&L by entry time, a sortable connection ranking, open positions and the trade log | Built and tested (fixtures + local UI checks) — **not yet run on live alerts** |
| Settings: Kite login, theme, desktop notifications | Done |
| V1 pages and MCX V2 | **Removed** 2026-09-27 (tables kept — [database.md § 3](database.md#3-retired-tables-left-untouched)) |

---

## 2. Open items

| # | Item | Details |
| --- | --- | --- |
| 1 | **First market-hours run of the live worker** | Log in to Kite, `npm run live -- --check`, then `npm run live`; watch Dashboard → Live feed ("decided in", checked / corrected counts) |
| 2 | **V2 on live Kite data** | V2 → Products → Sync from Kite; preview a connection; compare one strategy over a few days |
| 3 | **Real Telegram / email sends** | V2 → Settings → test buttons |
| 4 | **Scheduler window** | The backup scanner must run 09:00–00:05 IST on weekdays (see [deployment.md § 5](deployment.md#5-scheduler-every-minute)); the old V1 window stopped at the NSE close |
| 5 | **Chartink discrepancy** | A strategy alerted twice on Chartink and not in Compare; needs a candle-by-candle comparison (scan, product, timeframe, range, alert times) |
| 6 | Local development writes to the configured database | The local `.env` points at the production Neon database; use a Neon branch for experiments |

---

## 3. Known limitations

- **Kite requires a manual login every trading day** (~06:00 IST token reset); the live worker reminds you on
  Telegram 15 minutes before the open.
- **Kite historical rate limit (~3 requests/s)** limits the per-minute scanner and Compare; the live worker avoids it
  for evaluation (streaming) and uses it only for warm-up and confirmations.
- **Kite streams at most 9,000 contracts per login**; connections beyond that are checked by the scanner.
- **Holidays and special sessions are data**: enter them in V2 → Settings → Market calendar.
- **Option legs have short histories**, so long Daily/Weekly indicators on CE / PE may never warm up.
- **Backtests use today's contracts** (Kite has no candles for expired ones), with option strikes fixed around ATM at
  the start of the period, and are limited in length per timeframe (as Compare).
- **Paper trading is an approximation:** fills are the last traded price ± slippage (no order book); without the live
  worker, stops and targets are checked once a minute on the latest price; futures / sold-option margin is estimated
  (≈12 % indices, 20 % stocks, 10 % MCX), not Kite's exact SPAN + exposure; charges use Zerodha's published rates
  (update `src/server/v2/paper/charges.ts` when they change); a late square-off (worker and scanner both off) uses the
  last price seen.
- **Single user**: one default user; one Telegram chat (env or V2 settings override).
- **No automated tests** for Postgres SQL, the Kite integration or the UI.

---

## 4. Decisions log

| Date | Decision |
| --- | --- |
| 2026-09-29 | Neon's monthly network-transfer allowance ran out (connections blocked, data kept). Database reads cut: contracts cached until the next sync (were re-read every minute per connection — ~48 MB/h for a NIFTY-sized chain), the alarm polls a feed of new alerts (was ~97 MB/h with the app open), lists without condition traces, status by counts, closed paper trades reused, live-worker context reloaded only on change |
| 2026-09-28 | **Backtest tab**: a strategy on up to 20 products over a past period with a starting capital and paper settings — alerts found as in Compare, each traded like a paper trade with exits walked on the contract's 1-minute Kite candles (stop wins a same-minute tie, gaps fill at the open); trades the money can't cover are skipped and listed; final capital, return, the paper figures and charts, by product, every trade |
| 2026-09-28 | One filter bar for Alerts (active / history / signals) and Paper: strategy, period (today … custom), product, type, market, timeframe, fired group, candles, delivery, outcome, side — filtered on the server. Dev hot reloads now rebuild the API's service container (a stale container served old paper results and crashed the Paper tab) |
| 2026-09-28 | Paper trading **on by default for every connection** (existing and new); each connection can change its own values (📄 chip) over its strategy's; the Paper tab reworked for decisions (period filter, profit factor, P&L by day / entry time, how trades closed, sortable connection ranking, stop → target bars) |
| 2026-09-28 | Paper trading: optional per strategy (off until switched on), prefilled with ₹10,000 per trade for every strategy, +20 % / −10 %, square-off 15:20 NSE / 23:20 MCX, exit on the other group, charges + 0.5 % slippage; one position per connection and strike position; results on a dedicated Paper tab |
| 2026-09-27 | V1 pages (Dashboard, Alerts, Strategies, Configuration, MCX) and MCX V2 removed — code, API routes, cron jobs and tests; **their database tables kept untouched**. `/` and old page URLs redirect to `/v2`; the top bar and desktop notifications now follow V2; Settings keeps the Kite login, theme and notifications |
| 2026-09-23 | Vercel-only deployment, cron-driven evaluation; all mock data removed ("real data only") |
| 2026-09-25 | MCX as a **dedicated tab and module**, sharing the indicator/strategy engine and alert store; NSE files kept intact where possible |
| 2026-09-25 | Keep NSE/BSE underlyings; add the 13 listed MCX products; the Strategy Library is shared across markets |
| 2026-09-25 | A strategy is NSE/BSE-pinned, MCX-pinned or universal; baskets can't mix markets; weekly expiries map to MCX months |
| 2026-09-25 | Multi-timeframe conditions use the forming higher-timeframe candle built from closed run candles (no look-ahead) |
| 2026-09-25 | Volume candles and email alerts deferred; strikes stay "one strike relative to ATM" |
| 2026-09-25 | Color-rich redesign rejected and reverted; the existing look is the baseline |
| 2026-09-25 | Top bar shows NSE/BSE and MCX separately with open/closed and monitor activity |
| 2026-09-25 | Bollinger %B / Bandwidth added; the builder adapts comparisons and warns on price-vs-small-number |
| 2026-09-27 | V2 live worker (`npm run live`, runs locally): Kite WebSocket streaming, candles built from ticks, evaluation seconds after each close; results that would alert, near misses that matter, and gap-affected data are re-checked on Kite's official candles before deciding (alerts marked Verified / Unverified); ATM ± 2 strikes kept warm; cron scanner becomes the backup; Neon stays the database |
| 2026-09-26 | New **V2** at `/v2`: strategy (product-agnostic, 1–4 legs chosen by the trader) + product connection = alert; compare products by alerts only; comparing legs is enough for now, arithmetic kept in scope for later; nothing existing replaced |
| 2026-09-26 | MCX V2 conditions use FUT / CE / PE legs of a strike (simpler universe: product → futures or options → expiry → strikes; reference-future and fixed-contract choices removed; old definitions auto-upgraded) |
| 2026-09-25 | MCX V2 built as an isolated subsystem next to V1 (decisions D1–D9 accepted: Resend email, volume candles from base candles, spec cross semantics, ≤ 40 targets / ≤ 150 requests per cycle, same cron with its own lease, manual holiday calendar, 1-minute live mode, `/mcx-v2` beta page, Telegram env with MCX chat override) |

---

## 5. Verification status

| Claim | How verified |
| --- | --- |
| V2 engine, legs, catalogue, validation, compare, scanner, alert policy, live worker logic, boundaries; indicator maths; market-time helpers | Automated tests (101 passing: 59 V2, 42 indicators / market time) |
| App after the V1 / MCX V2 removal: redirects, V2 tabs, Settings (Kite card, notifications), top bar, Kite / preference / V2 APIs, removed APIs → 404, cron → V2 scan, live worker boot and clean stop | Local production build against a throwaway database (Kite and Telegram disabled) |
| V2 live worker against the real Kite stream | **Not verified** — needs market hours |
| V2 against live Kite data and real Telegram / Resend sends | **Not verified** |
