-- Equity backtest history: every finished backtest — what was tested, when, with which strategy, and how it did —
-- so the trader can look back at it, open it again exactly as it was, or run it again.
--   run      the history line (small JSON, read once per process): strategy name / version / timeframe, stocks,
--            period, money, when, how long, the headline figures
--   request  what's needed to run it again: the strategy's definition as it was, the stocks, period and money
--   result   the full result (every trade and order) as gzipped JSON — read only when that run is opened; NULL when
--            it was too large to keep
CREATE TABLE IF NOT EXISTS eq_backtests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id  UUID REFERENCES eq_strategies(id) ON DELETE SET NULL,  -- NULL: the builder's unsaved strategy, or deleted since
  ran_at       TIMESTAMPTZ NOT NULL,
  run          JSONB NOT NULL,
  request      JSONB NOT NULL,
  result       BYTEA,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eq_backtests_ran_idx ON eq_backtests (ran_at DESC);
CREATE INDEX IF NOT EXISTS eq_backtests_strategy_idx ON eq_backtests (strategy_id, ran_at DESC);
