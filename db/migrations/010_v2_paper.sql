-- V2 paper trading (optional, per strategy): a plan per strategy and the simulated trades its alerts open.
CREATE TABLE IF NOT EXISTS v2_paper_plans (
  strategy_id UUID PRIMARY KEY REFERENCES v2_strategies(id) ON DELETE CASCADE,
  plan        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_paper_trades (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id    UUID NOT NULL REFERENCES v2_strategies(id) ON DELETE CASCADE,
  connection_id  UUID NOT NULL REFERENCES v2_connections(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL,
  slot           TEXT NOT NULL,               -- one open position per connection + strike shift
  alert_id       UUID REFERENCES v2_alerts(id) ON DELETE SET NULL,
  status         TEXT NOT NULL,               -- OPEN | CLOSED
  entry_at       TIMESTAMPTZ NOT NULL,
  exit_at        TIMESTAMPTZ,
  net_pnl        DOUBLE PRECISION,
  trade          JSONB NOT NULL,              -- the full PaperTrade (instrument, prices, terms, P&L)
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_paper_trades_open_idx ON v2_paper_trades (status) WHERE status = 'OPEN';
-- At most one open position per connection + strike shift, even if the scanner and the live worker race.
CREATE UNIQUE INDEX IF NOT EXISTS v2_paper_trades_one_open ON v2_paper_trades (connection_id, slot) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS v2_paper_trades_strategy_idx ON v2_paper_trades (strategy_id, entry_at DESC);
CREATE INDEX IF NOT EXISTS v2_paper_trades_entry_idx ON v2_paper_trades (entry_at DESC);
