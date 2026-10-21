# Trading AI (Groq)

An analyst in a panel on every page (**AI** in the top bar): build an Equity strategy from plain words, backtest it,
explain what drove a result and check whether it's robust. Phase 1 covers the Equity section; F&O (V2), the
screener and the market brief come later.

## Rules it works by

- **Every number comes from a tool.** The model never computes or recalls figures: it calls the app's own Equity
  service and reads a compact analysis computed in code (`server/ai/analysis.ts`).
- **It proposes, the trader decides.** It can't save, delete or trade. A strategy it writes is a card with
  **Open in builder** (unsaved). Backtests it runs go into the history, marked "· by AI".
- **Only what was asked.** It never takes a next step on its own; it ends by asking whether you want one. Enforced in
  code: the tools that run backtests (`run_backtest`, `robustness_check`) are given to the model only when the
  question asks for one ("backtest it", "is it robust?", "how did it do?") or answers yes to the AI's offer
  (`backtestAsked`, tools.ts). Mentioning an existing backtest ("analyse this backtest") doesn't count.
- **Robustness is judged in code-backed terms.** `robustness_check` runs the strategy as written, every period
  −20 % / +20 % and exit levels ±20 % (optionally on another list) and returns one comparison table (CAGR, drawdown,
  trades, profit factor, t-stat of the average trade, top-3-trade share), plus each year against NIFTY 50 and the two
  halves. Curve-fitted = the setting is a sharp peak with clearly worse neighbours.

## Where it is

| | |
| --- | --- |
| Top bar | **AI** opens the panel. The pill shows Groq's allowance: requests used today of the day's total, tokens used this minute, when each renews, and this app's use today (tooltip) |
| Builder | **Describe it to AI**. The strategy on screen (saved or not) goes with the question |
| Backtest result / history row | **Analyse with AI**: asks about that backtest straight away |
| Panel | Steps as they happen (backtest progress, waits for Groq's limit), answers, strategy cards, links that open a backtest (`/equity?tab=backtest&history=<id>`) |

Conversations live in the server's memory (never the database). A restart clears them; the panel then starts fresh.

## Create with AI (Strategies page)

Its own window and conversation (`mode: CREATOR`), separate from the chat. It only builds: its tools are
`propose_strategy` and `get_strategy`, with no backtests. Its instructions (`creatorPrompt`) carry the whole builder:
- every indicator with its parameter ranges, sources and outputs (generated from the catalogue);
- how the app reads each rule (crossings, triggers, exits, pyramiding, sizing, orders);
- the unit rules and limits;
- the trader's saved strategies and their templates.

It asks up to 3 questions when something essential is unclear (with suggested answers), otherwise builds exactly what
was described. It replies with **Built** (their words → the rule), **Assumed** (shown on the card in amber to check),
and **Worth considering (not applied)**, then asks what next. The card has **Open in builder** and
**Save as new strategy**. Page context isn't sent: it works from the trader's words only.

## Tools (`server/ai/tools.ts`)

`list_strategies`, `get_strategy`, `propose_strategy`, `list_stock_lists`, `find_instruments`, `run_backtest`,
`robustness_check`, `analyse_backtest`, `backtest_history`. AI backtests use `EquityService.runBacktest`, outside the
page's job slot, so they never cancel the trader's own backtest. Robustness variants aren't kept in the history.

## Strategy format (`server/ai/compact.ts`)

The model writes a compact form (a fraction of the builder JSON's tokens). Values can be short:
`"SMA(20)"`, `"RSI(14)"`, `"SMA(20,volume)"`, `"MACD(12,26,9).signal"`, `"HIGHEST(252,high)"`, `"close[1]"`,
`"1.5*SMA(20,volume)"`, `"SMA(9) of RSI(14)"`. Operators are forgiving (`crosses above`, `crossover`, `gt`, `≥`).
Mistakes come back as precise messages for the model to fix; the result is checked by the builder's validator.

## Groq and its limits

`GROQ_API_KEY` in `.env` (server only), optional `GROQ_MODEL` (default `openai/gpt-oss-120b`). The free plan allows
**1,000 requests a day and 8,000 tokens a minute**, and every request resends the conversation. So:

- the system prompt and tool results are compact;
- older tool results shrink to one line, then older questions drop out of what the model sees;
- before a request that wouldn't fit this minute's tokens, and on a 429, it **waits and says so** instead of failing;
  a daily limit is reported as such.

Measured on 2026-10-21 (free plan, NIFTY 50, 5 years): writing a strategy + one backtest + verdict took 46 s and 3
requests. A robustness check (4 backtests) took about 2 minutes, mostly Kite candle fetching. A paid Groq plan
removes the waits; the limits are read from Groq's headers, so nothing needs changing.

Privacy: strategies and results discussed are sent to Groq.
