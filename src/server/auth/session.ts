/**
 * Dashboard session cookie: `<expiresAtMs>.<HMAC-SHA256(APP_PASSWORD, expiresAtMs)>`.
 * Uses Web Crypto only, so it runs in the proxy and in route handlers alike.
 * Changing APP_PASSWORD invalidates every existing session.
 */
export const SESSION_COOKIE = 'ash_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`ash-session:${message}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function createSessionToken(password: string, now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_TTL_SECONDS * 1000);
  return `${exp}.${await hmac(password, exp)}`;
}

export async function verifySessionToken(token: string | undefined, password: string, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sig, await hmac(password, exp));
}
