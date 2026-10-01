# Setup — local development

> Related: [deployment.md](deployment.md) (production) · [troubleshooting.md](troubleshooting.md) · [development.md](development.md)

## 1. Prerequisites

| Requirement | Version / notes | Source |
| --- | --- | --- |
| Node.js | `>= 22.13` (24 LTS recommended) | `engines` in [package.json](../package.json) |
| npm | Any version that reads `package-lock.json` v3 | [package-lock.json](../package-lock.json) is committed |
| PostgreSQL | A Postgres database reachable by URL — normally **Neon** (free plan). The schema needs the `pgcrypto` extension and `gen_random_uuid()`; the exact minimum Postgres version is *not stated in the repository*. Optional: without it the app uses a local SQLite file | [db/migrations/](../db/migrations) |
| Zerodha Kite Connect app | API key + secret; the historical-data add-on is needed for candles (per the root README) | [.env.example](../.env.example) |
| Telegram bot | Optional | [.env.example](../.env.example) |

Main stack (from `package.json`): Next.js `^16.3.6` (App Router, Turbopack), React `^19.3`, TypeScript `^5.9`,
Tailwind CSS `^3.4`, TanStack Query `^5`, zod `^3.25`, `pg` `^8.23`, `kiteconnect` `^4.1`, `lightweight-charts`
`^4.2`, `recharts` `^2.15`, `exceljs`, `date-fns` `^4`, `lucide-react`, vitest `^3.2`.

> **This is Next.js 16.** APIs and conventions differ from older versions (for example `src/proxy.ts` replaces
> middleware). [AGENTS.md](../AGENTS.md) asks contributors to read the guides in `node_modules/next/dist/docs/`
> before writing Next.js code.

---

## 2. Install

```bash
git clone <repo-url> algo-hunt && cd algo-hunt
npm install
cp .env.example .env.local        # then fill in the values below
```

---

## 3. Environment variables

Read by [src/server/config/index.ts](../src/server/config/index.ts) (zod-validated, lazily at request time) unless
noted otherwise.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** (Neon) | Postgres connection string; unset → local SQLite file (`DATABASE_FILE`, default `data/algo-hunt.db`). On Vercel use Neon's **pooled** string (host contains `-pooler`). `sslmode=require` is rewritten to `verify-full` internally (same behaviour, no warning) |
| `KITE_API_KEY` | **Yes** for market data | Kite Connect app key |
| `KITE_API_SECRET` | **Yes** for market data | Kite Connect app secret; also derives the key that encrypts the stored access token. Rotating it invalidates the stored session |
| `APP_PASSWORD` | **Yes in production** | Dashboard password. Unset → open in development, 503 in production |
| `CRON_SECRET` | **Yes in production** | Secret for `/api/cron/tick` (`Authorization: Bearer …` or `?secret=`). Unset → allowed only outside production |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | No | Telegram alerts. The chat id can instead be set in V2 → Settings (then only the token is needed) |
| `RESEND_API_KEY` | No | Email alerts via [Resend](https://resend.com); recipients and sender are set in V2 → Settings |
| `LIVE_WORKER` | No | `on` (default) / `off` — the live worker inside the app. `off` also turns the memory layer off ([database.md § 5](database.md#5-database-traffic)) |
| `LOG_LEVEL` | No | `error` · `warn` · `info` (default) · `debug`; JSON log lines ([logger.ts](../src/server/utils/logger.ts)) |
| `KITE_API_ROOT` | No | Overrides the Kite API base URL (for proxies / integration testing). Read directly in [kiteClient.ts](../src/server/services/kite/kiteClient.ts); **not listed in `.env.example`** |
| `NODE_ENV` | Set by Next.js | Production enables the password/secret requirements and `Secure` cookies |

**Where env files are read:**

- Next.js loads `.env*` files itself. A value already present in the process environment wins over the files.
- `scripts/migrate.mjs` reads `.env.local`, then `.env`, only for variables not already set.
- `.env`, `.env.local` and `.env.*.local` are git-ignored ([.gitignore](../.gitignore)).

> ⚠ **Use a separate development database.** The dev server talks to whatever `DATABASE_URL` points at, runs its
> migrations on start, and its live worker writes alerts and paper trades. Point development at a Neon branch (or
> leave `DATABASE_URL` unset for the local file) if you don't want to touch the trader's data. Two running copies on
> one database would also alert twice.

---

## 4. Database

**Neon:** create a free project, copy its connection string into `DATABASE_URL`. `npm run setup` (or `npm run dev`
/ `npm run build` / `npm run db:migrate`) applies the migrations. The running app keeps live state in memory and
sends Neon only core records — [database.md § 5](database.md#5-database-traffic).

**Local file:** with `DATABASE_URL` unset the app keeps its data in `data/algo-hunt.db` (SQLite built into Node.js),
creating and updating the file itself on start; `backups/` gets a snapshot a day. Both are git-ignored. To bring
Postgres data over once: `npm run db:import -- "<postgres url>"`. See [database.md § 1](database.md#1-technology-and-access).

---

## 5. Run

```bash
npm run setup                 # install + build
npm start                     # http://localhost:3000 — app + live worker, one process
```

| Command | What it does |
| --- | --- |
| `npm run setup` | `npm install` + build |
| `npm start` | `next start`: the UI, the API, the live worker inside the app (and daily backups in local-file mode); needs `APP_PASSWORD` |
| `npm run update` | `git pull --ff-only` + install + build (Postgres migrations included) |
| `npm run dev` | `predev` (Postgres migrations if `DATABASE_URL`), then `next dev` — with the live worker inside |
| `npm run live` | The live worker as its own process (only with `LIVE_WORKER=off` on the app): `-- --check` tests the stream, `-- --force` starts even if another worker holds the lock |
| `npm run backup` / `npm run restore -- <file>` | Snapshot the local database now / put a snapshot back (app stopped) |
| `npm run db:import -- "<url>"` | Copy all data from Postgres into the local database |
| `npm test` / `npm run test:watch` | vitest once / watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Postgres migrations (the local database migrates itself) |

The live worker starts inside the app with `npm start` and `npm run dev` (`LIVE_WORKER=off` to run it separately
with `npm run live`). Only one worker runs per project folder: a lock file in the system temp folder marks it, a
second one stands aside, and an app that finds a separate worker running reads everything from the database.

### Connecting Kite locally

1. In your Kite Connect app, add the redirect URL `http://localhost:3000/zerodhaRedirection` (or
   `/redirect/zerodha`).
2. Open the app → **Connect Kite** (top bar or **Settings → Broker Connection**). You return automatically.
   Then **V2 → Products → Sync from Kite** once (the scanner and the live worker keep it fresh afterwards).
3. Kite tokens expire every morning (~06:00 IST), so reconnect once per trading day.

### Running alerts locally

- **Live worker:** inside the app with `npm start` / `npm run dev`, or `npm run live` next to an app started with
  `LIVE_WORKER=off` (see
  [v2-user-guide.md](v2-user-guide.md#live-alerts-on-your-computer-recommended)).
- **Scanner:** keep `/v2` open (it scans once a minute during market hours), or trigger one cycle by hand. Without
  `CRON_SECRET` this is allowed outside production; `force=1` runs even when markets are closed:

  ```bash
  curl -s 'http://localhost:3000/api/cron/tick?force=1'
  ```

---

## 6. Common setup problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| API responds `503 Database tables are missing — run npm run db:migrate` | Postgres schema not migrated | `npm run db:migrate` |
| `This Node.js has no built-in SQLite — install Node.js 22.13 or newer` | Node.js too old for the local database | Install Node.js 24 LTS |
| The app uses the local file instead of Neon | `DATABASE_URL` is unset (or set to empty in the shell — an existing empty variable wins over `.env.local`) | Set it in `.env.local`; `unset DATABASE_URL` in the shell; restart |
| Log says "a live worker is already running on this computer" | A separate `npm run live` holds the worker lock | Stop it (Ctrl+C) and restart the app, or keep it and start the app with `LIVE_WORKER=off` |
| Settings shows "Kite Connect credentials are missing" | `KITE_API_KEY` / `KITE_API_SECRET` unset | Set both; restart |
| V2 product lists are empty | Products not synced yet | Connect Kite, then **V2 → Products → Sync from Kite** |
| `next dev` exits with "Another next dev server is already running" | Next.js 16 allows one dev server per project directory | Use the existing server (URL printed) or stop it |
| Production responds `APP_PASSWORD is not configured…` | Missing env var in production | Set `APP_PASSWORD` |
| Kite login bounces back with an error | Redirect URL mismatch, cancelled login, or a reused `request_token` | Check the Kite app's Redirect URL; log in again |

More: [troubleshooting.md](troubleshooting.md).
