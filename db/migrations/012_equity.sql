-- Equity section (NSE cash stocks), separate from F&O (v2_*): saved strategies and watchlists.
-- Candles, backtests and screens are never stored in the database.
CREATE TABLE IF NOT EXISTS eq_strategies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  definition  JSONB NOT NULL,              -- the full EqStrategyDefinition
  version     INTEGER NOT NULL DEFAULT 1,  -- bumped on every save
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eq_watchlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  symbols     JSONB NOT NULL DEFAULT '[]', -- NSE symbols, in the trader's order
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
