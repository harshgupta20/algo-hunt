/**
 * V2 module entry: builds the product-agnostic strategy system from the app's
 * shared low-level services (Kite session + historical rate gate). The rest of
 * the app wires it in at three points: the API context, the router and the cron route.
 */
import type { KiteAuthService } from '../services/kite/kiteAuth';
import type { KiteHistoricalProvider } from '../services/kite/KiteHistoricalProvider';
import { KiteDataProvider } from './data/KiteDataProvider';
import { ProductService } from './data/ProductService';
import { PgV2Store } from './persistence/PgV2Store';
import { V2Service } from './V2Service';

export { V2Service, V2ServiceError } from './V2Service';

export interface V2Module {
  service: V2Service;
}

export function createV2Module(deps: { kiteAuth: KiteAuthService; historical: KiteHistoricalProvider }): V2Module {
  const store = new PgV2Store();
  const provider = new KiteDataProvider(deps.kiteAuth, deps.historical);
  const products = new ProductService(store, provider);
  return { service: new V2Service({ store, provider, products }) };
}
