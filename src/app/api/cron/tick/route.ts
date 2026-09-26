/**
 * Scheduled V2 scanner. Call every minute during market hours:
 *  - Vercel Cron (Pro plan) sends `Authorization: Bearer $CRON_SECRET` automatically.
 *  - Any external scheduler (e.g. cron-job.org) can send the same header, or `?secret=`.
 * `?force=1` runs outside market hours and bypasses the 45s spacing (debugging).
 * While the local live worker (`npm run live`) is streaming, this only backs it up.
 */
import { getContext } from '@/server/api/context';
import { safeEqual } from '@/server/auth/session';

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
    const { run, skipped } = await getContext().v2.service.scan({ force });
    return Response.json({ v2: { status: run.status, skipped, units: run.unitsEvaluated, alerts: run.alerts, errors: run.errors.length } });
  } catch (err) {
    return Response.json({ v2: { error: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
