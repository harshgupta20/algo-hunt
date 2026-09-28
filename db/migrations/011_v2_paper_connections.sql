-- V2 paper trading per connection: values a connection changes from its strategy's paper plan
-- (cash per trade, target / stop-loss, square-off, slippage, charges, on / off). No row = the strategy's plan.
CREATE TABLE IF NOT EXISTS v2_paper_overrides (
  connection_id UUID PRIMARY KEY REFERENCES v2_connections(id) ON DELETE CASCADE,
  override      JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
