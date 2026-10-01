# Testing

> Related: [development.md](development.md) · [code-notes.md](code-notes.md)

## 1. Framework and configuration

| Item | Value |
| --- | --- |
| Runner | **vitest** `^3.2` |
| Config | [vitest.config.ts](../vitest.config.ts): `include: ['tests/**/*.test.ts']`, `environment: 'node'`, `env: { LOG_LEVEL: 'error' }`, aliases `@ash/shared` and `@` |
| Type checking | `npm run typecheck` (`tsc --noEmit` also covers `tests/`) |
| Coverage | Not configured |
| E2E / browser tests | None in the repository (UI checked manually against a local production build) |

## 2. Running tests

```bash
npm test                                   # vitest run — whole suite (13 files, 101 tests at the time of writing)
npm run test:watch                         # watch mode
npx vitest run tests/v2/live.test.ts       # one file
npx vitest run -t "Kite candles"           # tests whose name matches
```

## 3. What is tested

Unit and service-level tests that run the real engines against in-memory fixtures: V2 uses `MemoryV2Store`,
`FixtureV2Provider` and `RecordingChannels` from [tests/helpers/v2Fakes.ts](../tests/helpers/v2Fakes.ts); the live
worker tests drive a fake tick stream and a fake clock. Nothing touches Postgres, Kite or the network.

| File | Tests | Covers |
| --- | --- | --- |
| [rsi.test.ts](../tests/rsi.test.ts) | 10 | Wilder RSI: warm-up, hand-verified series, edge cases, StockCharts RSI(14) reference |
| [indicators.test.ts](../tests/indicators.test.ts) | 10 | EMA, SMA, RSI, Bollinger, MACD, Price, Volume, Supertrend, VWAP; indicator signatures |
| [indicatorsExtra.test.ts](../tests/indicatorsExtra.test.ts) | 12 | ADX/DMI against a TradingView-style reference; `peek()`; candlestick patterns; Heikin Ashi; weekly aggregation |
| [marketSession.test.ts](../tests/marketSession.test.ts) | 7 | MCX close 23:30/23:55 around the US daylight-saving switch; windows; candle alignment and closes |
| [syntheticSeries.test.ts](../tests/syntheticSeries.test.ts) | 3 | The RSI series generators used by other tests |
| [v2/resolve.test.ts](../tests/v2/resolve.test.ts) | 5 | V2 legs → contracts: spot-based ATM (NSE), future-based ATM (MCX), FUT = the future options expire into, strike positions, legs outside the ladder, spot / futures-only |
| [v2/catalog.test.ts](../tests/v2/catalog.test.ts) | 10 | Kite dump rows → V2 instruments and products; NSE calendar; strategy / connection validation and product compatibility; named groups in the strategy text; product counts per type (following the search); listing / counting only products with the legs a strategy needs; scanner-load estimate (requests per product, option legs per strike position) |
| [v2/scanner.test.ts](../tests/v2/scanner.test.ts) | 8 | One FUT-vs-CE strategy on NIFTY, BANKNIFTY and GOLD: alerts, market gating, no re-alerting, refusals, explain, compare, spot-only on stocks |
| [v2/bollinger.test.ts](../tests/v2/bollinger.test.ts) | 4 | V2 Bollinger Bands: upper / middle / lower with the chosen std dev, %B, bandwidth, other sources, which comparisons validation allows |
| [v2/comparison.test.ts](../tests/v2/comparison.test.ts) | 6 | Editor comparison rules: a Bollinger band / average becomes “Close vs band” (no number), %B / Bandwidth / RSI / ADX get typical levels, one-click fix for “band vs number” |
| [v2/examples.test.ts](../tests/v2/examples.test.ts) | 5 | Every V2 example validates; the trader's RSI + Bollinger sheet (Group 1 bullish OR Group 2 bearish) fires the right group on bullish / bearish candles and not on a half setup |
| [v2/backtest.test.ts](../tests/v2/backtest.test.ts) | 5 | Backtest: entry at the alert candle's close, exit at the target found in 1-minute candles (P&L, charges, final capital, return); a stop-loss in the same minute as the target wins and a gap fills at the open; a trade the capital can't cover is skipped; square-off at 15:20 at the last price; positional trades run to the end of the test; missing strategy / reversed period refused |
| [v2/storeSpec.test.ts](../tests/v2/storeSpec.test.ts) | 16 | One store-behaviour spec run two ways — the in-memory store and the memory layer (`RuntimeV2Store`) in front of it: instruments / products / calendar, strategies + versions + cascades, unit states, signal dedupe, alerts + deliveries + acknowledge + feed + every filter, scan runs, settings, locks with the minimum interval, live heartbeat, paper plans / overrides / one open trade per slot / close once / marks / versions, history clean-up (older alerts, signals, closed trades go; open trades and newer records stay), context stamp |
| [v2/memoryLayer.test.ts](../tests/v2/memoryLayer.test.ts) | 1 | Database calls in a simulated session through the memory layer: after warm-up, an hour of minute scans and screen polls (alarm feed, status, live card, paper summary / open trades, connections, paper settings) makes none; the alert writes signal, alert, delivery, unit state and paper trade once each; the new alert and open trade are served from memory; the target exit is one write; the Paper tab reads closed trades once |
| [v2/databaseOutage.test.ts](../tests/v2/databaseOutage.test.ts) | 5 | Database unreachable: the alert still goes out (Telegram, alarm, paper trade, Paper tab), 5 writes wait (status shows them) and are saved in order with the same ids once it's back; waiting writes kept in a file across a restart; a duplicate signal skips its alert and deliveries (the paper trade is saved without the link); a refused write is dropped after 3 tries and the rest go on; alert / signal lists read once until an alert changes them; history kept by default, then deleted now and once a day for the chosen period (saving destinations keeps it) |
| [v2/traffic.test.ts](../tests/v2/traffic.test.ts) | 3 | Database traffic: contracts read once until the next instrument sync; the alarm feed returns only newer alerts; closed paper trades re-read only when one closes |
| [v2/filters.test.ts](../tests/v2/filters.test.ts) | 5 | Trader filters: alerts by type, market, symbol, timeframe, strategy, IST dates, fired group, candle source and delivery status; signals by outcome; paper trades and summary by market, side, group and period end; the client's query string |
| [v2/charts.test.ts](../tests/v2/charts.test.ts) | 1 | Chart axes always cover the data |
| [v2/paper.test.ts](../tests/v2/paper.test.ts) | 14 | Paper trading: on for every connection by default (₹10,000 / +20 % / −10 % / 15:20 defaults, nothing saved); a connection's own values (cash → 2 lots, no stop) and going back to the strategy's; switched off for one connection (alert still sent, no trade); an alert through the scanner buys whole lots with slippage and the target closes it net of charges (P&L, money needed, return, equity, profit factor, avg win / loss, today, per day / exit reason / entry hour, sparkline, period filter); close by hand and reset; groups trade their own leg and the other group closes the open trade; exit-only groups; selling a future (estimated margin, over budget, stop above entry, stop wins); no trade on an index spot leg / closed market / after square-off; square-off at 15:20 including a late check; positional trades to expiry; stats (win rate, money needed at once, drawdown, profit factor, avg win / loss); rules follow the strategy's groups; plan validation; an older server's summary filled in without crashing |
| [v2/live.test.ts](../tests/v2/live.test.ts) | 18 | Live worker: Kite tick packets; socket subscribe / drop / resubscribe; minute building (trade-time buckets, day open, day-volume deltas, late trades); gaps and Kite catching up; the re-check rule (true / gap / near miss that matters); subscription plan (ATM ± 2 strikes, capacity, waiting for a price); fetch-queue priorities; end to end (decided live, verified alert, correction by Kite, near miss confirmed, gap re-check, unverified fallback, paper trade opened on the streamed price and closed by a tick through its stop, cron steps aside + one offline warning, one worker at a time) |
| [v2/boundary.test.ts](../tests/v2/boundary.test.ts) | 4 | V2 never imports the retired V1 / MCX V2 modules (guard kept); the rest of the app imports V2 only at the wiring points (API context, router, cron route, live worker, app-shell layout) |

## 4. Adding tests

- V2 behaviour: build products with the helpers in `v2Fakes.ts` (`spot`, `fut`, `ladder`, `candlesAt`,
  `timesEndingAt`, `strategy`, `cond`, `ind`, `legSeries`), run through `V2Service` / `V2Scanner` / `LiveWorker`,
  and assert on `store.data` (units, signals, alerts) and `channels.sent`.
- Pass explicit clocks (`clock: () => t`) — sessions and candle boundaries depend on the time.
- A new module under `src/server/v2` must keep [tests/v2/boundary.test.ts](../tests/v2/boundary.test.ts) green.
