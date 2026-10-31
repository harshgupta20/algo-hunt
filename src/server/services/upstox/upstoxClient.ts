/**
 * Upstox REST client for the V2 Options backtest: the token exchange, logout, and the market-data calls it
 * replays — expired option / futures contracts and their candles, and historical candles of indices, stocks
 * and live contracts. Read-only: nothing here places orders.
 *
 *   rate      Upstox allows 50 requests a second, 500 a minute and 2,000 per 30 minutes per user; one gate per
 *             process keeps every call under 20 / 450 / 1,900 (it waits rather than getting refused)
 *   retries   429 and 5xx (and network errors) are retried up to 3 times with growing pauses; other errors
 *             are final
 *   errors    a rejected token (401 / UDAPI100050) → UpstoxTokenError; an endpoint that needs Upstox Plus
 *             (UDAPI1149) → UpstoxPlusRequiredError; the rest → UpstoxError with Upstox's own message
 *
 * Candles come back as [time ISO+05:30, open, high, low, close, volume, oi], newest first: they are parsed,
 * checked (a malformed row fails the call rather than being skipped) and returned oldest first.
 */
/** A candle (time = open, epoch seconds) — the same shape as V2's RawCandle. */
export interface UpstoxCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}

export const UPSTOX_API = 'https://api.upstox.com';

export class UpstoxError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'UpstoxError';
  }
}

/** Upstox refused the access token (expired at 03:30 IST, logged out, or revoked by a newer login). */
export class UpstoxTokenError extends UpstoxError {
  constructor(status: number, code: string | null, message: string) {
    super(status, code, message);
    this.name = 'UpstoxTokenError';
  }
}

/** The expired-instrument endpoints need Upstox Plus on the account. */
export class UpstoxPlusRequiredError extends UpstoxError {
  constructor(status: number, code: string | null) {
    super(status, code, 'Upstox only serves expired contracts with Upstox Plus — turn on Upstox Plus for this account (free to activate) and run it again.');
    this.name = 'UpstoxPlusRequiredError';
  }
}

/** Not connected (no login yet, or the stored session expired). */
export class UpstoxNotConnectedError extends Error {
  constructor(reason?: string) {
    super(reason ?? 'Upstox isn’t connected — use “Connect Upstox” to log in.');
    this.name = 'UpstoxNotConnectedError';
  }
}

const TOKEN_CODES = new Set(['UDAPI100050', 'UDAPI100016']);
const PLUS_CODE = 'UDAPI1149';

// ---- rate gate ------------------------------------------------------------------------------------

export interface RateWindow {
  ms: number;
  max: number;
}

/** Under Upstox's per-user limits (50 / s, 500 / min, 2,000 / 30 min) with headroom. */
export const UPSTOX_WINDOWS: RateWindow[] = [
  { ms: 1_000, max: 20 },
  { ms: 60_000, max: 450 },
  { ms: 30 * 60_000, max: 1_900 },
];

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Sliding-window gate: `take()` resolves when one more request fits in every window. */
export class RateGate {
  private readonly stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly windows: RateWindow[] = UPSTOX_WINDOWS,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  /** Requests counted in the longest window (for status / tests). */
  get used(): number {
    return this.stamps.length;
  }

  /** How long until one more request fits (0 = now). */
  waitMs(): number {
    const t = this.now();
    const longest = Math.max(...this.windows.map((w) => w.ms));
    while (this.stamps.length && this.stamps[0]! <= t - longest) this.stamps.shift();
    let wait = 0;
    for (const w of this.windows) {
      const inside = this.stamps.filter((s) => s > t - w.ms);
      if (inside.length >= w.max) wait = Math.max(wait, inside[inside.length - w.max]! + w.ms - t + 1);
    }
    return wait;
  }

  take(): Promise<void> {
    const next = this.chain.then(async () => {
      for (let wait = this.waitMs(); wait > 0; wait = this.waitMs()) await this.sleep(wait);
      this.stamps.push(this.now());
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/** One gate for the whole process (every Upstox call shares the account's limits). */
const g = globalThis as unknown as { __ashUpstoxGate?: RateGate };
export const upstoxGate = (): RateGate => (g.__ashUpstoxGate ??= new RateGate());

// ---- requests -------------------------------------------------------------------------------------

export interface UpstoxHttp {
  fetch: typeof fetch;
  gate: RateGate;
  sleep: (ms: number) => Promise<void>;
}

const defaultHttp = (): UpstoxHttp => ({ fetch: (...a) => fetch(...a), gate: upstoxGate(), sleep: realSleep });

interface ErrorBody {
  status?: string;
  errors?: Array<{ errorCode?: string; error_code?: string; message?: string }>;
}

/** The error Upstox returned, as one of the typed errors above. */
export function upstoxError(status: number, body: unknown): UpstoxError {
  const e = (body as ErrorBody | null)?.errors?.[0];
  const code = e?.errorCode ?? e?.error_code ?? null;
  const message = e?.message?.trim() || `Upstox answered HTTP ${status}`;
  if (code === PLUS_CODE) return new UpstoxPlusRequiredError(status, code);
  if (status === 401 || (code !== null && TOKEN_CODES.has(code))) return new UpstoxTokenError(status, code, message);
  return new UpstoxError(status, code, message);
}

const RETRIES = 3;
const retryable = (status: number) => status === 429 || status >= 500;

/** GET/POST/DELETE an Upstox endpoint and return its `data` (or the whole body when there is none). */
export async function upstoxRequest<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; token?: string; form?: Record<string, string> } = {},
  http: UpstoxHttp = defaultHttp(),
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(init.form).toString();
  }
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await http.sleep(1_000 * 2 ** (attempt - 1));
    await http.gate.take();
    let res: Response;
    try {
      res = await http.fetch(`${UPSTOX_API}${path}`, { method: init.method ?? 'GET', headers, body });
    } catch (err) {
      lastError = new UpstoxError(0, null, `Upstox could not be reached: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok || (json as ErrorBody | null)?.status === 'error') {
      const err = upstoxError(res.status, json);
      if (retryable(res.status)) {
        lastError = err;
        continue;
      }
      throw err;
    }
    if (json === null) throw new UpstoxError(res.status, null, 'Upstox sent an empty or unreadable answer');
    const data = (json as { data?: unknown }).data;
    return (data === undefined ? json : data) as T;
  }
  throw lastError instanceof Error ? lastError : new UpstoxError(0, null, 'Upstox request failed');
}

// ---- parsing --------------------------------------------------------------------------------------

/** Upstox candle rows → candles, oldest first; any malformed row throws (never silently dropped). */
export function parseCandles(rows: unknown, what: string): UpstoxCandle[] {
  if (rows === undefined || rows === null) return [];
  if (!Array.isArray(rows)) throw new UpstoxError(200, null, `Upstox candles for ${what} were not a list`);
  const out: UpstoxCandle[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) throw new UpstoxError(200, null, `Upstox sent a malformed candle for ${what}: ${JSON.stringify(r)}`);
    const ms = Date.parse(String(r[0]));
    const [open, high, low, close, volume] = [r[1], r[2], r[3], r[4], r[5]].map(Number) as [number, number, number, number, number];
    const oi = r[6] === undefined || r[6] === null ? undefined : Number(r[6]);
    const bad = !Number.isFinite(ms) || ![open, high, low, close, volume].every(Number.isFinite) || (oi !== undefined && !Number.isFinite(oi));
    if (bad) throw new UpstoxError(200, null, `Upstox sent a malformed candle for ${what}: ${JSON.stringify(r)}`);
    if (ms % 1000 !== 0) throw new UpstoxError(200, null, `Upstox sent a candle time with fractions of a second for ${what}: ${String(r[0])}`);
    out.push({ time: ms / 1000, open, high, low, close, volume, ...(oi === undefined ? {} : { oi }) });
  }
  out.sort((a, b) => a.time - b.time);
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.time === out[i - 1]!.time) throw new UpstoxError(200, null, `Upstox sent two candles for the same time for ${what} (${new Date(out[i]!.time * 1000).toISOString()})`);
  }
  return out;
}

// ---- endpoints ------------------------------------------------------------------------------------

/** A contract as Upstox lists it (expired-instrument APIs and the daily instrument file share these fields). */
export interface UpstoxContract {
  instrument_key: string;
  segment: string;
  exchange?: string;
  name?: string;
  trading_symbol: string;
  instrument_type: string;
  /** yyyy-mm-dd (expired APIs) or epoch ms of 23:59:59 IST on the expiry day (instrument file). */
  expiry: string | number;
  strike_price?: number;
  lot_size: number;
  /** In paise (5 = ₹0.05). */
  tick_size: number;
  underlying_key?: string;
  underlying_symbol?: string;
  weekly?: boolean;
}

export type ExpiredInterval = '1minute' | '3minute' | '5minute' | '15minute' | '30minute' | 'day';

export interface UpstoxTokenResponse {
  access_token?: string;
  user_id?: string;
  user_name?: string;
  email?: string;
}

const enc = encodeURIComponent;

/** The market-data endpoints, bound to an access token. */
export class UpstoxApi {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly http: UpstoxHttp = defaultHttp(),
    /** Upstox rejected the token: end the session; the call then fails with UpstoxNotConnectedError. */
    private readonly onTokenError?: (err: UpstoxTokenError) => Promise<void>,
  ) {}

  private async get<T>(path: string): Promise<T> {
    try {
      return await upstoxRequest<T>(path, { token: await this.token() }, this.http);
    } catch (err) {
      if (err instanceof UpstoxTokenError && this.onTokenError) {
        await this.onTokenError(err);
        throw new UpstoxNotConnectedError(`Upstox rejected the session (${err.message.replace(/\.$/, '')}) — use “Connect Upstox” to log in again.`);
      }
      throw err;
    }
  }

  /** Past expiries (weekly and monthly) of an underlying — Upstox keeps about six months. Not MCX. */
  async expiries(underlyingKey: string): Promise<string[]> {
    const data = await this.get<unknown>(`/v2/expired-instruments/expiries?instrument_key=${enc(underlyingKey)}`);
    if (!Array.isArray(data)) throw new UpstoxError(200, null, `Upstox expiries for ${underlyingKey} were not a list`);
    return data.map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  }

  async expiredOptions(underlyingKey: string, expiry: string): Promise<UpstoxContract[]> {
    const data = await this.get<unknown>(`/v2/expired-instruments/option/contract?instrument_key=${enc(underlyingKey)}&expiry_date=${expiry}`);
    return Array.isArray(data) ? (data as UpstoxContract[]) : [];
  }

  async expiredFutures(underlyingKey: string, expiry: string): Promise<UpstoxContract[]> {
    const data = await this.get<unknown>(`/v2/expired-instruments/future/contract?instrument_key=${enc(underlyingKey)}&expiry_date=${expiry}`);
    return Array.isArray(data) ? (data as UpstoxContract[]) : [];
  }

  /** Candles of an expired contract (`NSE_FO|47983|17-04-2025`), inclusive IST dates. */
  async expiredCandles(expiredKey: string, interval: ExpiredInterval, from: string, to: string): Promise<UpstoxCandle[]> {
    const data = await this.get<{ candles?: unknown }>(`/v2/expired-instruments/historical-candle/${enc(expiredKey)}/${interval}/${to}/${from}`);
    return parseCandles(data?.candles, expiredKey);
  }

  /** Candles of an index, stock or live contract (v3: minutes 1–300, days), inclusive IST dates. */
  async historicalCandles(key: string, unit: 'minutes' | 'days', interval: number, from: string, to: string): Promise<UpstoxCandle[]> {
    const data = await this.get<{ candles?: unknown }>(`/v3/historical-candle/${enc(key)}/${unit}/${interval}/${to}/${from}`);
    return parseCandles(data?.candles, key);
  }
}

/** Exchange a login `code` for an access token (the code works once, whatever happens). */
export function exchangeUpstoxCode(x: { code: string; apiKey: string; apiSecret: string; redirectUri: string }, http: UpstoxHttp = defaultHttp()): Promise<UpstoxTokenResponse> {
  return upstoxRequest<UpstoxTokenResponse>(
    '/v2/login/authorization/token',
    { method: 'POST', form: { code: x.code, client_id: x.apiKey, client_secret: x.apiSecret, redirect_uri: x.redirectUri, grant_type: 'authorization_code' } },
    http,
  );
}

export function upstoxLogout(token: string, http: UpstoxHttp = defaultHttp()): Promise<unknown> {
  return upstoxRequest('/v2/logout', { method: 'DELETE', token }, http);
}

/** Upstox's login page for this app (it returns to `redirectUri` with ?code=…&state=…). */
export function upstoxLoginUrl(apiKey: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: apiKey, redirect_uri: redirectUri, state });
  return `${UPSTOX_API}/v2/login/authorization/dialog?${q.toString()}`;
}
