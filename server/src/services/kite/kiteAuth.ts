/**
 * Kite Connect OAuth-style auth manager. Owns the login URL, the request_token
 * → access_token exchange, token validation, and the auth STATE the UI shows.
 * When a token is missing/invalid/expired it moves to 'needs-login' (never
 * crashes) so the user can re-authenticate with one click.
 */
import type { KiteAuthState, KiteAuthStatus } from '@ash/shared';
import { childLogger } from '../../utils/logger.js';
import { upsertEnv } from '../../utils/envFile.js';

const log = childLogger('kite-auth');

/** Kite's SDK rejects with plain objects, not Errors — pull a readable message. */
function kiteErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Kite request failed';
}

export interface KiteAuthDeps {
  apiKey: string;
  apiSecret: string;
  /** Called with a validated access token to (re)connect the live provider. */
  onToken: (accessToken: string) => Promise<void>;
}

export class KiteAuthManager {
  private state: KiteAuthState = 'needs-login';
  private lastError: string | undefined;
  private token: string | undefined;
  private kc: any;
  private pending: { token: string; promise: Promise<void> } | undefined;

  constructor(private readonly deps: KiteAuthDeps) {}

  private async client(): Promise<any> {
    if (!this.kc) {
      const { KiteConnect } = await import('kiteconnect');
      this.kc = new KiteConnect({ api_key: this.deps.apiKey });
    }
    return this.kc;
  }

  status(): KiteAuthStatus {
    return {
      enabled: true,
      state: this.state,
      needsLogin: this.state === 'needs-login' || this.state === 'error',
      lastError: this.lastError,
    };
  }

  async loginUrl(): Promise<string> {
    const kc = await this.client();
    return kc.getLoginURL();
  }

  /** Seed from a saved token (env) at boot; validate; connect the provider if valid. */
  async init(seedToken?: string): Promise<void> {
    if (!seedToken) {
      this.state = 'needs-login';
      return;
    }
    this.token = seedToken;
    try {
      const kc = await this.client();
      kc.setAccessToken(seedToken);
      await kc.getProfile(); // throws on invalid/expired token
      await this.deps.onToken(seedToken);
      this.state = 'connected';
      this.lastError = undefined;
      log.info('kite session restored from saved token');
    } catch (err) {
      this.state = 'needs-login';
      this.lastError = 'Saved Kite token is invalid or expired — please log in.';
      log.warn({ err: kiteErrorMessage(err) }, 'saved kite token invalid; login required');
    }
  }

  /**
   * Exchange a request_token (from the login redirect) for an access token.
   * De-duplicates concurrent/repeat submissions of the SAME request_token
   * (e.g. a double-fired redirect) so generateSession runs once — Kite's session
   * endpoint is rate-limited and a request_token is single-use.
   */
  async completeLogin(requestToken: string): Promise<void> {
    if (this.pending && this.pending.token === requestToken) return this.pending.promise;
    const promise = this.exchange(requestToken);
    this.pending = { token: requestToken, promise };
    try {
      await promise;
    } finally {
      this.pending = undefined;
    }
  }

  private async exchange(requestToken: string): Promise<void> {
    this.state = 'connecting';
    try {
      const kc = await this.client();
      const session = await kc.generateSession(requestToken, this.deps.apiSecret);
      const accessToken: string | undefined = session?.access_token;
      if (!accessToken) throw new Error('Kite did not return an access token');
      this.token = accessToken;
      upsertEnv('KITE_ACCESS_TOKEN', accessToken); // persist across restarts
      await this.deps.onToken(accessToken); // (re)connect the live provider
      this.state = 'connected';
      this.lastError = undefined;
      log.info('kite login complete; live provider connected');
    } catch (err) {
      const message = kiteErrorMessage(err);
      this.state = 'error';
      this.lastError = message;
      log.error({ err: message }, 'kite login failed');
      throw new Error(message); // so the API returns the real Kite message
    }
  }

  /** Called when the live session drops due to an auth problem → prompt re-login. */
  markNeedsLogin(reason: string): void {
    if (this.state === 'connecting') return;
    this.state = 'needs-login';
    this.lastError = reason;
    log.warn({ reason }, 'kite session needs re-login');
  }

  logout(): void {
    this.token = undefined;
    this.state = 'needs-login';
    this.lastError = undefined;
  }
}
