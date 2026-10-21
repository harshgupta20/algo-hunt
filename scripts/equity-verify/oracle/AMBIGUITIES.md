# Oracle: choices where SPEC.md (v4) is silent or open to more than one reading

Written only from SPEC.md, without reading the production engine. Each item is the reading I implemented.
Sections V4 and V3 cover v4 and v3, section A covers v2, and section B covers v1 choices that still apply.

## V4. SPEC v4 (COARSE blocks)

V4-1. **The mask uses the loaded, repaired candles** (v2 repair has already replaced high and low), the same
      arrays the simulation uses. The blocks start at the first loaded row. As a result:
      - `dataFrom` shifts the block alignment;
      - `endDate` can change the last (short) block, and with it whether the most recent candles are coarse.
V4-2. **Rounding and the ratio**: `round()` is Python's; that only matters for an exact .5, where the distance is
      0.5 either way. The ratio is computed as `step / median * 100`. A median ≤ 0 is never coarse; prices are
      positive, so this cannot happen in practice.
V4-3. **Only the FIRST fitting step is tested**, as the spec says. Steps are tried from largest to smallest, so a
      smaller step could only give a smaller ratio. The result is therefore the same as "any step".
V4-4. **The coarse check only affects the candle being tested.** The circuit test for a non-coarse candle still
      compares with the previous close, even if that previous candle sits in a coarse block. NONE is still tested
      first, for every candle.

## V3. SPEC v3 (zero-volume NONE candles)

V3-1. **NONE** means `not (volume > 0)`, so a NaN volume also counts as NONE. It is tested before the circuit
      lock.

V3-2. **NONE only blocks fills.** Everything else still treats the candle as a normal candle:
      - it is a CHECK, so it can raise entry, exit, TIME and pyramid signals;
      - it sets `lastClose` and counts in the curve;
      - it is the "previous close" for the next candle's circuit test;
      - it feeds the indicators and the weekly candles;
      - its date is a market-calendar date, used by the "lapsed" rule.

      In NEXT_OPEN mode an exit signal on a NONE day therefore becomes a normal pending EXIT.

V3-3. **NONE in step 2**: the stock is skipped entirely (no stop, no target, no highWater update). On a
      locked-DOWN (not NONE) candle, targets and the highWater update still run; only stops are off (v2).

V3-4. **STUCK** exists only in CLOSE mode (an at-close exit hit by noSell). It lasts for that close only, so the
      position is re-evaluated at the next check. 3c already skips the stock because it is still holding.

V3-5. **A market-wide zero-volume day sits inside the market calendar.** The data has two: 2025-03-18 (112
      stocks) and 2026-01-15 (96 stocks). A NEXT_OPEN ENTRY/ADD signalled the day before is not "lapsed" (the
      stock did trade on the next market day) but is skipped "no-trades". It does not move to the next real
      session. Pending EXITs wait. This follows the spec literally.

## A. SPEC v2

A1. **Repair on load** happens in the loader (`evaluate.daily_bars`, used by `run.py`), before the weekly candles,
    the indicators and the circuit-lock test. high and low are both computed from the ORIGINAL four values, so a
    repaired high never feeds into the low. `simulate()` itself does not repair; the unit tests pass bars as written.

A2. **INTRADAY sum order** is brokerage + STT + exchange + SEBI + stamp + GST, then round2. DELIVERY uses
    STT + exchange + SEBI + stamp + DP + GST. These choices only matter at the ulp level.

A3. **Every sale re-charges same-day buys**, including the END valuation sale: it is dated with the stock's last
    processed date, and a buy fill on that date (bought at that day's open, or at the close in CLOSE mode) is
    re-charged INTRADAY. I applied the rule ("at a SALE on date D") literally. A re-charged fill's value is
    `fill.quantity × fill.price`, where `fill.price = round2(px)`. Since px is already whole paise, that equals
    the buy value.

A4. **Whole paise**:
    - Buys always fill at `ceil2`, even when slippage is 0.
    - Every market sell (`slippage = true`) uses `floor2(raw × (1 − slip))`, even when slippage is 0. A
      stop-touch sale at an unrounded stop price is therefore rounded DOWN to paise.
    - Stop prices themselves are not rounded. Only the target is, with `ceil2`.
    - The fill's `stopAfter` stays `round2(active stop)`.
    - A target sale and the END sale use the raw price.

A5. **Tolerant price rules** apply only where the spec says: step 2 a–d, the step-3a close stop, and the step-3b
    pyramid rule. These stay EXACT:
    - the active-stop tie-break (which of SL, trailing or pyramid labels the exit);
    - the highWater update;
    - the cash check (`+1e-9`);
    - the circuit-lock tests (`high == low`, close against the previous close).

A6. **Circuit lock** compares with the stock's previous row in the LOADED data, which can be before `from`. With
    `dataFrom`, the first loaded row is index 0 and can never be locked.

A7. **A pending EXIT on a locked-DOWN candle stays pending**, so:
    - 3a, 3b and 3c skip that stock, because it has a pending order;
    - step-2 targets still apply, since v2 only disables stops on a locked-DOWN candle. If a target sells the
      stock, the stale pending EXIT is dropped at its next candle as "not holding";
    - if it is still pending at the end, the END sale uses its reason and signal date.

A8. *(Resolved in v3.)* An at-close exit on a noSell candle leaves the stock STUCK, and step 3b skips it, so no
    ADD happens after a blocked exit.

A9. **Step-1 order for ADD/ENTRY**: first the silent precondition (ADD needs a position, ENTRY needs none), then
    lapsed, circuit and gap, in that order. EXIT has no "lapsed" rule, as the spec says.

A10. **"lapsed"** uses the case's own market calendar: the union of its stocks' dates in [from, to]. A stock that
     is alone in a case can therefore never lapse. A signal date always lies in this calendar.

A11. **Max positions at signal time** (3c, NEXT_OPEN) is holding − (stocks with a pending EXIT) + (stocks with a
     pending ENTRY). It counts every stock with a pending EXIT; in practice they are all still holding. The
     fill-time check inside `buy()` is unchanged: holding count only.

A12. **Shares (v2)**: `floor(n + 1e-9·max(1, n))` for AMOUNT and PERCENT only. QUANTITY stays `floor(value)`. A
     negative n (PERCENT with negative equity) floors normally and gives a "size" skip.

A13. **The END "end" skip for a pending ADD** is always recorded, never deduplicated. The stock is then sold with
     reason END, because the pending order is not an EXIT.

## B. Earlier choices (unchanged in v2)

### Conditions and data
B1. **Tolerant comparisons** (tol = 1e-9·max(1,|a|,|b|)) apply to every condition in entry and exit groups,
    including both legs of CROSSES. CROSSES reads the previous values at check k−1, with `barsAgo` applied
    relative to that check.
B2. **`dataFrom`**: rows kept are `dataFrom <= date <= endDate`. When it starts mid-week, the first partial week
    counts as a normal complete week, because only the last week can be incomplete.
B3. **`soldAtClose`** is set only by a step-3a exit filled at the close. It is never cleared; it is only compared
    with today's date.
B4. **BECOMES_TRUE** looks at `entry[k−1]` at the previous check whatever the position state was then, including
    checks before `from`. An empty or missing entry group is UNKNOWN, so the strategy never enters.

### Indicators
B5. **Ignoring na**: every single-source indicator (and `ma`) runs on the series with its na values removed, and
    the results are put back at their original bars.
B6. **Summation**: windows use Python `sum()`, which is compensated (Neumaier) summation. Results can differ from
    a naive JavaScript loop by a few ulps; the v2 tolerances absorb this.
B7. **SUPERTREND**: the first value is at index period−1. Warm-up bands count as na and nz() turns them into 0,
    as in Pine. The first direction is app −1 (downtrend) and the value is the upper band.
B8. **DMI/ADX**: division by zero gives na, then fixnan carries the last value forward. If there is no earlier
    value, the result stays na.
B9. **Operand handling**:
    - Integer-valued float params are treated as ints.
    - A non-numeric param, an unknown indicator, output, op, mode or rule, or a period < 1 makes that case an
      error.
    - Any of the five price fields is accepted as `source`; fixed-source indicators ignore it.
    - `ma.type` defaults to SMA. A missing `ma.period` is an error.
    - NUMBER operands ignore `barsAgo`. A negative `barsAgo` is applied as written.

### Simulation
B10. **Step 3 runs as three passes** over the checked stocks: all exits, then all pyramiding, then all new buys.
     Step 1 also runs as three passes.
B11. **Skip dates**:
     - A skip raised inside `buy()` (size, max, cash) is dated with the fill date.
     - The step-1 skips (lapsed, circuit, gap) are dated today, as the spec says.
     - The 3c "max" skip and the at-close "circuit" skips are dated with the signal date (today).
     - "end" skips are dated with the order's signal date.
B12. **Zero counts as "set"**: `stopLossPct` / `targetPct` / `trailingStopPct` equal to 0 count as set. Only null
     disables them.
B13. **highWater** starts at the first fill. It is raised only in step 2, after the stop/target tests, including
     on the entry day. ADD fills do not change it. The 3a close stop uses the already-raised highWater.
B14. **entryCheck** is the check index of the signal. TIME is measured in checks, so for `1w` it counts weeks. A
     pending order waits for that stock's next candle.
B15. **Equity** is `cash + qty·lastClose`, added left to right in symbol order. With `capital: null`, cash starts
     at 0.
B16. **round2** follows exact JS `Math.round`. `ceil2` and `floor2` follow the spec's ±1e-6 formulas. -0 is
     printed as 0.
B17. **END sale** is dated with the stock's last processed date and comes after all other trades, in symbol order.
B18. **Symbols and errors**: duplicate symbols are dropped. A missing data file makes the case an error. Error
     entries carry an extra `traceback` field.
B19. **Caching**: indicator columns and weekly bars are cached per data slice `(file, dataFrom, endDate)` and
     reused across the cases of a batch, with an LRU limit (150 slices × 16 `array('d')` columns). Results are
     identical to a per-case cache.
