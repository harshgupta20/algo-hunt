/**
 * Upstox REST client: candle parsing (Upstox's docs samples), typed errors, retries, the rate gate, request
 * shapes (keys with "|" and spaces, the token form) and the 03:30 IST token expiry.
 */
import { describe, expect, it } from 'vitest';
import {
  RateGate,
  UpstoxApi,
  UpstoxError,
  UpstoxNotConnectedError,
  UpstoxPlusRequiredError,
  UpstoxTokenError,
  exchangeUpstoxCode,
  parseCandles,
  upstoxError,
  upstoxLoginUrl,
  upstoxRequest,
  type UpstoxHttp,
} from '../../src/server/services/upstox/upstoxClient';
import { nextUpstoxTokenExpiry } from '../../src/server/utils/marketTime';
import { ist } from '../helpers/v2Fakes';

/** A fake fetch answering from a queue, recording each request. */
function fakeHttp(answers: Array<{ status: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sleeps: number[] = [];
  const http: UpstoxHttp = {
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const a = answers.shift();
      if (!a) throw new Error('no more answers');
      if (a instanceof Error) throw a;
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
    gate: new RateGate([{ ms: 1000, max: 1000 }]),
    sleep: async (ms) => void sleeps.push(ms),
  };
  return { http, calls, sleeps };
}

const errorBody = (code: string, message: string) => ({ status: 'error', errors: [{ errorCode: code, message, propertyPath: null, invalidValue: null }] });

describe('upstox candles', () => {
  it('parses Upstox’s rows (newest first, +05:30 times, OI) oldest first', () => {
    // The expired-candle docs sample.
    const rows = [
      ['2022-11-30T00:00:00+05:30', 125.35, 126.8, 122.1, 123.45, 1542678, 184632],
      ['2022-11-29T00:00:00+05:30', 120.85, 126.55, 120.5, 125.35, 1876543, 195732],
    ];
    expect(parseCandles(rows, 'x')).toEqual([
      { time: ist('2022-11-29', '00:00') / 1000, open: 120.85, high: 126.55, low: 120.5, close: 125.35, volume: 1876543, oi: 195732 },
      { time: ist('2022-11-30', '00:00') / 1000, open: 125.35, high: 126.8, low: 122.1, close: 123.45, volume: 1542678, oi: 184632 },
    ]);
    // Minute candles: the open time in IST.
    expect(parseCandles([['2025-01-02T09:15:00+05:30', 1, 2, 0.5, 1.5, 10, 0]], 'x')[0]!.time).toBe(ist('2025-01-02', '09:15') / 1000);
    expect(parseCandles([['2025-01-02T09:15:00+05:30', 1, 2, 0.5, 1.5, 10]], 'x')[0]).not.toHaveProperty('oi');
    expect(parseCandles(undefined, 'x')).toEqual([]);
  });

  it('fails on a malformed row or a repeated time instead of dropping it', () => {
    expect(() => parseCandles([['2025-01-02T09:15:00+05:30', 1, 2, 'x', 1.5, 10, 0]], 'NIFTY')).toThrow(/malformed candle for NIFTY/);
    expect(() => parseCandles([['not a time', 1, 2, 0.5, 1.5, 10, 0]], 'NIFTY')).toThrow(/malformed/);
    expect(() => parseCandles([[1, 2]], 'NIFTY')).toThrow(/malformed/);
    expect(() => parseCandles({ candles: [] }, 'NIFTY')).toThrow(/not a list/);
    const t = '2025-01-02T09:15:00+05:30';
    expect(() => parseCandles([[t, 1, 1, 1, 1, 1, 0], [t, 1, 1, 1, 1, 1, 0]], 'NIFTY')).toThrow(/two candles for the same time/);
  });
});

describe('upstox errors and requests', () => {
  it('types Upstox’s errors: Plus needed, token rejected, the rest with Upstox’s message', () => {
    expect(upstoxError(403, errorBody('UDAPI1149', 'This API is available exclusively with an Upstox Plus plan subscription'))).toBeInstanceOf(UpstoxPlusRequiredError);
    expect(upstoxError(401, errorBody('UDAPI100050', 'Invalid token used to access API'))).toBeInstanceOf(UpstoxTokenError);
    expect(upstoxError(401, null)).toBeInstanceOf(UpstoxTokenError);
    const e = upstoxError(400, errorBody('UDAPI1021', 'Instrument key is of invalid format'));
    expect(e).toBeInstanceOf(UpstoxError);
    expect(e).not.toBeInstanceOf(UpstoxTokenError);
    expect(e).toMatchObject({ status: 400, code: 'UDAPI1021', message: 'Instrument key is of invalid format' });
    expect(upstoxError(400, { status: 'error', errors: [{ error_code: 'UDAPI1149' }] })).toBeInstanceOf(UpstoxPlusRequiredError);
  });

  it('encodes keys, sends the bearer token, returns `data`, retries 429 / 5xx / network errors with growing pauses', async () => {
    const { http, calls, sleeps } = fakeHttp([{ status: 429, body: errorBody('UDAPI10005', 'Too Many Request Sent') }, new Error('socket hang up'), { status: 503, body: {} }, { status: 200, body: { status: 'success', data: ['2024-10-03', '2024-10-10'] } }]);
    const api = new UpstoxApi(async () => 'TOKEN', http);
    expect(await api.expiries('NSE_INDEX|Nifty 50')).toEqual(['2024-10-03', '2024-10-10']);
    expect(calls).toHaveLength(4);
    expect(calls[0]!.url).toBe('https://api.upstox.com/v2/expired-instruments/expiries?instrument_key=NSE_INDEX%7CNifty%2050');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('gives up after 3 retries; never retries a 4xx', async () => {
    const busy = fakeHttp(Array.from({ length: 4 }, () => ({ status: 500, body: errorBody('UDAPI100500', 'Something went wrong') })));
    await expect(upstoxRequest('/x', {}, busy.http)).rejects.toMatchObject({ status: 500, message: 'Something went wrong' });
    expect(busy.calls).toHaveLength(4);
    const bad = fakeHttp([{ status: 400, body: errorBody('UDAPI1088', 'Invalid date') }]);
    await expect(upstoxRequest('/x', {}, bad.http)).rejects.toMatchObject({ status: 400, code: 'UDAPI1088' });
    expect(bad.calls).toHaveLength(1);
  });

  it('builds the expired-candle path (to before from) and the v3 path; a rejected token ends the session first', async () => {
    const { http, calls } = fakeHttp([
      { status: 200, body: { status: 'success', data: { candles: [] } } },
      { status: 200, body: { status: 'success', data: { candles: [] } } },
      { status: 401, body: errorBody('UDAPI100050', 'Invalid token used to access API') },
    ]);
    const ended: string[] = [];
    const api = new UpstoxApi(async () => 'T', http, async (e) => void ended.push(e.message));
    await api.expiredCandles('NSE_FO|47983|17-04-2025', '1minute', '2025-04-01', '2025-04-17');
    await api.historicalCandles('NSE_EQ|INE002A01018', 'minutes', 15, '2025-01-01', '2025-01-28');
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.upstox.com/v2/expired-instruments/historical-candle/NSE_FO%7C47983%7C17-04-2025/1minute/2025-04-17/2025-04-01',
      'https://api.upstox.com/v3/historical-candle/NSE_EQ%7CINE002A01018/minutes/15/2025-01-28/2025-01-01',
    ]);
    await expect(api.expiredOptions('NSE_INDEX|Nifty 50', '2025-04-17')).rejects.toBeInstanceOf(UpstoxNotConnectedError);
    expect(ended).toEqual(['Invalid token used to access API']);
  });

  it('exchanges the login code as a form (the token answer is not wrapped in `data`)', async () => {
    const { http, calls } = fakeHttp([{ status: 200, body: { email: 'x', user_id: 'AB1234', user_name: 'Trader', access_token: 'ACCESS', extended_token: 'EXT' } }]);
    const t = await exchangeUpstoxCode({ code: 'mk404x', apiKey: 'KEY', apiSecret: 'SECRET', redirectUri: 'http://localhost:3000/redirect/upstox' }, http);
    expect(t).toMatchObject({ access_token: 'ACCESS', user_id: 'AB1234', user_name: 'Trader' });
    expect(calls[0]!.url).toBe('https://api.upstox.com/v2/login/authorization/token');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)))).toEqual({ code: 'mk404x', client_id: 'KEY', client_secret: 'SECRET', redirect_uri: 'http://localhost:3000/redirect/upstox', grant_type: 'authorization_code' });
  });

  it('the login page URL carries the key, the exact redirect URL and the state', () => {
    const u = new URL(upstoxLoginUrl('KEY', 'http://localhost:3000/redirect/upstox', 'abc'));
    expect(u.origin + u.pathname).toBe('https://api.upstox.com/v2/login/authorization/dialog');
    expect(Object.fromEntries(u.searchParams)).toEqual({ response_type: 'code', client_id: 'KEY', redirect_uri: 'http://localhost:3000/redirect/upstox', state: 'abc' });
  });
});

describe('rate gate', () => {
  it('waits until one more request fits every window', async () => {
    let now = 0;
    const slept: number[] = [];
    const gate = new RateGate(
      [
        { ms: 1_000, max: 2 },
        { ms: 10_000, max: 3 },
      ],
      () => now,
      async (ms) => {
        slept.push(ms);
        now += ms;
      },
    );
    await gate.take();
    await gate.take();
    expect(slept).toEqual([]);
    await gate.take(); // third in a second → waits for the first to leave the 1 s window
    expect(slept).toEqual([1001]);
    await gate.take(); // fourth in 10 s → waits for the first to leave the 10 s window
    expect(now).toBe(10_001);
    expect(gate.used).toBe(2); // 1,001 and 10,001 are inside the last 10 s; the two at 0 left
    expect(gate.waitMs()).toBe(0);
  });

  it('serves concurrent callers one at a time', async () => {
    let now = 0;
    const gate = new RateGate([{ ms: 1_000, max: 1 }], () => now, async (ms) => void (now += ms));
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => gate.take().then(() => order.push(now))));
    expect(order).toEqual([0, 1001, 2002]);
  });
});

describe('upstox token expiry', () => {
  it('stops at 03:30 IST: the next one after login (a login before 03:30 lasts until that same morning)', () => {
    expect(nextUpstoxTokenExpiry(ist('2026-10-13', '20:00'))).toBe(ist('2026-10-14', '03:30'));
    expect(nextUpstoxTokenExpiry(ist('2026-10-14', '02:30'))).toBe(ist('2026-10-14', '03:30'));
    expect(nextUpstoxTokenExpiry(ist('2026-10-14', '03:30'))).toBe(ist('2026-10-15', '03:30'));
    expect(nextUpstoxTokenExpiry(ist('2026-10-14', '09:00'))).toBe(ist('2026-10-15', '03:30'));
  });
});
