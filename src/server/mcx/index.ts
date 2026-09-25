/**
 * MCX V2 module entry: builds the isolated subsystem from the app's shared
 * low-level services (Kite session + historical rate gate). V1 wires it in
 * exactly three places: the API context, the router and the cron route.
 */
import type { KiteAuthService } from '../services/kite/kiteAuth';
import type { KiteHistoricalProvider } from '../services/kite/KiteHistoricalProvider';
import { KiteMcxDataProvider } from './data/KiteMcxDataProvider';
import { McxInstrumentService } from './data/McxInstrumentService';
import { McxService } from './McxService';
import { PgMcxStore } from './persistence/PgMcxStore';

export { McxService, McxServiceError } from './McxService';

export interface McxModule {
  service: McxService;
}

export function createMcxModule(deps: { kiteAuth: KiteAuthService; historical: KiteHistoricalProvider }): McxModule {
  const store = new PgMcxStore();
  const provider = new KiteMcxDataProvider(deps.kiteAuth, deps.historical);
  const instruments = new McxInstrumentService(store, provider);
  return { service: new McxService({ store, provider, instruments }) };
}
