/**
 * Scheduled live evaluator. Call every minute during market hours:
 *  - Vercel Cron (Pro plan) sends `Authorization: Bearer $CRON_SECRET` automatically.
 *  - Any external scheduler (e.g. cron-job.org) can send the same header, or `?secret=`.
 * `?force=1` runs outside market hours and bypasses the 45s spacing (debugging).
 */
import { getContext } from '@/server/api/context';
import { safeEqual } from '@/server/auth/session';
import { runLiveTick } from '@/server/services/live/liveTick';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization') ?? '';
  const query = new URL(request.url).searchParams.get('secret') ?? '';
  return safeEqual(header, `Bearer ${secret}`) || safeEqual(query, secret);
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const force = new URL(request.url).searchParams.get('force') === '1';
  try {
    return Response.json(await runLiveTick(getContext(), { force }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
