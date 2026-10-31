/**
 * Upstox login for the V2 Options backtest (expired contracts). OAuth like Kite's:
 *   loginUrl()        Upstox's login page with a fresh `state` (checked on return, so only a login this app
 *                     started can complete — Upstox's own advice)
 *   completeLogin()   the redirect's `code` → access token, stored encrypted (key from UPSTOX_API_SECRET)
 *   status()          connected until 03:30 IST, when Upstox ends every token; then 'needs-login'
 *   api()             the market-data client; a token Upstox rejects flips the state to 'needs-login'
 */
import { randomBytes } from 'node:crypto';
import type { UpstoxAuthStatus } from '@ash/shared';
import { getConfig, requireUpstoxCredentials } from '../../config/index';
import type { AppStore } from '../../db/appStore';
import { childLogger } from '../../utils/logger';
import { nextUpstoxTokenExpiry } from '../../utils/marketTime';
import { decryptToken, encryptToken } from '../kite/tokenCrypto';
import { exchangeUpstoxCode, upstoxLoginUrl, upstoxLogout, UpstoxApi, UpstoxNotConnectedError, type UpstoxHttp } from './upstoxClient';

const log = childLogger('upstox-auth');

/** A login's `state` is accepted for this long after the login page was opened. */
const STATE_TTL_MS = 15 * 60_000;
const TOKEN_MEMO_MS = 30_000;
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class UpstoxAuthService {
  private memo: { token: string; at: number } | undefined;
  private readonly states = new Map<string, number>();
  private pending: { code: string; promise: Promise<void> } | undefined;

  constructor(
    private readonly store: Pick<AppStore, 'upstox'>,
    private readonly deps: { now?: () => number; http?: UpstoxHttp } = {},
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  async status(now = this.now()): Promise<UpstoxAuthStatus> {
    if (!getConfig().upstox.isConfigured) {
      return { enabled: false, state: 'disabled', needsLogin: false, lastError: 'UPSTOX_API_KEY, UPSTOX_API_SECRET and UPSTOX_REDIRECT_URI are not all set on the server.' };
    }
    let rec;
    try {
      rec = await this.store.upstox.get();
    } catch (err) {
      // The upstox_session table arrives with migration 015 (applied by `npm run dev` / `npm run build`).
      if ((err as { code?: string }).code === '42P01') return { enabled: true, state: 'error', needsLogin: true, lastError: 'The database isn’t updated for Upstox yet — restart the app (npm run dev / npm start) so it applies the update.' };
      throw err;
    }
    const base = { enabled: true, userId: rec?.userId, userName: rec?.userName, loginTime: rec?.loginTime, expiresAt: rec?.expiresAt };
    if (!rec?.accessTokenEnc || rec.state !== 'connected') {
      return { ...base, state: rec?.state === 'error' ? 'error' : 'needs-login', needsLogin: true, lastError: rec?.lastError };
    }
    if (rec.expiresAt && Date.parse(rec.expiresAt) <= now) {
      return { ...base, state: 'needs-login', needsLogin: true, lastError: 'Upstox session expired (Upstox ends every login at 3:30 AM IST).' };
    }
    return { ...base, state: 'connected', needsLogin: false };
  }

  async isConnected(): Promise<boolean> {
    return (await this.status()).state === 'connected';
  }

  /** Upstox's login page for this app, with a one-time `state`. */
  loginUrl(): string {
    const { apiKey, redirectUri } = requireUpstoxCredentials();
    const now = this.now();
    for (const [s, at] of this.states) if (now - at > STATE_TTL_MS) this.states.delete(s);
    const state = randomBytes(16).toString('hex');
    this.states.set(state, now);
    return upstoxLoginUrl(apiKey, redirectUri, state);
  }

  /** The decrypted token of a live session, or UpstoxNotConnectedError. */
  async accessToken(): Promise<string> {
    if (this.memo && this.now() - this.memo.at < TOKEN_MEMO_MS) return this.memo.token;
    const status = await this.status();
    if (status.state !== 'connected') throw new UpstoxNotConnectedError(status.lastError ? `Upstox isn’t connected: ${status.lastError}` : undefined);
    const rec = await this.store.upstox.get();
    const token = rec?.accessTokenEnc ? decryptToken(rec.accessTokenEnc, requireUpstoxCredentials().apiSecret) : undefined;
    if (!token) {
      await this.store.upstox.markState('needs-login', 'The stored Upstox session could not be read — please log in again.');
      throw new UpstoxNotConnectedError();
    }
    this.memo = { token, at: this.now() };
    return token;
  }

  /**
   * The redirect's `code` → access token. `state` must be one this app handed out (and is used once).
   * A repeat of the same code (a double-fired redirect) waits for the first exchange instead of failing.
   */
  async completeLogin(code: string, state: string): Promise<void> {
    if (this.pending?.code === code) return this.pending.promise;
    const issued = this.states.get(state);
    if (issued === undefined || this.now() - issued > STATE_TTL_MS) {
      throw new Error('This Upstox login wasn’t started from this app (or took over 15 minutes, or the app restarted) — use “Connect Upstox” again.');
    }
    this.states.delete(state);
    const promise = this.exchange(code);
    this.pending = { code, promise };
    try {
      await promise;
    } finally {
      this.pending = undefined;
    }
  }

  private async exchange(code: string): Promise<void> {
    const { apiKey, apiSecret, redirectUri } = requireUpstoxCredentials();
    let session;
    try {
      session = await exchangeUpstoxCode({ code, apiKey, apiSecret, redirectUri }, this.deps.http);
    } catch (err) {
      await this.store.upstox.markState('error', msg(err));
      log.error({ err: msg(err) }, 'upstox login failed');
      throw new Error(msg(err));
    }
    if (!session?.access_token) {
      await this.store.upstox.markState('error', 'Upstox did not return an access token');
      throw new Error('Upstox did not return an access token');
    }
    const now = this.now();
    await this.store.upstox.save({
      accessTokenEnc: encryptToken(session.access_token, apiSecret),
      userId: session.user_id,
      userName: session.user_name,
      loginTime: new Date(now).toISOString(),
      expiresAt: new Date(nextUpstoxTokenExpiry(now)).toISOString(),
      state: 'connected',
    });
    this.memo = { token: session.access_token, at: now };
    log.info({ user: session.user_id }, 'upstox login complete');
  }

  async invalidate(reason: string): Promise<void> {
    this.memo = undefined;
    await this.store.upstox.markState('needs-login', reason);
    log.warn({ reason }, 'upstox session needs re-login');
  }

  /** The market-data client: a token Upstox rejects ends the session (the UI then offers a new login). */
  api(): UpstoxApi {
    return new UpstoxApi(
      () => this.accessToken(),
      this.deps.http,
      (err) => this.invalidate(`Upstox rejected the session: ${err.message.replace(/\.$/, '')}. Please log in again.`),
    );
  }

  async logout(): Promise<void> {
    try {
      await upstoxLogout(await this.accessToken(), this.deps.http);
    } catch {
      /* already invalid / not connected — nothing to revoke */
    }
    this.memo = undefined;
    await this.store.upstox.clear();
  }
}
