import { SESSION_COOKIE } from '@/server/auth/session';

export async function POST(): Promise<Response> {
  const res = Response.json({ ok: true });
  res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
