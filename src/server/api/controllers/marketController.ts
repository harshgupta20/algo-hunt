import type { Universe } from '@/shared/market/types';
import type { AppContext } from '../context';
import { HttpError, type Handler } from '../http';
import { MarketError, MarketService, type MarketDeps } from '../../market/MarketService';

const UNIVERSES: Universe[] = ['nifty50', 'nifty100', 'nifty500', 'midcap150', 'smallcap250', 'fno'];

/** The market eagle view (/market): read-only market data from Kite and free public sources. */
export function marketController(ctx: AppContext) {
  const deps: MarketDeps = {
    kite: (fn) => ctx.kiteAuth.call(fn),
    v2: {
      alerts: (q) => ctx.v2.service.alerts(q),
      products: (f) => ctx.v2.service.products(f),
      instrumentsFor: (id) => ctx.v2.service.instrumentsFor(id),
    },
  };
  const service = new MarketService(deps);
  const wrap =
    (fn: Handler): Handler =>
    async (req) => {
      try {
        return await fn(req);
      } catch (err) {
        if (err instanceof MarketError) throw new HttpError(err.status, err.message);
        throw err;
      }
    };

  return {
    overview: wrap(() => service.overview()),
    map: wrap((req) => {
      const u = (req.query.get('universe') ?? 'nifty500') as Universe;
      if (!UNIVERSES.includes(u)) throw new HttpError(400, `universe must be one of ${UNIVERSES.join(', ')}`);
      return service.map(u);
    }),
    movers: wrap(() => service.movers()),
    options: wrap(() => service.options()),
    global: wrap(() => service.global()),
    news: wrap(() => service.news()),
    calendar: wrap(() => service.calendar()),
    company: wrap((req) => service.company(String(req.params.symbol ?? '').toUpperCase())),
  };
}
