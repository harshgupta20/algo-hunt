/**
 * V2 module entry: builds the product-agnostic strategy system from the app's
 * shared low-level services (Kite session + historical rate gate). The rest of
 * the app wires it in at four points: the API context, the router, the cron route
 * and the live worker process (src/server/workers/v2Live.ts).
 */
import { requireKiteCredentials } from '../config/index';
import type { KiteAuthService } from '../services/kite/kiteAuth';
import type { KiteHistoricalProvider } from '../services/kite/KiteHistoricalProvider';
import type { UpstoxAuthService } from '../services/upstox/upstoxAuth';
import { getConfig } from '../config/index';
import { envChannelFactory } from './alerts/notifications';
import { KiteDataProvider } from './data/KiteDataProvider';
import { KiteStream } from './live/KiteStream';
import { LiveWorker, type LiveSession } from './live/LiveWorker';
import { ProductService } from './data/ProductService';
import { createV2Store } from './persistence/createStore';
import { memoryMode } from '../runtime';
import { V2Service } from './V2Service';
import { UpstoxHistory } from './upstox/UpstoxHistory';

export { V2Service, V2ServiceError } from './V2Service';
export { LiveWorker } from './live/LiveWorker';
export { KiteStream } from './live/KiteStream';

export interface V2Module {
  service: V2Service;
}

export function createV2Module(deps: { kiteAuth: KiteAuthService; historical: KiteHistoricalProvider; upstoxAuth?: UpstoxAuthService }): V2Module {
  const store = createV2Store();
  const provider = new KiteDataProvider(deps.kiteAuth, deps.historical);
  const products = new ProductService(store, provider);
  // The Options backtest's history: Upstox, when its keys are set.
  const upstox = deps.upstoxAuth;
  const options =
    upstox && getConfig().upstox.isConfigured
      ? {
          history: new UpstoxHistory({ api: () => upstox.api(), calendar: () => store.calendar.list() }),
          status: async () => {
            const st = await upstox.status();
            return { source: 'UPSTOX' as const, configured: st.enabled, connected: st.state === 'connected', userId: st.userId, userName: st.userName, expiresAt: st.expiresAt, lastError: st.lastError };
          },
          logout: () => upstox.logout(),
        }
      : undefined;
  return { service: new V2Service({ store, provider, products, options }) };
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
  // Inside the app the status is memory (every 5 s is free); a separate worker writes it to the database — every 20 s.
  const statusEveryMs = memoryMode() ? 5_000 : 20_000;
  return new LiveWorker({ store, provider, products, channels: envChannelFactory, stream: new KiteStream(), session: kiteLiveSession(deps.kiteAuth), statusEveryMs });
}
