# Code notes — complex areas outside V2

Notes on the shared low-level code that is genuinely hard to follow, and what extra documentation would help. V2's
own tricky parts (candle building from ticks, the Kite re-check rule, gaps, subscription planning) are described in
[v2-architecture.md § 4b](v2-architecture.md#4b-live-worker-streaming--npm-run-live) and in each module's header.

> Related: [architecture.md](architecture.md) · [status.md](status.md)

## 1. `BaseIndicator.peek()` — state cloning

[src/server/services/indicator/types.ts](../src/server/services/indicator/types.ts)

**What's tricky:** `peek` deep-copies the instance's own properties (keeping class prototypes) except `outputs`, then
runs `compute` on the copy. This silently breaks if a future indicator's `compute` reads `this.outputs`, or keeps
state in `Map`/`Set`/closures.

**Recommend:** keep the existing warning on `compute`, extend it to mention `Map`/`Set`/closures, and add one test
per new indicator asserting `peek(bar) === (update(bar), value())` (the pattern in
[indicatorsExtra.test.ts](../tests/indicatorsExtra.test.ts)).

## 2. Lease SQL — `PgV2Store.locks.acquire`

[src/server/v2/persistence/PgV2Store.ts](../src/server/v2/persistence/PgV2Store.ts) (table `app_locks`, lease `v2-scan`)

**What's tricky:** one `INSERT … ON CONFLICT DO UPDATE … WHERE` enforces two rules at once: no live lease **and** the
last run ended at least `minIntervalSeconds` ago. `release()` sets `last_run_at`.

**Recommend:** a comment on the SQL stating both conditions and that `force` passes `minIntervalSeconds = 0`.

## 3. Kite login races — `kiteAuth.exchange`

[src/server/services/kite/kiteAuth.ts](../src/server/services/kite/kiteAuth.ts)

**What's tricky:** a failed exchange is ignored if a session was stored within the last **120 s**. This absorbs a
double-fired redirect that hit another serverless instance.

**Recommend:** name the constant (e.g. `CONCURRENT_EXCHANGE_WINDOW_MS`) and reference the redirect pages that can
double-fire.

## 4. Historical windows — `KiteHistoricalProvider`

[src/server/services/kite/KiteHistoricalProvider.ts](../src/server/services/kite/KiteHistoricalProvider.ts)

**What's tricky:**
- Requests are split into per-interval windows (`MAX_DAYS`), serialized through a promise gate spaced 350 ms apart,
  retried on 429, and de-duplicated by timestamp.
- `continuous` is sent only for day candles.
- Weekly candles are aggregated after fetching daily ones.

**Recommend:** note that `continuous=true` is only requested for **futures** day candles (see `KiteDataProvider.getHistoricalCandles`).

## 5. Candlestick pattern thresholds — `patterns.ts`

[src/server/services/indicator/patterns.ts](../src/server/services/indicator/patterns.ts)

Thresholds (doji body ≤ 10 % of range, shadows ≥ 2× body and ≥ 60 % of range, stars ≤ 30 % of the first body,
5-candle trend context) are inline numbers.

**Recommend:** lift them into named constants with a one-line rationale each, so they can be tuned consistently.
