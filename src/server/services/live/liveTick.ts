/**
 * One scheduled evaluator pass. Called every minute by the scheduler
 * (/api/cron/tick) and, as a fallback, by any open dashboard. A DB lease
 * guarantees a single run at a time and at most one run per ~minute, no
 * matter how many callers fire.
 */
import type { LiveStatus } from '@ash/shared';
import type { DataStore } from '../../db/store';
import { childLogger } from '../../utils/logger';
import { isMarketWindow } from '../../utils/marketTime';
import type { InstrumentStore } from '../kite/instrumentStore';
import type { KiteAuthService } from '../kite/kiteAuth';
import { kiteErrorMessage } from '../kite/kiteClient';
import { syncInstrumentsIfStale } from '../kite/instrumentSync';
import { channelsFromConfig } from '../notification/NotificationService';
import type { MonitorRunResult, MonitorService } from './monitorService';

const log = childLogger('live-tick');

const LOCK = 'live-tick';
const LEASE_SECONDS = 280; // < the route's maxDuration
const MIN_INTERVAL_SECONDS = 45;
export const LAST_TICK_KEY = 'last_tick';

export interface TickDeps {
  store: DataStore;
  kiteAuth: KiteAuthService;
  instrumentStore: InstrumentStore;
  monitors: MonitorService;
}

export interface TickResult {
  ran: boolean;
  reason?: 'kite-not-connected' | 'market-closed' | 'busy' | 'no-monitors';
  at: string;
  instrumentsSynced?: boolean;
  monitors?: MonitorRunResult[];
  alerts?: number;
}

interface LastTick {
  at: string;
  monitors: number;
  alerts: number;
  errors: number;
}

export async function runLiveTick(deps: TickDeps, opts: { force?: boolean; now?: number } = {}): Promise<TickResult> {
  const now = opts.now ?? Date.now();
  const at = new Date(now).toISOString();

  if (!(await deps.kiteAuth.isConnected())) return { ran: false, reason: 'kite-not-connected', at };
  if (!opts.force && !isMarketWindow(now)) return { ran: false, reason: 'market-closed', at };
  if (!(await deps.store.locks.acquire(LOCK, LEASE_SECONDS, opts.force ? 0 : MIN_INTERVAL_SECONDS))) {
    return { ran: false, reason: 'busy', at };
  }

  try {
    let instrumentsSynced = false;
    try {
      instrumentsSynced = await syncInstrumentsIfStale(deps.kiteAuth, deps.store);
      if (instrumentsSynced) deps.instrumentStore.invalidate();
    } catch (err) {
      log.error({ err: kiteErrorMessage(err) }, 'instrument sync failed; continuing with stored master');
    }

    const results = await deps.monitors.runAll(now);
    const alerts = results.reduce((n, r) => n + r.alerts, 0);
    const summary: LastTick = { at, monitors: results.length, alerts, errors: results.filter((r) => r.error).length };
    await deps.store.kv.set(LAST_TICK_KEY, summary);
    log.info(summary, 'live tick complete');
    return { ran: true, reason: results.length ? undefined : 'no-monitors', at, instrumentsSynced, monitors: results, alerts };
  } finally {
    await deps.store.locks.release(LOCK);
  }
}

/** Evaluator health for the UI. */
export async function liveStatus(deps: TickDeps, now = Date.now()): Promise<LiveStatus> {
  const [kiteConnected, active, last] = await Promise.all([
    deps.kiteAuth.isConnected(),
    deps.store.configs.listActive(),
    deps.store.kv.get<LastTick>(LAST_TICK_KEY),
  ]);
  return {
    kiteConnected,
    marketOpen: isMarketWindow(now, 0),
    activeMonitors: active.length,
    lastRunAt: last?.value.at,
    lastRunSummary: last ? { monitors: last.value.monitors, alerts: last.value.alerts, errors: last.value.errors } : undefined,
    channels: channelsFromConfig().map((c) => c.name),
  };
}
