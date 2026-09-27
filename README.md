# Algo Hunt — Strategy + Product = Alert

A personal trading **alert** platform for Indian markets (it never places orders). Build a strategy once — 1–4 legs
(Spot, Future, Call, Put) and conditions between them — then connect it to any **NSE index, NSE stock or MCX
commodity** and get alerts on Telegram, email and the desktop when it fires. Compare shows which products a strategy
suits. Everything runs on real Zerodha Kite data.

Built with **Next.js 16** (App Router), **Neon Postgres** and **Zerodha Kite Connect**.

> 📚 Documentation lives in [docs/](docs/README.md) — the trader guide ([v2-user-guide.md](docs/v2-user-guide.md)),
> architecture, setup, API, database, testing, deployment, troubleshooting and the current
> [status](docs/status.md).

---

## How alerts are produced

- **Live worker (recommended):** `npm run live` on your computer streams Kite ticks for every contract your
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

## Setup

```bash
cp .env.example .env.local     # DATABASE_URL + Kite credentials (APP_PASSWORD optional locally)
npm install
npm run dev                    # http://localhost:3000 — applies pending migrations first, opens V2
```

For local Kite login, add `http://localhost:3000/zerodhaRedirection` as the Redirect URL in your Kite Connect app.
With `APP_PASSWORD` unset the app is open in development (production refuses to serve without it).

| Command | Description |
| --- | --- |
| `npm run dev` | Apply pending migrations, then start the Next.js dev server |
| `npm run live` | Live worker: streams Kite ticks and alerts seconds after each candle close (`-- --check` tests the stream) |
| `npm run build` / `npm start` | Migrate + production build / serve |
| `npm test` | vitest suite |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Apply pending migrations |

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled connection string |
| `KITE_API_KEY`, `KITE_API_SECRET` | yes | Kite Connect app (the secret also encrypts the stored access token) |
| `APP_PASSWORD` | production | Login password |
| `CRON_SECRET` | production | Protects `/api/cron/tick` (`openssl rand -hex 32`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | no | Telegram alerts via our bot [@algohuntbot](https://t.me/algohuntbot). Recipients (several people / groups) are managed in V2 → Settings; `TELEGRAM_CHAT_ID` (comma-separated) is the fallback |
| `RESEND_API_KEY` | no | Email alerts (recipients and sender in V2 → Settings) |

### Deploying

Deploy to Vercel (migrations run during `npm run build`) and call `/api/cron/tick` every minute on weekdays,
09:00–00:05 IST, with `Authorization: Bearer <CRON_SECRET>` — Vercel Cron (Pro) or cron-job.org. Details:
[docs/deployment.md](docs/deployment.md).

### Daily use

Kite access tokens expire every morning (~06:00 IST). Each trading day: **Connect Kite** (top bar or Settings →
Broker Connection), then start `npm run live` on your computer. See the [trader guide](docs/v2-user-guide.md).

To receive Telegram alerts, open [@algohuntbot](https://t.me/algohuntbot) and press **Start**, then add yourself in
V2 → Settings → Telegram chats (**Find chat IDs**).

## Security notes

- The whole app sits behind `APP_PASSWORD` (HMAC-signed, HttpOnly session cookie, 30 days).
- The Kite access token is stored AES-256-GCM encrypted with a key derived from `KITE_API_SECRET` and is never
  returned by any endpoint. The app only calls Kite's read-only data APIs.
- `/api/cron/tick` requires `CRON_SECRET`.
