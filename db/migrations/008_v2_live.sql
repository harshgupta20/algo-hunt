-- V2 live worker (streaming): one heartbeat/status row, rewritten every few seconds by `npm run live`.
-- The cron scanner reads it to step aside while the worker is healthy and to warn once when it goes quiet.
CREATE TABLE IF NOT EXISTS v2_live_status (
  id                  TEXT PRIMARY KEY DEFAULT 'main',
  worker_id           TEXT NOT NULL,
  heartbeat_at        TIMESTAMPTZ NOT NULL,
  status              JSONB NOT NULL,
  offline_notified_at TIMESTAMPTZ
);
