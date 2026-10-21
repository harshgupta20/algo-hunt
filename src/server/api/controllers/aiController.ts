import { z } from 'zod';
import { eqDefinitionSchema } from '@/shared/equity';
import type { AiFillRequest, AiSendRequest } from '@/shared/ai/types';
import { AiError } from '../../ai';
import type { AppContext } from '../context';
import type { Handler } from '../http';
import { parse } from '../schemas';

const sendSchema = z.object({
  mode: z.enum(['CHAT', 'CREATOR']).optional(),
  conversationId: z.string().min(1).max(64).optional(),
  message: z.string().trim().min(1).max(4000),
  context: z
    .object({
      page: z.enum(['equity-strategies', 'equity-builder', 'equity-backtest', 'equity-screener', 'equity-watchlists', 'other']),
      label: z.string().max(300).optional(),
      draft: z.unknown().optional(),
      strategyId: z.string().max(64).optional(),
      backtestId: z.string().max(64).optional(),
    })
    .optional(),
}) as z.ZodType<AiSendRequest>;

const fillSchema = z.object({ part: z.enum(['entry', 'exit']), text: z.string().trim().min(1).max(2000), strategy: z.unknown() });

/** Service errors carry their own status (503 not set up, 409 busy, 404 gone, 429 Groq's limit). */
function wrap(h: Handler): Handler {
  return async (req) => {
    try {
      return await h(req);
    } catch (err) {
      if (err instanceof AiError) return Response.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 });
      throw err;
    }
  };
}

/** The trading AI assistant: status (Groq's limits, today's use) and conversations. */
export function aiController(ctx: AppContext) {
  const svc = () => ctx.ai.service;
  const handlers = {
    status: () => svc().status(),
    list: (req) => svc().list(req.query.get('mode') === 'CREATOR' ? 'CREATOR' : 'CHAT'),
    send: (req) => {
      const body = parse(sendSchema, req.body);
      // The builder's strategy as typed so far: unnamed → "Unsaved strategy"; still not a strategy → left out.
      if (body.context?.draft !== undefined) {
        const raw = body.context.draft as unknown as Record<string, unknown>;
        const named = typeof raw === 'object' && raw !== null && !String(raw.name ?? '').trim() ? { ...raw, name: 'Unsaved strategy' } : raw;
        const d = eqDefinitionSchema.safeParse(named);
        body.context = { ...body.context, draft: d.success ? d.data : undefined };
        if (!d.success) delete body.context.draft;
      }
      return svc().send(body);
    },
    fill: (req) => {
      const body = parse(fillSchema, req.body);
      // The builder's strategy as typed so far (an unnamed one is fine).
      const raw = body.strategy as Record<string, unknown> | null;
      const d = eqDefinitionSchema.safeParse(raw && typeof raw === 'object' && !String(raw.name ?? '').trim() ? { ...raw, name: 'Draft' } : raw);
      if (!d.success) return Response.json({ error: 'The builder’s strategy couldn’t be read — check it for errors first' }, { status: 400 });
      const strategy = { ...d.data, name: typeof raw?.name === 'string' ? raw.name : d.data.name };
      return svc().fill({ part: body.part, text: body.text, strategy } satisfies AiFillRequest);
    },
    get: (req) => svc().get(req.params.id!),
    stop: (req) => svc().stop(req.params.id!),
    remove: (req) => {
      svc().remove(req.params.id!);
      return new Response(null, { status: 204 });
    },
  } satisfies Record<string, Handler>;
  return Object.fromEntries(Object.entries(handlers).map(([k, h]) => [k, wrap(h)])) as typeof handlers;
}
