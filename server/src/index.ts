/**
 * Server bootstrap: composes the data store, strategy engine, market-data
 * provider, notification pipeline and background worker, then serves the API +
 * WebSocket hub. This is the ONLY place these pieces are wired together.
 */
import http from 'node:http';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { createDataStore } from './db/index.js';
import { createStrategyEngine } from './services/strategy/StrategyEngine.js';
import {
  InstrumentStore,
  KiteAuthManager,
  createHistoricalProvider,
  createMarketDataProvider,
} from './services/kite/index.js';
import type { KiteHistoricalProvider, KiteProvider } from './services/kite/index.js';
import { WsHub } from './services/notification/wsHub.js';
import { BrowserChannel, NotificationService } from './services/notification/NotificationService.js';
import { AlertService } from './services/history/alertService.js';
import { BacktestRunner } from './services/analyzer/backtestRunner.js';
import { MarketWorker } from './workers/marketWorker.js';
import { createApp } from './api/app.js';
import type { AppContext } from './api/context.js';

async function main(): Promise<void> {
  const store = await createDataStore();
  const engine = createStrategyEngine();
  const provider = createMarketDataProvider();
  const instrumentStore = new InstrumentStore(provider);
  const hub = new WsHub();
  const notifications = new NotificationService(store, [new BrowserChannel(hub)]);
  const alertService = new AlertService(store, notifications);
  const worker = new MarketWorker({ provider, instrumentStore, engine, alertService, hub, store });
  // Analyzer reuses the SAME engine + instrument store as the live worker.
  const historical = createHistoricalProvider(instrumentStore);
  const analyzer = new BacktestRunner(historical, instrumentStore, engine, store);

  // Kite OAuth-style login (only when MARKET_PROVIDER=kite). The auth manager
  // pushes a validated token to both providers and drives (re)connection, so
  // an expired/invalid token becomes a one-click re-login instead of a crash.
  let kiteAuth: KiteAuthManager | undefined;
  if (config.marketProvider === 'kite') {
    const liveKite = provider as KiteProvider;
    const histKite = historical as KiteHistoricalProvider;
    kiteAuth = new KiteAuthManager({
      apiKey: config.kite.apiKey!,
      apiSecret: config.kite.apiSecret!,
      onToken: async (token) => {
        liveKite.setAccessToken(token);
        histKite.setAccessToken(token);
        if (worker.isLive) await liveKite.reconnect();
        else await worker.startLive();
      },
    });
    liveKite.onAuthError((reason) => {
      kiteAuth!.markNeedsLogin(reason);
      hub.broadcastStatus('disconnected');
    });
  }

  const ctx: AppContext = { store, engine, instrumentStore, alertService, worker, analyzer, kiteAuth };
  const app = createApp(ctx);
  const server = http.createServer(app);
  hub.attach(server);

  await worker.start();
  // Try to restore a saved Kite session; if invalid, the UI prompts for login.
  if (kiteAuth) await kiteAuth.init(config.kite.accessToken);

  server.listen(config.port, () => {
    logger.info(
      { provider: config.marketProvider, store: store.kind },
      `ASH server listening on http://localhost:${config.port}`,
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      await worker.stop();
      await hub.close();
      await store.close();
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
