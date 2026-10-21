# Equity — stock strategies (`/equity`)

Strategies for **NSE cash stocks**, separate from F&O (`/v2`): their own builder, engine, backtester, screener,
watchlists, database tables and API. **Equity** in the sidebar. Every control and number on the page has a tooltip, and
every stock in the trades, by-stock, signals-not-taken and screener lists has a **TradingView chart link** (NSE, on the
strategy's daily / weekly candles; TradingView has no date link, so the tooltip says which dates to scroll to).

> Related: [status.md](status.md) · [database.md](database.md) · [api.md](api.md) · [v2-architecture.md](v2-architecture.md)

## 1. Tabs

| Tab | What it does |
| --- | --- |
| **Strategies** | Saved strategies (edit, backtest, screen, duplicate, delete) and the template gallery — the trader's three strategies first, then classic setups (52-week breakout, golden cross, Supertrend, uptrend pullback, volume breakout). Opens the builder |
| **Backtest** | A strategy (saved, or the builder's unsaved one) on an index list / watchlist / picked stocks, over any period, with a starting capital (or none) and an optional maximum of stocks held. Runs in the background (progress, time left, cancel; survives tab switches). Results: final capital, return, CAGR, max drawdown, win rate, profit factor, trades, NIFTY 50 bought-and-held comparison, account value + drawdown chart, monthly returns, each trade with **every order and why** (indicator values at the signal), by stock with data notes, signals not taken, CSVs |
| **Screener** | Each stock at its last completed check: entry true / **fresh signal** (true now, not at the check before) / exit true, with every condition's two values |
| **Watchlists** | Your own stock lists; start from an index list (NIFTY 50 / Next 50 / 100 / Midcap 150 / Smallcap 250 / 500, F&O) or pick stocks |

## 2. The strategy

| Part | Options |
| --- | --- |
| Checked on | **Daily close** or **Weekly close** (when the week completes, on its last trading day) — chosen **once**: every buy condition, exit condition and the pyramiding MA use those candles |
| Buy when | Conditions in nested ALL / ANY groups. A value is a price field (open / high / low / close / volume), an indicator (SMA, EMA, WMA, RSI, MACD, Bollinger, ATR, Supertrend, ADX, DMI, highest / lowest of the previous N, ROC) or a number. Each value can be read N days / weeks ago, × a multiplier; RSI / ATR / ADX / ROC can take a **moving average of themselves** (RSI(14) with SMA(9) = TradingView's "RSI-based MA"). Operators: crosses above / below, >, ≥, <, ≤. **Buy on**: conditions true, or only when they turn true |
| Sell when (first of) | Target % · stop-loss % · trailing stop % (below the highest high since the first buy) · exit conditions (a group) · time exit (N checks) · the pyramiding stop. Target and stop-loss measured from the average price (moves with adds) or the first buy |
| Pyramiding | When the MA (SMA / EMA / WMA, period N, on the strategy's timeframe) **rises to the last buy price** and the close is at or above it → buy one more lot; **the stop for ALL lots becomes that MA value**. Repeats until a stop or any other exit sells everything. Optional max adds |
| Money per buy | ₹ per buy (whole shares) · shares per buy · % of the account's value. The same for the first buy and every add |
| Orders | **Not a choice** — the same for every strategy (`EQ_ORDER_RULES`): fill at the **next trading day's open** (what an end-of-day alert lets you do) with 0.1 % slippage, stops on **any day's low** (a stop-loss order), Zerodha delivery charges. The builder shows them in one line |

## 3. Exact rules (the engine follows these — `src/server/equity/engine/`)

- **Checks.** Daily: every trading day's close. Weekly: the last trading day of each completed week (Monday–Sunday,
  IST); the last week counts only when no weekday of it is left in the data. Every value reads the strategy's own
  candles — there are no per-value timeframes.
- **Old saved strategies** (from when a value could pick its own daily / weekly candles, and orders were set per
  strategy) are upgraded as they're read and on their next save (`shared/equity/normalize.ts`): when every entry
  value read one timeframe, the strategy takes it (a Daily strategy with "weekly close crosses above weekly SMA(20)"
  becomes Weekly, so its exits and pyramiding MA turn weekly too); the old order settings are dropped.
- **Crossings** compare this check with the previous one: *crosses above* = above now **and** at or below before
  (TradingView `ta.crossover`).
- **Too little history** → the condition is unknown → it neither buys nor sells. Extra history before the period is
  fetched automatically so indicators have settled on day one (recursive averages get several periods more).
- **Indicator maths** = the app's indicator library (Wilder RSI / ATR / ADX, EMA seeded with an SMA) — the tests
  compare every indicator candle by candle.
- **Each day, in order:** (1) orders signalled at the previous check fill at today's open — sells, then adds, then
  buys (alphabetical when cash is short); (2) stops and targets during the day — a gap through the stop sells at the
  open, otherwise at the stop when the low reaches it; a target sells at the target when the high reaches it (at the
  open on a gap up); **both in one day → the stop counts**; the trailing high is updated after; (3) at a check's close:
  exits, then pyramid adds, then new buys (never re-buying a stock sold the same day); (4) the account is valued at
  the close.
- **Stop** = the highest of stop-loss %, trailing stop and the pyramiding stop.
- **Skipped** (and listed): a buy the free cash can't cover, 0 shares for the money, over the max stocks held, a signal
  on the last check (it would fill after the period).
- **End of the period:** positions still held are valued at the last close (reason END, sell charges counted).
- **Only finished sessions:** today's candle counts after 15:40 IST on a weekday; Kite's forming candle is dropped.
- **Charges (delivery, per order):** STT 0.1 % on buys and sells, exchange 0.00297 %, SEBI ₹10 / crore, stamp
  0.015 % on buys, GST 18 % on exchange + SEBI, DP ₹15.34 per sell (GST already included — ₹3.50 CDSL + ₹9.50
  Zerodha + ₹2.34 GST). Slippage worsens buys, adds, stop and signal sells — not target limit orders — and each
  order's text shows the price before it (e.g. "bought at the next open (₹13,740.00 + 0.1% slippage)").
- **Survivorship bias:** stock lists are today's members.

## 4. Data

- **Stocks:** every NSE equity-series stock from Kite's NSE instrument list (≈3,050; REITs `-RR`, trade-for-trade
  `-BE` and bond series are left out), refreshed daily, kept in memory and in `data/equity-instruments.json` (never
  the database). Index lists and sectors from NSE's constituent files (via the market module); F&O = stocks with
  futures (from the F&O catalogue). Both are passed in by `server/api/context.ts`.
- **Candles:** daily candles from Kite (one request per stock covers ~1,900 days), weekly built from them, through
  the app's shared Kite queue (~3 requests a second). Kept in memory until a newer session finishes, so re-runs ask
  Kite only for what's new. Never in the database.

## 5. Code and boundaries

| Where | What |
| --- | --- |
| `src/shared/equity/` | Types, catalog, zod schemas, validation (units, bounds, history), plain-language text, templates |
| `src/server/equity/engine/` | `bars` (daily → weekly), `indicators` (whole columns), `evaluate` (conditions per check, audit text), `simulate` (the portfolio day by day), `charges`, `stats`, `backtest`, `screen` — pure, no I/O |
| `src/server/equity/` | `data/universe` (stock list, presets), `data/candles` (Kite + cache), `store/` (Pg / memory), `jobs` (background runs), `EquityService` |
| `src/client/equity/` | `EquityHub`, the builder (`strategies/`), `backtest/` (form, results, charts), `screener/`, `watchlists/`, `StockPicker`, `help.ts` |
| API | `src/server/api/controllers/equityController.ts`, routes under `/api/equity` (see [api.md](api.md)) |
| Database | `eq_strategies`, `eq_watchlists` (migration 012) — read once per process, then served from memory |

`tests/v2/boundary.test.ts` enforces the separation: Equity never imports F&O (V2) code and V2 never imports Equity;
`shared/equity` depends only on itself and zod; `server/equity` reaches outside itself only for the indicator maths,
logger, database pool and config.

## 6. Tests

`tests/equity/`: indicators vs the library (candle by candle) and hand-checked; the engine on hand-built candles
(crossings, fills at close / next open, the app's order rules with slippage in the order text, stop / target / gaps /
same-day, trailing stop, the pyramiding example with exact prices, max adds, any-exit-closes-all, weekly candles,
shared cash, max stocks held, charges, slippage, time exit, END, figures); the service (stock list filter, presets,
checks before saving, upgrading old strategies, watchlists, jobs, cache, cancel, finished sessions, screener);
TradingView links (`format.test.ts`).

## 7. Next

- **Connections & alerts:** strategy + watchlist → end-of-day entry / add / exit alerts (Telegram / email) and a
  position book that follows each alert (adds, current stop, P&L).
- A file cache of daily candles (instant first runs after a restart).
