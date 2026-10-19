/**
 * Equity module (NSE cash stocks) — independent of F&O (V2): its own strategies, engine, store and API.
 * It reuses only low-level building blocks (indicator maths, the Kite session and request queue, the database
 * pool, the logger). Wired in server/api/context.ts.
 */
import { getConfig } from '../config/index';
import { CandleCache, type DailySource } from './data/candles';
import { Universe, type UniverseDeps } from './data/universe';
import { EquityService } from './EquityService';
import { MemoryEquityStore } from './store/MemoryEquityStore';
import { PgEquityStore } from './store/PgEquityStore';

export { EquityError, EquityService } from './EquityService';

export interface EquityModule {
  service: EquityService;
}

export function createEquityModule(deps: Pick<UniverseDeps, 'kite' | 'lists' | 'fno'> & { historical: DailySource; kiteConnected: () => Promise<boolean> }): EquityModule {
  const store = getConfig().databaseUrl ? new PgEquityStore() : new MemoryEquityStore();
  const universe = new Universe({ kite: deps.kite, lists: deps.lists, fno: deps.fno });
  const candles = new CandleCache(deps.historical);
  return { service: new EquityService({ store, universe, candles, kiteConnected: deps.kiteConnected }) };
}
