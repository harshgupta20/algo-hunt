-- MCX V2: an isolated MCX alerting subsystem. Additive only — no V1 / NSE table is touched.

-- Own instrument universe, synced from Kite's MCX instrument dump.
CREATE TABLE IF NOT EXISTS mcx_instruments (
  token           BIGINT PRIMARY KEY,
  instrument_type TEXT NOT NULL,              -- MCX_FUTURE | MCX_OPTION | MCX_INDEX
  underlying      TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  expiry          TEXT,
  strike          DOUBLE PRECISION,
  option_type     TEXT,                       -- CE | PE
  lot_size        INTEGER NOT NULL DEFAULT 1,
  tick_size       DOUBLE PRECISION NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcx_instruments_underlying_idx ON mcx_instruments (underlying, expiry);

-- Market calendar overrides (holidays, special sessions). Weekday defaults live in code.
CREATE TABLE IF NOT EXISTS mcx_calendar (
  date       TEXT PRIMARY KEY,                -- yyyy-mm-dd (IST)
  kind       TEXT NOT NULL,                   -- HOLIDAY | SPECIAL_SESSION
  open_min   INTEGER,
  close_min  INTEGER,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Strategies + immutable versions (alerts reference the version that produced them).
CREATE TABLE IF NOT EXISTS mcx_strategies (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT false,
  enabled_at      TIMESTAMPTZ,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcx_strategy_versions (
  strategy_id UUID NOT NULL REFERENCES mcx_strategies(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  definition  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy_id, version)
);

-- Per evaluation unit (strategy × target instrument) state machine + latest evaluation (explain).
CREATE TABLE IF NOT EXISTS mcx_unit_state (
  strategy_id           UUID NOT NULL REFERENCES mcx_strategies(id) ON DELETE CASCADE,
  target_instrument_id  TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'IDLE',
  last_evaluated_candle BIGINT,
  last_result           TEXT,
  last_signal_candle    BIGINT,
  last_alert_at         TIMESTAMPTZ,
  cooldown_until        TIMESTAMPTZ,
  last_evaluation       JSONB,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy_id, target_instrument_id)
);

-- Deterministic, deduplicated signals (identity = strategy · version · target · timeframe · candle · type).
CREATE TABLE IF NOT EXISTS mcx_signals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity             TEXT NOT NULL UNIQUE,
  strategy_id          UUID NOT NULL REFERENCES mcx_strategies(id) ON DELETE CASCADE,
  version              INTEGER NOT NULL,
  target_instrument_id TEXT NOT NULL,
  trigger_timeframe    TEXT NOT NULL,
  candle_time          BIGINT NOT NULL,
  signal_type          TEXT NOT NULL,
  outcome              TEXT NOT NULL,
  evaluation           JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcx_signals_strategy_idx ON mcx_signals (strategy_id, created_at DESC);

-- Alerts actually dispatched (with the full evaluation for "why did this fire").
CREATE TABLE IF NOT EXISTS mcx_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id         UUID NOT NULL REFERENCES mcx_signals(id) ON DELETE CASCADE,
  strategy_id       UUID NOT NULL REFERENCES mcx_strategies(id) ON DELETE CASCADE,
  strategy_name     TEXT NOT NULL,
  version           INTEGER NOT NULL,
  status            TEXT NOT NULL,            -- SENT | PARTIAL | FAILED | ACKNOWLEDGED
  instrument        JSONB NOT NULL,
  trigger_timeframe TEXT NOT NULL,
  candle_time       BIGINT NOT NULL,
  price             DOUBLE PRECISION,
  evaluation        JSONB NOT NULL,
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcx_alerts_created_idx ON mcx_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS mcx_alerts_strategy_idx ON mcx_alerts (strategy_id);

CREATE TABLE IF NOT EXISTS mcx_deliveries (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES mcx_alerts(id) ON DELETE CASCADE,
  channel  TEXT NOT NULL,                     -- telegram | email
  status   TEXT NOT NULL,                     -- sent | failed
  error    TEXT,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcx_deliveries_alert_idx ON mcx_deliveries (alert_id);

-- Scanner observability.
CREATE TABLE IF NOT EXISTS mcx_scan_runs (
  id          UUID PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL,                  -- OK | PARTIAL | FAILED | SKIPPED
  summary     JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS mcx_scan_runs_started_idx ON mcx_scan_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS mcx_scan_errors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES mcx_scan_runs(id) ON DELETE CASCADE,
  strategy_id   TEXT,
  instrument_id TEXT,
  condition_id  TEXT,
  timeframe     TEXT,
  source        TEXT NOT NULL,
  message       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcx_scan_errors_run_idx ON mcx_scan_errors (run_id);

-- Settings (channel destinations, caps).
CREATE TABLE IF NOT EXISTS mcx_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
