import type { AppContext } from '../context';
import { HttpError, type Handler } from '../http';
import { syncInstrumentsFromKite } from '../../services/kite/instrumentSync';
import { INSTRUMENTS_SYNCED_KEY } from '../../services/kite/instrumentSync';

/** Accept a raw request_token OR the full redirected URL and pull the token out. */
export function extractRequestToken(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/request_token=([^&\s]+)/);
  return match ? decodeURIComponent(match[1]!) : trimmed;
}

export function kiteController(ctx: AppContext) {
  /** Auth status the UI polls to decide whether to show a "Connect Kite" prompt. */
  const status: Handler = () => ctx.kiteAuth.status();

  /** Start the login flow: redirect the browser to Kite's login page. */
  const login: Handler = async () => Response.redirect(await ctx.kiteAuth.loginUrl(), 302);

  /**
   * Alternative OAuth redirect target (`https://<app>/api/kite/callback`).
   * Exchanges request_token → access_token, then returns to Settings.
   */
  const callback: Handler = async (req) => {
    const back = (q: string) => Response.redirect(new URL(`/settings?${q}`, req.url), 302);
    const requestToken = req.query.get('request_token') ?? '';
    const kiteStatus = req.query.get('status');
    if (kiteStatus && kiteStatus !== 'success') return back('kite=error&message=Login%20was%20cancelled');
    if (!requestToken) return back('kite=error&message=Missing%20request_token');
    try {
      await ctx.kiteAuth.completeLogin(requestToken);
      return back('kite=connected');
    } catch (err) {
      return back(`kite=error&message=${encodeURIComponent(err instanceof Error ? err.message : 'Login failed')}`);
    }
  };

  /** The Kite login URL as JSON (so the client can navigate to it). */
  const loginUrlJson: Handler = async () => ({ url: await ctx.kiteAuth.loginUrl() });

  /**
   * Complete login by submitting the request_token — used by the
   * /zerodhaRedirection page, or pasted manually (token or full redirected URL).
   */
  const session: Handler = async (req) => {
    const raw = typeof (req.body as { token?: unknown })?.token === 'string' ? (req.body as { token: string }).token : '';
    const requestToken = extractRequestToken(raw);
    if (!requestToken) throw new HttpError(400, 'Provide the request_token (or paste the full redirected URL).');
    try {
      await ctx.kiteAuth.completeLogin(requestToken);
      return { ok: true };
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'Login failed');
    }
  };

  const logout: Handler = async () => {
    await ctx.kiteAuth.logout();
    return { ok: true };
  };

  /** Instrument-master status + manual refresh from Kite. */
  const instruments: Handler = async () => {
    const [count, synced] = await Promise.all([ctx.store.instruments.count(), ctx.store.kv.get<{ at: string }>(INSTRUMENTS_SYNCED_KEY)]);
    return { count, syncedAt: synced?.value.at };
  };

  const syncInstruments: Handler = async () => {
    const count = await syncInstrumentsFromKite(ctx.kiteAuth, ctx.store);
    ctx.instrumentStore.invalidate();
    return { count, syncedAt: new Date().toISOString() };
  };

  return { status, login, loginUrlJson, callback, session, logout, instruments, syncInstruments };
}
