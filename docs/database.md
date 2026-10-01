# Database

> Related: [architecture.md](architecture.md) · [v2-architecture.md § 6](v2-architecture.md#6-persistence) · [deployment.md](deployment.md)

## 1. Technology and access

Postgres on **Neon**, reached through `DATABASE_URL` (required). The running app keeps hot data in memory in front
of it (§ 5), so the database sees only core records.

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
| `app_locks` | Named leases (`name`, `locked_until`, `last_run_at`): the V2 scanner holds `v2-scan` so two cycles never overlap and cycles are ≥ 45 s apart. Not used in memory mode (the lease is held in memory) |
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
| `v2_unit_state` | Alert state per (connection, unit) + latest evaluation. In memory mode written only when the alert state changes, without the evaluation |
| `v2_signals` | Signals with their outcome; `identity` UNIQUE is the dedupe. In memory mode only those that alerted (ALERTED / NO_CHANNEL), with a shallow trace |
| `v2_alerts` / `v2_deliveries` | Alerts (unit with its leg contracts, evaluation) and per-recipient results (`target` = Telegram chat / email recipients) |
| `v2_scan_runs` | Scanner cycles (summary JSON incl. errors; pruned after 3 days). Not written in memory mode |
| `v2_settings` | One JSON row: Telegram chats (`telegramChats: [{ id, name }]`; older rows with a single `telegramChatId` are read as a one-chat list), email recipients / sender, request budget |
| `v2_paper_plans` | Paper-trading plan per strategy — the defaults for its connections (`strategy_id` PK → `v2_strategies`, cascade; `plan` JSON: enabled, cash per trade, rules, target / stop %, square-off, charges, slippage). No row = the preferred defaults, switched on (migration 010) |
| `v2_paper_trades` | Simulated trades opened by alerts: `trade` JSON (contract, lots, entry / exit, terms, P&L) plus indexed `strategy_id`, `connection_id` (cascade), `alert_id` (set null), `slot`, `status`, `entry_at`, `exit_at`, `net_pnl`; a partial unique index allows one OPEN trade per (connection, slot = strike position) (migration 010) |
| `v2_paper_overrides` | A connection's own paper values over its strategy's plan (`connection_id` PK → `v2_connections`, cascade; `override` JSON: only the changed keys) (migration 011) |
| `v2_live_status` | One row from a separate live worker (`npm run live`, every 20 s): heartbeat, state, sockets, contracts, accuracy counters, last candle closes; `offline_notified_at` = the backup scanner already warned (migration 008). Not written in memory mode |

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

---

## 5. Database traffic

Normally the app is one process — `npm start` / `npm run dev`: UI, API, scanner and live worker together. Nothing
else writes the same data, so [RuntimeV2Store](../src/server/v2/persistence/RuntimeV2Store.ts) (V2) and
`RuntimeAppStore` ([appStore.ts](../src/server/db/appStore.ts)) wrap the database store and keep hot data in memory.
The state lives on `globalThis`, so every module copy in the process shares it.

| Data | Where it goes |
| --- | --- |
| Strategies, connections, settings, paper plans / overrides, calendar, Kite session, preferences | Read once, cached, written through on change (a strategy's version history is read on demand) |
| Instruments / products | Cached; Postgres sync is a diff (deletes gone or changed tokens, inserts new ones) once a day, with its time and count kept in `v2_settings` key `instruments_sync` |
| Alerts, deliveries | Written in the background (below); the alarm feed is served from memory (the last 200 loaded once); alert lists are read once per filter and reused until an alert changes |
| Signals | ALERTED / NO_CHANNEL written (in the background) with a shallow trace (top-level ids, labels, results); others kept in memory (last 1 000); deduped in memory by identity |
| Unit state | Written (in the background) only when the alert decision changes (state, last signal candle, last alert, cooldown) |
| Paper trades | Written (in the background) on open and on close; open trades and their marks (live P&L) in memory, one per slot checked there; closed trades read once per change |
| Scanner runs, locks, live-worker status, the change stamp screens poll | Memory only |

[tests/v2/memoryLayer.test.ts](../tests/v2/memoryLayer.test.ts) checks this on a simulated session: after warm-up an
hour of minute scans and screen polls makes no database calls; an alert costs five writes (signal, alert, delivery,
unit state, paper trade); a paper exit one; the Paper tab then reads the closed trades once.

### Saving in the background

Event writes — signal, alert, delivery, alert status, unit state, paper trade open / close — never hold an alert up.
The record exists in memory at once (with its id), and the write goes to a queue
([writeQueue.ts](../src/server/v2/persistence/writeQueue.ts)) that one writer saves in order:

- While the database can't be reached (no connection, timeout, Neon's quota error) it retries, 1 s → 30 s, and the
  top bar shows "N not saved yet" (`/api/v2/status` → `database`). The waiting writes are kept in
  `data/pending-writes.json` (`PENDING_WRITES_FILE`; git-ignored) and saved on the next start; on Ctrl+C the app
  saves what it can within 2 s first.
- A write the database refuses (Postgres classes 22 / 23 — a duplicate, a deleted connection) is
  tried 3 times and dropped, with the writes that depend on it (an alert whose signal wasn't saved, its deliveries);
  a paper trade is still saved, without the link. Settings → Database shows the count.
- Every read that goes to the database first waits for the queue (so it sees the new records) — unless the
  database is failing, then the alarm feed, alert details, lists read before and the Paper tab answer from memory.
- The pool gives up on a connection after 10 s and on a query after 60 s, and a connection closed by the server
  (Neon going to sleep) is logged, not fatal.

### Database size and history

Settings → Database (`GET /api/v2/database`) shows the size (Postgres `pg_database_size`; checked at
most every 10 minutes) against Neon's free 0.5 GB, and the largest tables. **Keep history** (`v2_settings.historyDays`,
`PUT /api/v2/database/history`) is `null` — everything — by default; with a period, alerts (+ deliveries), signals not
tied to a kept alert, closed paper trades and scanner cycles older than it are deleted at once and then daily
(`maintenance.prune`, run hourly by the app, once per IST day). Strategies, connections, settings and open trades are
never deleted. At start the app also removes scanner cycles older than 3 days (they were always kept 3 days).

Memory mode is off — every read and write goes to the database — on Vercel, with `LIVE_WORKER=off`, in the separate
`npm run live` process, and in an app that finds such a worker running (decided at start,
[runtime.ts](../src/server/runtime.ts)). A lock file in the system temp folder (one per project folder) marks the
running live worker. Consequence of memory mode: the Signals and Scanner tabs show history since the app started.
