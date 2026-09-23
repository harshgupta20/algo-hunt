/**
 * The REST API: every /api/* path (except cron + auth) is dispatched through
 * the router in src/server/api/routes.ts.
 */
import { getContext } from '@/server/api/context';
import { dispatch, type Router } from '@/server/api/http';
import { createRouter } from '@/server/api/routes';

// Kite historical backfills for the analyzer can take a while (rate-limited API).
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

let router: Router | undefined;

async function handle(request: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  router ??= createRouter(getContext());
  const { path } = await ctx.params;
  return dispatch(router, request, path);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
