import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionToken, safeEqual } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const password = process.env.APP_PASSWORD;
  if (!password) return Response.json({ error: 'APP_PASSWORD is not configured on the server.' }, { status: 503 });

  let supplied = '';
  try {
    supplied = String(((await request.json()) as { password?: unknown }).password ?? '');
  } catch {
    /* empty / invalid body */
  }
  if (!safeEqual(supplied, password)) {
    await new Promise((r) => setTimeout(r, 600)); // blunt brute-force attempts
    return Response.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const res = Response.json({ ok: true });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${await createSessionToken(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
  );
  return res;
}
