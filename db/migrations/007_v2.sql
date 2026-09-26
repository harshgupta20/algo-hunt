-- V2: product-agnostic strategies + product connections. Additive only — no existing table is touched.

-- Instruments of every supported market (NSE/BSE indices, NSE cash stocks, NFO/BFO + MCX futures & options).
CREATE TABLE IF NOT EXISTS v2_instruments (
  token      BIGINT PRIMARY KEY,
  exchange   TEXT NOT NULL,
  product_id TEXT NOT NULL,                  -- NSE:NIFTY · NSE:RELIANCE · BSE:SENSEX · MCX:GOLD
  kind       TEXT NOT NULL,                  -- SPOT | FUT | CE | PE
  symbol     TEXT NOT NULL,
  expiry     TEXT,
  strike     DOUBLE PRECISION,
  lot_size   INTEGER NOT NULL DEFAULT 1,
  tick_size  DOUBLE PRECISION NOT NULL DEFAULT 0,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_instruments_product_idx ON v2_instruments (product_id, kind, expiry);

-- Product catalogue derived from the instruments at sync time.
CREATE TABLE IF NOT EXISTS v2_products (
  id              TEXT PRIMARY KEY,
  market          TEXT NOT NULL,             -- NSE | MCX (session calendar)
  kind            TEXT NOT NULL,             -- INDEX | STOCK | COMMODITY
  symbol          TEXT NOT NULL,
  name            TEXT NOT NULL,
  has_spot        BOOLEAN NOT NULL,
  has_futures     BOOLEAN NOT NULL,
  has_options     BOOLEAN NOT NULL,
  future_expiries JSONB NOT NULL DEFAULT '[]',
  option_expiries JSONB NOT NULL DEFAULT '[]',
  strike_step     DOUBLE PRECISION,
  lot_size        INTEGER,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_calendar (
  market    TEXT NOT NULL,
  date      TEXT NOT NULL,
  kind      TEXT NOT NULL,                   -- HOLIDAY | SPECIAL_SESSION
  open_min  INTEGER,
  close_min INTEGER,
  note      TEXT,
  PRIMARY KEY (market, date)
);

-- Strategies are product-agnostic; every save is an immutable version.
CREATE TABLE IF NOT EXISTS v2_strategies (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v2_strategy_versions (
  strategy_id UUID NOT NULL REFERENCES v2_strategies(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  definition  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy_id, version)
);

-- A strategy connected to a product (expiry, strike positions, alert settings).
CREATE TABLE IF NOT EXISTS v2_connections (
  id          UUID PRIMARY KEY,
  strategy_id UUID NOT NULL REFERENCES v2_strategies(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL,
  config      JSONB NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  enabled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_connections_strategy_idx ON v2_connections (strategy_id);

CREATE TABLE IF NOT EXISTS v2_unit_state (
  connection_id         UUID NOT NULL REFERENCES v2_connections(id) ON DELETE CASCADE,
  unit_key              TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'IDLE',
  last_evaluated_candle BIGINT,
  last_result           TEXT,
  last_signal_candle    BIGINT,
  last_alert_at         TIMESTAMPTZ,
  cooldown_until        TIMESTAMPTZ,
  last_evaluation       JSONB,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, unit_key)
);

CREATE TABLE IF NOT EXISTS v2_signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity          TEXT NOT NULL UNIQUE,
  connection_id     UUID NOT NULL REFERENCES v2_connections(id) ON DELETE CASCADE,
  strategy_id       UUID NOT NULL,
  version           INTEGER NOT NULL,
  unit_key          TEXT NOT NULL,
  trigger_timeframe TEXT NOT NULL,
  candle_time       BIGINT NOT NULL,
  outcome           TEXT NOT NULL,
  evaluation        JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_signals_connection_idx ON v2_signals (connection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id         UUID NOT NULL REFERENCES v2_signals(id) ON DELETE CASCADE,
  connection_id     UUID NOT NULL REFERENCES v2_connections(id) ON DELETE CASCADE,
  strategy_id       UUID NOT NULL,
  strategy_name     TEXT NOT NULL,
  version           INTEGER NOT NULL,
  product_id        TEXT NOT NULL,
  status            TEXT NOT NULL,
  unit              JSONB NOT NULL,
  trigger_timeframe TEXT NOT NULL,
  candle_time       BIGINT NOT NULL,
  evaluation        JSONB NOT NULL,
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_alerts_created_idx ON v2_alerts (created_at DESC);

CREATE TABLE IF NOT EXISTS v2_deliveries (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES v2_alerts(id) ON DELETE CASCADE,
  channel  TEXT NOT NULL,
  status   TEXT NOT NULL,
  error    TEXT,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_deliveries_alert_idx ON v2_deliveries (alert_id);

CREATE TABLE IF NOT EXISTS v2_scan_runs (
  id          UUID PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL,
  summary     JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_scan_runs_started_idx ON v2_scan_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS v2_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
