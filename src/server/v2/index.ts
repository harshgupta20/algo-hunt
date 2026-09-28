/**
 * V2 module entry: builds the product-agnostic strategy system from the app's
 * shared low-level services (Kite session + historical rate gate). The rest of
 * the app wires it in at four points: the API context, the router, the cron route
 * and the live worker process (src/server/workers/v2Live.ts).
 */
import { requireKiteCredentials } from '../config/index';
import type { KiteAuthService } from '../services/kite/kiteAuth';
import type { KiteHistoricalProvider } from '../services/kite/KiteHistoricalProvider';
import { envChannelFactory } from './alerts/notifications';
import { KiteDataProvider } from './data/KiteDataProvider';
import { KiteStream } from './live/KiteStream';
import { LiveWorker, type LiveSession } from './live/LiveWorker';
import { ProductService } from './data/ProductService';
import { createV2Store } from './persistence/createStore';
import { V2Service } from './V2Service';

export { V2Service, V2ServiceError } from './V2Service';
export { LiveWorker } from './live/LiveWorker';
export { KiteStream } from './live/KiteStream';

export interface V2Module {
  service: V2Service;
}

export function createV2Module(deps: { kiteAuth: KiteAuthService; historical: KiteHistoricalProvider }): V2Module {
  const store = createV2Store();
  const provider = new KiteDataProvider(deps.kiteAuth, deps.historical);
  const products = new ProductService(store, provider);
  return { service: new V2Service({ store, provider, products }) };
}

/** The Kite session as the live worker sees it: credentials while logged in, else null. */
export function kiteLiveSession(kiteAuth: KiteAuthService): LiveSession {
  return {
    async credentials() {
      if (!(await kiteAuth.isConnected())) return null;
      return { apiKey: requireKiteCredentials().apiKey, accessToken: await kiteAuth.accessToken() };
    },
  };
}

/** The streaming live worker (`npm run live`), on the same database and Kite session as the app. */
export function createV2LiveWorker(deps: { kiteAuth: KiteAuthService; historical: KiteHistoricalProvider }): LiveWorker {
  const store = createV2Store();
  const provider = new KiteDataProvider(deps.kiteAuth, deps.historical);
  const products = new ProductService(store, provider);
  return new LiveWorker({ store, provider, products, channels: envChannelFactory, stream: new KiteStream(), session: kiteLiveSession(deps.kiteAuth) });
}
