/**
 * Provider factory. Selects the live-data source from configuration.
 */
import { config } from '../../config/index.js';
import { childLogger } from '../../utils/logger.js';
import type { MarketDataProvider } from './MarketDataProvider.js';
import { MockProvider } from './MockProvider.js';
import { KiteProvider } from './KiteProvider.js';
import type { HistoricalDataProvider } from './HistoricalDataProvider.js';
import { MockHistoricalProvider } from './MockHistoricalProvider.js';
import { KiteHistoricalProvider } from './KiteHistoricalProvider.js';
import type { InstrumentStore } from './instrumentStore.js';

const log = childLogger('provider-factory');

export function createMarketDataProvider(): MarketDataProvider {
  if (config.marketProvider === 'kite') {
    if (!config.kite.canLogin) {
      throw new Error(
        'MARKET_PROVIDER=kite but KITE_API_KEY / KITE_API_SECRET are not set. ' +
          'Set them in .env (the access token is obtained via login) or use MARKET_PROVIDER=mock.',
      );
    }
    log.info('using Kite Connect live provider');
    // Token may be empty here; the auth manager supplies/validates it via login.
    return new KiteProvider(config.kite.apiKey!, config.kite.accessToken ?? '');
  }
  log.info('using mock (simulated) provider');
  return new MockProvider(config.mockTickIntervalMs);
}

/** Historical-candle source, selected the same way as the live provider. */
export function createHistoricalProvider(store: InstrumentStore): HistoricalDataProvider {
  if (config.marketProvider === 'kite') {
    if (!config.kite.canLogin) {
      throw new Error('MARKET_PROVIDER=kite but KITE_API_KEY / KITE_API_SECRET are not set.');
    }
    log.info('using Kite Connect historical provider');
    return new KiteHistoricalProvider(config.kite.apiKey!, config.kite.accessToken ?? '');
  }
  log.info('using mock (synthetic) historical provider');
  return new MockHistoricalProvider(store);
}

export type { MarketDataProvider } from './MarketDataProvider.js';
export type { HistoricalDataProvider } from './HistoricalDataProvider.js';
export { InstrumentStore } from './instrumentStore.js';
export { KiteProvider } from './KiteProvider.js';
export { KiteHistoricalProvider } from './KiteHistoricalProvider.js';
export { KiteAuthManager } from './kiteAuth.js';
