# Setup — local development

> Related: [deployment.md](deployment.md) (production) · [troubleshooting.md](troubleshooting.md) · [development.md](development.md)

## 1. Prerequisites

| Requirement | Version / notes | Source |
| --- | --- | --- |
| Node.js | `>= 20.9` | `engines` in [package.json](../package.json) |
| npm | Any version that reads `package-lock.json` v3 | [package-lock.json](../package-lock.json) is committed |
| PostgreSQL | A Postgres database reachable by URL. Production uses Neon. The schema needs the `pgcrypto` extension and `gen_random_uuid()`; the exact minimum Postgres version is *not stated in the repository* | [db/migrations/](../db/migrations) |
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
| `DATABASE_URL` | **Yes** | Postgres connection string. On Vercel use Neon's **pooled** string (host contains `-pooler`). `sslmode=require` is rewritten to `verify-full` internally (same behaviour, no warning) |
| `KITE_API_KEY` | **Yes** for market data | Kite Connect app key |
| `KITE_API_SECRET` | **Yes** for market data | Kite Connect app secret; also derives the key that encrypts the stored access token. Rotating it invalidates the stored session |
| `APP_PASSWORD` | **Yes in production** | Dashboard password. Unset → open in development, 503 in production |
| `CRON_SECRET` | **Yes in production** | Secret for `/api/cron/tick` (`Authorization: Bearer …` or `?secret=`). Unset → allowed only outside production |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | No | Both set → alerts are also sent to that Telegram chat. MCX V2 needs only the token when a chat id is set in MCX V2 → Settings |
| `RESEND_API_KEY` | No | MCX V2 email alerts via [Resend](https://resend.com); recipients and sender are set in MCX V2 → Settings |
| `LOG_LEVEL` | No | `error` · `warn` · `info` (default) · `debug`; JSON log lines ([logger.ts](../src/server/utils/logger.ts)) |
| `KITE_API_ROOT` | No | Overrides the Kite API base URL (for proxies / integration testing). Read directly in [kiteClient.ts](../src/server/services/kite/kiteClient.ts); **not listed in `.env.example`** |
| `NODE_ENV` | Set by Next.js | Production enables the password/secret requirements and `Secure` cookies |

**Where env files are read:**

- Next.js loads `.env*` files itself. A value already present in the process environment wins over the files.
- `scripts/migrate.mjs` reads `.env.local`, then `.env`, only for variables not already set.
- `.env`, `.env.local` and `.env.*.local` are git-ignored ([.gitignore](../.gitignore)).

> ⚠ **Use a separate development database.** The dev server talks to whatever `DATABASE_URL` points at. An open
> dashboard triggers live ticks, which write monitor state and alerts and may sync instruments. Point local
> development at a Neon branch or local Postgres, not production.

---

## 4. Database

```bash
npm run db:migrate            # apply pending db/migrations/*.sql (fails if DATABASE_URL is missing)
```

`npm run dev` also runs migrations first (`predev` with `--if-configured --soft`: skipped without `DATABASE_URL`,
and warns instead of failing). See [database.md § 4](database.md#4-migrations).

---

## 5. Run

```bash
npm run dev                   # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | `predev` migrations, then `next dev` |
| `npm run build` | Migrations (`--if-configured`), then `next build` |
| `npm start` | `next start` (serve a production build) |
| `npm test` / `npm run test:watch` | vitest once / watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Apply migrations |

There is only one service to run: the Next.js app serves both the UI and the API. The database and Kite are
external.

### Connecting Kite locally

1. In your Kite Connect app, add the redirect URL `http://localhost:3000/zerodhaRedirection` (or
   `/redirect/zerodha`).
2. Open the app → **Connect Kite** (top bar or **Settings → Broker Connection**). You return automatically. The
   instrument master for NSE/BSE and MCX syncs after login.
3. Kite tokens expire every morning (~06:00 IST), so reconnect once per trading day.

### Running the live evaluator locally

- Keep a dashboard tab open. While Kite is connected and a market with active monitors is in session, the tab
  calls `POST /api/live/tick` every 30 s.
- Or trigger one pass by hand. Without `CRON_SECRET` this is allowed outside production; `force=1` runs even when
  markets are closed:

  ```bash
  curl -s 'http://localhost:3000/api/cron/tick?force=1'
  ```

---

## 6. Common setup problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| API responds `503 Database tables are missing — run npm run db:migrate` | Schema not migrated on this database | `npm run db:migrate` |
| `DATABASE_URL is not set. Add your Neon Postgres connection string…` | Missing env var | Add it to `.env.local` |
| Settings shows "Kite Connect credentials are missing" | `KITE_API_KEY` / `KITE_API_SECRET` unset | Set both; restart |
| Underlying / product dropdowns are empty; "not synced" badges on the MCX tab | Instrument master not downloaded yet | Connect Kite, then **Settings → Refresh** |
| `next dev` exits with "Another next dev server is already running" | Next.js 16 allows one dev server per project directory | Use the existing server (URL printed) or stop it |
| Production responds `APP_PASSWORD is not configured…` | Missing env var in production | Set `APP_PASSWORD` |
| Kite login bounces back with an error | Redirect URL mismatch, cancelled login, or a reused `request_token` | Check the Kite app's Redirect URL; log in again |

More: [troubleshooting.md](troubleshooting.md).
