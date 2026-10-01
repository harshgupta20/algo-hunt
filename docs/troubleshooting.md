# Troubleshooting

Only problems that follow from the code, configuration or documented behaviour are listed. The messages quoted are
the exact strings the application produces.

> Related: [setup.md § 6](setup.md#6-common-setup-problems) · [deployment.md](deployment.md) · [status.md](status.md)

## 1. Setup and configuration

| Symptom / message | Cause | Fix |
| --- | --- | --- |
| `503 Database tables are missing — run npm run db:migrate (Vercel builds run it automatically).` | Postgres error `42P01`: schema never migrated on this database | `npm run db:migrate`, or redeploy (the build migrates) |
| `DATABASE_URL is not set. Add your Neon Postgres connection string to the environment.` | Missing env var | Set `DATABASE_URL` |
| `Invalid environment configuration: …` | An env var has an invalid value (e.g. `LOG_LEVEL=verbose`) | Use a valid value (see [setup.md § 3](setup.md#3-environment-variables)) |
| Every page returns `APP_PASSWORD is not configured. Set it in your Vercel project environment variables.` (503) | Production without `APP_PASSWORD` | Set it and redeploy |
| `Zerodha Kite is not configured: set KITE_API_KEY and KITE_API_SECRET.` / Settings shows "credentials are missing" | Kite env vars unset | Set both |
| `/api/cron/tick` returns `401 Unauthorized` | Missing or wrong `CRON_SECRET` header/query | Send `Authorization: Bearer <CRON_SECRET>` |
| `next dev` prints "Another next dev server is already running" | Next.js 16 allows one dev server per project folder | Use the running one or stop it |

## 1a. Database setting

| Symptom / message | Cause | Fix |
| --- | --- | --- |
| `[migrate] DATABASE_URL is not set — add your Neon connection string to .env.local` / `DATABASE_URL is not set` errors | No database configured | Put the Neon connection string in `.env.local` (see `.env.example`); restart |
| The app still reports `DATABASE_URL is not set` although `.env.local` has it | It's set to empty in the shell — an existing (even empty) variable wins over `.env.local` | `unset DATABASE_URL`; restart |

## 1b. Neon: "Limit reached" / "Connection Restricted"

Neon limits the **data sent out of the database** per month (network transfer). When it runs out, Neon blocks
connections — **nothing is deleted**; access returns when the allowance resets (see *Review usage* in the Neon console
for the date) or right away on a paid plan.

Since 2026-10-01 the running app keeps hot data in memory and sends Neon only core records — an hour of scans and
open screens makes no database calls ([database.md § 5](database.md#5-database-traffic)). Before that (2026-09-29) reads were cut: contracts are read once per instrument sync (not every minute), the
alarm polls a feed of alerts newer than the last one it saw (nothing when there's nothing new), alert / signal lists
leave the condition trace in the database (opened on demand), status uses counts, closed paper trades are reused
until one closes, and the live worker reloads connections only when a one-value check says they changed.

Also make sure nothing else reads the same database: a deployed copy (e.g. on Vercel) called every minute by a
scheduler reads as much as the local app. Stop the scheduler (or the deployment) if you only run it locally.

## 1c. "N not saved yet" in the top bar

The app can't reach the database, so it holds the new records (alerts, deliveries, paper trades) and saves them when
it's back — alerts, the alarm and paper trading keep working meanwhile. Settings → Database shows the count, since
when, and the error.

| Error shown | Cause | Fix |
| --- | --- | --- |
| `connect ECONNREFUSED`, `getaddrinfo ENOTFOUND`, `timeout exceeded when trying to connect` | No internet, or the database host is wrong | Check the connection / `DATABASE_URL`; nothing to do once it's back |
| `… exceeded the compute time quota` / `data transfer quota` | Neon's free monthly allowance ran out | Wait for the reset (Neon console → *Review usage*) or upgrade; records keep waiting meanwhile (also across restarts, in `data/pending-writes.json`) |
| `relation "v2_…" does not exist` | Migrations not applied | `npm run db:migrate` (or restart `npm run dev`) |
| "N records were refused by the database" (Settings) | The database rejected them (e.g. their connection was deleted meanwhile) | Nothing to do — the app log has each one (`database refused a write — dropped`) |

Don't delete `data/pending-writes.json` while it exists — it is the only copy of those records.

## 2. Kite connection

| Symptom / message | Cause | Fix |
| --- | --- | --- |
| Top bar "Kite offline", **Connect Kite** button | No session, or the daily token expired (~06:00 IST) | Click **Connect Kite** |
| `Kite rejected the session: … Please log in again.` | Kite returned `TokenException` mid-day (token revoked or expired) | Log in again. The app flips to *needs login* automatically |
| Login lands on Settings with `kite=error&message=Login was cancelled` / `Missing request_token` | Cancelled login or wrong redirect | Check the Kite app's Redirect URL (`/zerodhaRedirection`) and retry |
| `Provide the request_token (or paste the full redirected URL).` | Empty body to `POST /api/kite/session` | Send `{"token": "<request_token or URL>"}` |
| `Kite did not return an access token` / other login error text | Kite rejected the exchange (bad secret, reused token) | Verify `KITE_API_SECRET`; request_tokens are single-use, so log in again |
| `409` on product sync / preview / compare | Kite not connected | Connect Kite first |
| Compare is slow | Kite historical rate limit (~3 req/s) | Fewer products or a larger trigger timeframe |

## 3. V2 products and connections

| Symptom / message | Cause | Fix |
| --- | --- | --- |
| Product lists are empty | Products never synced | **V2 → Products → Sync from Kite** (needs Kite; ~1 minute) |
| A product is missing from the connection picker | It lacks a leg the strategy uses (e.g. options → cash-only stocks are hidden) | Expected; the picker lists only products offering every leg |
| `… is already connected to this strategy` | A product in the selection already has a connection for that strategy | Already-connected products are marked "connected" and skipped by Select all |
| `Strike position +N is outside the listed strikes — skipped` | That strike isn't listed for the chosen expiry | Choose fewer strike positions or another expiry |
| "Unknown" results | Indicator warm-up, or a contract with no trades / history | Expected: Unknown never alerts |

## 4. Live worker

| Symptom / message | Cause | Fix |
| --- | --- | --- |
| Log: `a live worker is already running on this computer (npm run live) — not starting one in the app` | A separate `npm run live` holds the worker lock; the app then reads everything from the database | Stop it (Ctrl+C) and restart the app — the app runs the worker itself |
| Log: `live worker not started in the app` | Kite env vars missing, or the worker failed to start | Check `KITE_API_KEY` / `KITE_API_SECRET`; the log line has the error |
| `✗ Kite is not logged in — log in from the app …` (`--check`) / state **Waiting for Kite login** | No valid Kite session | Log in (Settings → Broker Connection); the worker picks it up within 30 s |
| `✗ A live worker is already running on this computer (process N) — usually inside the app …` from `npm run live` | The app already runs the worker | Nothing to do — or start the app with `LIVE_WORKER=off` to use the separate one |
| `Another live worker is running (heartbeat N s ago)` | A second worker was started | Stop the first one (Ctrl+C), or start with `-- --force` |
| Live feed **Degraded** / Telegram "live feed disconnected" | Internet drop or Kite closed the socket | It reconnects by itself; the backup scanner covers meanwhile |
| Telegram "live worker is offline" | The worker stopped without Ctrl+C (crash, sleep, closed terminal) | Restart the app (or `npm run live`); keep the computer awake in market hours |
| `This computer's clock is N s off the exchange` | System clock drift | Enable automatic time sync |
| Alerts marked **Unverified** | Kite's official candles didn't arrive within 2 minutes | Usually identical to Kite's chart; check it if it matters |
| "N connection(s) don't fit Kite's contract limit" | More than 9,000 streamed contracts | Those connections are checked by the scanner; reduce products or strike positions |

## 5. Scanner

| Symptom | Cause | Fix |
| --- | --- | --- |
| Top bar shows "Scanner" and alerts come minutes late | The live worker isn't running | Start `npm run live` |
| No scans in the evening for MCX | Scheduler window stops at NSE close | Cover 09:00–00:05 IST (see [deployment.md § 5](deployment.md#5-scheduler-every-minute)) |
| An alert you expected is missing after downtime | Candles that closed more than 30 minutes before evaluation are recorded as suppressed (stale), not sent | Expected behaviour; see V2 → Alerts → signals |

## 6. Tests and build

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npm run build` skips migrations | `DATABASE_URL` not set in the build environment (`--if-configured`) | Set it in Vercel project env vars |
