import { z } from 'zod';
import type { ConnectionConfig, StrategyDefinition } from '@/shared/v2';
import { calendarSchema, connectionConfigSchema, settingsSchema, strategyDefinitionSchema } from '@/shared/v2';
import type { AppContext } from '../context';
import { created, type Handler } from '../http';
import { parse } from '../schemas';
import { V2ServiceError } from '../../v2';

/** Service errors carry validation issues — return them alongside the message. */
function wrap(h: Handler): Handler {
  return async (req) => {
    try {
      return await h(req);
    } catch (err) {
      if (err instanceof V2ServiceError) return Response.json({ error: err.message, issues: err.issues }, { status: err.status });
      throw err;
    }
  };
}

const definition: z.ZodType<StrategyDefinition> = strategyDefinitionSchema;
const config: z.ZodType<ConnectionConfig> = connectionConfigSchema;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const expiry = z.union([z.object({ mode: z.enum(['CURRENT', 'NEXT', 'FAR']) }), z.object({ mode: z.literal('SPECIFIC'), date: isoDate })]);

export function v2Controller(ctx: AppContext) {
  const svc = () => ctx.v2.service;
  const num = (v: string | null) => (v ? Number(v) : undefined);
  const str = (v: string | null) => v ?? undefined;

  const handlers = {
    status: () => svc().status(),
    products: (req) =>
      svc().products({
        search: str(req.query.get('search')),
        kind: str(req.query.get('kind')),
        market: str(req.query.get('market')),
        ids: req.query.get('ids')?.split(',').filter(Boolean),
        limit: num(req.query.get('limit')),
      }),
    product: (req) => svc().product(req.params.id!),
    syncProducts: () => svc().syncProducts(),

    listStrategies: () => svc().listStrategies(),
    getStrategy: (req) => svc().getStrategy(req.params.id!),
    createStrategy: async (req) => created(await svc().createStrategy(parse(z.object({ definition }), req.body).definition)),
    updateStrategy: (req) => svc().updateStrategy(req.params.id!, parse(z.object({ definition }), req.body).definition),
    removeStrategy: async (req) => {
      await svc().removeStrategy(req.params.id!);
    },
    duplicateStrategy: async (req) => created(await svc().duplicateStrategy(req.params.id!)),
    versions: (req) => svc().versions(req.params.id!),
    validateStrategy: (req) => svc().validateStrategy(parse(z.object({ definition }), req.body).definition),

    listConnections: (req) => svc().listConnections(str(req.query.get('strategyId'))),
    createConnections: async (req) => {
      const b = parse(z.object({ strategyId: z.string().uuid(), productIds: z.array(z.string()).min(1).max(50), config }), req.body);
      return created(await svc().createConnections(b.strategyId, b.productIds, b.config));
    },
    validateConnection: (req) => {
      const b = parse(z.object({ strategyId: z.string().uuid(), productId: z.string(), config }), req.body);
      return svc().validateConnection(b.strategyId, b.productId, b.config);
    },
    previewConnection: (req) => {
      const b = parse(z.object({ strategyId: z.string().optional(), definition: definition.optional(), productId: z.string(), config }), req.body);
      return svc().previewConnection(b);
    },
    updateConnection: (req) => svc().updateConnection(req.params.id!, parse(z.object({ config }), req.body).config),
    removeConnection: async (req) => {
      await svc().removeConnection(req.params.id!);
    },
    enableConnection: (req) => svc().enableConnection(req.params.id!),
    disableConnection: (req) => svc().disableConnection(req.params.id!),
    units: (req) => svc().units(req.params.id!),
    explainConnection: (req) => svc().explainConnection(req.params.id!),
    explainDraft: (req) => svc().explainDraft(parse(z.object({ definition, productId: z.string(), config: config.optional() }), req.body)),

    compare: (req) =>
      svc().compare(
        parse(
          z.object({
            strategyId: z.string().optional(),
            definition: definition.optional(),
            products: z.array(z.string()).min(1).max(20),
            from: isoDate,
            to: isoDate,
            expiry: expiry.optional(),
            strikeShift: z.number().int().min(-10).max(10).optional(),
            trigger: z.enum(['ON_TRANSITION', 'WHILE_TRUE']).optional(),
            cooldownMinutes: z.number().int().min(1).max(10_080).nullable().optional(),
          }),
          req.body,
        ),
      ),

    alerts: (req) =>
      svc().alerts({
        connectionId: str(req.query.get('connectionId')),
        strategyId: str(req.query.get('strategyId')),
        active: req.query.get('active') === '1',
        limit: num(req.query.get('limit')),
      }),
    acknowledge: (req) => svc().acknowledge(req.params.id!),
    signals: (req) => svc().signals({ connectionId: str(req.query.get('connectionId')), strategyId: str(req.query.get('strategyId')), limit: num(req.query.get('limit')) }),

    scan: (req) => svc().scan({ force: parse(z.object({ force: z.boolean().optional() }), req.body ?? {}).force }),
    scanRuns: (req) => svc().scanRuns(num(req.query.get('limit'))),

    settings: () => svc().settings(),
    saveSettings: (req) => svc().saveSettings(parse(settingsSchema, req.body)),
    calendar: () => svc().calendarEntries(),
    saveCalendar: (req) => svc().saveCalendar(parse(z.object({ entries: calendarSchema }), req.body).entries),
    channels: () => svc().channelStatus(),
    testChannel: (req) => svc().testChannel(parse(z.object({ channel: z.enum(['telegram', 'email']) }), req.body).channel),
  } satisfies Record<string, Handler>;

  return Object.fromEntries(Object.entries(handlers).map(([k, h]) => [k, wrap(h as Handler)])) as Record<keyof typeof handlers, Handler>;
}
