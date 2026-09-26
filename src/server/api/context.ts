/**
 * Dependency container for route handlers — the ONLY place the services are
 * wired together. Built lazily once per serverless instance (and cached on
 * globalThis so dev hot-reloads don't leak pools), keeping the API layer thin.
 */
import { PgAppStore, type AppStore } from '../db/appStore';
import { KiteAuthService } from '../services/kite/kiteAuth';
import { KiteHistoricalProvider } from '../services/kite/KiteHistoricalProvider';
import { createV2Module, type V2Module } from '../v2';

export interface AppContext {
  /** Kite login session + UI preferences. */
  store: AppStore;
  kiteAuth: KiteAuthService;
  /** V2: product-agnostic strategies + product connections (alerts). */
  v2: V2Module;
}

function build(): AppContext {
  const store = new PgAppStore();
  const kiteAuth = new KiteAuthService(store);
  const historical = new KiteHistoricalProvider(kiteAuth);
  const v2 = createV2Module({ kiteAuth, historical });
  return { store, kiteAuth, v2 };
}

const globalForCtx = globalThis as unknown as { __ashContext?: AppContext };

export function getContext(): AppContext {
  globalForCtx.__ashContext ??= build();
  return globalForCtx.__ashContext;
}
