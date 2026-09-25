# Domain guide — what the system does

Algo Hunt is an **alerting** platform for Indian derivatives. It never places trades. A **monitor** watches the
contracts of one underlying (a Future and, where options exist, the ATM Call and ATM Put). It evaluates a
**strategy** on every closed candle and records one combined **alert** when the strategy's rules turn true.

> Related: [architecture.md](architecture.md) · [api.md](api.md) · [status.md](status.md) (known issues)

Contents: [1 Markets](#1-markets-and-sessions) · [2 Contracts](#2-instruments-and-contracts) ·
[3 Strategies](#3-strategies) · [4 Market profiles](#4-strategy-market-profiles) · [5 Groups](#5-underlying-groups-and-baskets) ·
[6 Monitors](#6-monitors-live-evaluation) · [7 Alerts](#7-alerts) · [8 Backtesting](#8-backtesting) ·
[9 UI map](#9-ui-map) · [10 Glossary](#10-glossary)

---

## 1. Markets and sessions

The platform knows two **markets** (`Segment = 'NSE' | 'MCX'` in [src/shared/types/market.ts](../src/shared/types/market.ts)).
An underlying's market is looked up from its symbol with `segmentOf()` in [src/shared/constants.ts](../src/shared/constants.ts).

| | NSE/BSE index F&O | MCX commodity F&O |
| --- | --- | --- |
| Underlyings | NIFTY, BANKNIFTY, FINNIFTY (NFO); SENSEX, BANKEX (BFO) | GOLD, GOLDM, GOLDPETAL, SILVER, SILVERM, CRUDEOIL, CRUDEOILM, NATURALGAS, NATGASMINI, COPPER, ALUMINIUM, ZINC, NICKEL |
| Session (IST, weekdays) | 09:15–15:30 | 09:00–23:30 while the US observes daylight saving; 09:00–23:55 otherwise |
| Intraday candle alignment | 09:15 | 09:00 |
| Expiry choices | Current Weekly · Next Weekly · Monthly | Near Month · Next Month · Far Month |
| Strike interval | Fixed per index (50 / 100 / 50 / 100 / 100) | Read from the listed strikes (most common gap) |
| Options | Always | Only where MCX lists them; others are **futures-only** |
| Where you manage monitors | Configuration page | MCX tab |

**MCX close time.** `usDstInEffect(date)` in [src/server/utils/marketTime.ts](../src/server/utils/marketTime.ts)
returns true for IST trading days strictly between the 2nd Sunday of March and the 1st Sunday of November (MCX
switches on the following Monday). The close is 23:30 then, otherwise 23:55.

**Session helpers** (all take a `Session`, defaulting to NSE):

| Function | Meaning |
| --- | --- |
| `isMarketWindow(ms, grace=10, session)` | Weekday and between open and close + grace minutes |
| `isAnyMarketWindow(ms)` | NSE or MCX window open (used to gate the live tick) |
| `periodOpenMs(ms, tf, session)` | Open time of the candle containing `ms`: intraday aligned to the session open; daily = IST midnight; weekly = Monday 00:00 IST |
| `candleCloseMs(open, tf, session)` | Intraday: `min(open + tf, session close)`, so the last candle is truncated; daily = that day's close; weekly = Friday's close |

Exchange holidays are **not modelled**. On a holiday Kite returns no new candles, so evaluation is a no-op (see
[status.md](status.md)).

### Timeframes

`1m, 3m, 5m, 10m, 15m, 30m, 1h` (intraday), `1d` (Daily) and `1w` (Weekly), defined in `TIMEFRAMES` in
[src/shared/constants.ts](../src/shared/constants.ts). Kite has no weekly interval, so weekly candles are
aggregated from daily candles (Monday start) by `aggregateWeekly` in
[src/server/services/indicator/candles.ts](../src/server/services/indicator/candles.ts).

---

## 2. Instruments and contracts

### Instrument master

The `instruments` table holds FUT/CE/PE contracts of the supported underlyings, downloaded from Kite by
[src/server/services/kite/instrumentSync.ts](../src/server/services/kite/instrumentSync.ts).

| | NSE/BSE | MCX |
| --- | --- | --- |
| Kite exchanges | NFO, BFO | MCX |
| Row filter | `name` ∈ index symbols | `name` ∈ MCX product symbols, falling back to the tradingsymbol prefix (`GOLD25DECFUT` → `GOLD`) |
| Replace scope | Only rows of NFO + BFO | Only rows of MCX |
| Sync timestamp key (`app_kv`) | `instruments_synced_at` | `instruments_synced_at_mcx` |

A sync runs after every Kite login (both markets), when a market's copy is older than 18 h (checked on each live
tick), from **Settings → Refresh**, and on first load when the table is empty. A market that fails to sync is logged
and skipped; the other market still syncs. [InstrumentStore](../src/server/services/kite/instrumentStore.ts) caches
the master per instance for 10 minutes.

### Expiries

- **NSE:** `current-weekly` = nearest expiry, `next-weekly` = the one after, `monthly` = the last expiry in its
  calendar month.
- **MCX:** `near-month` / `next-month` / `far-month` = 1st / 2nd / 3rd upcoming expiry, counting **option expiries**
  if the product has options, otherwise **futures expiries**.
- **Mapping:** a strategy fixed to a weekly expiry still runs on MCX. `effectiveExpiryType()` maps Current weekly
  and Monthly → Near month, and Next weekly → Next month. The reverse is refused: MCX month expiries on an NSE
  underlying are a 400 error.

### Contracts a monitor watches (the "triplet")

`resolveTriplet()` returns `{ future, call?, put?, strike }`:

1. **Future** = the first future expiring on or after the chosen option expiry. For MCX this is the future the
   option devolves into.
2. **Strike** (only if the product has options):
   - NSE: `round(futureLTP / interval) × interval`, shifted by the selection (ATM, ATM±1, ATM±2).
   - MCX: the **listed** strike nearest the future LTP, then shifted along the listed strikes.
   - `CUSTOM` uses the strike you pick from the listed strikes.
3. **Call / Put** = CE / PE at that strike and expiry.
4. **Futures-only products** (no CE/PE listed) return `{ future, strike: 0 }`. Strategies that read the Call or Put
   leg, including the built-in one, are refused on them.

---

## 3. Strategies

### 3.1 Built-in: RSI Multi Confirmation (`rsi-sync`)

Implemented as a class in [src/server/services/strategy/rsiSyncStrategy.ts](../src/server/services/strategy/rsiSyncStrategy.ts)
and registered in `StrategyEngine`. It needs all three legs. Default params: RSI period 14, Future 60, Call 60,
Put 40, configurable per monitor.

| Scenario | Future RSI | Call RSI | Put RSI |
| --- | --- | --- | --- |
| **S1** — all three crossing | crosses **above** 60 | crosses above 60 | crosses **below** 40 |
| **S2** — future already above | **already** above 60 (prev ≥ 60 and curr ≥ 60) | crosses above 60 | crosses below 40 |

A *cross* means `prev < level ≤ curr` (above) or `prev > level ≥ curr` (below), so `59.99 → 60.01` counts. The
Future conditions of S1 and S2 are mutually exclusive, so a candle produces at most **one** alert, never one per
leg. RSI is Wilder's, computed incrementally ([rsi.ts](../src/server/services/indicator/rsi.ts)).

### 3.2 Custom strategies (Strategy Builder)

A custom strategy is JSON (`StrategyDef` in [src/shared/types/builder.ts](../src/shared/types/builder.ts)), stored
in `custom_strategies` and versioned in `strategy_versions`. The rules form a tree:

- **Group**: `logic` AND/OR, optional `label`, children (conditions or groups).
- **Condition**: `instrument` (future / call / put) · `indicator` (kind + params + output field) · `operator` · a
  right-hand side (`value`, `value2` for ranges, or `compareTo` indicator on `compareInstrument`) · `lookback` ·
  `timeframe` · `compareTimeframe` · `candle`.

**Status:** `draft` (not usable by monitors) → `active` ("Published") → `disabled` (monitors using it stop and show
an error). Every save increments `version`. The built-in strategy's rules are also available as builder JSON
([builtinStrategies.ts](../src/server/services/strategy/builtinStrategies.ts)); tests prove the generic evaluator
reproduces it exactly.

**Rising edge.** The evaluator fires only when the root turns false → true, so a strategy fires once per trigger,
not on every candle its conditions stay true. For an OR root, the first matching child group's `label` becomes the
alert's **variant** (e.g. "Scenario 1").

#### Operators

Defined in [builderCatalog.ts](../src/server/services/strategy/builderCatalog.ts) and evaluated in
[conditionEngine.ts](../src/server/services/strategy/conditionEngine.ts).

| Operator | Label | True when |
| --- | --- | --- |
| `gt` / `lt` / `gte` / `lte` | > < ≥ ≤ | Value vs right-hand side on every closed candle |
| `eq` / `neq` | = ≠ | Exact equality (useful for Supertrend direction ±1) |
| `crossAbove` / `crossBelow` | Cross Above / Below | `prev < rhsPrev` and `curr ≥ rhs` (mirror for below). Both sides are compared on both candles, so a moving comparison line only counts when the order flips |
| `rising` / `falling` | Rising / Falling | Now vs `lookback` candles ago |
| `above` / `below` | Above / Below | State: `≥` / `≤` right-hand side |
| `between` / `outside` | Range | Inside `[value, value2]` / outside it |
| `increasedByPct` / `decreasedByPct` | % change | Change vs `lookback` candles ago ≥ `value` % |
| `detected` | Is Detected | Candle patterns only: pattern completed on this candle |

#### Indicators

Implemented as streaming classes in [library.ts](../src/server/services/indicator/library.ts), specified for the UI
in [registry.ts](../src/server/services/indicator/registry.ts).

| Kind | Params (default) | Outputs (`field`) | Notes |
| --- | --- | --- | --- |
| `RSI` | period (14) | — | Wilder, 0–100 |
| `EMA` | period (20) | — | SMA-seeded |
| `SMA` | period (20) | — | |
| `VWAP` | — | — | Resets each calendar day (UTC date of the candle) |
| `MACD` | fast (12), slow (26), signal (9) | line · signal · hist | |
| `BBANDS` | period (20), mult (2) | upper · mid · lower · **percentB** · **bandwidth** | Population std-dev. %B = (close − lower)/(upper − lower); Bandwidth = (upper − lower)/mid × 100 |
| `SUPERTREND` | period (10), mult (3) | value · direction (+1/−1) | ATR-based |
| `PRICE` | — | close · open · high · low | |
| `VOLUME` | — | — | |
| `OI` | — | — | Open interest from Kite |
| `ADX` | period/DI length (14), smoothing (14) | — | Wilder RMA, TradingView-compatible |
| `DMI` | period (14) | plus (+DI) · minus (−DI) | |
| `PATTERN` | — | a candlestick pattern (below) | Output 1/0; tested with `detected` |

Every indicator supports `peek(bar)`, which returns the value a bar *would* produce without committing it. This is
used for forming higher-timeframe candles.

#### Candlestick patterns

[patterns.ts](../src/server/services/indicator/patterns.ts). The definitions are shape-based. Hammer / Hanging Man
and Inverted Hammer / Shooting Star share a shape and are told apart by the trend before them: the close just before
the pattern vs the close 5 candles earlier.

| Group | Patterns |
| --- | --- |
| Roll-ups | Any Bullish Pattern, Any Bearish Pattern |
| Neutral | Doji (body ≤ 10 % of range) |
| Bullish | Hammer, Inverted Hammer, Bullish Marubozu, Bullish Engulfing, Bullish Harami, Piercing Line, Morning Star, Three White Soldiers |
| Bearish | Hanging Man, Shooting Star, Bearish Marubozu, Bearish Engulfing, Bearish Harami, Dark Cloud Cover, Evening Star, Three Black Crows |

#### Candle types

`candle: 'normal' | 'heikinAshi'` applies to both sides of a condition. Heikin Ashi: close = (O+H+L+C)/4, open =
midpoint of the previous HA candle (first candle: (O+C)/2), high/low extended to include both.

#### Multi-timeframe conditions

A condition's `timeframe` (and `compareTimeframe` for the right side) can differ from the run timeframe (the
monitor's or backtest's). [customEvaluator.ts](../src/server/services/strategy/customEvaluator.ts) keeps one
**series** per instrument × timeframe × candle type:

- **Run timeframe:** fed the run's closed candles.
- **Larger timeframe** (e.g. Daily inside a 15-minute monitor): seeded with that timeframe's own candles
  (including warm-up history). Completed candles are committed once they close. The **still-forming** candle is
  built from the run candles seen so far in its period and read provisionally ("today's Daily RSI as of 11:15").
  Kite's final candle for a period is used only after that period has closed, so there's **no look-ahead**.
- **Smaller timeframe** (e.g. 15m inside a 1h run): reads the last candle of that timeframe that closed at or
  before the run candle's close.
- Daily/Weekly candles of the **future** are fetched with Kite `continuous=1`, stitching expired contracts
  together. Option legs have only their own short history, so long Daily/Weekly indicators may lack warm-up there.

#### Builder comparison helpers (client)

[src/client/views/builder/comparison.ts](../src/client/views/builder/comparison.ts):

- Each output has a unit (`scaleOf`): price · oscillator · MACD · direction · volume · OI · yes/no · %B ratio · band
  width %.
- Changing the indicator or output to a different unit adapts the right side. Price-type outputs switch to
  **Compare to → Indicator** (Bollinger / VWAP / Supertrend → Price Close; Price / EMA / SMA → a slower EMA). Other
  units switch back to a number with a typical level (RSI 60, ADX/DMI 25, MACD 0, %B 1, Bandwidth 2).
- The editor warns when two compared indicators are on different units, and when a **Future** price-type indicator
  is compared with a number ≤ 100.

---

## 4. Strategy market profiles

`StrategyDef.market` (`StrategyMarket`) fixes some of **underlyings, expiryType, strikeSelection, timeframe**. Any
field left unset is chosen per run. Rules live in [src/shared/strategyMarket.ts](../src/shared/strategyMarket.ts)
and are enforced server-side by [runContext.ts](../src/server/services/strategy/runContext.ts).

- **Specific** = every field fixed. A backtest asks only for the date range; creating a monitor takes one click.
- **Universal** = something open. Run forms show only the open fields; fixed ones show as locked chips.
- **Basket** = several fixed underlyings. A backtest merges all of them; "create monitor" makes one per underlying
  as a group.
- **Fixed values always win.** Running monitors re-sync to a changed profile on their next evaluation. A monitor
  whose underlying is no longer allowed is reported as an error.
- **Market rules** (`validateMarket`):
  - A basket can't mix NSE/BSE and MCX underlyings.
  - An MCX month expiry requires MCX underlyings.
  - `marketSegment()` / `runsOnSegment()` decide which strategies each tab lists: a strategy pinned to NSE doesn't
    appear in the MCX tab, and vice versa.
- **Legacy definitions** without `market` are normalized to universal (`normalizeStrategyDef`).

---

## 5. Underlying groups and baskets

- **Underlying group:** a saved set of underlyings (`underlying_groups`). The preset **Indices** group
  (`group-indices`) is virtual and read-only. Used to create one monitor per member, or to backtest the members
  together.
- **Config group (group monitor):** several monitors created together, sharing `group_id` / `group_name`, and
  activated / deactivated / deleted together (`/config-groups/*`). The MCX tab creates one when you select several
  products.

---

## 6. Monitors (live evaluation)

A **monitor** is an `alert_configurations` row: underlying, expiry type, strike selection (+ custom strike),
timeframe, strategy, RSI params, active flag, optional group.

**Activation** (`MonitorService.activate`, requires Kite):

1. Checks the custom strategy exists and isn't disabled.
2. Resolves the expiry date and contracts from the live future LTP.
3. Refuses option-leg strategies on futures-only products.
4. Writes `monitor_state` (locked contracts, activation time, empty cursor) and sets `active = true`.

**Each tick** (`runAll`), for every active monitor whose market is in session (all of them with `force`):

1. Re-sync with the strategy's market profile (fixed timeframe / expiry / strike changes re-lock the contracts).
2. Re-activate when state is missing or the locked expiry has passed (rolls to the next contract).
3. Fetch candles per leg: 300 warm-up bars on the run timeframe (104 weeks for weekly), shared across monitors in
   the run. Extra timeframes the rules read are fetched too.
4. Replay the closed candles through the evaluator. A candle can alert only if it:
   - opened **after** the previous cursor (`last_bucket`),
   - closed **after** activation, and
   - closed **≤ 30 minutes ago** (`MAX_ALERT_LAG_MS`; older ones are skipped but still advance the cursor).
5. Record the cursor and a snapshot (closed and provisional RSI per leg, LTP) for the gauges. Errors are stored in
   `last_error` and retried on the next tick.

**At most once per candle:** the cursor plus unique indexes on `alerts` — `(config_id, bucket, scenario)` and, for
custom strategies, `(config_id, bucket) WHERE scenario IS NULL`.

**Market status shown in the top bar** ([Topbar.tsx](../src/client/components/layout/Topbar.tsx)), per market:

| Label | Meaning |
| --- | --- |
| **Live · N monitors** | Open, monitors evaluated within the last 3 minutes |
| **Open · no monitors** (hollow dot) | Open, nothing running on this market |
| **Open · N monitors · scheduler idle** | Open with monitors, no evaluation in the last 3 minutes |
| **Open · N monitors paused** | Open with monitors, Kite offline |
| **Closed** / **Closed · N monitors waiting** | Outside the session |

---

## 7. Alerts

An alert (`alerts` table, `Alert` type in [src/shared/types/alert.ts](../src/shared/types/alert.ts)) is one strategy
trigger on one candle for one monitor.

- **Built-in alerts:** `scenario` 1/2, title `"<UNDERLYING> Strategy Triggered"`, and an RSI snapshot (prev/curr per
  leg).
- **Custom alerts:** `strategy_id`, `strategy_name`, `variant`, and `conditions` (a per-condition trace such as
  `58.90 → 61.30 · cross above 60.00 ✓`). Title: `"<UNDERLYING> · <strategy name>"`. The RSI snapshot columns are
  filled on a best-effort basis from the trace (see [status.md](status.md)).
- `triggeredAt` = the candle's **close** time. `bucket` = the candle's open time (epoch ms).
- **Delivery:**
  - Server side: Telegram (when both env vars are set), logged per channel in `notification_logs`.
  - Client side: a browser notification and chime for alerts the open tab hasn't seen (controlled by
    `user_preferences`).
- **Market of an alert** is derived from its underlying. The Alerts page, Dashboard (NSE only) and MCX tab (MCX
  only) filter by it.

---

## 8. Backtesting

[backtestRunner.ts](../src/server/services/analyzer/backtestRunner.ts), fronted by `POST /api/analyzer/run` and
`/chart`. Results are **never persisted**.

- **Date range:** presets today … last year, or custom (IST days) ([dateRange.ts](../src/server/services/analyzer/dateRange.ts)).
- **Built-in strategy:** fetches the future and **every strike that was ATM** during the range. Recomputing the ATM
  strike per candle from the future close makes the strike follow the price.
- **Custom strategy:** uses the contract set resolved today. Extra timeframes are fetched with warm-up history
  before the range start.
- **Groups / baskets:** run each member and merge. A failing member is skipped.
- **Stats** ([stats.ts](../src/server/services/analyzer/stats.ts)): totals, S1/S2, per-day avg/max/min, per week,
  distributions, a weekday heatmap and an hour heatmap (09–15 h NSE, 09–23 h MCX).
- **Chart window:** future candles ± 100 candles around a selected alert, RSI panes, markers.
- **Export:** CSV / JSON / Excel ([src/client/lib/export.ts](../src/client/lib/export.ts)).
- **Kite limits:** requests are split into windows per interval (e.g. 55 days for 1m, 180 for 15m, 1900 for daily)
  and spaced ~350 ms apart, so long ranges across many strikes take time.

---

## 9. UI map

| Route | View | Purpose |
| --- | --- | --- |
| `/` | [Dashboard.tsx](../src/client/views/Dashboard.tsx) | NSE/BSE: stat cards, MCX summary strip, active monitor gauges, latest alerts, performance charts |
| `/alerts` | [Alerts.tsx](../src/client/views/Alerts.tsx) | Feed / Table of all alerts with filters (Market, Underlying, Strategy, Timeframe, Scenario, dates), CSV export |
| `/strategies` | [StrategiesHub.tsx](../src/client/views/StrategiesHub.tsx) | Tabs: **Library** (built-in + yours; edit/duplicate/publish/disable/delete/backtest), **Builder**, **Backtest** |
| `/configuration` | [Configuration.tsx](../src/client/views/Configuration.tsx) | NSE/BSE monitors (single or group) and underlying groups |
| `/mcx` | [McxHub.tsx](../src/client/views/mcx/McxHub.tsx) | Tabs: **Overview** (session, product catalog, MCX monitors, MCX alerts, performance), **Monitors**, **Backtest** |
| `/settings` | [Settings.tsx](../src/client/views/Settings.tsx) | Kite connection + instrument master, notifications, theme, evaluator status, Telegram |
| `/login` | [LoginForm.tsx](../src/app/login/LoginForm.tsx) | Password sign-in |
| `/zerodhaRedirection`, `/redirect/zerodha` | [KiteRedirect.tsx](../src/client/views/KiteRedirect.tsx) | Kite OAuth landing: exchanges the `request_token`, returns to Settings |

Old URLs are redirected in [next.config.ts](../next.config.ts): `/library`, `/builder[/:id]`, `/analyzer`,
`/strategy/:id`, `/history`, `/analytics`.

---

## 10. Glossary

| Term | Meaning |
| --- | --- |
| **Underlying** | Index or commodity product whose derivatives are watched (NIFTY, CRUDEOIL, …) |
| **Leg** | One contract of a monitor: `future`, `call` (CE) or `put` (PE) |
| **Triplet** | The contracts a monitor locks: future + ATM call + ATM put (call/put absent for futures-only products) |
| **ATM** | At-the-money: the strike nearest the future's price |
| **Monitor / configuration** | A saved watch (underlying + strategy + timeframe…); *active* when evaluated live |
| **Bucket** | A candle's open time (epoch ms); the dedupe key for alerts |
| **Run timeframe** | The monitor's / backtest's candle size; conditions may read other timeframes |
| **Forming candle** | The current, not-yet-closed candle; never used for decisions on the run timeframe |
| **Rising edge** | The strategy's rules turning from false to true; the only moment it fires |
| **Scenario / variant** | Which built-in scenario (S1/S2), or which labeled custom rule branch, fired |
| **Specific / universal strategy** | All market fields fixed / some chosen per run |
| **Segment / market** | `NSE` (NSE/BSE index F&O) or `MCX` (commodities) |
| **Futures-only product** | An MCX product with no listed options |
| **Continuous data** | Kite day candles stitched across expired futures contracts |
