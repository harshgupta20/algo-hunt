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

## 2. Kite connection

| Symptom / message | Cause | Fix |
| --- | --- | --- |
| Top bar "Kite offline", **Connect Kite** button | No session, or the daily token expired (~06:00 IST) | Click **Connect Kite** |
| `Kite rejected the session: … Please log in again.` | Kite returned `TokenException` mid-day (token revoked or expired) | Log in again. The app flips to *needs login* automatically |
| Login lands on Settings with `kite=error&message=Login was cancelled` / `Missing request_token` | Cancelled login or wrong redirect | Check the Kite app's Redirect URL (`/zerodhaRedirection`) and retry |
| `Provide the request_token (or paste the full redirected URL).` | Empty body to `POST /api/kite/session` | Send `{"token": "<request_token or URL>"}` |
| `Kite did not return an access token` / other login error text | Kite rejected the exchange (bad secret, reused token) | Verify `KITE_API_SECRET`; request_tokens are single-use, so log in again |
| `409` on activate / backtest | Kite not connected | Connect Kite first |
| Backtests are slow | Kite historical rate limit (~3 req/s); long ranges are split into windows and fetched one after another | Use shorter ranges or a larger timeframe |

## 3. Instruments and contracts

| Symptom / message | Cause | Fix |
| --- | --- | --- |
| Empty underlying/product lists; MCX catalog shows **not synced** | Instrument master missing for that market | **Settings → Refresh** (needs Kite) |
| `Kite returned no MCX F&O instruments for the supported underlyings` (in logs) | The MCX download contained no matching product names | Check `MCX_PRODUCTS` symbols against Kite's `name` column (see [status.md](status.md)) |
| `Instrument sync failed — NSE: …; MCX: …` | Both markets failed to sync | Check the Kite connection; retry |
| `No upcoming <expiry> expiry for <UNDERLYING>. Is Kite connected and the instrument master synced?` | No contract for that expiry choice (e.g. Far Month on a product listing only two months) | Pick another expiry, or refresh instruments |
| `Could not resolve triplet for <U> <expiry> @ <strike> (future=… call=… put=…)` | The computed strike isn't listed for that expiry (NSE) | Choose another strike or expiry, or use CUSTOM |
| `No listed strikes for <U> <expiry>` | MCX product with options but none listed for that expiry | Choose another month |
| `Near month is an MCX expiry — NIFTY trades on NSE/BSE. Choose a weekly or monthly expiry.` | MCX expiry on an NSE underlying | Use NSE expiries on NSE underlyings |

## 4. Monitors

| Symptom / message (monitor card / error badge) | Cause | Fix |
| --- | --- | --- |
| `Strategy "<name>" is disabled — publish it to resume this monitor.` | The strategy was disabled | Publish it again in the Library |
| `This strategy only runs on <list> — not <U>. Delete this monitor, or add <U> to "<name>".` | The strategy's fixed underlyings changed | Edit the strategy or delete the monitor |
| `RSI Multi Confirmation needs the ATM Call and Put, but <U> has no listed options…` | Built-in strategy on a futures-only MCX product | Use a strategy that reads only the Future |
| `"<name>" reads the call/put leg, but <U> has no listed options…` | Custom strategy with option legs on a futures-only product | Same as above |
| Top bar shows **scheduler idle** for a market | No evaluation in the last 3 minutes while that market is open with active monitors | Check the cron job (window must include MCX evenings, see [deployment.md § 5](deployment.md#5-scheduler-every-minute)); keep a dashboard open as a fallback |
| MCX monitors never alert in the evening | Scheduler window stops at NSE close | Extend the cron window to 09:00–00:05 IST |
| An alert you expected is missing after downtime | Candles that closed more than 30 minutes before evaluation are skipped on purpose (`skippedStale`) | Expected behaviour |
| A Daily/Weekly monitor only fires once a day/week | Daily candles close at the session close; weekly candles at Friday's close | Expected behaviour |
| Daily/Weekly conditions on Call/Put never become true | Option contracts only have a few weeks of history, so long indicators don't warm up | Read Daily/Weekly indicators on the Future (continuous data) |

## 5. Strategy builder

| Symptom | Cause | Fix |
| --- | --- | --- |
| Warning "… is a price, but 60 looks like an oscillator level" | Price-type indicator (Bollinger band, EMA, Price…) on the Future compared with a small number | Compare to an indicator (e.g. Close vs Bollinger Upper), type a real price, or use Bollinger %B / Bandwidth |
| Warning "… are on different scales" | Comparing indicators with different units (e.g. RSI vs EMA) | Compare like with like |
| "Bollinger upper crosses above Close" doesn't fire on breakouts | With the band on the left, *Cross Above* means the band rose above price (price fell back) | Use *Cross Below* there, or put Price (Close) on the left and compare to Bollinger Upper |
| `Choose underlying, timeframe — "<name>" leaves them open.` (backtest) | Universal strategy run without its open fields | Fill the fields shown under the strategy |

## 6. Tests and build

| Symptom | Cause | Fix |
| --- | --- | --- |
| stderr shows `{"level":"error",…"monitor evaluation failed"…}` during `npm test` | Tests that deliberately make a monitor fail | Expected |
| `npm run build` skips migrations | `DATABASE_URL` not set in the build environment (`--if-configured`) | Set it in Vercel project env vars |
