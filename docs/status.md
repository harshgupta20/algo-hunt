# Project status — known issues, limitations and pending work

Snapshot as of **2026-10-01**. Use this page as the working list of what still needs verifying or doing.

> Related: [v2-architecture.md](v2-architecture.md) · [code-notes.md](code-notes.md) · [troubleshooting.md](troubleshooting.md)

---

## 1. What is in place

| Area | Status |
| --- | --- |
| **V2** at `/v2` (the whole app): product-agnostic strategies (1–4 legs: Spot / Future / Call / Put, conditions between any legs, named AND/OR groups, Bollinger / RSI / ADX / MACD / Supertrend / patterns…) connected to NSE indices, NSE stocks or MCX commodities; compare a strategy across products; explain now; Telegram + email + desktop notifications ([v2-architecture.md](v2-architecture.md), [trader guide](v2-user-guide.md)) | Built and tested (fixtures + local UI checks) — **not yet verified against live Kite (product sync, candles) or real Telegram / Resend sends** |
| **Database: Neon + memory layer** — one process (`npm start` / `npm run dev`: app + live worker); hot data in memory, Neon only for core records, saved in the background (alerts never wait; retried while Neon is unreachable, kept across restarts); lists reused until the next alert; Settings → Database: size vs 0.5 GB and Keep history (default everything) ([database.md § 5](database.md#5-database-traffic)) | Built and tested (store spec on the memory layer, call counts over a simulated session, an alert during a database outage, restart with waiting writes, history clean-up) — **not yet run against Neon** |
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
| 7 | **Back on Neon** | Check Neon → *Review usage* that the transfer allowance has reset; set `DATABASE_URL` in `.env.local`; restart (migrations up to 011 apply); watch Neon's usage for a trading day. Stop any deployed copy / scheduler reading the same database |
| 8 | **Desktop `.exe`: first real install** | Actions → Desktop app → Run workflow, install the `.exe` on Windows (Git + Node.js present): wizard → first start (clone, install, build) → Kite login in the window → an alert → tray → Quit → start again (should take seconds) |

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
- **Signals and Scanner history since the app started** (memory mode): signals that didn't alert and scanner runs
  aren't saved; alerts, alerting signals and paper trades are.
- **One running copy per database**: two copies (e.g. this laptop and a Vercel deployment with its scheduler) each
  scan and alert.
- **No automated tests** for Postgres SQL, the Kite integration or the UI.

---

## 4. Decisions log

| Date | Decision |
| --- | --- |
| 2026-10-04 | **Windows `.exe`: the `.bat` as a program** (the user: same as the `.bat`, but feeling like Windows software, nothing else to hand over). `desktop/` (Electron) installs with an NSIS installer (welcome, disclaimer, Windows 10+ check). A setup wizard saves the settings encrypted instead of a `.env`. Each start runs the `.bat`'s steps on a start-up screen: git clone / fetch, `npm install` (only when `package-lock.json` changed), `npm run build` (only for a new version), `next start` on 127.0.0.1:3000. Then its own window, signed in; tray; clean stop over IPC. Needs Git and Node.js like the `.bat`. Built by hand-run GitHub Actions (`desktop-app.yml`); no release repository or auto-updater, since the code updates itself from GitHub ([desktop.md](desktop.md)) |
| 2026-10-04 | **Strategy filter: counts + several at once.** The strategy dropdown became chips with each strategy's count under the other filters (alerts / signals / paper trades; `GET /api/v2/{alerts,signals,paper}/counts` — one grouped query, reused in memory with this run's records added by sequence number). Choose several strategies (`strategyIds`) to see them together. Checked on real data (160 alerts: 33 + 127) |
| 2026-10-04 | **Backtest exit rules** (the trader's sheet: exit on MA / RSI crossing below a level, or the last-3-candles low): each trading group gets an optional AND / OR condition tree (the strategy editor's), checked at every close of its smallest timeframe; exit at that close (`EXIT_RULE`), other exits still apply. New indicator **N-candle low / high** (`RANGE`: lowest low / highest high of the previous N candles). Backtest only — live paper trading still exits by target / stop / square-off / other group / expiry. Checked on real data (15-min strategy, 4 indices, 2 weeks) |
| 2026-10-04 | **Backtest run on real data** (Kite candles, the trader's 4 strategies, Neon read-only): works, 1–9 s per run. Found and fixed: **MCX lot sizes** — Kite lists every MCX contract with lot size 1, so paper trades / backtests / margin / charges counted a CRUDEOIL lot as 1 barrel (100× too small, and far too many "lots" per trade). Now the real units per lot are applied when the contract list is imported (`MCX_LOT_UNITS`: Gold 100, Gold Mini 10, Gold Petal 1, Silver 30, Silver Mini 5, Crude 100, Crude Mini 10, Natural Gas 1,250, NatGas Mini 250, Copper 2,500, Aluminium / Zinc 5,000, Nickel 250). Takes effect after the next contract sync (Products → Sync from Kite, or the 08:15 sync); MCX paper trades closed before it keep their old (too small) figures |
| 2026-10-02 | **Backtest checked end to end** on a simulated month of NIFTY / RELIANCE minute data through the app's stack (engine numbers verified: entry ± slippage, target / stop in 1-minute candles, charges, capital). What looked like "not working": without a Kite login it returned an empty result (now a clear 409, Compare too); 0 trades with the reason hidden in a collapsed row (now a box at the top: no alerts, or every alert skipped by reason with what to change — e.g. the default ₹1,00,000 can't cover one futures lot's margin); daily / weekly strategies never trade with the square-off on (now said in the notes and the reason); the capital / cash-per-trade / % boxes jumped to their minimum while typing (now a number box that corrects only when you leave it). Option strikes stay fixed at the period's start (a known limit) |
| 2026-10-02 | **One `.bat` for the trader** (the user's choice — a single file, no launcher scripts): `start-algo-hunt.bat` sits in a folder with the `.env`; each start clones (first time) or fetches + resets the `algo-hunt` folder to GitHub (token written in the `.bat`), copies the `.env` in, `npm install`, `npm run build`, `npm run start`, opens the browser; already running → opens the browser. The app also saves waiting records when its window is closed (SIGHUP). Not yet run on Windows |
| 2026-10-02 | **Fewer database reads + long lists paged.** Closed paper trades are read once at start and kept in memory (each paper exit used to re-read every closed trade — MBs per exit); alert / signal list pages are kept and new records merged in from memory (each alert used to re-read the open lists); today's alerts open from memory; the daily contract sync rewrites only products whose fingerprint changed (was a ~100,000-contract comparison); unit states load without old saved evaluations. Alerts, signals, the paper trade log, backtest trades / skipped alerts and products load a page at a time with infinite scroll (50, products 100); every filter is applied on the server per page; the trade log's Winners / Losers moved to the server; CSV exports every matching trade. Postgres paging and the fingerprint sync are not yet run against Neon |
| 2026-10-01 | **Local SQLite database removed** (the user's call): Neon via `DATABASE_URL` is the only database. Gone: `SqliteV2Store`, `SqliteAppStore`, the SQLite schema, daily backups and `npm run backup` / `restore` / `db:import`. Existing `data/algo-hunt.db*` and `backups/` files are left on disk (git-ignored) and no longer read |
| 2026-10-01 | **Neon free plan made safe.** Alert / signal lists are cached until an alert changes them (the 5-minute list refreshes kept Neon awake all day — ~80 of 100 compute-hours with the app open in market hours, all of them if left open overnight). Event writes go through a background queue: Telegram, the alarm and paper trades never wait for Neon; while it's unreachable writes retry and survive restarts (`data/pending-writes.json`); the top bar warns. Pool: 10 s connect / 60 s query timeouts, idle-connection errors no longer fatal. Settings → Database: size against 0.5 GB and **Keep history** — default *everything* (the user asked not to shrink data); a chosen period deletes older alerts, signals and closed paper trades daily after a confirmation. Old scanner cycles (> 3 days) removed at start. Recommended: Neon compute fixed at 0.25 CU; one running copy per database; develop on the local file |
| 2026-10-01 | **Back to Neon, with far fewer database calls.** The app runs as one process (the live worker inside `npm start` and now `npm run dev`), so hot data stays in memory (`RuntimeV2Store`, `RuntimeAppStore`) and Neon gets only core records: config (cached, written through), alerts + deliveries, alerting signals with a shallow trace, paper trades on open / close, unit state when the alert decision changes. Memory only: scan runs, non-alerting signals, evaluations, live status, locks, paper marks. Off on Vercel, with `LIVE_WORKER=off` and next to a separate `npm run live` (lock file in the temp folder). Postgres instrument sync is a daily diff. The SQLite file stays as the fallback without `DATABASE_URL` |
| 2026-09-29 | **Local database by default**: SQLite built into Node.js in `data/algo-hunt.db` (git-ignored), schema applied on start; Postgres only when `DATABASE_URL` is set. `npm start` runs the app, the live worker and daily backups (newest 14) in one process; `npm run setup` / `update` / `backup` / `restore` / `db:import`. Chosen for the trader's laptop (i5, 8 GB, Chrome + other software): no database server or extra install; measured ~140 MB for the whole app process. Data never goes into git (snapshots instead) |
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
| V2 engine, legs, catalogue, validation, compare, scanner, alert policy, live worker logic, boundaries; indicator maths; market-time helpers | Automated tests (172 passing: 130 V2, 42 indicators / market time) |
| App after the V1 / MCX V2 removal: redirects, V2 tabs, Settings (Kite card, notifications), top bar, Kite / preference / V2 APIs, removed APIs → 404, cron → V2 scan, live worker boot and clean stop | Local production build against a throwaway database (Kite and Telegram disabled) |
| Desktop `.exe` | Start steps run end to end with Node.js (local repository as the source): clone → install → build → start → clean stop; again with nothing changed (≈1 s, install / build skipped); a new version (build only); offline (starts what it has); the token never in logs. The real Electron app run hidden on Linux: wizard bridge (Git / Node.js found, checks), *Start* from the wizard (save → clone from GitHub → install → build stops on a fake database with the right message), start with saved settings (start-up screen → signed-in `/v2` window in ≈6 s), quit (app exits with code 0, port freed). Kite in the hidden app: *Connect Kite* with a wrong key → Kite's 400 page detected → *Fix Kite keys* → wizard on the Kite step; Kite's redirect back (`/zerodhaRedirection`) arrives signed in and is handled (the token exchange then needs the real database). The wizard's key check rejects an unknown key against Kite (a valid key not tried). Packaged with `--win dir` (only its own files). Installer additions compiled with NSIS. Screens checked in headless Chrome. **Not yet installed on Windows** |
| V2 live worker against the real Kite stream | **Not verified** — needs market hours |
| V2 against live Kite data and real Telegram / Resend sends | **Not verified** |
