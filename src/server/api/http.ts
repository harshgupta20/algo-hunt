/**
 * Minimal HTTP toolkit for the Next.js catch-all API route: a typed request
 * wrapper, HttpError, zod parsing, and a path-pattern router. Controllers
 * return plain data (sent as JSON) or a Response for redirects/empty bodies.
 */
import { childLogger } from '../utils/logger';
import { KiteNotConnectedError } from '../services/kite/kiteClient';

const log = childLogger('api');

/** Error carrying an intended HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ApiRequest {
  method: string;
  params: Record<string, string>;
  query: URLSearchParams;
  url: URL;
  /** Parsed JSON body (undefined when absent/empty). */
  body: unknown;
  raw: Request;
}

export type Handler = (req: ApiRequest) => Promise<unknown> | unknown;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  private add(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, segments: path.split('/').filter(Boolean), handler });
    return this;
  }
  get(path: string, h: Handler) {
    return this.add('GET', path, h);
  }
  post(path: string, h: Handler) {
    return this.add('POST', path, h);
  }
  put(path: string, h: Handler) {
    return this.add('PUT', path, h);
  }
  delete(path: string, h: Handler) {
    return this.add('DELETE', path, h);
  }

  /** First registered route whose pattern matches wins (register literals before :params). */
  match(method: string, segments: string[]): { handler: Handler; params: Record<string, string> } | 'method' | undefined {
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      const ok = r.segments.every((seg, i) => {
        const actual = segments[i]!;
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(actual);
          return true;
        }
        return seg === actual;
      });
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { handler: r.handler, params };
    }
    return pathMatched ? 'method' : undefined;
  }
}

/** Kite's SDK (and some libs) reject with plain objects, not Errors. */
function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Internal server error';
}

/** Dispatch a Request through the router, handling JSON + errors uniformly. */
export async function dispatch(router: Router, request: Request, segments: string[]): Promise<Response> {
  const url = new URL(request.url);
  const found = router.match(request.method, segments);
  if (!found) return Response.json({ error: 'Not found' }, { status: 404 });
  if (found === 'method') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      const text = await request.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new HttpError(400, 'Request body must be valid JSON');
        }
      }
    }
    const result = await found.handler({ method: request.method, params: found.params, query: url.searchParams, url, body, raw: request });
    if (result instanceof Response) return result;
    if (result === undefined) return new Response(null, { status: 204 });
    return Response.json(result);
  } catch (err) {
    // Postgres "undefined_table": the schema was never migrated on this database.
    if ((err as { code?: unknown })?.code === '42P01') {
      log.error({ err, path: url.pathname }, 'database schema missing');
      return Response.json(
        { error: 'Database tables are missing — run `npm run db:migrate` (Vercel builds run it automatically).' },
        { status: 503 },
      );
    }
    const status = err instanceof HttpError ? err.status : err instanceof KiteNotConnectedError ? 409 : 500;
    if (status >= 500) log.error({ err, path: url.pathname }, 'unhandled request error');
    return Response.json({ error: extractMessage(err) }, { status });
  }
}

export function created(data: unknown): Response {
  return Response.json(data, { status: 201 });
}
