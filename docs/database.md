# Database

> Related: [architecture.md](architecture.md) · [v2-architecture.md § 6](v2-architecture.md#6-persistence) · [deployment.md](deployment.md)

## 1. Technology and access

Two interchangeable engines behind the same store interfaces (`V2Store`, `AppStore`); the choice is made at start:

| | **Local SQLite (default)** | **Postgres** (when `DATABASE_URL` is set) |
| --- | --- | --- |
| Where | One file, `DATABASE_FILE` (default `data/algo-hunt.db`, git-ignored) | Neon (or any Postgres) |
| Engine | SQLite built into Node.js (`node:sqlite`, Node 22.13+) — no server, no install | PostgreSQL via `pg` |
| Code | [sqlite.ts](../src/server/db/sqlite.ts) (open, WAL, foreign keys, busy timeout), [SqliteV2Store](../src/server/v2/persistence/SqliteV2Store.ts), `SqliteAppStore` | [PgV2Store](../src/server/v2/persistence/PgV2Store.ts), `PgAppStore`, [pool.ts](../src/server/db/pool.ts) |
| Schema | [sqliteSchema.ts](../src/server/db/sqliteSchema.ts) — applied automatically when the file is opened | [db/migrations/](../db/migrations) via [scripts/migrate.mjs](../scripts/migrate.mjs) |
| Backups | A snapshot a day to `BACKUP_DIR` (default `backups/`, newest 14 kept), `npm run backup`, `npm run restore -- <file>` ([backup.ts](../src/server/db/backup.ts)) | The provider's |
| Moving data | `npm run db:import -- "<postgres url>"` copies every table in use from Postgres, row for row | — |

The SQLite schema mirrors the Postgres `v2_*` tables used by the app, with SQLite types (ISO-8601 UTC text
timestamps, 0 / 1 booleans, JSON as text); the same unique / partial indexes give the same guarantees (signal
dedupe, one open paper trade per slot). The app and a separate `npm run live` can share the file (WAL mode).
The rest of this page describes the Postgres side; table names and meanings are the same in both.

| Item | Value |
| --- | --- |
| Engine | PostgreSQL. The hosted copy uses **Neon** (Singapore, `ap-southeast-1`; Vercel functions pinned to `sin1` in [vercel.json](../vercel.json)) |
| Driver | `pg` (node-postgres) — raw SQL, no ORM |
| Pool | [src/server/db/pool.ts](../src/server/db/pool.ts): `max` 5, `idleTimeoutMillis` 10 000, TLS (`rejectUnauthorized: false`) for every non-`localhost`/`127.0.0.1` host, cached on `globalThis` |
| Access | V2 through [PgV2Store](../src/server/v2/persistence/PgV2Store.ts) (interface `V2Store`); the Kite session and UI preferences through [appStore.ts](../src/server/db/appStore.ts) |
| Migrations | Plain SQL in [db/migrations/](../db/migrations), applied by [scripts/migrate.mjs](../scripts/migrate.mjs) (`npm run dev`, `npm run build`, `npm run live` and `npm run db:migrate` run it) |
| Tenancy | Single user: `user_preferences.user_id` is the fixed default user seeded by migration 004 |

---

## 2. Tables in use

### App level

| Table | Purpose |
| --- | --- |
| `kite_session` | Single row (`id = 1`): the Kite access token (AES-256-GCM encrypted with a key derived from `KITE_API_SECRET`), user, login / expiry time, `state` (`needs-login` / `connected` / `error`), `last_error` |
| `users` / `user_preferences` | The seeded default user and its UI preferences (`prefs` jsonb `{ theme, soundEnabled, browserNotifications }`) |
| `app_locks` | Named leases (`name`, `locked_until`, `last_run_at`): the V2 scanner holds `v2-scan` so two cycles never overlap and cycles are ≥ 45 s apart |
| `schema_migrations` | Applied migration files |

### V2 tables (007, 008)

Owned by V2 ([v2-architecture.md § 6](v2-architecture.md#6-persistence)); accessed only
through [PgV2Store](../src/server/v2/persistence/PgV2Store.ts).

| Table | Purpose |
| --- | --- |
| `v2_instruments` | Every supported contract: NSE / BSE indices and NSE cash stocks (`SPOT`), NFO / BFO / MCX futures and options (`token` PK, `product_id`, `kind`) |
| `v2_products` | Product catalogue built at sync: kind, session market, which legs it offers, expiries, strike gap, lot |
| `v2_calendar` | Holidays / special sessions per market (`market`, `date`) |
| `v2_strategies` / `v2_strategy_versions` | Product-agnostic strategies and their immutable versions |
| `v2_connections` | Strategy → product with `config` (expiry, strike shifts, alert policy), `enabled`, `enabled_at` |
| `v2_unit_state` | Alert state per (connection, unit) + latest evaluation |
| `v2_signals` | Every signal with its outcome; `identity` UNIQUE is the dedupe |
| `v2_alerts` / `v2_deliveries` | Alerts (unit with its leg contracts, evaluation) and per-recipient results (`target` = Telegram chat / email recipients) |
| `v2_scan_runs` | Scanner cycles (summary JSON incl. errors; pruned after 3 days) |
| `v2_settings` | One JSON row: Telegram chats (`telegramChats: [{ id, name }]`; older rows with a single `telegramChatId` are read as a one-chat list), email recipients / sender, request budget |
| `v2_paper_plans` | Paper-trading plan per strategy — the defaults for its connections (`strategy_id` PK → `v2_strategies`, cascade; `plan` JSON: enabled, cash per trade, rules, target / stop %, square-off, charges, slippage). No row = the preferred defaults, switched on (migration 010) |
| `v2_paper_trades` | Simulated trades opened by alerts: `trade` JSON (contract, lots, entry / exit, terms, P&L) plus indexed `strategy_id`, `connection_id` (cascade), `alert_id` (set null), `slot`, `status`, `entry_at`, `exit_at`, `net_pnl`; a partial unique index allows one OPEN trade per (connection, slot = strike position) (migration 010) |
| `v2_paper_overrides` | A connection's own paper values over its strategy's plan (`connection_id` PK → `v2_connections`, cascade; `override` JSON: only the changed keys) (migration 011) |
| `v2_live_status` | One row written every 5 s by the live worker (`npm run live`): heartbeat, state, sockets, contracts, accuracy counters, last candle closes; `offline_notified_at` = the backup scanner already warned (migration 008) |

---

## 3. Retired tables (left untouched)

The V1 pages and MCX V2 were removed from the code on 2026-09-27, but **their tables and data were not dropped**
(nothing reads or writes them any more):

- V1: `alert_configurations`, `monitor_state`, `alerts`, `custom_strategies`, `strategy_versions`,
  `underlying_groups`, `instruments`, `app_kv`, `notification_logs`, and the never-used `devices`, `strategies`.
- MCX V2 (migration 006): every `mcx_`-prefixed table.

Dropping them is optional and irreversible — only add a migration for it if you're sure the old data isn't needed.

---

## 4. Migrations

| File | Adds |
| --- | --- |
| [001_init.sql](../db/migrations/001_init.sql) … [005_light_theme_default.sql](../db/migrations/005_light_theme_default.sql) | V1 schema (now mostly retired, see § 3) plus `users`, `user_preferences`, `kite_session`, `app_locks` still in use; 004 seeds the default user |
| [006_mcx_v2.sql](../db/migrations/006_mcx_v2.sql) | MCX V2 tables (retired) |
| [007_v2.sql](../db/migrations/007_v2.sql) | V2 tables (all `v2_`-prefixed) |
| [008_v2_live.sql](../db/migrations/008_v2_live.sql) | `v2_live_status` (live worker heartbeat) |
| [009_v2_delivery_target.sql](../db/migrations/009_v2_delivery_target.sql) | `v2_deliveries.target` — who each delivery went to (one row per Telegram chat) |
| [010_v2_paper.sql](../db/migrations/010_v2_paper.sql) | `v2_paper_plans`, `v2_paper_trades` (paper trading) |
| [011_v2_paper_connections.sql](../db/migrations/011_v2_paper_connections.sql) | `v2_paper_overrides` (a connection's own paper values) |

Keep every migration file: the runner tracks applied files by name, and a fresh database is built by replaying them
in order.

How the runner works ([scripts/migrate.mjs](../scripts/migrate.mjs)):

- Loads `.env.local` then `.env` for any variable not already set, reads `DATABASE_URL`, and creates
  `schema_migrations`.
- Applies each unapplied `*.sql` in file-name order, each in its own transaction, recording it on success.
- Flags: `--if-configured` (skip quietly without `DATABASE_URL`; used by `npm run build`) and `--soft` (warn instead
  of failing; used by `predev`).
- There are **no down migrations**. All migrations so far are additive and idempotent (`IF NOT EXISTS`,
  `ON CONFLICT DO NOTHING`).
