/**
 * Signs the trader in: the web app's session cookie is `<expiresAtMs>.<HMAC-SHA256(APP_PASSWORD, "ash-session:" + expiresAtMs)>`
 * (src/server/auth/session.ts) — the desktop app knows the password, so it makes the cookie itself.
 */
import { createHmac } from 'node:crypto';

export const SESSION_COOKIE = 'ash_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionCookie(password: string, now = Date.now()): { value: string; expires: number } {
  const exp = now + TTL_MS;
  const sig = createHmac('sha256', password).update(`ash-session:${exp}`).digest('hex');
  return { value: `${exp}.${sig}`, expires: Math.floor(exp / 1000) };
}
