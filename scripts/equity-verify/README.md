# Equity backtest verification — `npm run verify:equity`

Proves the equity backtest (`src/server/equity/engine/`) right, so nobody has to check results by hand against
TradingView. **Run it after any change to the engine, the indicators, the charges or the equity rules.**

```bash
npm run verify:equity                    # ~5 min: 5 profiles × 400 random strategies + figures + indicator values
npm run verify:equity -- --quick         # ~1 min: 5 profiles × 80
npm run verify:equity -- --cases 2000 --seed 7 --profiles mixed,edge
npm run verify:equity -- --fetch-kite    # also fetch real Kite candles first (log in to Kite in the app)
```

Needs `python3` (standard library only) and, the first time, the network: it downloads daily candles for the 136
stocks in `universe.json` from Yahoo (independent of Kite) into `$EQUITY_VERIFY_DIR` (default
`~/.cache/algo-hunt-verify`). Candles never go into git, and they end on a fixed date (`DATA_END` in `cases.ts`) so a
run is reproducible. Exit code 1 if anything differs.

## What it checks

| Step | How |
| --- | --- |
| The reference implementation's own tests | `oracle/test_oracle.py` — hand-worked numbers for every indicator and rule |
| **Engine = reference, order by order** | Random strategies covering every builder input (`cases.ts`) run through the production engine (`engine.ts`) and through `oracle/` — an implementation written **from `SPEC.md` alone, without reading the engine**. Every trade, order, charge, skipped signal and daily account value must be identical (`checks/compare.py`) |
| Invariants | Rules any correct backtest obeys: money adds up, prices are whole paise inside the day's range, next-open fills at the next open, Zerodha charges, no overlapping positions, never over max stocks, cash never negative (`checks/invariants.py`) |
| Results-page figures | Return, CAGR, drawdown, monthly / yearly returns, win rate, profit factor, exposure, per-stock totals — recomputed independently (`checks/figures.py`) |
| Indicator values | Every indicator, output, source, MA-of-indicator and multiplier, daily and weekly, candle by candle (`checks/columns.py`) |

Profiles: `mixed` (the app's order rules half the time, other combinations the rest), `product` (the app's rules
only), `small` (short periods, many stocks), `edge` (illiquid small caps — circuits, zero-volume days, bad ticks —
heavy pyramiding, tight stops, little capital), `kite` (real Kite candles, after `--fetch-kite`).

Mutation-tested: a one-paisa change to a charge, a `≤` turned into `<` in the crossover rule, or a removed trading
rule each fail the run.

## When a check fails

`$EQUITY_VERIFY_DIR/runs/` keeps every case and both outputs. The failure line names the backtest id and the first
difference (e.g. `edge-104-37: MARUTI 2024-03-05 BUY: engine price=101.2 oracle 101.3`). Re-run just that case:

```bash
python3 -c "import json,sys; c=[x for x in json.load(open(sys.argv[1])) if x['id']==sys.argv[2]]; json.dump(c,open('/tmp/one.json','w'))" ~/.cache/algo-hunt-verify/runs/edge-cases.json edge-104-37
python3 scripts/equity-verify/oracle/run.py /tmp/one.json /tmp/one-oracle.json
```

Then decide which side is wrong **against the rule in `SPEC.md`** (and against the market: TradingView's maths,
Zerodha's charges, what an end-of-day trader could actually do) — not against the other implementation.

## Changing the rules

The engine and `SPEC.md` describe the same rules. When a rule changes:

1. change the engine and its unit tests (`tests/equity/`);
2. change `SPEC.md` (mark the passage, e.g. "(v6") — written so someone who hasn't read the engine can build it;
3. change `oracle/` **from the spec alone** (ideally someone — or an agent — who doesn't read the engine), with a
   hand-worked test in `oracle/test_oracle.py`;
4. `npm run verify:equity` — both sides must agree everywhere.

`oracle/AMBIGUITIES.md` lists the choices the reference made where the spec was silent; fold them into the spec when
they matter.

## Files

| File | What |
| --- | --- |
| `verify.ts` | The command: download, self-tests, cases, both engines, every check, summary |
| `cases.ts` | Random valid strategies + requests per profile (seeded, reproducible) |
| `engine.ts` | The production engine on the cases (orders, figures, indicator columns) |
| `kite-fetch.ts` | Optional: candles from Kite via the app's stored session (read-only) |
| `SPEC.md` | The rules, for an independent implementation |
| `oracle/` | The reference implementation (Python, standard library) and its tests |
| `checks/` | compare, invariants, figures, columns, and the Yahoo downloader |
| `universe.json` | The 136 test stocks: NIFTY 50-type large caps, special symbols (M&M, BAJAJ-AUTO…), recent listings, a random sample of small caps |
