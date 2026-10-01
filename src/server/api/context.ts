/**
 * Dependency container for route handlers — the ONLY place the services are
 * wired together. Built lazily once per serverless instance and cached on
 * globalThis, keeping the API layer thin. A dev hot reload re-evaluates this
 * module (it imports every service), so in development the container is rebuilt
 * with the new code; the Postgres pool and the in-memory app state (runtime.ts)
 * have their own globalThis caches and survive it.
 */
import { createAppStore, type AppStore } from '../db/appStore';
import { KiteAuthService } from '../services/kite/kiteAuth';
import { KiteHistoricalProvider } from '../services/kite/KiteHistoricalProvider';
import { createV2Module, type V2Module } from '../v2';

export interface AppContext {
  /** Kite login session + UI preferences. */
  store: AppStore;
  kiteAuth: KiteAuthService;
  /** Kite historical candles with the shared ~3 requests/s gate (the in-app live worker uses the same one). */
  historical: KiteHistoricalProvider;
  /** V2: product-agnostic strategies + product connections (alerts). */
  v2: V2Module;
}

function build(): AppContext {
  const store = createAppStore();
  const kiteAuth = new KiteAuthService(store);
  const historical = new KiteHistoricalProvider(kiteAuth);
  const v2 = createV2Module({ kiteAuth, historical });
  return { store, kiteAuth, historical, v2 };
}

/** New on every evaluation of this module — i.e. after a dev hot reload of any service it wires. */
const BUILD = Symbol('app-context');
const globalForCtx = globalThis as unknown as { __ashContext?: AppContext; __ashContextBuild?: symbol };

export function getContext(): AppContext {
  // Rebuilt only in development (new code after a hot reload). In production one container serves the whole
  // process — the live worker (started from instrumentation, possibly another copy of this module) shares it.
  const stale = process.env.NODE_ENV !== 'production' && globalForCtx.__ashContextBuild !== BUILD;
  if (!globalForCtx.__ashContext || stale) {
    globalForCtx.__ashContext = build();
    globalForCtx.__ashContextBuild = BUILD;
  }
  return globalForCtx.__ashContext;
}
