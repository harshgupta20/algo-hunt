# REST API reference

All endpoints are served by the same Next.js app under `/api`. The app shell uses them through
[src/client/lib/api.ts](../src/client/lib/api.ts), V2 through [src/client/v2/api.ts](../src/client/v2/api.ts); you
can call them with `curl` too.

> Related: [architecture.md](architecture.md) · [v2-architecture.md](v2-architecture.md) · V2 types in
> [src/shared/v2/types.ts](../src/shared/v2/types.ts)

---

## 1. API architecture

| Piece | File | Notes |
| --- | --- | --- |
| Catch-all route | [src/app/api/[...path]/route.ts](../src/app/api/[...path]/route.ts) | `GET/POST/PUT/DELETE`; `maxDuration = 300` s; `dynamic = 'force-dynamic'` |
| Router + dispatch | [src/server/api/http.ts](../src/server/api/http.ts) | Pattern router (`:param` segments); first registered match wins; JSON body parsing |
| Route table | [src/server/api/routes.ts](../src/server/api/routes.ts) | Single source of truth for paths below |
| Controllers | [src/server/api/controllers/](../src/server/api/controllers) | One factory per area, returning handler functions |
| Validation | [src/server/api/schemas.ts](../src/server/api/schemas.ts) | zod schemas; `parse()` throws a 400 |

Three routes live outside the router: `POST /api/auth/login`, `POST /api/auth/logout`, `GET|POST /api/cron/tick`.

**Handler return values:** plain data → `200` JSON; `created(data)` → `201`; `undefined` → `204` (no body); a
`Response` (redirects) is passed through.

---

## 2. Authentication

| Endpoint group | Auth |
| --- | --- |
| Everything under `/api` | Session cookie `ash_session`, checked by [src/proxy.ts](../src/proxy.ts). Missing/invalid → `401 {"error":"Not authenticated"}` |
| `/api/health`, `/api/auth/login` | Public |
| `/api/cron/*` | `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>` (checked in the route). Allowed without a secret only outside production |

If `APP_PASSWORD` is not set: open in development; every request gets `503` in production.

Get a cookie for `curl`:

```bash
curl -s -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"password":"<APP_PASSWORD>"}' http://localhost:3000/api/auth/login
# → {"ok":true}   (then pass -b cookies.txt on every call)
```

---

## 3. Errors and status codes

Every error body has the same shape:

```json
{ "error": "human-readable message" }
```

| Status | When |
| --- | --- |
| `400` | Invalid JSON body; zod validation (`"productIds: Array must contain at most 500 element(s)"`); V2 validation failures (`{ error, issues: [{ path, message, severity }] }`, e.g. a product lacking a leg the strategy needs) |
| `401` | No valid session cookie (proxy) or wrong password on login; cron call without the right secret |
| `404` | Unknown route, or a resource id that doesn't exist (`"Strategy not found"`, `"Product NSE:XYZ not found — sync products"`) |
| `405` | Route exists but not for this method |
| `409` | Kite is not connected (`KiteNotConnectedError`) — product sync, previews, compare, anything needing live Kite data |
| `503` | Database tables missing (Postgres `42P01`): `"Database tables are missing — run npm run db:migrate…"`; or `APP_PASSWORD` not configured |
| `500` | Anything unexpected (logged as `unhandled request error`) |

---

## 4. Endpoints

Conventions: `:id` = UUID path parameter.

### 4.1 System

| Method | Path | Description | Response |
| --- | --- | --- | --- |
| GET | `/api/health` | Liveness + Kite state (public) | `{"status":"ok","store":"postgres","kite":"connected"}` |
| POST | `/api/auth/login` | Body `{"password": string}`; sets `ash_session` | `{"ok":true}` · 401 · 503 |
| POST | `/api/auth/logout` | Clears the cookie | `{"ok":true}` |
| GET / POST | `/api/cron/tick` | One V2 scanner cycle (steps aside while the live worker streams). `?force=1` runs outside market hours and ignores the 45 s spacing | `{ v2: { status, skipped?, units, alerts, errors } }` |

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/tick
```

### 4.2 V2 — Strategy + Product = Alert

Product-agnostic strategies and product connections ([v2-architecture.md](v2-architecture.md)). Served by
[v2Controller.ts](../src/server/api/controllers/v2Controller.ts); types in [src/shared/v2/types.ts](../src/shared/v2/types.ts).
Validation failures return `400` with `{ error, issues: [{ path, message, severity }] }`.

| Method | Path | Params / body | Response |
| --- | --- | --- | --- |
| GET | `/api/v2/status` | — | Markets (NSE, MCX), Kite, instruments / products, strategies, connections, last scan, channels |
| GET | `/api/v2/live` | — | `{ health: { online, covering, uncovered[], crashed, silentMs }, status: LiveStatus \| null, offlineNotifiedAt }` — the live worker's heartbeat row |
| GET | `/api/v2/products` | `search`, `kind` (`INDEX`\|`STOCK`\|`COMMODITY`), `market`, `ids` (comma-separated), `needs` (leg kinds a strategy uses, e.g. `FUT,CE,PE` — only products offering all of them), `limit` (max 5000) | `V2Product[]` (legs available, expiries, strike gap, lot) |
| GET | `/api/v2/products/counts` | `search`, `market`, `needs` | `{ INDEX, STOCK, COMMODITY, total }` — products per type matching the filters (filter-button counts) |
| GET | `/api/v2/products/:id` | — | `V2Product` |
| POST | `/api/v2/products/sync` | — | `{ instruments, products, syncedAt }` (NSE, BSE, NFO, BFO, MCX; needs Kite) |
| GET / POST | `/api/v2/strategies` | POST `{ definition }` (1–4 legs) | list with connection counts · `201` strategy |
| POST | `/api/v2/strategies/validate` | `{ definition }` | `{ issues, valid, summary }` |
| GET / PUT / DELETE | `/api/v2/strategies/:id` | PUT `{ definition }` → new version | strategy · `204` |
| POST | `/api/v2/strategies/:id/duplicate` · GET `/versions` | — | copy · versions |
| POST | `/api/v2/strategies/:id/connections/enable` · `/disable` | — | Switch every connection of the strategy on / off at once: `{ changed, unchanged, failed: [{ connectionId, productId, message }] }` — switching on checks each like a single switch-on; failures stay off |
| GET / POST | `/api/v2/connections` | GET `?strategyId=` · POST `{ strategyId, productIds[] (1–500), config }` | rows with product + strategy name · `201` one connection per product (switched off); `400` if any product is already connected or can’t run the strategy |
| POST | `/api/v2/connections/validate` · `/preview` | `{ strategyId \| definition, productId, config }` | issues · contracts per leg now (units, ATM reference, quotes) |
| POST | `/api/v2/connections/explain` | `{ definition, productId, config? }` | Explain an unsaved strategy on a product now |
| PUT / DELETE | `/api/v2/connections/:id` | PUT `{ config }` | connection · `204` |
| POST | `/api/v2/connections/:id/enable` · `/disable` · `/explain` | — | connection · explain result |
| GET | `/api/v2/connections/:id/units` | — | `UnitState[]` |
| POST | `/api/v2/compare` | `{ strategyId \| definition, products[] (≤ 20), from, to, expiry?, strikeShift?, trigger?, cooldownMinutes? }` | Per product: alerts (with trace), candles, decided (coverage), contracts, notes — sorted by alerts |
| POST | `/api/v2/backtest` | `{ strategyId, products[] (1–20), from, to (IST dates), plan: PaperPlan (cash per trade, rules, exits, costs), capital (≥ 1000 \| null = no limit), expiry?, strikeShift?, trigger?, cooldownMinutes? }` | `BacktestResult { capital, finalCapital, returnOnCapitalPct, lowestCapital, summary: PaperSummary, products: [{ productId, symbol, alerts, trades, skipped, stats, spark, contracts, notes, errors }], trades: PaperTrade[], skipped: [{ productId, at, reason }], requests, notes }` — nothing saved; the period is limited per trigger timeframe as in Compare |
| GET | `/api/v2/alerts/feed` | `after` (ISO time, optional), `limit` (≤ 100) | Alerts recorded after `after`, newest first, as `{ id, strategyName, productId, unit, createdAt }` — what the app's alarm polls every 5 s (empty when nothing is new) |
| GET | `/api/v2/alerts/:id` | — | One alert in full, with its condition trace (lists leave the trace out) |
| GET | `/api/v2/alerts` · POST `/alerts/:id/acknowledge` · GET `/signals` | Filters (all optional; lists comma-separated): `strategyId`, `connectionId`, `kinds` (`INDEX,STOCK,COMMODITY`), `markets` (`NSE,MCX`), `search` (symbol contains), `timeframes` (trigger), `from` / `to` (IST dates, inclusive), `groups` (ids of the top-level groups that fired), `limit` (≤ 1000). Alerts also: `active=1`, `statuses` (`SENT,PARTIAL,FAILED,ACKNOWLEDGED`), `sources` (`LIVE_VERIFIED,HISTORICAL,LIVE,LIVE_UNVERIFIED`); signals: `outcomes` | alerts / signals, newest first — without the condition trace (alerts also without the duplicate `evaluation.unit`) |
| POST | `/api/v2/scan` · GET `/scan-runs` | `{ force? }` · `limit` | `{ run, skipped? }` · runs |
| GET / PUT | `/api/v2/settings` · `/calendar` | settings `{ telegramChats: [{ id, name? }] (≤ 20), emailRecipients, emailFrom, requestBudget }` · `{ entries: [{ market, date, kind, … }] }` | saved values |
| GET / PUT | `/api/v2/paper/plans/:strategyId` | PUT a `PaperPlan` `{ enabled, cashPerTrade (≥ 100), rules: [{ group, leg, side }], targetPct, stopPct, squareOff, squareOffNse, squareOffMcx, exitOnOpposite, charges, slippagePct }` | The strategy's paper plan — the defaults its connections use (GET: the preferred defaults, **switched on**, when none is saved; rules matched to its current groups) |
| GET | `/api/v2/paper/settings` | — | `{ plans: { [strategyId]: PaperPlan }, overrides: { [connectionId]: PaperOverride } }` — every strategy's plan and every connection's own values |
| PUT / DELETE | `/api/v2/paper/connections/:id` | PUT `{ override: { enabled?, cashPerTrade?, targetPct?, stopPct?, squareOff?, squareOffNse?, squareOffMcx?, exitOnOpposite?, charges?, slippagePct? } }` (`null` target / stop = none; `{}` or DELETE = follow the strategy) | `{ override }` — a connection's own values over its strategy's plan |
| GET | `/api/v2/paper/summary` | The alert filters (`strategyId`, `connectionId`, `kinds`, `markets`, `search`, `timeframes`, `from` / `to` = trades entered in those IST days, `groups`) plus `sides` (`BUY,SELL`) | `PaperSummary { from, overall, strategies[], connections[], equity[], daily[], reasons[], hours[] }` — stats: trades, open, wins, losses, winRate, gross / charges / net P&L, unrealizedPnl, avg / best / worst, avgWin / avgLoss, profitFactor, todayPnl, capitalPeak (money needed), returnPct, maxDrawdown, overBudget; connections (switched on or with trades) carry their effective paper settings (`paper`, `custom`) and a `spark` of cumulative P&L |
| GET | `/api/v2/paper/trades` | `status` (`OPEN`\|`CLOSED`), the same filters as the summary, `limit` (≤ 5000) | `PaperTrade[]` newest first (open trades carry `openPnl`) |
| POST | `/api/v2/paper/trades/:id/close` | — | Close an open paper trade at the latest price (`404` if already closed) |
| DELETE | `/api/v2/paper/strategies/:id/trades` | — | `{ deleted }` — every paper trade of the strategy (the plan stays) |
| GET | `/api/v2/channels` · POST `/channels/test` | `{ channel }` | status · `{ ok }` |
| GET | `/api/v2/channels/telegram/bot` | — | The bot people should open and press Start on: `{ username, name, verified }` (Telegram `getMe` on the token; else the default @algohuntbot, `verified: false`) |
| GET | `/api/v2/channels/telegram/chats` | — | Chats that recently messaged the bot (Telegram `getUpdates`): `[{ id, name, type, username? }]` — for picking chat ids. `POST /channels/test` returns `{ ok, results: [{ target, ok, error? }] }` (one per Telegram chat) |

`/api/cron/tick` runs the V2 scan and returns `v2: { status, skipped?, units, alerts, errors }`.

### 4.3 Kite Connect

| Method | Path | Description | Response |
| --- | --- | --- | --- |
| GET | `/api/kite/status` | Session state for the UI | `KiteAuthStatus { enabled, state: disabled\|needs-login\|connecting\|connected\|error, needsLogin, lastError?, userId?, userName?, loginTime?, expiresAt? }` |
| GET | `/api/kite/login` | Redirect to the Kite login page | `302` |
| GET | `/api/kite/login-url` | Login URL as JSON | `{ url }` |
| GET | `/api/kite/callback` | Alternative OAuth redirect target (`?request_token=&status=`) | `302` to `/settings?kite=connected` or `?kite=error&message=…` |
| POST | `/api/kite/session` | `{ token }` — a raw `request_token` **or** the full redirected URL | `{ ok: true }` · 400 |
| POST | `/api/kite/logout` | Revoke at Zerodha + delete the stored session | `{ ok: true }` |



### 4.4 Preferences

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/preferences` | — | `{ theme: 'light'\|'dark', soundEnabled, browserNotifications }` |
| PUT | `/api/preferences` | Full object (all three fields) | Saved object |
