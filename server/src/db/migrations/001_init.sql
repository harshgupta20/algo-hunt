-- Initial schema for the ASH trading alert platform.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  token      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key            TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  default_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS alert_configurations (
  id               UUID PRIMARY KEY,
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  underlying       TEXT NOT NULL,
  expiry_type      TEXT NOT NULL,
  expiry_date      TEXT,
  strike_selection TEXT NOT NULL,
  custom_strike    NUMERIC,
  timeframe        TEXT NOT NULL,
  strategy         TEXT NOT NULL,
  params           JSONB NOT NULL DEFAULT '{}'::jsonb,
  active           BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id       UUID REFERENCES alert_configurations(id) ON DELETE CASCADE,
  underlying      TEXT NOT NULL,
  expiry          TEXT NOT NULL,
  strike          NUMERIC NOT NULL,
  timeframe       TEXT NOT NULL,
  strategy        TEXT NOT NULL,
  scenario        SMALLINT NOT NULL,
  bucket          BIGINT NOT NULL,
  future_rsi      NUMERIC NOT NULL,
  call_rsi        NUMERIC NOT NULL,
  put_rsi         NUMERIC NOT NULL,
  future_prev_rsi NUMERIC,
  call_prev_rsi   NUMERIC,
  put_prev_rsi    NUMERIC,
  title           TEXT NOT NULL,
  triggered_at    TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe: at most one alert per (config, candle bucket, scenario).
CREATE UNIQUE INDEX IF NOT EXISTS alerts_dedupe_idx
  ON alerts (config_id, bucket, scenario);
CREATE INDEX IF NOT EXISTS alerts_triggered_at_idx ON alerts (triggered_at DESC);
CREATE INDEX IF NOT EXISTS alerts_underlying_idx ON alerts (underlying);

CREATE TABLE IF NOT EXISTS notification_logs (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
  channel  TEXT NOT NULL,
  status   TEXT NOT NULL,
  error    TEXT,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  prefs      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
