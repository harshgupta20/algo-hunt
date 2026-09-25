# Code notes — complex areas and inline-documentation recommendations

Source files were **not** modified for this documentation pass. Most modules already start with a header comment
that explains their purpose and invariants, which is a good practice worth keeping. The list below points at the
code that is genuinely hard to follow and says what extra documentation (or small refactor) would help.

> Related: [architecture.md](architecture.md) · [domain.md](domain.md) · [status.md](status.md)

## 1. Multi-timeframe series — `customEvaluator.ts`

[src/server/services/strategy/customEvaluator.ts](../src/server/services/strategy/customEvaluator.ts) — `Series.onRunCandle`

**What's tricky:** for a larger timeframe, it (a) finishes the previous period when a run candle belongs to a new
one, (b) commits older seeded candles, (c) merges the run candle into a partial aggregate, and (d) either commits
the period (if it closes exactly now) or exposes the partial as a *provisional* candle read through `peek()`.
`finish()` prefers Kite's own candle for a period and falls back to the aggregate.

**Recommend:**
- A short invariant comment on the fields: `pending` sorted by period open; `next` points at the first uncommitted
  seed; `partial` belongs to the current period only.
- A note that timeframes which are not multiples of each other (e.g. a 10m run with a 15m condition) aggregate
  approximately until Kite's candle is available.
- A note that `value(ref, back)` shifts `back` by one while a provisional candle exists.

## 2. `BaseIndicator.peek()` — state cloning

[src/server/services/indicator/types.ts](../src/server/services/indicator/types.ts)

**What's tricky:** `peek` deep-copies the instance's own properties (keeping class prototypes) except `outputs`, then
runs `compute` on the copy. This silently breaks if a future indicator's `compute` reads `this.outputs`, or keeps
state in `Map`/`Set`/closures.

**Recommend:** keep the existing warning on `compute`, extend it to mention `Map`/`Set`/closures, and add one test
per new indicator asserting `peek(bar) === (update(bar), value())` (the pattern in
[indicatorsExtra.test.ts](../tests/indicatorsExtra.test.ts)).

## 3. Live evaluation cursor — `monitorService.ts`

[src/server/services/live/monitorService.ts](../src/server/services/live/monitorService.ts) — `evaluate`, `evaluateCustom`

**What's tricky:**
- The full warm-up window is replayed on every run. Only candles passing `isNew` (after the cursor, closed after
  activation) *and* `isFresh` (≤ 30 min old) can alert.
- The cursor is taken from the **future** leg's last closed candle.
- Custom strategies are evaluated only on times present in **every** referenced leg.

**Recommend:** document why the future leg drives the cursor (it always exists, including futures-only products),
and that a missing option candle for a time means that time is skipped for strategies reading option legs.

## 4. Lease SQL — `PgLockRepository.acquire`

[src/server/db/pg/pgStore.ts](../src/server/db/pg/pgStore.ts)

**What's tricky:** one `INSERT … ON CONFLICT DO UPDATE … WHERE` enforces two rules at once: no live lease **and** the
last run ended at least `minIntervalSeconds` ago. `release()` sets `last_run_at`.

**Recommend:** a comment on the SQL stating both conditions and that `force` passes `minIntervalSeconds = 0`.

## 5. Custom-alert snapshot — `alertService.recordCustom`

[src/server/services/history/alertService.ts](../src/server/services/history/alertService.ts)

**What's tricky:** custom alerts fill `future_rsi / call_rsi / put_rsi` with the `curr` value of the last trace per
leg, whatever the indicator is (price, ADX, pattern 1/0…). Tables and the CSV label these columns as RSI.

**Recommend:** document this clearly in the code, and consider a schema change (a generic `snapshot` JSON, or only
filling the columns for RSI traces). Tracked in [status.md](status.md).

## 6. Contract resolution — `instrumentStore.ts`

[src/server/services/kite/instrumentStore.ts](../src/server/services/kite/instrumentStore.ts)

**What's tricky:**
- NSE uses registry intervals and **exact** strike matches.
- MCX uses the most common listed gap (`strikeInterval`) and snaps to the **nearest listed** strike
  (`listedStrike`).
- Futures-only products short-circuit to `{ future, strike: 0 }`.
- `nearestFuture(onOrAfter)` picks the future the option devolves into.

**Recommend:** a table-style comment at the top listing these per-market rules (they are currently spread across
methods).

## 7. Expiry mapping — `strategyMarket.ts` / `runContext.ts`

`effectiveExpiryType` (weekly → month on MCX) plus `expiryNotAllowed` (MCX months refused on NSE) plus
`validateMarket` (no mixed baskets; MCX months need MCX underlyings) together form the cross-market rules.

**Recommend:** a pointer comment in each function to the others, since the rules only make sense together.

## 8. Kite login races — `kiteAuth.exchange`

[src/server/services/kite/kiteAuth.ts](../src/server/services/kite/kiteAuth.ts)

**What's tricky:** a failed exchange is ignored if a session was stored within the last **120 s**. This absorbs a
double-fired redirect that hit another serverless instance.

**Recommend:** name the constant (e.g. `CONCURRENT_EXCHANGE_WINDOW_MS`) and reference the redirect pages that can
double-fire.

## 9. Historical windows — `KiteHistoricalProvider`

[src/server/services/kite/KiteHistoricalProvider.ts](../src/server/services/kite/KiteHistoricalProvider.ts)

**What's tricky:**
- Requests are split into per-interval windows (`MAX_DAYS`), serialized through a promise gate spaced 350 ms apart,
  retried on 429, and de-duplicated by timestamp.
- `continuous` is sent only for day candles.
- Weekly candles are aggregated after fetching daily ones.

**Recommend:** note that `continuous=true` is only requested by callers for the **future** leg on `1d`/`1w`.

## 10. Candlestick pattern thresholds — `patterns.ts`

[src/server/services/indicator/patterns.ts](../src/server/services/indicator/patterns.ts)

Thresholds (doji body ≤ 10 % of range, shadows ≥ 2× body and ≥ 60 % of range, stars ≤ 30 % of the first body,
5-candle trend context) are inline numbers.

**Recommend:** lift them into named constants with a one-line rationale each, so they can be tuned consistently.

## 11. Builder comparison rules — `comparison.ts`

[src/client/views/builder/comparison.ts](../src/client/views/builder/comparison.ts) — `adaptComparison`

Already documented. Worth adding: the rule order (same unit → keep; price → compare with an indicator; other units →
drop a price comparison and use a typical level), and that `priceLevelLooksWrong` is a heuristic (threshold 100,
Future leg only).

## 12. Per-market status in the top bar — `Topbar.tsx`

[src/client/components/layout/Topbar.tsx](../src/client/components/layout/Topbar.tsx) — `marketState`

"Live" vs "scheduler idle" uses the **global** `lastRunAt`, not a per-market timestamp.

**Recommend:** a comment saying so. If per-market staleness is ever needed, `last_tick` could record run times per
market.
