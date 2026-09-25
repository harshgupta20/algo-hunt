# Testing

> Related: [development.md](development.md) · [code-notes.md](code-notes.md)

## 1. Framework and configuration

| Item | Value |
| --- | --- |
| Runner | **vitest** `^3.2` |
| Config | [vitest.config.ts](../vitest.config.ts): `include: ['tests/**/*.test.ts']`, `environment: 'node'`, `env: { LOG_LEVEL: 'error' }`, aliases `@ash/shared` and `@` |
| Type checking | `npm run typecheck` (`tsc --noEmit` also covers `tests/`) |
| Coverage | **Not configured** — no coverage provider (e.g. `@vitest/coverage-v8`) in `devDependencies` and no coverage script |
| E2E / browser tests | **None** in the repository |

---

## 2. Running tests

```bash
npm test                                   # vitest run — whole suite (16 files, 127 tests at the time of writing)
npm run test:watch                         # watch mode
npx vitest run tests/mcx.test.ts           # one file
npx vitest run -t "no look-ahead"          # tests whose name matches
npx vitest run tests/monitorService.test.ts -t "double-fire"
```

Expected output ends with `Test Files 16 passed` / `Tests 127 passed`. Some tests log a JSON `monitor evaluation
failed` line to stderr **on purpose**: they check that a failing monitor records its error.

---

## 3. What is tested

All tests are **unit / service-level tests that run the real engines** (RSI, indicators, condition engine,
evaluator, monitor service, backtest runner, instrument store) against in-memory fixtures. They never touch
Postgres, Kite or the network.

| File | Tests | Covers |
| --- | --- | --- |
| [rsi.test.ts](../tests/rsi.test.ts) | 10 | Wilder RSI: warm-up, hand-verified series, edge cases, StockCharts RSI(14) reference |
| [crossing.test.ts](../tests/crossing.test.ts) | 13 | Cross-above/below vs already-above/below semantics (`59.99 → 60.01` counts) |
| [strategy.test.ts](../tests/strategy.test.ts) | 6 | Built-in RSI-sync scenarios S1/S2; exactly one match per candle |
| [customEvaluator.test.ts](../tests/customEvaluator.test.ts) | 3 | Generic JSON engine reproduces the built-in scenarios; rising-edge firing |
| [conditionEngine.test.ts](../tests/conditionEngine.test.ts) | 4 | Indicator-vs-indicator crosses (both sides compared on both candles) |
| [indicators.test.ts](../tests/indicators.test.ts) | 10 | EMA, SMA, RSI, Bollinger, MACD, Price, Volume, Supertrend, VWAP; indicator signatures |
| [indicatorsExtra.test.ts](../tests/indicatorsExtra.test.ts) | 12 | ADX/DMI against a TradingView-style reference; `peek()`; candlestick patterns; Heikin Ashi; weekly aggregation |
| [bollingerBuilder.test.ts](../tests/bollingerBuilder.test.ts) | 10 | Bollinger %B / Bandwidth; builder comparison rules (`comparison.ts`) |
| [mtfEvaluator.test.ts](../tests/mtfEvaluator.test.ts) | 8 | Multi-timeframe: forming daily candle (no look-ahead), previous-day crosses, day rollover, smaller timeframes, MCX alignment; HA and pattern conditions |
| [marketSession.test.ts](../tests/marketSession.test.ts) | 7 | MCX close 23:30/23:55 around the US daylight-saving switch; windows; candle alignment and closes |
| [mcx.test.ts](../tests/mcx.test.ts) | 11 | MCX expiries (near/next/far + weekly mapping), derived strike interval, futures-only contracts, catalog, evening-session monitors, session filtering, Daily-filter monitors (continuous candles), market-profile rules |
| [monitorService.test.ts](../tests/monitorService.test.ts) | 14 | Live evaluator end-to-end: ATM lock, one alert per scenario, no double-fire, no forming-candle decisions, activation floor, stale skip, custom strategies, disable/re-sync/coverage errors, shared candle fetches |
| [analyzer.test.ts](../tests/analyzer.test.ts) | 8 | Date ranges, stats, backtest runner determinism, chart window |
| [strategyMarket.test.ts](../tests/strategyMarket.test.ts) | 7 | Specific/universal profiles, legacy normalization, server enforcement for backtests and monitors |
| [summary.test.ts](../tests/summary.test.ts) | 1 | Dashboard summary counts on IST days |
| [syntheticSeries.test.ts](../tests/syntheticSeries.test.ts) | 3 | The RSI series generators used by other tests |

### Helpers

- [tests/helpers/fixtures.ts](../tests/helpers/fixtures.ts):
  - `niftyMaster()` / `mcxMaster()` — instrument masters (expiries in 2099 so they stay "upcoming").
  - `fixtureInstrumentStore(master, price)` — an `InstrumentStore` with a fixed LTP.
  - `FixtureHistorical` — candles per token, optionally per `token:timeframe`; records calls.
  - `fixtureStore()` — an in-memory `DataStore` with the same dedupe semantics as the Postgres unique indexes.
  - `sessionOpens()` / `toCandles()` — NSE-session-aligned candle times.
- [tests/helpers/syntheticSeries.ts](../tests/helpers/syntheticSeries.ts) — close-price series that end exactly on
  a cross above/below, or already above, a level (`buildScenarioSeries`).

---

## 4. Conventions

- Test the **real** engines through their public interfaces. Inject data via `HistoricalDataProvider`,
  `InstrumentSource` and `DataStore` fakes.
- Use fixed timestamps built from IST strings (`Date.parse('2026-09-23T11:00:00+05:30')`) and name the market
  situation in a comment (e.g. "Wednesday, NSE closed, MCX open").
- One behaviour per `it(...)`, phrased as the rule (`'never double-fires across repeated runs (cursor + dedupe)'`).
- Client logic that can be pure (e.g. [comparison.ts](../src/client/views/builder/comparison.ts)) lives outside
  React components so it can be tested here.

---

## 5. Known limitations

- **No database tests:** `pgStore.ts` SQL (including dedupe indexes, `replaceExchanges`, leases) is exercised only
  in production-like runs, not in the suite.
- **No Kite integration tests:** `KiteHistoricalProvider` windowing/retries, `kiteAuth` and `instrumentSync`
  parsing of real Kite rows are untested. In particular, the MCX product `name` values have not been checked
  against a live Kite instrument dump.
- **No UI/e2e tests:** React views are verified manually. There is no Playwright/Cypress setup.
- **No coverage reporting.**
- `lookbackDays()` and session-dependent helpers use `Date.now()` by default; tests pass explicit timestamps where
  it matters.
