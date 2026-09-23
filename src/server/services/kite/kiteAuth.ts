/**
 * Kite Connect OAuth-style auth service. Owns the login URL, the
 * request_token → access_token exchange, and the auth STATE the UI shows.
 *
 * Stateless by design (serverless): the session lives in the `kite_session`
 * row with the token encrypted at rest, so any function instance can serve
 * any request. An expired/invalid token flips the state to 'needs-login' and
 * the UI offers a one-click re-login.
 */
import type { KiteAuthStatus } from '@ash/shared';
import { getConfig, requireKiteCredentials } from '../../config/index';
import type { DataStore } from '../../db/store';
import { childLogger } from '../../utils/logger';
import { nextKiteTokenExpiry } from '../../utils/marketTime';
import { KiteNotConnectedError, createKiteClient, isKiteTokenError, kiteErrorMessage, type KiteClient } from './kiteClient';
import { decryptToken, encryptToken } from './tokenCrypto';

const log = childLogger('kite-auth');

/** Per-instance memo so a burst of Kite calls doesn't hit the DB for the token each time. */
const TOKEN_MEMO_MS = 30_000;

export class KiteAuthService {
  private memo: { token: string; at: number } | undefined;
  private pending: { requestToken: string; promise: Promise<void> } | undefined;

  constructor(
    private readonly store: DataStore,
    /** Invoked after a successful login (e.g. to refresh the instrument master). */
    private readonly onLogin?: () => Promise<void>,
  ) {}

  async status(now = Date.now()): Promise<KiteAuthStatus> {
    if (!getConfig().kite.isConfigured) {
      return {
        enabled: false,
        state: 'disabled',
        needsLogin: false,
        lastError: 'KITE_API_KEY and KITE_API_SECRET are not set on the server.',
      };
    }
    const rec = await this.store.kite.get();
    const base = {
      enabled: true,
      userId: rec?.kiteUserId,
      userName: rec?.userName,
      loginTime: rec?.loginTime,
      expiresAt: rec?.expiresAt,
    };
    if (!rec?.accessTokenEnc || rec.state !== 'connected') {
      const state = rec?.state === 'error' ? 'error' : 'needs-login';
      return { ...base, state, needsLogin: true, lastError: rec?.lastError };
    }
    if (rec.expiresAt && Date.parse(rec.expiresAt) <= now) {
      return {
        ...base,
        state: 'needs-login',
        needsLogin: true,
        lastError: 'Kite session expired (Kite resets access tokens daily around 6:00 AM IST).',
      };
    }
    return { ...base, state: 'connected', needsLogin: false };
  }

  async isConnected(): Promise<boolean> {
    return (await this.status()).state === 'connected';
  }

  async loginUrl(): Promise<string> {
    const kc = await createKiteClient();
    return kc.getLoginURL();
  }

  /** The decrypted access token of a live session, or throws KiteNotConnectedError. */
  async accessToken(): Promise<string> {
    if (this.memo && Date.now() - this.memo.at < TOKEN_MEMO_MS) return this.memo.token;
    const status = await this.status();
    if (status.state !== 'connected') throw new KiteNotConnectedError(status.lastError ?? undefined);
    const rec = await this.store.kite.get();
    const token = rec?.accessTokenEnc ? decryptToken(rec.accessTokenEnc, requireKiteCredentials().apiSecret) : undefined;
    if (!token) {
      await this.store.kite.markState('needs-login', 'Stored Kite session could not be decrypted — please log in again.');
      throw new KiteNotConnectedError();
    }
    this.memo = { token, at: Date.now() };
    return token;
  }

  /**
   * Exchange a request_token (from the login redirect) for an access token.
   * De-duplicates repeat submissions of the SAME request_token on this instance
   * (a request_token is single-use and Kite's session endpoint is rate-limited).
   */
  async completeLogin(requestToken: string): Promise<void> {
    if (this.pending?.requestToken === requestToken) return this.pending.promise;
    const promise = this.exchange(requestToken);
    this.pending = { requestToken, promise };
    try {
      await promise;
    } finally {
      this.pending = undefined;
    }
  }

  private async exchange(requestToken: string): Promise<void> {
    const { apiSecret } = requireKiteCredentials();
    const kc = await createKiteClient();
    let session: { access_token?: string; user_id?: string; user_name?: string; login_time?: string | Date };
    try {
      session = await kc.generateSession(requestToken, apiSecret);
    } catch (err) {
      const message = kiteErrorMessage(err);
      // A double-fired redirect can land on another instance: if a session was
      // just stored by that first exchange, the second (now-invalid) token is harmless.
      const rec = await this.store.kite.get();
      if (rec?.state === 'connected' && rec.loginTime && Date.now() - Date.parse(rec.updatedAt ?? rec.loginTime) < 120_000) {
        log.info('request_token already exchanged by a concurrent request; using stored session');
        return;
      }
      await this.store.kite.markState('error', message);
      log.error({ err: message }, 'kite login failed');
      throw new Error(message);
    }
    if (!session?.access_token) {
      await this.store.kite.markState('error', 'Kite did not return an access token');
      throw new Error('Kite did not return an access token');
    }

    const now = Date.now();
    await this.store.kite.save({
      accessTokenEnc: encryptToken(session.access_token, apiSecret),
      kiteUserId: session.user_id,
      userName: session.user_name,
      loginTime: new Date(now).toISOString(),
      expiresAt: new Date(nextKiteTokenExpiry(now)).toISOString(),
      state: 'connected',
    });
    this.memo = { token: session.access_token, at: now };
    log.info({ user: session.user_id }, 'kite login complete');

    if (this.onLogin) {
      try {
        await this.onLogin();
      } catch (err) {
        // Login itself succeeded; the next evaluator run retries the sync.
        log.error({ err: kiteErrorMessage(err) }, 'post-login hook failed');
      }
    }
  }

  /** Called when Kite rejects the token mid-flight → prompt a re-login in the UI. */
  async invalidate(reason: string): Promise<void> {
    this.memo = undefined;
    await this.store.kite.markState('needs-login', reason);
    log.warn({ reason }, 'kite session needs re-login');
  }

  /** Run a Kite call with the live token; a TokenException invalidates the session. */
  async call<T>(fn: (kc: KiteClient) => Promise<T>): Promise<T> {
    const kc = await createKiteClient(await this.accessToken());
    try {
      return await fn(kc);
    } catch (err) {
      if (isKiteTokenError(err)) {
        const reason = `Kite rejected the session: ${kiteErrorMessage(err).replace(/\.$/, '')}`;
        await this.invalidate(`${reason}. Please log in again.`);
        throw new KiteNotConnectedError(reason);
      }
      throw err;
    }
  }

  async logout(): Promise<void> {
    try {
      const token = await this.accessToken();
      const kc = await createKiteClient(token);
      await kc.invalidateAccessToken(token);
    } catch {
      /* already invalid / not connected — nothing to revoke */
    }
    this.memo = undefined;
    await this.store.kite.clear();
  }
}
