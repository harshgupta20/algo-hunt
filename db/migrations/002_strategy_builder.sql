-- Strategy Builder: custom strategies (stored as JSON), version history, and
-- additive columns on alerts for custom-strategy explanations.

CREATE TABLE IF NOT EXISTS custom_strategies (
  id          UUID PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  version     INTEGER NOT NULL DEFAULT 1,
  definition  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES custom_strategies(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  definition  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, version)
);

-- Alerts: allow custom-strategy alerts (scenario becomes optional) + explanation.
ALTER TABLE alerts ALTER COLUMN scenario DROP NOT NULL;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS strategy_id   TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS strategy_name TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS variant       TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS conditions    JSONB;

CREATE INDEX IF NOT EXISTS alerts_strategy_id_idx ON alerts (strategy_id);
