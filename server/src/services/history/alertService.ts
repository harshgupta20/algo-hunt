/**
 * Turns a strategy match into the ONE combined, persisted alert and delivers
 * it through the notification service. Also the read-side for history/analytics.
 */
import type {
  Alert,
  AlertConfiguration,
  AlertHistoryFilters,
  AnalyticsSummary,
  InstrumentTriplet,
  StrategyDef,
  StrategyMatch,
} from '@ash/shared';
import type { DataStore } from '../../db/index.js';
import type { NotificationService } from '../notification/NotificationService.js';
import type { StrategyMatchResult } from '../strategy/customEvaluator.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger('alert-service');

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round2opt(n: number | undefined): number | undefined {
  return n === undefined ? undefined : round2(n);
}

export class AlertService {
  constructor(
    private readonly store: DataStore,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Persist and dispatch the alert for a strategy match. Returns null if an
   * alert for this (config, bucket, scenario) already exists (dedupe).
   */
  async record(
    config: AlertConfiguration,
    triplet: InstrumentTriplet,
    match: StrategyMatch,
  ): Promise<Alert | null> {
    const { future, call, put } = match.readings;
    const newAlert = {
      configId: config.id,
      underlying: config.underlying,
      expiry: config.expiryDate ?? '',
      strike: triplet.strike,
      timeframe: config.timeframe,
      strategy: match.strategy,
      scenario: match.scenario,
      bucket: match.bucket,
      snapshot: {
        futureRsi: round2(future.curr),
        callRsi: round2(call.curr),
        putRsi: round2(put.curr),
        futurePrevRsi: round2opt(future.prev),
        callPrevRsi: round2opt(call.prev),
        putPrevRsi: round2opt(put.prev),
      },
      triggeredAt: new Date().toISOString(),
      title: `${config.underlying} Strategy Triggered`,
      groupId: config.groupId,
      groupName: config.groupName,
    };

    const saved = await this.store.alerts.insert(newAlert);
    if (!saved) return null;

    log.info(
      { alertId: saved.id, underlying: saved.underlying, scenario: saved.scenario, bucket: saved.bucket },
      'strategy alert recorded',
    );
    await this.notifications.notify(saved);
    return saved;
  }

  /**
   * Persist and dispatch an alert from a CUSTOM (builder) strategy, carrying the
   * per-condition trace as the explanation. Returns null on dedupe.
   */
  async recordCustom(
    config: AlertConfiguration,
    triplet: InstrumentTriplet,
    def: StrategyDef,
    match: StrategyMatchResult,
    bucket: number,
  ): Promise<Alert | null> {
    // Best-effort RSI snapshot from the trace (for shared alert widgets).
    const snapshot = { futureRsi: 0, callRsi: 0, putRsi: 0 };
    for (const t of match.traces) {
      if (t.instrument === 'future') snapshot.futureRsi = round2(t.curr);
      else if (t.instrument === 'call') snapshot.callRsi = round2(t.curr);
      else if (t.instrument === 'put') snapshot.putRsi = round2(t.curr);
    }

    const saved = await this.store.alerts.insert({
      configId: config.id,
      underlying: config.underlying,
      expiry: config.expiryDate ?? '',
      strike: triplet.strike,
      timeframe: config.timeframe,
      strategy: def.id,
      bucket,
      snapshot,
      triggeredAt: new Date(bucket).toISOString(),
      title: `${config.underlying} · ${def.name}`,
      strategyId: def.id,
      strategyName: def.name,
      variant: match.variant,
      conditions: match.traces,
      groupId: config.groupId,
      groupName: config.groupName,
    });
    if (!saved) return null;

    log.info({ alertId: saved.id, strategy: def.name, variant: match.variant, bucket }, 'custom strategy alert recorded');
    await this.notifications.notify(saved);
    return saved;
  }

  list(filters: AlertHistoryFilters): Promise<Alert[]> {
    return this.store.alerts.list(filters);
  }

  getById(id: string): Promise<Alert | null> {
    return this.store.alerts.getById(id);
  }

  analytics(): Promise<AnalyticsSummary> {
    return this.store.alerts.analytics();
  }
}
