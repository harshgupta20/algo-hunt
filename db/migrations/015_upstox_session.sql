-- Upstox session (single row), for the V2 Options backtest (expired option / futures candles). Same shape as
-- kite_session: the access token is stored AES-GCM encrypted; Upstox tokens stop working at 03:30 IST.
CREATE TABLE IF NOT EXISTS upstox_session (
  id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token TEXT,
  user_id      TEXT,
  user_name    TEXT,
  login_time   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  state        TEXT NOT NULL DEFAULT 'needs-login',
  last_error   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
