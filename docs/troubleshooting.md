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

## 1b. Neon: "Limit reached" / "Connection Restricted"

Neon limits the **data sent out of the database** per month (network transfer). When it runs out, Neon blocks
connections — **nothing is deleted**; access returns when the allowance resets (see *Review usage* in the Neon console
for the date) or right away on a paid plan.

The app keeps its reads small (since 2026-09-29): contracts are read once per instrument sync (not every minute), the
alarm polls a feed of alerts newer than the last one it saw (nothing when there's nothing new), alert / signal lists
leave the condition trace in the database (opened on demand), status uses counts, closed paper trades are reused
until one closes, and the live worker reloads connections only when a one-value check says they changed.

Also make sure nothing else reads the same database: a deployed copy (e.g. on Vercel) called every minute by a
scheduler reads as much as the local app. Stop the scheduler (or the deployment) if you only run it locally.

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

## 4. Live worker (`npm run live`)

| Symptom / message | Cause | Fix |
| --- | --- | --- |
| `✗ Kite is not logged in — log in from the app …` (`--check`) / state **Waiting for Kite login** | No valid Kite session | Log in (Settings → Broker Connection); the worker picks it up within 30 s |
| `Another live worker is running (heartbeat N s ago)` | A second worker was started | Stop the first one (Ctrl+C), or start with `-- --force` |
| Live feed **Degraded** / Telegram "live feed disconnected" | Internet drop or Kite closed the socket | It reconnects by itself; the backup scanner covers meanwhile |
| Telegram "live worker is offline" | The worker stopped without Ctrl+C (crash, sleep, closed terminal) | Restart `npm run live`; keep the computer awake in market hours |
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
