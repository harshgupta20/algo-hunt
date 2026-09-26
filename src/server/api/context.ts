/**
 * Dependency container for route handlers — the ONLY place the services are
 * wired together. Built lazily once per serverless instance (and cached on
 * globalThis so dev hot-reloads don't leak pools), keeping the API layer thin.
 */
import type { DataStore } from '../db/store';
import { PgDataStore } from '../db/pg/pgStore';
import { StrategyEngine, createStrategyEngine } from '../services/strategy/StrategyEngine';
import { InstrumentStore } from '../services/kite/instrumentStore';
import { KiteAuthService } from '../services/kite/kiteAuth';
import { KiteHistoricalProvider } from '../services/kite/KiteHistoricalProvider';
import { kiteInstrumentSource, syncInstrumentsFromKite } from '../services/kite/instrumentSync';
import { AlertService } from '../services/history/alertService';
import { NotificationService, channelsFromConfig } from '../services/notification/NotificationService';
import { BacktestRunner } from '../services/analyzer/backtestRunner';
import { MonitorService } from '../services/live/monitorService';
import type { TickDeps } from '../services/live/liveTick';
import { createMcxModule, type McxModule } from '../mcx';
import { createV2Module, type V2Module } from '../v2';

export interface AppContext extends TickDeps {
  store: DataStore;
  engine: StrategyEngine;
  instrumentStore: InstrumentStore;
  alertService: AlertService;
  monitors: MonitorService;
  analyzer: BacktestRunner;
  kiteAuth: KiteAuthService;
  /** MCX V2 (isolated subsystem; shares only the Kite session + historical rate gate). */
  mcx: McxModule;
  /** V2: product-agnostic strategies + product connections (isolated; shares only the Kite session + rate gate). */
  v2: V2Module;
}

function build(): AppContext {
  const store = new PgDataStore();
  const engine = createStrategyEngine();

  // After each Kite login, refresh the instrument master (Kite republishes it daily).
  const kiteAuth = new KiteAuthService(store, async () => {
    await syncInstrumentsFromKite(kiteAuth, store);
    instrumentStore.invalidate();
  });
  const instrumentStore = new InstrumentStore(kiteInstrumentSource(kiteAuth, store));

  const historical = new KiteHistoricalProvider(kiteAuth);
  const notifications = new NotificationService(store, channelsFromConfig());
  const alertService = new AlertService(store, notifications);
  const monitors = new MonitorService({ store, instrumentStore, engine, alertService, historical });
  // Analyzer reuses the SAME engine + instrument store as live monitoring.
  const analyzer = new BacktestRunner(historical, instrumentStore, engine, store);

  const mcx = createMcxModule({ kiteAuth, historical });
  const v2 = createV2Module({ kiteAuth, historical });

  return { store, engine, instrumentStore, alertService, monitors, analyzer, kiteAuth, mcx, v2 };
}

const globalForCtx = globalThis as unknown as { __ashContext?: AppContext };

export function getContext(): AppContext {
  globalForCtx.__ashContext ??= build();
  return globalForCtx.__ashContext;
}
