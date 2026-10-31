/**
 * Upstox login: only a login this app started can complete (state), the token is stored encrypted and ends at
 * 03:30 IST, a token Upstox rejects ends the session, and the redirect's code is exchanged once.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { UpstoxSessionRecord, UpstoxSessionRepository } from '../../src/server/db/appStore';
import { RateGate, UpstoxNotConnectedError, type UpstoxHttp } from '../../src/server/services/upstox/upstoxClient';
import { UpstoxAuthService } from '../../src/server/services/upstox/upstoxAuth';
import { ist } from '../helpers/v2Fakes';

beforeAll(() => {
  process.env.UPSTOX_API_KEY = 'KEY';
  process.env.UPSTOX_API_SECRET = 'SECRET';
  process.env.UPSTOX_REDIRECT_URI = 'http://localhost:3000/redirect/upstox';
});

class MemoryRepo implements UpstoxSessionRepository {
  rec: UpstoxSessionRecord | null = null;
  async get() {
    return this.rec ? { ...this.rec } : null;
  }
  async save(r: UpstoxSessionRecord) {
    this.rec = { ...r };
  }
  async markState(state: UpstoxSessionRecord['state'], lastError?: string) {
    this.rec = { ...(this.rec ?? { state }), state, lastError };
  }
  async clear() {
    this.rec = null;
  }
}

function setup(answers: Array<{ status: number; body: unknown }>) {
  const clock = { now: ist('2026-10-30', '20:00') };
  const calls: Array<{ url: string; body?: string; auth?: string }> = [];
  const http: UpstoxHttp = {
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? String(init.body) : undefined, auth: (init.headers as Record<string, string>).Authorization });
      const a = answers.shift() ?? { status: 500, body: {} };
      return new Response(JSON.stringify(a.body), { status: a.status });
    }) as typeof fetch,
    gate: new RateGate([{ ms: 1000, max: 1000 }]),
    sleep: async () => undefined,
  };
  const repo = new MemoryRepo();
  const auth = new UpstoxAuthService({ upstox: repo }, { now: () => clock.now, http });
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
  return { clock, calls, repo, auth, stateOf };
}

const token = { status: 200, body: { email: 'x', user_id: 'AB1234', user_name: 'Trader', access_token: 'ACCESS-1' } };

describe('upstox login', () => {
  it('logs in with a state it handed out; stores the token encrypted until 03:30 IST', async () => {
    const { auth, repo, calls, clock, stateOf } = setup([token]);
    expect(await auth.status()).toMatchObject({ enabled: true, state: 'needs-login', needsLogin: true });
    const url = auth.loginUrl();
    expect(new URL(url).searchParams.get('redirect_uri')).toBe('http://localhost:3000/redirect/upstox');
    await auth.completeLogin('CODE1', stateOf(url));
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toMatchObject({ code: 'CODE1', client_id: 'KEY', client_secret: 'SECRET', grant_type: 'authorization_code' });
    expect(repo.rec).toMatchObject({ state: 'connected', userId: 'AB1234', userName: 'Trader', expiresAt: new Date(ist('2026-10-31', '03:30')).toISOString() });
    expect(repo.rec!.accessTokenEnc).not.toContain('ACCESS-1');
    expect(await auth.status()).toMatchObject({ state: 'connected', needsLogin: false, userName: 'Trader' });
    expect(await auth.accessToken()).toBe('ACCESS-1');
    // 03:30 next morning: Upstox has ended it.
    clock.now = ist('2026-10-31', '03:30');
    expect(await auth.status()).toMatchObject({ state: 'needs-login', lastError: expect.stringMatching(/3:30 AM IST/) });
  });

  it('refuses a state it didn’t hand out, an old one, and one used twice', async () => {
    const { auth, clock, stateOf } = setup([token, token]);
    await expect(auth.completeLogin('CODE1', 'forged')).rejects.toThrow(/wasn’t started from this app/);
    const old = stateOf(auth.loginUrl());
    clock.now += 16 * 60_000;
    await expect(auth.completeLogin('CODE1', old)).rejects.toThrow(/wasn’t started from this app/);
    const fresh = stateOf(auth.loginUrl());
    await auth.completeLogin('CODE2', fresh);
    await expect(auth.completeLogin('CODE3', fresh)).rejects.toThrow(/wasn’t started from this app/);
  });

  it('a failed exchange is recorded with Upstox’s message', async () => {
    const { auth, repo, stateOf } = setup([{ status: 400, body: { status: 'error', errors: [{ errorCode: 'UDAPI100057', message: 'Invalid Auth code' }] } }]);
    await expect(auth.completeLogin('BAD', stateOf(auth.loginUrl()))).rejects.toThrow('Invalid Auth code');
    expect(repo.rec).toMatchObject({ state: 'error', lastError: 'Invalid Auth code' });
    expect(await auth.status()).toMatchObject({ state: 'error', needsLogin: true });
  });

  it('a token Upstox rejects ends the session (the next call says to log in again)', async () => {
    const { auth, calls, repo, stateOf } = setup([token, { status: 401, body: { status: 'error', errors: [{ errorCode: 'UDAPI100050', message: 'Invalid token used to access API' }] } }]);
    await auth.completeLogin('CODE1', stateOf(auth.loginUrl()));
    await expect(auth.api().expiries('NSE_INDEX|Nifty 50')).rejects.toBeInstanceOf(UpstoxNotConnectedError);
    expect(calls[1]!.auth).toBe('Bearer ACCESS-1');
    expect(repo.rec).toMatchObject({ state: 'needs-login', lastError: expect.stringMatching(/Upstox rejected the session: Invalid token used to access API/) });
    await expect(auth.accessToken()).rejects.toBeInstanceOf(UpstoxNotConnectedError);
  });

  it('logout revokes at Upstox and forgets the session', async () => {
    const { auth, calls, repo, stateOf } = setup([token, { status: 200, body: { status: 'success', data: true } }]);
    await auth.completeLogin('CODE1', stateOf(auth.loginUrl()));
    await auth.logout();
    expect(calls[1]!.url).toBe('https://api.upstox.com/v2/logout');
    expect(repo.rec).toBeNull();
    expect(await auth.status()).toMatchObject({ state: 'needs-login' });
  });
});
