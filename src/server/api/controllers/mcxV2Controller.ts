import { z } from 'zod';
import { mcxCalendarSchema, mcxSettingsSchema, mcxStrategyDefinitionSchema, mcxUniverseSchema } from '@/shared/mcx';
import type { McxStrategyDefinition, Universe } from '@/shared/mcx';
import type { AppContext } from '../context';
import { created, type Handler } from '../http';
import { parse } from '../schemas';
import { McxServiceError } from '../../mcx';

/** Service errors carry validation issues — return them alongside the message. */
function wrap(h: Handler): Handler {
  return async (req) => {
    try {
      return await h(req);
    } catch (err) {
      if (err instanceof McxServiceError) return Response.json({ error: err.message, issues: err.issues }, { status: err.status });
      throw err;
    }
  };
}

const definition: z.ZodType<McxStrategyDefinition> = mcxStrategyDefinitionSchema;
const universeSchema = mcxUniverseSchema as unknown as z.ZodType<Universe>;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function mcxV2Controller(ctx: AppContext) {
  const svc = () => ctx.mcx.service;
  const num = (v: string | null) => (v ? Number(v) : undefined);

  const handlers = {
    status: () => svc().status(),
    products: () => svc().products(),
    instruments: (req) =>
      svc().instruments({
        underlying: req.query.get('underlying') ?? undefined,
        expiry: req.query.get('expiry') ?? undefined,
        type: req.query.get('type') ?? undefined,
        search: req.query.get('search') ?? undefined,
        limit: num(req.query.get('limit')),
      }),
    syncInstruments: () => svc().syncInstruments(),
    previewUniverse: (req) => svc().previewUniverse(parse(z.object({ universe: universeSchema }), req.body).universe),

    listStrategies: () => svc().listStrategies(),
    getStrategy: (req) => svc().getStrategy(req.params.id!),
    createStrategy: async (req) => created(await svc().createStrategy(parse(z.object({ definition }), req.body).definition)),
    updateStrategy: (req) => svc().updateStrategy(req.params.id!, parse(z.object({ definition }), req.body).definition),
    removeStrategy: async (req) => {
      await svc().removeStrategy(req.params.id!);
    },
    duplicateStrategy: async (req) => created(await svc().duplicateStrategy(req.params.id!)),
    enable: (req) => svc().enable(req.params.id!),
    disable: (req) => svc().disable(req.params.id!),
    versions: (req) => svc().versions(req.params.id!),
    units: (req) => svc().units(req.params.id!),
    validate: (req) => {
      const b = parse(z.object({ definition, forEnable: z.boolean().optional(), resolve: z.boolean().optional() }), req.body);
      return svc().validate(b.definition, { forEnable: b.forEnable, resolve: b.resolve });
    },
    explainStrategy: (req) => svc().explain({ strategyId: req.params.id!, targetId: parse(z.object({ targetId: z.string().optional() }), req.body ?? {}).targetId }),
    explainDraft: (req) => {
      const b = parse(z.object({ definition, targetId: z.string().optional() }), req.body);
      return svc().explain({ definition: b.definition, targetId: b.targetId });
    },
    replay: (req) => {
      const b = parse(
        z.object({ strategyId: z.string().optional(), definition: definition.optional(), from: isoDate, to: isoDate, targetIds: z.array(z.string()).max(10).optional() }),
        req.body,
      );
      return svc().replay(b);
    },

    alerts: (req) =>
      svc().alerts({ strategyId: req.query.get('strategyId') ?? undefined, active: req.query.get('active') === '1', limit: num(req.query.get('limit')) }),
    alert: (req) => svc().alert(req.params.id!),
    acknowledge: (req) => svc().acknowledge(req.params.id!),
    signals: (req) => svc().signals({ strategyId: req.query.get('strategyId') ?? undefined, limit: num(req.query.get('limit')) }),

    /** Dashboard-driven scan (the lease makes it a no-op when the cron already ran this minute). */
    scan: (req) => svc().scan({ force: parse(z.object({ force: z.boolean().optional() }), req.body ?? {}).force }),
    scanRuns: (req) => svc().scanRuns(num(req.query.get('limit'))),
    scanRun: (req) => svc().scanRun(req.params.id!),

    settings: () => svc().settings(),
    saveSettings: (req) => svc().saveSettings(parse(mcxSettingsSchema, req.body)),
    calendar: () => svc().calendarEntries(),
    saveCalendar: (req) => svc().saveCalendar(parse(z.object({ entries: mcxCalendarSchema }), req.body).entries),
    channels: () => svc().channelStatus(),
    testChannel: (req) => svc().testChannel(parse(z.object({ channel: z.enum(['telegram', 'email']) }), req.body).channel),
  } satisfies Record<string, Handler>;

  return Object.fromEntries(Object.entries(handlers).map(([k, h]) => [k, wrap(h as Handler)])) as Record<keyof typeof handlers, Handler>;
}
