/**
 * SQLite schema (the local database), as numbered migrations applied automatically when the database is
 * opened — `git pull` + start is all an update needs. The same tables as the Postgres v2_* schema, with
 * SQLite types: timestamps are ISO-8601 UTC text (sortable), booleans 0 / 1, JSON as text.
 * Never edit an applied migration — add the next one.
 */
export const SQLITE_MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '001_init',
    sql: `
CREATE TABLE kite_session (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT,
  kite_user_id TEXT,
  user_name    TEXT,
  login_time   TEXT,
  expires_at   TEXT,
  state        TEXT NOT NULL DEFAULT 'needs-login',
  last_error   TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE user_preferences (
  user_id    TEXT PRIMARY KEY,
  prefs      TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE app_locks (
  name         TEXT PRIMARY KEY,
  locked_until TEXT NOT NULL,
  last_run_at  TEXT
);

CREATE TABLE v2_instruments (
  token      INTEGER PRIMARY KEY,
  exchange   TEXT NOT NULL,
  product_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  expiry     TEXT,
  strike     REAL,
  lot_size   INTEGER NOT NULL DEFAULT 1,
  tick_size  REAL NOT NULL DEFAULT 0,
  synced_at  TEXT NOT NULL
);
CREATE INDEX v2_instruments_product_idx ON v2_instruments (product_id, kind, expiry);

CREATE TABLE v2_products (
  id              TEXT PRIMARY KEY,
  market          TEXT NOT NULL,
  kind            TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  name            TEXT NOT NULL,
  has_spot        INTEGER NOT NULL,
  has_futures     INTEGER NOT NULL,
  has_options     INTEGER NOT NULL,
  future_expiries TEXT NOT NULL DEFAULT '[]',
  option_expiries TEXT NOT NULL DEFAULT '[]',
  strike_step     REAL,
  lot_size        INTEGER,
  updated_at      TEXT NOT NULL
);

CREATE TABLE v2_calendar (
  market    TEXT NOT NULL,
  date      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  open_min  INTEGER,
  close_min INTEGER,
  note      TEXT,
  PRIMARY KEY (market, date)
);

CREATE TABLE v2_strategies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE v2_strategy_versions (
  strategy_id TEXT NOT NULL REFERENCES v2_strategies(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  definition  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (strategy_id, version)
);

CREATE TABLE v2_connections (
  id          TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES v2_strategies(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL,
  config      TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,
  enabled_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX v2_connections_strategy_idx ON v2_connections (strategy_id);

CREATE TABLE v2_unit_state (
  connection_id         TEXT NOT NULL REFERENCES v2_connections(id) ON DELETE CASCADE,
  unit_key              TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'IDLE',
  last_evaluated_candle INTEGER,
  last_result           TEXT,
  last_signal_candle    INTEGER,
  last_alert_at         TEXT,
  cooldown_until        TEXT,
  last_evaluation       TEXT,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (connection_id, unit_key)
);

CREATE TABLE v2_signals (
  id                TEXT PRIMARY KEY,
  identity          TEXT NOT NULL UNIQUE,
  connection_id     TEXT NOT NULL REFERENCES v2_connections(id) ON DELETE CASCADE,
  strategy_id       TEXT NOT NULL,
  version           INTEGER NOT NULL,
  unit_key          TEXT NOT NULL,
  trigger_timeframe TEXT NOT NULL,
  candle_time       INTEGER NOT NULL,
  outcome           TEXT NOT NULL,
  evaluation        TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX v2_signals_connection_idx ON v2_signals (connection_id, created_at DESC);
CREATE INDEX v2_signals_created_idx ON v2_signals (created_at DESC);

CREATE TABLE v2_alerts (
  id                TEXT PRIMARY KEY,
  signal_id         TEXT NOT NULL REFERENCES v2_signals(id) ON DELETE CASCADE,
  connection_id     TEXT NOT NULL REFERENCES v2_connections(id) ON DELETE CASCADE,
  strategy_id       TEXT NOT NULL,
  strategy_name     TEXT NOT NULL,
  version           INTEGER NOT NULL,
  product_id        TEXT NOT NULL,
  status            TEXT NOT NULL,
  unit              TEXT NOT NULL,
  trigger_timeframe TEXT NOT NULL,
  candle_time       INTEGER NOT NULL,
  evaluation        TEXT NOT NULL,
  acknowledged_at   TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX v2_alerts_created_idx ON v2_alerts (created_at DESC);

CREATE TABLE v2_deliveries (
  id       TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES v2_alerts(id) ON DELETE CASCADE,
  channel  TEXT NOT NULL,
  target   TEXT,
  status   TEXT NOT NULL,
  error    TEXT,
  sent_at  TEXT NOT NULL
);
CREATE INDEX v2_deliveries_alert_idx ON v2_deliveries (alert_id);

CREATE TABLE v2_scan_runs (
  id          TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  status      TEXT NOT NULL,
  summary     TEXT NOT NULL
);
CREATE INDEX v2_scan_runs_started_idx ON v2_scan_runs (started_at DESC);

CREATE TABLE v2_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE v2_live_status (
  id                  TEXT PRIMARY KEY DEFAULT 'main',
  worker_id           TEXT NOT NULL,
  heartbeat_at        TEXT NOT NULL,
  status              TEXT NOT NULL,
  offline_notified_at TEXT
);

CREATE TABLE v2_paper_plans (
  strategy_id TEXT PRIMARY KEY REFERENCES v2_strategies(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE v2_paper_trades (
  id            TEXT PRIMARY KEY,
  strategy_id   TEXT NOT NULL REFERENCES v2_strategies(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES v2_connections(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL,
  slot          TEXT NOT NULL,
  alert_id      TEXT REFERENCES v2_alerts(id) ON DELETE SET NULL,
  status        TEXT NOT NULL,
  entry_at      TEXT NOT NULL,
  exit_at       TEXT,
  net_pnl       REAL,
  trade         TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX v2_paper_trades_open_idx ON v2_paper_trades (status) WHERE status = 'OPEN';
-- At most one open position per connection + strike shift.
CREATE UNIQUE INDEX v2_paper_trades_one_open ON v2_paper_trades (connection_id, slot) WHERE status = 'OPEN';
CREATE INDEX v2_paper_trades_strategy_idx ON v2_paper_trades (strategy_id, entry_at DESC);
CREATE INDEX v2_paper_trades_entry_idx ON v2_paper_trades (entry_at DESC);

CREATE TABLE v2_paper_overrides (
  connection_id TEXT PRIMARY KEY REFERENCES v2_connections(id) ON DELETE CASCADE,
  override      TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
`,
  },
];
