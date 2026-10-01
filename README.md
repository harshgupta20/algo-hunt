# Algo Hunt — Strategy + Product = Alert

A personal trading **alert** platform for Indian markets (it never places orders). Build a strategy once — 1–4 legs
(Spot, Future, Call, Put) and conditions between them — then connect it to any **NSE index, NSE stock or MCX
commodity** and get alerts on Telegram, email and the desktop when it fires. Compare shows which products a strategy
suits, and **paper trading** (on for every connection, ₹10,000 per trade by default, adjustable per strategy or
connection) turns every alert into a simulated trade so the Paper tab shows what each connection would have made.
**Backtest** answers the same question for the past: a strategy on the products you pick, with your capital, over past
candles. Everything runs on real Zerodha Kite data.

Built with **Next.js 16** (App Router), **Zerodha Kite Connect** and **Postgres on Neon** — only core records are
stored; live state stays in the app's memory.

> 📚 Documentation lives in [docs/](docs/README.md) — the trader guide ([v2-user-guide.md](docs/v2-user-guide.md)),
> architecture, setup, API, database, testing, deployment, troubleshooting and the current
> [status](docs/status.md).

---

## How alerts are produced

- **Live worker (recommended):** runs inside the app with `npm start` (or as `npm run live`); it streams Kite ticks for every contract your
  switched-on connections use, builds candles as they form and checks each connection seconds after its candle
  closes. Anything that would alert is re-checked on Kite's official candles first, so alerts match the Kite chart
  (marked **✓ Verified**).
- **Scanner (backup):** `/api/cron/tick`, called every minute by a scheduler, checks connections on Kite's closed
  candles. While the live worker runs, the scanner only covers what the worker can't; if the worker stops, the scanner
  takes over and Telegram tells you.

## Layout

```
src/
  app/                 Next.js App Router
    (dashboard)/       v2 (the app) · settings (Kite login, theme, notifications)
    api/[...path]/     REST API (src/server/api/routes.ts)
    api/cron/tick/     V2 scanner (CRON_SECRET-protected)
    api/auth/*         Password login / logout
    zerodhaRedirection Kite OAuth redirect landing page
  proxy.ts             Access control (password session cookie) for every page + API
  client/v2/           The V2 UI
  server/v2/           The V2 module (products, strategies, connections, engine, alerts, scanner, live worker)
  server/workers/      v2Live.ts — the `npm run live` process
  server/services/     kite/ (auth, encrypted session, historical candles) · indicator/ (indicator maths)
  shared/v2/           V2 types, catalogue, validation, text
db/migrations/         SQL migrations (applied automatically)
```

---

## Setup — clone, set up, start

Needs **Node.js 24 LTS** (or 22.13+), git and a database URL — **Neon** (free Postgres) is the normal choice. The
app runs as one process (UI, API, scanner and live worker together), so everything that changes every few seconds
stays in its memory and Neon receives only the core records: strategies, connections, settings, alerts and their
deliveries, alerting signals, paper trades (opening and closing) and the Kite session — see
[Database traffic](#database-traffic).

```bash
git clone <repo> algo-hunt && cd algo-hunt
cp .env.example .env.local     # DATABASE_URL (Neon), Kite keys, APP_PASSWORD, Telegram
npm run setup                  # install + migrate + build (once, and after each update)
npm start                      # http://localhost:3000 — the app and the live worker in one process
```

Later, to update: stop the app (Ctrl+C), `npm run update` (git pull + install + migrate + build), then `npm start`
again.

For Kite login, add `http://localhost:3000/zerodhaRedirection` as the Redirect URL in your Kite Connect app.
`npm start` needs `APP_PASSWORD` (the login password); `npm run dev` is open without it.

| Command | Description |
| --- | --- |
| `npm run setup` | Install and build |
| `npm start` | Serve the build: UI, API, scanner and **live worker** (streams Kite, alerts seconds after each candle close) — one process. `LIVE_WORKER=off` to run the worker separately |
| `npm run update` | `git pull` + install + build (then `npm start`) |
| `npm run dev` | Development server — also runs the live worker inside it |
| `npm run live` | Live worker as its own process (`-- --check` tests the Kite stream). Only with `LIVE_WORKER=off` on the app, which then reads everything from the database |
| `npm test` / `npm run typecheck` | vitest suite / TypeScript check |

Run the app on **one computer at a time**: each running copy has its own scanner and live worker, so two copies on
the same database would alert twice.

### Database traffic

The running app reads each kind of data from the database once, then keeps it in memory and writes changes through
(implementation: [RuntimeV2Store](src/server/v2/persistence/RuntimeV2Store.ts), [runtime.ts](src/server/runtime.ts)).

| | In the database (Neon) | In memory only (since the app started) |
| --- | --- | --- |
| Core | Strategies, connections, settings, paper plans / overrides, Kite session, preferences, instruments (re-synced as a daily diff) | — |
| Events | Alerts + deliveries; signals that alerted (with a short trace); paper trades on open and close; a unit's alert state when it changes | Signals that didn't alert, scanner runs, evaluation details, paper marks (live P&L) |
| Status | — | Live-worker heartbeat, locks, the change stamp the screens poll |

A trading hour of scans and open screens makes **no database calls** once warm; an alert costs about five writes, a
paper exit one ([tests/v2/memoryLayer.test.ts](tests/v2/memoryLayer.test.ts) counts them). Alert and signal lists
are read once and reused until the next alert, so Neon can sleep whenever nothing fires. The Signals and Scanner
tabs show history since the app last started. On Vercel, with `LIVE_WORKER=off`, or next to a separate
`npm run live`, the app reads and writes everything in the database instead (more than one process shares it).

**Alerts never wait for the database.** The alert, its Telegram message, the alarm and the paper trade happen from
memory; their records are saved right after, in order, by a background queue. While Neon can't be reached (asleep,
offline, over its monthly allowance) the queue retries every few seconds; the top bar shows **"N not saved yet"**
and the records are kept in `data/pending-writes.json` across a restart.

**Settings → Database** shows the space used (against Neon's free 0.5 GB) and **Keep history**: everything by
default, or alerts, signals and closed paper trades for the last 1 / 3 / 6 / 12 / 24 months (older ones deleted
daily, after a confirmation).

On the Neon free plan (100 compute-hours, 5 GB transfer, 0.5 GB storage a month): set the compute size to a fixed
0.25 CU in the Neon console, and run only one copy of the app on the database (a Vercel copy with its scheduler,
or a second laptop, would double alerts and traffic). Develop on a separate free Neon project (a branch of the same
project shares its compute-hours).

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `KITE_API_KEY`, `KITE_API_SECRET` | yes | Kite Connect app (the secret also encrypts the stored access token) |
| `APP_PASSWORD` | for `npm start` | Login password |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | no | Telegram alerts via our bot [@algohuntbot](https://t.me/algohuntbot). Recipients (several people / groups) are managed in V2 → Settings; `TELEGRAM_CHAT_ID` (comma-separated) is the fallback |
| `RESEND_API_KEY` | no | Email alerts (recipients and sender in V2 → Settings) |
| `DATABASE_URL` | yes | Postgres connection string (Neon) |
| `LIVE_WORKER` | no | `on` (default, `npm start` and `npm run dev`) / `off` — the live worker inside the app; `off` also turns the memory layer off |
| `PENDING_WRITES_FILE` | no | Where records waiting for the database are kept across restarts (default `data/pending-writes.json`, git-ignored) |
| `CRON_SECRET` | Vercel | Protects `/api/cron/tick` (`openssl rand -hex 32`) |

### Deploying (optional)

The app is meant to run on the trader's computer. A hosted copy is possible on Vercel with Postgres (`DATABASE_URL`;
migrations run during `npm run build`) and call `/api/cron/tick` every minute on weekdays,
09:00–00:05 IST, with `Authorization: Bearer <CRON_SECRET>` — Vercel Cron (Pro) or cron-job.org. Details:
[docs/deployment.md](docs/deployment.md).

### Daily use

Kite access tokens expire every morning (~06:00 IST). Each trading day: `npm start` (if it isn't running), then
**Connect Kite** (top bar or Settings → Broker Connection) — the live worker inside the app picks the login up. See the
[trader guide](docs/v2-user-guide.md).

To receive Telegram alerts, open [@algohuntbot](https://t.me/algohuntbot) and press **Start**, then add yourself in
V2 → Settings → Telegram chats (**Find chat IDs**).

## Security notes

- The whole app sits behind `APP_PASSWORD` (HMAC-signed, HttpOnly session cookie, 30 days).
- The Kite access token is stored AES-256-GCM encrypted with a key derived from `KITE_API_SECRET` and is never
  returned by any endpoint. The app only calls Kite's read-only data APIs.
- `/api/cron/tick` requires `CRON_SECRET`.
