-- Serverless runtime state. On Vercel nothing survives between requests, so
-- everything the old long-running worker kept in memory (or in .env) lives here.

-- Default single-tenant user + preferences (replaces the old `db:seed` step).
INSERT INTO users (id, email, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'default@ash.local', 'Default User')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_preferences (user_id, prefs)
VALUES ('00000000-0000-0000-0000-000000000001', '{"theme":"dark","soundEnabled":true,"browserNotifications":true}'::jsonb)
ON CONFLICT (user_id) DO NOTHING;

-- Kite Connect session (single row). The access token is stored AES-GCM encrypted.
CREATE TABLE IF NOT EXISTS kite_session (
  id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token TEXT,
  kite_user_id TEXT,
  user_name    TEXT,
  login_time   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  state        TEXT NOT NULL DEFAULT 'needs-login',
  last_error   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Instrument master (F&O contracts of supported underlyings), synced from Kite daily.
CREATE TABLE IF NOT EXISTS instruments (
  token           BIGINT PRIMARY KEY,
  tradingsymbol   TEXT NOT NULL,
  underlying      TEXT NOT NULL,
  exchange        TEXT NOT NULL,
  instrument_type TEXT NOT NULL,
  strike          NUMERIC NOT NULL DEFAULT 0,
  expiry          TEXT NOT NULL,
  lot_size        INTEGER,
  tick_size       NUMERIC
);
CREATE INDEX IF NOT EXISTS instruments_underlying_idx ON instruments (underlying, expiry);

-- Live monitor state: the triplet locked at activation, the last evaluated
-- closed candle (dedupe across cron runs), and the latest RSI snapshot.
CREATE TABLE IF NOT EXISTS monitor_state (
  config_id    UUID PRIMARY KEY REFERENCES alert_configurations(id) ON DELETE CASCADE,
  strike       NUMERIC NOT NULL,
  expiry       TEXT NOT NULL,
  triplet      JSONB NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_bucket  BIGINT,
  snapshot     JSONB,
  last_error   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leases so overlapping cron/dashboard triggers never run the evaluator twice at once.
CREATE TABLE IF NOT EXISTS app_locks (
  name         TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at  TIMESTAMPTZ
);

-- Small key/value store (e.g. instruments_synced_at, last tick summary).
CREATE TABLE IF NOT EXISTS app_kv (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Custom-strategy alerts have a NULL scenario, which the (config, bucket, scenario)
-- unique index treats as distinct — dedupe them on (config, bucket) instead.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_dedupe_custom_idx
  ON alerts (config_id, bucket) WHERE scenario IS NULL;

CREATE INDEX IF NOT EXISTS alerts_config_idx ON alerts (config_id);
CREATE INDEX IF NOT EXISTS configs_active_idx ON alert_configurations (active);
