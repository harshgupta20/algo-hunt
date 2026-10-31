import type { AppContext } from '../context';
import { HttpError, type Handler } from '../http';

/** Upstox login (the V2 Options backtest): status, login page, the redirect's code, logout. */
export function upstoxController(ctx: AppContext) {
  const status: Handler = () => ctx.upstoxAuth.status();

  /** Start the login: redirect the browser to Upstox's login page (it returns to /redirect/upstox). */
  const login: Handler = async () => {
    try {
      return Response.redirect(ctx.upstoxAuth.loginUrl(), 302);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'Upstox login is not available');
    }
  };

  /** The login URL as JSON (so the client can navigate to it). */
  const loginUrlJson: Handler = async () => {
    try {
      return { url: ctx.upstoxAuth.loginUrl() };
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'Upstox login is not available');
    }
  };

  /** Complete the login with the redirect's `code` and `state` (sent by the /redirect/upstox page). */
  const session: Handler = async (req) => {
    const body = (req.body ?? {}) as { code?: unknown; state?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const state = typeof body.state === 'string' ? body.state.trim() : '';
    if (!code || !state) throw new HttpError(400, 'The Upstox redirect had no code / state — use “Connect Upstox” again.');
    try {
      await ctx.upstoxAuth.completeLogin(code, state);
      return { ok: true };
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'Upstox login failed');
    }
  };

  const logout: Handler = async () => {
    await ctx.upstoxAuth.logout();
    return { ok: true };
  };

  return { status, login, loginUrlJson, session, logout };
}
