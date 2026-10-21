import type { EqPreset } from '@/shared/equity';
import { EQ_PRESETS, eqBacktestRequestSchema, eqDefinitionSchema, eqScreenRequestSchema, eqWatchlistInputSchema } from '@/shared/equity';
import { EquityError } from '../../equity';
import type { AppContext } from '../context';
import type { Handler } from '../http';
import { parse } from '../schemas';

/** Service errors carry validation issues — return them alongside the message. */
function wrap(h: Handler): Handler {
  return async (req) => {
    try {
      return await h(req);
    } catch (err) {
      if (err instanceof EquityError) return Response.json({ error: err.message, issues: err.issues }, { status: err.status });
      throw err;
    }
  };
}

const PRESETS = new Set<string>(EQ_PRESETS.map((p) => p.value));

/** Equity (NSE cash stocks): universe, strategies, watchlists, backtests and screens. */
export function equityController(ctx: AppContext) {
  const svc = () => ctx.equity.service;
  const handlers = {
    stocks: (req) => {
      const preset = req.query.get('preset');
      if (preset && !PRESETS.has(preset)) return Response.json({ error: `preset must be one of ${[...PRESETS].join(', ')}` }, { status: 400 });
      const limit = Number(req.query.get('limit') ?? 200);
      const symbols = req.query.get('symbols');
      return svc().stocks({
        search: req.query.get('search') ?? undefined,
        preset: (preset as EqPreset | null) ?? undefined,
        symbols: symbols ? symbols.split(',').filter(Boolean) : undefined,
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : 200,
      });
    },
    presets: () => svc().presets(),
    templates: () => svc().templates(),

    listStrategies: () => svc().listStrategies(),
    getStrategy: (req) => svc().getStrategy(req.params.id!),
    createStrategy: async (req) => Response.json(await svc().createStrategy(parse(eqDefinitionSchema, req.body)), { status: 201 }),
    updateStrategy: (req) => svc().updateStrategy(req.params.id!, parse(eqDefinitionSchema, req.body)),
    duplicateStrategy: async (req) => Response.json(await svc().duplicateStrategy(req.params.id!), { status: 201 }),
    removeStrategy: async (req) => {
      await svc().removeStrategy(req.params.id!);
      return undefined;
    },
    validate: (req) => svc().validate(parse(eqDefinitionSchema, req.body)),

    listWatchlists: () => svc().listWatchlists(),
    createWatchlist: async (req) => Response.json(await svc().createWatchlist(parse(eqWatchlistInputSchema, req.body)), { status: 201 }),
    updateWatchlist: (req) => svc().updateWatchlist(req.params.id!, parse(eqWatchlistInputSchema, req.body)),
    removeWatchlist: async (req) => {
      await svc().removeWatchlist(req.params.id!);
      return undefined;
    },

    startBacktest: (req) => svc().startBacktest(parse(eqBacktestRequestSchema, req.body)),
    latestBacktest: async () => svc().latestBacktest(),
    backtestJob: async (req) => svc().backtestJob(req.params.id!),
    cancelBacktest: async (req) => svc().cancelBacktest(req.params.id!),
    backtestHistory: () => svc().backtestHistory(),
    backtestRecord: (req) => svc().backtestRecord(req.params.id!),
    removeBacktestRecord: async (req) => {
      await svc().removeBacktestRecord(req.params.id!);
      return undefined;
    },

    startScreen: (req) => svc().startScreen(parse(eqScreenRequestSchema, req.body)),
    latestScreen: async () => svc().latestScreen(),
    screenJob: async (req) => svc().screenJob(req.params.id!),
    cancelScreen: async (req) => svc().cancelScreen(req.params.id!),
  } satisfies Record<string, Handler>;
  return Object.fromEntries(Object.entries(handlers).map(([k, h]) => [k, wrap(h as Handler)])) as Record<keyof typeof handlers, Handler>;
}
