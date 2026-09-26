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
  const ctx = getContext();
  let live: unknown;
  let status = 200;
  try {
    live = await runLiveTick(ctx, { force });
  } catch (err) {
    live = { error: err instanceof Error ? err.message : String(err) };
    status = 500;
  }
  // MCX V2 runs as an isolated second job with its own lease: a failure here never affects V1 (and vice versa).
  let mcxV2: unknown;
  try {
    const { run, skipped } = await ctx.mcx.service.scan({ force });
    mcxV2 = { status: run.status, skipped, units: run.unitsEvaluated, alerts: run.alerts, errors: run.errors.length };
  } catch (err) {
    mcxV2 = { error: err instanceof Error ? err.message : String(err) };
  }
  // V2 connections: a third isolated job with its own lease.
  let v2: unknown;
  try {
    const { run, skipped } = await ctx.v2.service.scan({ force });
    v2 = { status: run.status, skipped, units: run.unitsEvaluated, alerts: run.alerts, errors: run.errors.length };
  } catch (err) {
    v2 = { error: err instanceof Error ? err.message : String(err) };
  }
  return Response.json({ ...(live as object), mcxV2, v2 }, { status });
}

export { handle as GET, handle as POST };
