/**
 * Access control for the whole app (Next.js 16 proxy, Node runtime).
 *  - Pages + /api require the password session cookie (see /login).
 *  - /api/cron/* is authenticated by CRON_SECRET inside the route instead.
 *  - With APP_PASSWORD unset: open in development, refused in production.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './server/auth/session';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health'];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/api/cron/')) return NextResponse.next();

  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();
    return new NextResponse('APP_PASSWORD is not configured. Set it in your Vercel project environment variables.', {
      status: 503,
    });
  }

  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, password)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
