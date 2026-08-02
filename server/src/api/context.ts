/**
 * Dependency container passed to route handlers, keeping the API layer thin and
 * free of business logic (all of which lives in the services/worker).
 */
import type { DataStore } from '../db/index.js';
import type { StrategyEngine } from '../services/strategy/StrategyEngine.js';
import type { InstrumentStore } from '../services/kite/instrumentStore.js';
import type { AlertService } from '../services/history/alertService.js';
import type { MarketWorker } from '../workers/marketWorker.js';
import type { BacktestRunner } from '../services/analyzer/backtestRunner.js';
import type { KiteAuthManager } from '../services/kite/kiteAuth.js';

export interface AppContext {
  store: DataStore;
  engine: StrategyEngine;
  instrumentStore: InstrumentStore;
  alertService: AlertService;
  worker: MarketWorker;
  analyzer: BacktestRunner;
  /** Present only when MARKET_PROVIDER=kite. */
  kiteAuth?: KiteAuthManager;
}
