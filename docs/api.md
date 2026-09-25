# REST API reference

All endpoints are served by the same Next.js app under `/api`. The UI uses them through
[src/client/lib/api.ts](../src/client/lib/api.ts); you can call them with `curl` too.

> Related: [architecture.md § 3](architecture.md#3-request--response-flow-rest-api) · [domain.md](domain.md) for the
> meaning of each field · types in [src/shared/types/](../src/shared/types)

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
| `400` | Invalid JSON body; zod validation (`"underlying: Required; timeframe: Invalid enum value…"`); business rule violations (e.g. `"This strategy only runs on NIFTY, BANKNIFTY — not FINNIFTY."`, `"Near month is an MCX expiry — NIFTY trades on NSE/BSE…"`, activation failures) |
| `401` | No valid session cookie (proxy) or wrong password on login; cron call without the right secret |
| `404` | Unknown route, or a resource id that doesn't exist (`"Configuration not found"`, `"Strategy not found"`) |
| `405` | Route exists but not for this method |
| `409` | Kite is not connected (`KiteNotConnectedError`) — activation, backtests, anything needing live Kite data |
| `503` | Database tables missing (Postgres `42P01`): `"Database tables are missing — run npm run db:migrate…"`; or `APP_PASSWORD` not configured |
| `500` | Anything unexpected (logged as `unhandled request error`) |

---

## 4. Endpoints

Conventions: `:id` = UUID path parameter. Types refer to [src/shared/types/](../src/shared/types).

### 4.1 System

| Method | Path | Description | Response |
| --- | --- | --- | --- |
| GET | `/api/health` | Liveness + Kite state (public) | `{"status":"ok","store":"postgres","kite":"connected"}` |
| POST | `/api/auth/login` | Body `{"password": string}`; sets `ash_session` | `{"ok":true}` · 401 · 503 |
| POST | `/api/auth/logout` | Clears the cookie | `{"ok":true}` |
| GET / POST | `/api/cron/tick` | One live-evaluation pass. `?force=1` runs outside market hours and ignores the 45 s spacing | `TickResult` (below) |

`TickResult`: `{ ran: boolean, reason?: 'kite-not-connected'|'market-closed'|'busy'|'no-monitors', at: ISO,
instrumentsSynced?: boolean, monitors?: MonitorRunResult[], alerts?: number }`, where `MonitorRunResult` =
`{ configId, underlying, evaluatedCandles, alerts, skippedStale, error? }`.

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/tick
```

### 4.2 Live status

| Method | Path | Description | Response |
| --- | --- | --- | --- |
| GET | `/api/live/status` | Evaluator health per market | `LiveStatus` |
| POST | `/api/live/tick` | Dashboard-driven evaluation (same lease as cron) | `{ ran, reason?, at, alerts }` |

`LiveStatus` example (NSE closed, MCX open):

```json
{
  "kiteConnected": true,
  "marketOpen": false,
  "sessions": {
    "NSE": { "open": false, "opensAt": "2026-09-25T03:45:00.000Z", "closesAt": "2026-09-25T10:00:00.000Z" },
    "MCX": { "open": true,  "opensAt": "2026-09-25T03:30:00.000Z", "closesAt": "2026-09-25T18:00:00.000Z" }
  },
  "activeMonitors": 3,
  "activeBySegment": { "NSE": 1, "MCX": 2 },
  "lastRunAt": "2026-09-25T14:40:02.000Z",
  "lastRunSummary": { "monitors": 2, "alerts": 0, "errors": 0 },
  "channels": ["telegram"]
}
```

### 4.3 Monitors (configurations)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/configs` | — | `AlertConfiguration[]` (newest first; both markets) |
| POST | `/api/configs` | `configInputSchema` (below) | `201 AlertConfiguration` |
| GET | `/api/configs/snapshots` | — | `ConfigRuntimeSnapshot[]` for active monitors (gauges, locked contracts, last error) |
| GET | `/api/configs/:id` | — | `AlertConfiguration` · 404 |
| PUT | `/api/configs/:id` | Partial `configInputSchema` | Updated config. If active, it is **re-activated** (needs Kite → 409) |
| DELETE | `/api/configs/:id` | — | `204` (monitor state and alerts cascade) |
| POST | `/api/configs/:id/activate` | — | Config with `active: true` · 409 (Kite) · 400 (resolution failed, e.g. option legs on a futures-only product) |
| POST | `/api/configs/:id/deactivate` | — | Config with `active: false` |

`configInputSchema` (comments for explanation only):

```jsonc
{
  "underlying": "CRUDEOIL",
  "expiryType": "near-month",          // current-weekly | next-weekly | monthly | near-month | next-month | far-month
  "strikeSelection": "ATM",            // ATM | ATM+1 | ATM-1 | ATM+2 | ATM-2 | CUSTOM
  "customStrike": 5450,                // only with CUSTOM
  "timeframe": "15m",                  // 1m 3m 5m 10m 15m 30m 1h 1d 1w
  "strategy": "rsi-sync",              // or a custom strategy UUID
  "params": { "rsiPeriod": 14, "futureLevel": 60, "callLevel": 60, "putLevel": 40 }   // optional, partial
}
```

The server applies the strategy's fixed market fields, rejects underlyings the strategy doesn't cover, rejects MCX
month expiries on NSE underlyings, and rejects disabled strategies.

### 4.4 Group monitors

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/config-groups` | `{ members: string[], groupName?, expiryType, strikeSelection, customStrike?, timeframe, strategy, params? }` | `201 { groupId, groupName, configs: AlertConfiguration[] }` (every member validated first) |
| POST | `/api/config-groups/:groupId/activate` | — | `{ activated, total, errors: string[] }` (needs Kite) |
| POST | `/api/config-groups/:groupId/deactivate` | — | `{ deactivated }` |
| DELETE | `/api/config-groups/:groupId` | — | `204` |

### 4.5 Underlying groups

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/groups` | — | `UnderlyingGroup[]` (includes the read-only preset `group-indices`) |
| POST | `/api/groups` | `{ name: string, members: string[] }` | `201 UnderlyingGroup` |
| GET | `/api/groups/:id` | — | `UnderlyingGroup` · 404 |
| PUT | `/api/groups/:id` | Partial body | Updated group · 404 ("not found or not editable" for the preset) |
| DELETE | `/api/groups/:id` | — | `204` |

### 4.6 Alerts and analytics

| Method | Path | Query | Response |
| --- | --- | --- | --- |
| GET | `/api/alerts` | `from`, `to` (ISO), `underlying`, `expiry`, `timeframe`, `scenario` (1\|2), `strategyId`, `strategy` (`rsi-sync` or id), `groupId`, `configId`, `segment` (`NSE`\|`MCX`), `limit` (default 100, max 1000), `offset` | `Alert[]`, newest first |
| GET | `/api/alerts/:id` | — | `Alert` · 404 |
| GET | `/api/analytics/summary` | `segment` (optional) | `AnalyticsSummary` over the latest 5000 alerts |

```bash
curl -s -b cookies.txt 'http://localhost:3000/api/alerts?segment=MCX&limit=5'
```

### 4.7 Instruments and MCX catalog

| Method | Path | Query | Response |
| --- | --- | --- | --- |
| GET | `/api/instruments/meta` | `segment=MCX` (optional) | `{ timeframes, strikeSelections, expiryTypes }` (expiry choices per market) |
| GET | `/api/instruments/underlyings` | `segment=MCX` (optional) | `UnderlyingDef[]` present in the synced master |
| GET | `/api/instruments/:underlying/expiries` | — | `[{ type, date, label }]` · 404 when none |
| GET | `/api/instruments/:underlying/strikes` | `expiry=yyyy-mm-dd` (required) | `number[]` ascending · 400 without `expiry` |
| GET | `/api/mcx/products` | — | `McxProductInfo[]`: `{ symbol, name, group, optionsLiquid, available, hasOptions, futures[{tradingSymbol, expiry, lotSize}], optionExpiries[], strikeInterval?, strikeCount? }` |

Example (`/api/instruments/CRUDEOIL/expiries`):

```json
[
  { "type": "near-month", "date": "2026-10-15", "label": "Near Month (2026-10-15)" },
  { "type": "next-month", "date": "2026-11-17", "label": "Next Month (2026-11-17)" }
]
```

### 4.8 Strategies

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/strategies` | — | Built-in strategy definitions (`StrategyDefinition[]`) |
| GET | `/api/strategies/:key` | — | One built-in definition (`rsi-sync`) · 404 |
| GET | `/api/builder/catalog` | — | `BuilderCatalog` (indicators, operators, instruments, timeframes, candle types) that drives the builder UI |
| GET | `/api/builder/template` | — | The built-in strategy as builder JSON |
| GET | `/api/custom-strategies` | — | `StrategyDef[]` |
| POST | `/api/custom-strategies` | `strategyDefInputSchema` | `201 StrategyDef` (version 1; `market` validated) |
| GET | `/api/custom-strategies/:id` | — | `StrategyDef` · 404 |
| PUT | `/api/custom-strategies/:id` | Partial input | Updated def (version +1, new version row) |
| DELETE | `/api/custom-strategies/:id` | — | `204` |
| POST | `/api/custom-strategies/:id/duplicate` | — | `201` copy named "… (copy)", status `draft` |
| POST | `/api/custom-strategies/:id/publish` | — | Status `active` |
| POST | `/api/custom-strategies/:id/disable` | — | Status `disabled` |
| GET | `/api/custom-strategies/:id/versions` | — | `StrategyVersion[]` |
| GET | `/api/custom-strategies/:id/stats` | — | `StrategyStats` from that strategy's live alerts |

`strategyDefInputSchema` (abridged example):

```json
{
  "name": "Daily trend + 15m RSI",
  "category": "Momentum",
  "status": "active",
  "market": { "timeframe": "15m" },
  "root": {
    "type": "group", "id": "r", "logic": "AND",
    "children": [
      { "type": "condition", "id": "a", "instrument": "future",
        "indicator": { "kind": "RSI", "params": { "period": 14 } }, "operator": "crossAbove", "value": 60 },
      { "type": "condition", "id": "b", "instrument": "future", "timeframe": "1d",
        "indicator": { "kind": "RSI", "params": { "period": 14 } }, "operator": "gt", "value": 50 },
      { "type": "condition", "id": "c", "instrument": "future", "candle": "heikinAshi",
        "indicator": { "kind": "PATTERN", "field": "bullishEngulfing" }, "operator": "detected" }
    ]
  }
}
```

Market rules on create/update: at most 50 underlyings; no NSE+MCX mix; MCX month expiries need MCX underlyings;
`strikeSelection` can't be fixed to `CUSTOM`.

### 4.9 Backtesting

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/analyzer/run` | `{ strategy, preset, from?, to?, underlying?, underlyings?, groupName?, expiryType?, strikeSelection?, customStrike?, timeframe?, params? }` | `BacktestResult { meta, alerts, stats }` |
| POST | `/api/analyzer/chart` | `{ params: <same as run>, center: epochMs, span?: number }` | `ChartWindow { candles, futureRsi, callRsi, putRsi, markers, levels }` |

`preset`: `today | yesterday | last-week | last-month | last-3-months | last-6-months | last-year | custom`
(`custom` needs `from` and `to`). Fields the strategy fixes may be omitted. Missing open fields → 400
(`"Choose underlying, timeframe — "X" leaves them open."`). Kite not connected → 409.

```bash
curl -s -b cookies.txt -H 'Content-Type: application/json' -X POST http://localhost:3000/api/analyzer/run \
  -d '{"strategy":"rsi-sync","preset":"last-week","underlying":"NIFTY","expiryType":"current-weekly","strikeSelection":"ATM","timeframe":"15m"}'
```

### 4.10 Kite Connect

| Method | Path | Description | Response |
| --- | --- | --- | --- |
| GET | `/api/kite/status` | Session state for the UI | `KiteAuthStatus { enabled, state: disabled\|needs-login\|connecting\|connected\|error, needsLogin, lastError?, userId?, userName?, loginTime?, expiresAt? }` |
| GET | `/api/kite/login` | Redirect to the Kite login page | `302` |
| GET | `/api/kite/login-url` | Login URL as JSON | `{ url }` |
| GET | `/api/kite/callback` | Alternative OAuth redirect target (`?request_token=&status=`) | `302` to `/settings?kite=connected` or `?kite=error&message=…` |
| POST | `/api/kite/session` | `{ token }` — a raw `request_token` **or** the full redirected URL | `{ ok: true }` · 400 |
| POST | `/api/kite/logout` | Revoke at Zerodha + delete the stored session | `{ ok: true }` |
| GET | `/api/kite/instruments` | Instrument master status | `{ count, syncedAt?, segments: { NSE: {count, syncedAt?}, MCX: {count, syncedAt?} } }` |
| POST | `/api/kite/instruments/sync` | Re-download both markets now | `{ count, syncedAt }` |

### 4.11 Preferences

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/preferences` | — | `{ theme: 'light'\|'dark', soundEnabled, browserNotifications }` |
| PUT | `/api/preferences` | Full object (all three fields) | Saved object |

### 4.12 MCX V2 (beta)

The independent MCX alerting subsystem ([mcx-v2-architecture.md](mcx-v2-architecture.md)). Served by
[mcxV2Controller.ts](../src/server/api/controllers/mcxV2Controller.ts); types in
[src/shared/mcx/types.ts](../src/shared/mcx/types.ts). Validation failures return `400` with
`{ error, issues: [{ path, message, severity }] }`.

| Method | Path | Params / body | Response |
| --- | --- | --- | --- |
| GET | `/api/mcx/v2/status` | — | `{ now, market: { open, today, sessionStart, sessionEnd }, kiteConnected, instruments: { count, syncedAt }, strategies: { total, enabled }, lastRun, channels }` |
| GET | `/api/mcx/v2/products` | — | Products with `futures[]` and `optionExpiries[{ expiry, strikes }]` from `mcx_instruments` |
| GET | `/api/mcx/v2/instruments` | `underlying`, `expiry`, `type` (`MCX_FUTURE`\|`CE`\|`PE`), `search`, `limit` (≤ 2000) | `{ total, items: McxInstrument[] }` |
| POST | `/api/mcx/v2/instruments/sync` | — | `{ count, syncedAt }` (needs Kite) |
| POST | `/api/mcx/v2/universe/preview` | `{ universe }` | Resolution (`units`, `references` with LTP, `expiries`, `errors`, `notes`) + `cap` + `quotes` |
| POST | `/api/mcx/v2/validate` | `{ definition, forEnable?, resolve? }` | `{ issues, valid, summary, resolvedTargets? }` |
| GET | `/api/mcx/v2/strategies` | — | `McxStrategy[]` |
| POST | `/api/mcx/v2/strategies` | `{ definition }` | `201` `McxStrategy` (disabled, v1) |
| GET / PUT / DELETE | `/api/mcx/v2/strategies/:id` | PUT `{ definition }` → new version, unit states reset | `McxStrategy` · `204` |
| POST | `/api/mcx/v2/strategies/:id/duplicate` | — | `201` copy (disabled) |
| POST | `/api/mcx/v2/strategies/:id/enable` · `/disable` | — | `McxStrategy`; enable validates first (channels configured, universe within the cap) |
| GET | `/api/mcx/v2/strategies/:id/versions` | — | `McxStrategyVersion[]`, newest first |
| GET | `/api/mcx/v2/strategies/:id/units` | — | `UnitState[]` with each unit's latest evaluation |
| POST | `/api/mcx/v2/strategies/:id/explain` | `{ targetId? }` | Explain result (per contract: evaluation trace, previous result, what the policy would do). Nothing saved |
| POST | `/api/mcx/v2/explain` | `{ definition, targetId? }` | Same for an unsaved draft |
| POST | `/api/mcx/v2/replay` | `{ strategyId? \| definition?, from, to, targetIds? (≤ 10) }` | Per contract, one row per trigger candle (result, outcome, failing conditions, trace on signals). Span limited per timeframe (e.g. 15 days of 15m) |
| GET | `/api/mcx/v2/alerts` | `active=1`, `strategyId`, `limit` | `McxAlert[]` with deliveries |
| GET | `/api/mcx/v2/alerts/:id` | — | `McxAlert` |
| POST | `/api/mcx/v2/alerts/:id/acknowledge` | — | `McxAlert`; the unit goes quiet until the strategy turns false |
| GET | `/api/mcx/v2/signals` | `strategyId`, `limit` (≤ 500) | `McxSignal[]` including suppressed ones |
| POST | `/api/mcx/v2/scan` | `{ force? }` | `{ run: McxScanRun, skipped? }` — same lease as the cron job |
| GET | `/api/mcx/v2/scan-runs` · `/scan-runs/:id` | `limit` | `McxScanRun[]` / one run |
| GET / PUT | `/api/mcx/v2/settings` | `{ telegramChatId?, emailRecipients, emailFrom, universeCap, requestBudget }` | `McxSettings` |
| GET / PUT | `/api/mcx/v2/calendar` | `{ entries: [{ date, kind: 'HOLIDAY'\|'SPECIAL_SESSION', openMin?, closeMin?, note? }] }` | `CalendarEntry[]` |
| GET | `/api/mcx/v2/channels` | — | `{ telegram: { configured, detail }, email: { configured, detail } }` |
| POST | `/api/mcx/v2/channels/test` | `{ channel: 'telegram'\|'email' }` | `{ ok: true }` · 400 with the reason |

The cron route `/api/cron/tick` also runs the MCX V2 scan after the V1 evaluation (its own lease and error
handling) and adds `mcxV2: { status, skipped?, units, alerts, errors }` to its response.

