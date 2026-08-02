import type { RequestHandler } from 'express';
import type { KiteAuthStatus } from '@ash/shared';
import { config } from '../../config/index.js';
import { HttpError } from '../../middleware/errorHandler.js';
import type { AppContext } from '../context.js';

/** Accept a raw request_token OR the full redirected URL and pull the token out. */
export function extractRequestToken(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/request_token=([^&\s]+)/);
  return match ? decodeURIComponent(match[1]!) : trimmed;
}

export function kiteController(ctx: AppContext) {
  /** Auth status the UI polls to decide whether to show a "Connect Kite" prompt. */
  const status: RequestHandler = (_req, res) => {
    if (!ctx.kiteAuth) {
      const disabled: KiteAuthStatus = { enabled: false, state: 'disabled', needsLogin: false };
      res.json(disabled);
      return;
    }
    res.json(ctx.kiteAuth.status());
  };

  /** Start the login flow: redirect the browser to Kite's login page. */
  const login: RequestHandler = async (_req, res) => {
    if (!ctx.kiteAuth) throw new HttpError(400, 'Kite is not enabled (MARKET_PROVIDER is not "kite").');
    res.redirect(await ctx.kiteAuth.loginUrl());
  };

  /**
   * Kite's OAuth redirect target (set this exact URL as the app's Redirect URL).
   * Exchanges request_token → access_token, connects the live feed, then returns
   * the browser to the dashboard.
   */
  const callback: RequestHandler = async (req, res) => {
    const back = (q: string) => res.redirect(`${config.clientOrigin}/settings?${q}`);
    if (!ctx.kiteAuth) return back('kite=error&message=Kite%20not%20enabled');

    const requestToken = typeof req.query.request_token === 'string' ? req.query.request_token : '';
    const kiteStatus = req.query.status;
    if (kiteStatus && kiteStatus !== 'success') return back('kite=error&message=Login%20was%20cancelled');
    if (!requestToken) return back('kite=error&message=Missing%20request_token');

    try {
      await ctx.kiteAuth.completeLogin(requestToken);
      return back('kite=connected');
    } catch (err) {
      const msg = encodeURIComponent(err instanceof Error ? err.message : 'Login failed');
      return back(`kite=error&message=${msg}`);
    }
  };

  /** The Kite login URL as JSON (so the client can open it in a popup/new tab). */
  const loginUrlJson: RequestHandler = async (_req, res) => {
    if (!ctx.kiteAuth) throw new HttpError(400, 'Kite is not enabled (MARKET_PROVIDER is not "kite").');
    res.json({ url: await ctx.kiteAuth.loginUrl() });
  };

  /**
   * Complete login by submitting the request_token manually — works with ANY
   * Kite Redirect URL (the user pastes the token, or the whole redirected URL).
   */
  const session: RequestHandler = async (req, res) => {
    if (!ctx.kiteAuth) throw new HttpError(400, 'Kite is not enabled (MARKET_PROVIDER is not "kite").');
    const raw = typeof (req.body as { token?: unknown })?.token === 'string' ? (req.body as { token: string }).token : '';
    const requestToken = extractRequestToken(raw);
    if (!requestToken) throw new HttpError(400, 'Provide the request_token (or paste the full redirected URL).');
    try {
      await ctx.kiteAuth.completeLogin(requestToken);
      res.json({ ok: true });
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'Login failed');
    }
  };

  const logout: RequestHandler = (_req, res) => {
    ctx.kiteAuth?.logout();
    res.json({ ok: true });
  };

  return { status, login, loginUrlJson, callback, session, logout };
}
