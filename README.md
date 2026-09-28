# Algo Hunt — Strategy + Product = Alert

A personal trading **alert** platform for Indian markets (it never places orders). Build a strategy once — 1–4 legs
(Spot, Future, Call, Put) and conditions between them — then connect it to any **NSE index, NSE stock or MCX
commodity** and get alerts on Telegram, email and the desktop when it fires. Compare shows which products a strategy
suits, and **paper trading** (on for every connection, ₹10,000 per trade by default, adjustable per strategy or
connection) turns every alert into a simulated trade so the Paper tab shows what each connection would have made.
**Backtest** answers the same question for the past: a strategy on the products you pick, with your capital, over past
candles. Everything runs on real Zerodha Kite data.

Built with **Next.js 16** (App Router), **Zerodha Kite Connect** and a local **SQLite** database built into Node.js
(Postgres, e.g. Neon, optional).

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

Needs only **Node.js 24 LTS** (or 22.13+) and git — no database server, nothing else to install. The data lives in
one local file, `data/algo-hunt.db` (SQLite, built into Node.js), created and updated by the app itself; a snapshot
is saved to `backups/` once a day (the newest 14 are kept). Both folders are git-ignored, so `git pull` never touches
data.

```bash
git clone <repo> algo-hunt && cd algo-hunt
cp .env.example .env.local     # Kite keys, APP_PASSWORD, Telegram — leave DATABASE_URL unset for the local database
npm run setup                  # install + build (once, and after each update)
npm start                      # http://localhost:3000 — the app, the live worker and the database in one process
```

Later, to update: stop the app (Ctrl+C), `npm run update` (git pull + install + build), then `npm start` again.

For Kite login, add `http://localhost:3000/zerodhaRedirection` as the Redirect URL in your Kite Connect app.
`npm start` needs `APP_PASSWORD` (the login password); `npm run dev` is open without it.

| Command | Description |
| --- | --- |
| `npm run setup` | Install and build |
| `npm start` | Serve the build: UI, API, **live worker** (streams Kite, alerts seconds after each candle close) and daily backups — one process. `LIVE_WORKER=off` to run the worker separately |
| `npm run update` | `git pull` + install + build (then `npm start`) |
| `npm run backup` | Save a snapshot of the local database now (`-- --list` lists them) — safe while the app runs |
| `npm run restore -- <file>` | Put a snapshot back (stop the app first; the current data is saved as a `before-restore` snapshot) |
| `npm run db:import -- "<postgres url>"` | One-time copy of all your data from Postgres (e.g. Neon) into the local database |
| `npm run dev` | Development server (no in-app live worker — run `npm run live` alongside) |
| `npm run live` | Live worker as its own process (`-- --check` tests the Kite stream) |
| `npm test` / `npm run typecheck` | vitest suite / TypeScript check |

To keep copies off the laptop, point `BACKUP_DIR` at a cloud-synced folder (Google Drive, OneDrive). To move to
another computer, copy a snapshot there and `npm run restore -- <file>`. Run the app on one computer at a time —
the data is a local file.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `KITE_API_KEY`, `KITE_API_SECRET` | yes | Kite Connect app (the secret also encrypts the stored access token) |
| `APP_PASSWORD` | for `npm start` | Login password |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | no | Telegram alerts via our bot [@algohuntbot](https://t.me/algohuntbot). Recipients (several people / groups) are managed in V2 → Settings; `TELEGRAM_CHAT_ID` (comma-separated) is the fallback |
| `RESEND_API_KEY` | no | Email alerts (recipients and sender in V2 → Settings) |
| `DATABASE_FILE`, `BACKUP_DIR` | no | Where the local database / its snapshots live (default `data/algo-hunt.db`, `backups/`) |
| `LIVE_WORKER` | no | `on` / `off` — the live worker inside the app (default: on with `npm start`, off with `npm run dev`) |
| `DATABASE_URL` | no | Use **Postgres** instead of the local file (e.g. Neon, the Vercel copy) |
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
