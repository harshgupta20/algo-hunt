-- Underlying groups: apply one strategy to a set of underlyings (per-member).
CREATE TABLE IF NOT EXISTS underlying_groups (
  id         UUID PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  members    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE alert_configurations ADD COLUMN IF NOT EXISTS group_id   TEXT;
ALTER TABLE alert_configurations ADD COLUMN IF NOT EXISTS group_name TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS group_id   TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS group_name TEXT;

CREATE INDEX IF NOT EXISTS configs_group_idx ON alert_configurations (group_id);
CREATE INDEX IF NOT EXISTS alerts_group_idx ON alerts (group_id);
