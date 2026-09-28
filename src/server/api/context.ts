/**
 * Dependency container for route handlers — the ONLY place the services are
 * wired together. Built lazily once per serverless instance and cached on
 * globalThis, keeping the API layer thin. A dev hot reload re-evaluates this
 * module (it imports every service), so the container is rebuilt with the new
 * code; the Postgres pool has its own globalThis cache and is reused.
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

/** New on every evaluation of this module — i.e. after a dev hot reload of any service it wires. */
const BUILD = Symbol('app-context');
const globalForCtx = globalThis as unknown as { __ashContext?: AppContext; __ashContextBuild?: symbol };

export function getContext(): AppContext {
  if (!globalForCtx.__ashContext || globalForCtx.__ashContextBuild !== BUILD) {
    globalForCtx.__ashContext = build();
    globalForCtx.__ashContextBuild = BUILD;
  }
  return globalForCtx.__ashContext;
}
