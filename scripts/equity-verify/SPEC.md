# Equity backtest — reference specification (for an independent implementation)

This is the behaviour an NSE cash-stock (long-only, delivery) backtester must have — the rules the production
engine (`src/server/equity/engine/`) follows, written so that someone who has NOT read the engine can build an
INDEPENDENT reference implementation (pure Python 3, standard library only) whose output is diffed against it.
`oracle/` is that implementation; `oracle/AMBIGUITIES.md` lists the choices it made where this text is silent.

**Changing the engine's rules?** Change this spec in the same commit, then change `oracle/` from the spec alone
(not by reading the engine), and run `npm run verify:equity`. "(vN" marks show when a rule was added.

---------------------------------------------------------------------------------------------------------------
## 0. Data

Daily candles, one JSON file per stock: `{"symbol", "date": [yyyy-mm-dd...], "open": [...], "high": [...],
"low": [...], "close": [...], "volume": [...]}` — sorted ascending, one row per trading day (IST date).
**Repair on load (v2):** high = max(open, high, low, close), low = min(open, high, low, close) for every candle
(a bad tick can put the open outside the day's range).

### Weekly candles (built from daily)
- Weeks run Monday–Sunday by the IST date. Group consecutive daily rows with the same Monday.
- Weekly open = first day's open, high = max high, low = min low, close = last day's close, volume = sum.
- A weekly candle's `date` = its LAST trading day. Each weekly candle remembers its last daily index.
- Every week is complete except possibly the last one: the last week is complete only if `endDate >= the Friday
  of that week` (Friday = Monday + 4 days). `endDate` is an input (yyyy-mm-dd).

## 1. Indicators (TradingView Pine v5 semantics) — file `oracle/indicators.py`

Expose `operand_column(bars: dict, operand: dict) -> list[float]` returning one float per candle of `bars`
(`bars` has keys open/high/low/close/volume lists and date), with `float('nan')` where the value is not defined
yet. The caller passes daily or weekly bars. Do NOT apply `barsAgo` here (the evaluator does).

Operand shapes:
- `{"kind": "PRICE", "field": "open|high|low|close|volume"}` → that column.
- `{"kind": "INDICATOR", "indicator": ID, "params": {...}, "source"?: field, "output"?: str, "ma"?: {"type":
  "SMA|EMA|WMA", "period": n}, "multiplier"?: number}`.
  Missing params use defaults; missing `source` uses the default source; missing `output` uses the first output.
- NUMBER operands never reach this function.

| ID | params (default) | sources (default first) | outputs (default first) |
|---|---|---|---|
| SMA | period 20 | close, open, high, low, volume | — |
| EMA | period 20 | same | — |
| WMA | period 20 | same | — |
| RSI | period 14 | close, open, high, low | — |
| MACD | fast 12, slow 26, signal 9 | close | line, signal, hist |
| BB | period 20, stdDev 2 | close | upper, mid, lower, percentB, bandwidth |
| ATR | period 14 | (fixed: whole candle) | — |
| SUPERTREND | period 10, multiplier 3 | (fixed) | value, direction |
| ADX | period 14, smoothing 14 | (fixed) | — |
| DMI | period 14 | (fixed) | plus, minus |
| HIGHEST | period 20 | high, close, low, open, volume | — |
| LOWEST | period 20 | low, close, high, open, volume | — |
| ROC | period 10 | close, volume | — |

Definitions (n = period; "na" = NaN):
- **SMA** (ta.sma): mean of the last n values; na until n values exist.
- **EMA** (ta.ema): alpha = 2/(n+1). The first value (at the n-th defined source value) is the SMA of the first n
  values; then ema = alpha·x + (1−alpha)·ema[1].
- **RMA** (ta.rma, used by RSI/ATR/DMI/ADX): alpha = 1/n, seeded with the SMA of the first n values, then
  rma = (rma[1]·(n−1) + x)/n.
- **WMA** (ta.wma): Σ (n−j)·x[i−j] for j=0..n−1, divided by n(n+1)/2.
- **RSI** (TradingView's built-in RSI): change = x − x[1] (na on the first bar); up = rma(max(change,0), n);
  down = rma(max(−change,0), n) (the RMA seeds on the first n changes, so the first RSI is at index n);
  rsi = down == 0 ? 100 : up == 0 ? 0 : 100 − 100/(1 + up/down).
- **MACD**: line = ema(src, fast) − ema(src, slow) (defined once both are); signal = ema(line, signal) seeded with
  the SMA of the first `signal` defined line values; hist = line − signal.
- **BB**: basis = sma(src, n); dev = population standard deviation of the last n values (divide by n), where a
  deviation |x − basis| ≤ 1e-10 counts as 0 (TradingView's ta.stdev — a flat window has zero width) (v5);
  upper = basis + stdDev·dev; lower = basis − stdDev·dev; mid = basis;
  percentB = (src − lower)/(upper − lower) (na when upper == lower);
  bandwidth = (upper − lower)/basis × 100 (na when basis == 0).
- **True range**: tr[0] = high − low; tr[i] = max(high−low, |high − close[i−1]|, |low − close[i−1]|).
- **ATR** = rma(tr, n).
- **SUPERTREND(period, multiplier)** = TradingView `ta.supertrend(factor=multiplier, atrPeriod=period)`:
  ```
  src = hl2 ; atr = ta.atr(atrPeriod)              // atr = rma(tr, period) as above
  upperBand = src + factor * atr ; lowerBand = src - factor * atr
  prevLowerBand = nz(lowerBand[1]) ; prevUpperBand = nz(upperBand[1])     // previous FINAL bands, 0 if na
  lowerBand := lowerBand > prevLowerBand or close[1] < prevLowerBand ? lowerBand : prevLowerBand
  upperBand := upperBand < prevUpperBand or close[1] > prevUpperBand ? upperBand : prevUpperBand
  if na(atr[1])            _direction := 1
  else if prevSuperTrend == prevUpperBand   _direction := close > upperBand ? -1 : 1
  else                     _direction := close < lowerBand ? 1 : -1
  superTrend := _direction == -1 ? lowerBand : upperBand
  ```
  (prevSuperTrend = superTrend[1]). Output `value` = superTrend. Output `direction` uses THIS APP'S convention,
  the opposite sign of TradingView's: **+1 = uptrend** (TradingView −1), **−1 = downtrend** (TradingView +1).
  Values are na while atr is na.
- **DMI / ADX** (ta.dmi(len=period, adxSmoothing)):
  ```
  up = high - high[1] ; down = -(low - low[1])            // na on the first bar
  plusDM  = na(up) ? na : (up > down and up > 0 ? up : 0)
  minusDM = na(down) ? na : (down > up and down > 0 ? down : 0)
  trur  = rma(tr, len)        // tr here is na on the first bar (no previous close), so it starts at bar 1
  plus  = fixnan(100 * rma(plusDM, len) / trur)
  minus = fixnan(100 * rma(minusDM, len) / trur)
  sum = plus + minus
  adx = 100 * rma(abs(plus - minus) / (sum == 0 ? 1 : sum), adxSmoothing)
  ```
  fixnan = when the value is na (e.g. division by zero) use the last non-na value. DMI outputs plus / minus
  (DMI's own ADX smoothing is irrelevant); ADX uses params period and smoothing.
- **HIGHEST / LOWEST**: highest / lowest of the PREVIOUS n values — the current candle is NOT included
  (= TradingView `ta.highest(src, n)[1]`); na until n previous values exist.
- **ROC**: 100·(x − x[n])/x[n]; na when x[n] == 0 or not available.
- **ma** (a moving average of the indicator's selected line): SMA / EMA / WMA of period ma.period applied to the
  indicator's line. TradingView rule for na values inside a series: **na values in the source are ignored** — the
  average is computed over the last `period` non-na values, the output at a bar whose source is na is na, and the
  average continues afterwards (a single na must not break everything after it). Same rule inside the plain
  SMA/EMA/WMA/RSI/etc. if a source column ever contains na mid-series.
- **multiplier**: multiply the final value (after `ma`).

## 2. Strategy definition (JSON)

```
{ name, timeframe: "1d" | "1w",
  entry: { when: GROUP, trigger: "WHEN_TRUE" | "BECOMES_TRUE" },
  exit: { targetPct: number|null, stopLossPct: number|null, trailingStopPct: number|null,
          priceBase: "AVERAGE" | "FIRST_BUY", when: GROUP|null, maxBars: int|null },
  pyramid: { enabled: bool, maType: "SMA"|"EMA"|"WMA", maPeriod: int, maxAdds: int|null },
  sizing: { mode: "AMOUNT"|"QUANTITY"|"PERCENT", value: number } }
GROUP     = { type: "AND"|"OR", id, children: [GROUP|CONDITION...] }
CONDITION = { type: "CONDITION", id, left: OPERAND, op: "CROSSES_ABOVE"|"CROSSES_BELOW"|"GT"|"GTE"|"LT"|"LTE", right: OPERAND }
OPERAND   = PRICE | INDICATOR (see §1) | {kind:"NUMBER", value}; PRICE/INDICATOR may carry "barsAgo": int
```

## 3. Checks and conditions — file `oracle/evaluate.py` (or inside simulate.py)

- **One timeframe**: every operand and the pyramiding MA are computed on the strategy's candles (daily bars for
  "1d", weekly bars for "1w").
- **Checks** (the closes at which the strategy is evaluated):
  - "1d": every daily candle. Check k ↔ daily index k. Own index = k.
  - "1w": every COMPLETE weekly candle, in order. Check k is at the daily index of that week's last day; its own
    index is the weekly candle's index.
- **Reading an operand at check k**: NUMBER → its value. Otherwise col = operand_column(strategy bars, operand);
  i = ownIndex(k) − (barsAgo or 0); value = col[i] if 0 ≤ i < len(col) else na.
- **Condition value** (tri-state TRUE / FALSE / UNKNOWN) at check k with L = left value, R = right value:
  - if L or R is na → UNKNOWN.
  - Floating-point ties count as EQUAL: tol(a, b) = 1e-9 × max(1, |a|, |b|).
    GT: a − b > tol; GTE: a − b ≥ −tol; LT: b − a > tol; LTE: a − b ≤ tol.
  - CROSSES_ABOVE: needs k ≥ 1 and the previous CHECK's values pl, pr (both non-na, else UNKNOWN):
    TRUE iff GT(L, R) and LTE(pl, pr). CROSSES_BELOW: TRUE iff LT(L, R) and GTE(pl, pr). (k = 0 → UNKNOWN.)
- **Groups**: AND → FALSE if any child FALSE; else UNKNOWN if any child UNKNOWN or no children; else TRUE.
  OR → TRUE if any child TRUE; else UNKNOWN if any child UNKNOWN or no children; else FALSE.
- The exit group counts only if it contains at least one CONDITION somewhere; otherwise there is no exit group.
- **Pyramiding MA** at check k = the operand {kind: INDICATOR, indicator: maType, params: {period: maPeriod}}
  (source close) read at check k.
- **Entry signal at check k**: entry[k] is TRUE and (trigger == WHEN_TRUE, or k == 0, or entry[k−1] is not TRUE).

## 4. The simulation — file `oracle/simulate.py`

Inputs: definition, list of stocks (symbol + daily bars), `from`, `to` (inclusive IST dates), `capital`
(number or null = unlimited), `maxPositions` (int or null), `endDate` (for weekly completeness), and order
`rules = {fill: "NEXT_OPEN"|"CLOSE", stopTrigger: "TOUCH"|"CLOSE", charges: bool, slippagePct: number}`.

Indicators are computed over each stock's FULL supplied history (including candles before `from`); the
simulation only trades on dates in [from, to].

### Rounding
`round2(x)` = JavaScript `Math.round(x*100)/100`, i.e. floor(x*100 + 0.5)/100 — NOT Python's banker's round().

### Charges (Zerodha), per order, when rules.charges is true (else 0)   (v2: new exchange rate + intraday)
DELIVERY(side, value): STT 0.1 % of value (buy and sell); exchange 0.00307 % of value; SEBI = value × 10/1e7;
stamp duty 0.015 % of value on BUYS only; DP charge ₹15.34 on SELLS only (GST already included in it);
GST 18 % of (exchange + SEBI). = round2(sum).
INTRADAY(side, value): brokerage = min(0.03 % of value, ₹20); STT 0.025 % of value on SELLS only; exchange and
SEBI as above; stamp 0.003 % of value on BUYS only; GST 18 % of (brokerage + exchange + SEBI); no DP. = round2(sum).
Every buy is charged DELIVERY(BUY, value) when it fills. At a SALE on date D: let todayQty = Σ quantity of the
position's BUY fills dated D. For each such fill, replace its charges with INTRADAY(BUY, fill.quantity × fill.price)
(cash += old − new; position charges += new − old; the fill's recorded charges become the new value). The sale's
charges = if todayQty == 0: DELIVERY(SELL, qty × px); elif todayQty == qty: INTRADAY(SELL, qty × px);
else round2(INTRADAY(SELL, todayQty × px) + DELIVERY(SELL, (qty − todayQty) × px)).

### Slippage and whole paise   (v2)
slip = slippagePct/100. ceil2(x) = ceil(x·100 − 1e-6)/100; floor2(x) = floor(x·100 + 1e-6)/100.
Every buy fills at px = ceil2(raw × (1 + slip)). Market sells (slippage) fill at px = floor2(raw × (1 − slip)).
Target sales are limit orders and the END valuation uses the last close: NO slippage, px = raw.

### Price-rule tolerance   (v2)
The simulator's price rules use the same tolerance as conditions: atLeast(a, b) = NOT (b − a > tol),
atMost(a, b) = NOT (a − b > tol), below(a, b) = (b − a > tol), with tol = 1e-9 × max(1, |a|, |b|).
This replaces the exact comparisons in step 2, step 3a (CLOSE stop) and step 3b (pyramid rule) below.

### Calendar
The simulated dates = the sorted union of all stocks' daily dates within [from, to]. (v2) The MARKET calendar is the
same list; nextMarketDay(d) = the date after d in it (none after the last).
**Circuit lock (v2):** a stock's candle at daily index i ≥ 1 is LOCKED when high == low and close ≠ close[i−1]:
locked UP if close > close[i−1], locked DOWN if close < close[i−1] (one price all day = circuit limit).
**Coarse history (v4):** per stock, over its LOADED daily candles in blocks of 40 starting at the first loaded
candle (the last block may be shorter): collect the block's open/high/low/close values; skip the block if they hold
fewer than 5 distinct values; else find the FIRST step in [5, 1, 0.5, 0.25, 0.1] such that every value x satisfies
|x/step − round(x/step)| < 1e-6; if found, let closes = the block's closes sorted ascending and median =
closes[floor(len/2)]; the block is COARSE if step / median × 100 ≥ 0.2. A candle in a COARSE block is never locked
UP / DOWN (the circuit test is skipped for it — rounded history makes one-price days meaningless); the volume rule
(NONE) still applies to it.
**No trades (v3):** a candle with volume == 0 (or not > 0) is NONE — nothing can fill on it. NONE is checked first
(a zero-volume candle is NONE even if it also looks locked). Let noBuy = UP or NONE (SKIP category "circuit" for
UP, "no-trades" for NONE) and noSell = DOWN or NONE. Each stock has a pointer to
its next daily row; on a date, only stocks that HAVE a candle that day ("today's stocks") act. Stocks are always
processed in alphabetical order of symbol (plain string comparison). Each stock remembers `lastClose` = the close
of its last processed candle (initially the close of its last candle BEFORE `from`, or none).

### Position state
qty, buyValue (Σ shares × fill price over all buys incl. slippage), charges (Σ of all order charges),
firstPrice (first fill price), lastBuyPrice (latest buy fill price, incl. slippage), adds (count), pyramidStop
(null or a price), highWater (initialised to the first fill price), entryCheck (check index of the entry SIGNAL),
entryDate (date of the first fill), fills list.
avg = buyValue/qty. base = avg if priceBase == AVERAGE else firstPrice.

### Stops and target of a position
Candidate stops: stop-loss = base × (1 − stopLossPct/100) [if set]; trailing = highWater × (1 − trailingStopPct/100)
[if set]; pyramid stop [if not null]. The ACTIVE stop is the highest price among them; on a tie the later in this
order wins (stop-loss < trailing < pyramid) — (v6) a tie means within the price-rule tolerance: a candidate replaces
the current one when atLeast(candidate, current) — this only decides the exit reason label
(STOP_LOSS / TRAILING_STOP / PYRAMID_STOP). target = ceil2(base × (1 + targetPct/100)) [if set] (v2: a limit at a
whole-paisa price).

### Sizing — shares(price) where price is the fill price INCLUDING slippage
QUANTITY → floor(value). AMOUNT → n = value / price. PERCENT → n = (equity × value/100) / price, where
equity = cash + Σ over held stocks of qty × lastClose (at the moment of the buy). For AMOUNT / PERCENT the shares
are floor(n + 1e-9 × max(1, n)) (v2: an exact whole number never floors one lower because of float noise).

### buy(stock, rawPrice, date, kind ENTRY|ADD, signalDate, signalCheck, stopAfter?)
1. px = ceil2(raw × (1 + slip)); q = shares(px). If q < 1 → SKIP (category "size").
2. If kind == ENTRY and maxPositions is set and (number of stocks currently holding a position) ≥ maxPositions →
   SKIP (category "max").
3. value = q × px; ch = charges(BUY, value). If capital is not null and value + ch > cash + 1e-9 → SKIP ("cash").
4. cash −= value + ch. Reset the stock's last-skip marker for this kind (see Skips).
5. ENTRY (or no position): new position (firstPrice = lastBuyPrice = highWater = px, entryCheck = signalCheck,
   entryDate = date, adds 0, pyramidStop null). ADD: adds += 1; lastBuyPrice = px; if stopAfter given,
   pyramidStop = stopAfter.
6. qty += q; buyValue += value; charges += ch. Record a fill {date, side BUY, kind, quantity q, price round2(px),
   charges ch, signalDate, stopAfter: round2(active stop price AFTER this buy) or null if no stop}.

### sell(stock, rawPrice, date, reason, signalDate, slippage: bool)
px = floor2(raw × (1 − slip)) if slippage else raw. value = qty × px; re-charge today's buys and compute the sale's
charges ch as in "Charges" above; cash += value − ch; position charges += ch. Fill {date, side SELL, kind EXIT, quantity qty, price round2(px), charges ch, signalDate,
stopAfter null}. Trade record: {symbol, entryDate, exitDate = date, exitReason, quantity = qty, adds,
avgPrice = round2(avg), exitPrice = round2(px), invested = round2(buyValue), grossPnl = round2(value − buyValue),
charges = round2(position charges), netPnl = round2(value − buyValue − position charges),
returnPct = round2(net/buyValue × 100) (net unrounded), holdingDays = calendar days from entryDate to exit date,
fills}. The stock then has no position.

### Each date, in this order
**Step 1 — orders signalled at the previous check fill at today's OPEN** (only relevant with fill NEXT_OPEN; only
for today's stocks; a pending order is consumed even if it can't fill). Three passes over today's stocks:
first all pending EXITs, then all pending ADDs, then all pending ENTRYs. (v2 rules:)
- EXIT: if not holding → drop it. If noSell (v3: locked DOWN or NONE) → it stays pending (retried at the stock's
  next candle). Else sell at the open (slippage).
- ADD (needs a position, else drop) / ENTRY (needs no position, else drop), checked in this order:
  1. if nextMarketDay(signalDate) exists and ≠ today → SKIP category "lapsed" (the stock didn't trade on the
     market's next day; a day order lapses);
  2. elif noBuy (v3) → SKIP category "circuit" (UP) or "no-trades" (NONE);
  3. elif ADD and atMost(open, stopAfter) → SKIP category "gap" (it would open at/below the stop it sets);
  4. else buy at the open (ADD with its stopAfter).
  (Every SKIP here is dated today, kind = ADD or ENTRY, through the usual skip-marker rule.)

**Step 2 — during the day**, for each of today's stocks holding a position (after step 1):
(v3) If today's candle is NONE, skip this stock entirely in step 2 (no stop, no target, no highWater update).
stop = active stop (may be none), target = target price (may be none); touch = (rules.stopTrigger == TOUCH) and
today's candle is NOT locked DOWN (v2).
  a. if touch and stop and atMost(open, stop) → sell at OPEN, reason = the stop's reason, slippage.
  b. elif target and atLeast(open, target) → sell at OPEN, reason TARGET, no slippage.
  c. elif touch and stop and atMost(low, stop) → sell at the STOP price, stop's reason, slippage.
  d. elif target and atLeast(high, target) → sell at the TARGET price, reason TARGET, no slippage.
  Then, if still holding, highWater = max(highWater, today's high).
  (signalDate of these sells = today.)

**Step 3 — at the close.** First set lastClose = today's close for all of today's stocks. The stocks with a CHECK
today are today's stocks whose daily index is a check index (k). Fill-at-close mode: atClose = (fill == CLOSE).
  a. **Exits** — for each checked stock holding a position with NO pending order:
     reason = (stopTrigger == CLOSE and stop exists and below(close, stop)) → the stop's reason;
              elif the exit group exists and is TRUE at k → EXIT_RULE;
              elif maxBars set and k − entryCheck ≥ maxBars → TIME.
     If a reason: atClose → if noSell (v3) the stock is STUCK for this close: no sale, and step 3b skips it (no add);
     else sell at the close (slippage) and set the stock's soldAtClose = today; not atClose → pending EXIT
     {signalDate today, signal check k}.
  b. **Pyramiding** (if enabled) — for each checked stock holding a position with no pending order and not STUCK:
     due = MA(k) is a number and atLeast(MA, lastBuyPrice) and atLeast(close, MA) and (maxAdds null or
     adds < maxAdds) (v2: tolerant). If not due: reset the stock's ADD skip marker; continue. If due:
     not atClose → pending ADD {stopAfter = MA}; atClose → if noBuy: SKIP "circuit" / "no-trades" (kind ADD,
     today); else buy ADD at the close with stopAfter = MA.
  c. **New buys** — for each checked stock with no position, no pending order and soldAtClose ≠ today (a stock
     sold EARLIER today — at the open, or intraday by a stop/target — CAN buy again):
     if there is no entry signal at k: reset the stock's ENTRY skip marker; continue.
     atClose → if noBuy: SKIP "circuit" / "no-trades"; else buy ENTRY at the close. Not atClose: if maxPositions is set and
     (stocks holding) − (stocks with a pending EXIT) + (stocks with a pending ENTRY) ≥ maxPositions → SKIP ("max")
     (v2: a stock already being sold at the next open frees its place); else pending ENTRY {signalDate today,
     signal check k}.

**Step 4** — advance today's stocks' pointers; record curve point {date, equity = round2(cash + Σ qty × lastClose
over held stocks)}. (With capital null, cash starts at 0 and may go negative.)

### End of the period
For each stock (alphabetical): a pending ENTRY or ADD (v2: ADD too) → SKIP with category "end" (kind ENTRY / ADD,
date = its signal date).
If holding and lastClose exists: sell at lastClose with NO slippage, date = the stock's last processed date (or
`to`), reason = the pending EXIT's reason if one is pending, else END; signalDate = pending exit's signalDate or
that last date. Finally set the LAST curve point's equity to round2(cash).

### Skips (list of {symbol, date, kind ENTRY|ADD, category})
Each stock keeps a last-skip category per kind (ENTRY, ADD), initially none. A skip is recorded only when its
category differs from the stored one (then stored). The stored category is reset to none on a successful buy of
that kind, when an ENTRY check has no signal (3c) and when an ADD is not due (3b).

## 5. Output — `oracle/run.py`

CLI: `python3 -I oracle/run.py CASES.json OUT.json` where CASES.json = list of
`{id, definition, symbols: [..], dataDir, from, to, capital, maxPositions, endDate, dataFrom?, rules}`; load each
symbol's candles from `dataDir/<SYMBOL with "&" replaced by "_AND_">.json`, keep only rows with date ≤ endDate and,
when `dataFrom` is given, date ≥ dataFrom.
OUT.json = list of `{id, trades: [...], skipped: [{symbol, date, kind, category}], curve: [{date, equity}],
error?: str}` with trades in the order they were closed. Never crash a whole batch on one case — catch per case.

Performance matters a little (thousands of cases × ~10 stocks × up to ~6000 candles): cache indicator columns per
(stock, timeframe, operand) within a case.
