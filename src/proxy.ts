/**
 * Access control for the whole app (Next.js 16 proxy, Node runtime).
 *  - Pages + /api require the password session cookie (see /login). The home page `/` is the public
 *    landing page; /login skips its form when the browser is already signed in.
 *  - /api/cron/* is authenticated by CRON_SECRET inside the route instead.
 *  - With APP_PASSWORD unset: open in development, refused in production.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './server/auth/session';

// `/` is the product landing page: no app data on it, so anyone can open it.
const PUBLIC_PATHS = ['/', '/api/auth/login', '/api/health'];

/** Where signing in leads: the `next` page when it's on this site (and not /login itself), else the app. */
function afterSignIn(request: NextRequest): URL {
  const next = request.nextUrl.searchParams.get('next');
  const ok = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login');
  return new URL(ok ? next : '/v2', request.url);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/api/cron/')) return NextResponse.next();

  const password = process.env.APP_PASSWORD;
  if (pathname === '/login') {
    // Already signed in (or no password needed, in development): straight into the app.
    const signedIn = password ? await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, password) : process.env.NODE_ENV !== 'production';
    return signedIn ? NextResponse.redirect(afterSignIn(request)) : NextResponse.next();
  }
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
  // App icons (icon.png, apple-icon.png) stay public so the login page and browser tab can show them.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)'],
};
