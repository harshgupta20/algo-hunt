/**
 * Postgres implementation of McxStore on the mcx_* tables (migration 006).
 * bigint columns come back as strings from node-postgres and are converted here.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  CalendarEntry,
  McxAlert,
  McxDelivery,
  McxInstrument,
  McxScanRun,
  McxSettings,
  McxSignal,
  McxStrategy,
  McxStrategyDefinition,
  McxStrategyVersion,
  UnitState,
} from '@/shared/mcx';
import { DEFAULT_MCX_SETTINGS } from '@/shared/mcx';
import { getPool } from '../../db/pool';
import type { AlertFilters, McxStore } from './McxStore';

/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

function mapInstrument(r: any): McxInstrument {
  return {
    id: `MCX:${r.token}`,
    token: Number(r.token),
    exchange: 'MCX',
    instrumentType: r.instrument_type,
    underlying: r.underlying,
    symbol: r.symbol,
    expiry: r.expiry ?? null,
    strike: num(r.strike),
    optionType: r.option_type ?? null,
    lotSize: Number(r.lot_size),
    tickSize: Number(r.tick_size),
    active: r.active,
  };
}

function mapStrategy(r: any): McxStrategy {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    enabledAt: iso(r.enabled_at),
    version: Number(r.current_version),
    definition: r.definition,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

function mapUnit(r: any): UnitState {
  return {
    strategyId: r.strategy_id,
    targetInstrumentId: r.target_instrument_id,
    state: r.state,
    lastEvaluatedCandle: num(r.last_evaluated_candle),
    lastResult: r.last_result ?? null,
    lastSignalCandle: num(r.last_signal_candle),
    lastAlertAt: iso(r.last_alert_at),
    cooldownUntil: iso(r.cooldown_until),
    lastEvaluation: r.last_evaluation ?? null,
    updatedAt: iso(r.updated_at) ?? undefined,
  };
}

function mapSignal(r: any): McxSignal {
  return {
    id: r.id,
    identity: r.identity,
    strategyId: r.strategy_id,
    version: Number(r.version),
    targetInstrumentId: r.target_instrument_id,
    triggerTimeframe: r.trigger_timeframe,
    candleTime: Number(r.candle_time),
    signalType: r.signal_type,
    outcome: r.outcome,
    evaluation: r.evaluation,
    createdAt: iso(r.created_at)!,
  };
}

function mapAlert(r: any, deliveries: McxDelivery[]): McxAlert {
  return {
    id: r.id,
    signalId: r.signal_id,
    strategyId: r.strategy_id,
    strategyName: r.strategy_name,
    version: Number(r.version),
    status: r.status,
    instrument: r.instrument,
    triggerTimeframe: r.trigger_timeframe,
    candleTime: Number(r.candle_time),
    price: num(r.price),
    evaluation: r.evaluation,
    deliveries,
    acknowledgedAt: iso(r.acknowledged_at),
    createdAt: iso(r.created_at)!,
  };
}

const STRATEGY_SELECT = `SELECT s.*, v.definition FROM mcx_strategies s
  JOIN mcx_strategy_versions v ON v.strategy_id = s.id AND v.version = s.current_version`;

export class PgMcxStore implements McxStore {
  constructor(private readonly poolFn: () => pg.Pool = getPool) {}

  private get pool(): pg.Pool {
    return this.poolFn();
  }

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  instruments = {
    replaceAll: (list: McxInstrument[]) =>
      this.tx(async (c) => {
        await c.query('DELETE FROM mcx_instruments');
        for (let i = 0; i < list.length; i += 5000) {
          const rows = list.slice(i, i + 5000);
          await c.query(
            `INSERT INTO mcx_instruments (token, instrument_type, underlying, symbol, expiry, strike, option_type, lot_size, tick_size, active)
             SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::text[], $8::int[], $9::float8[], $10::bool[])
             ON CONFLICT (token) DO NOTHING`,
            [
              rows.map((r) => r.token),
              rows.map((r) => r.instrumentType),
              rows.map((r) => r.underlying),
              rows.map((r) => r.symbol),
              rows.map((r) => r.expiry),
              rows.map((r) => r.strike),
              rows.map((r) => r.optionType),
              rows.map((r) => r.lotSize),
              rows.map((r) => r.tickSize),
              rows.map((r) => r.active),
            ],
          );
        }
      }),
    list: async () => (await this.pool.query('SELECT * FROM mcx_instruments')).rows.map(mapInstrument),
    count: async () => Number((await this.pool.query('SELECT count(*)::int AS n FROM mcx_instruments')).rows[0]?.n ?? 0),
    syncedAt: async () => iso((await this.pool.query('SELECT max(synced_at) AS at FROM mcx_instruments')).rows[0]?.at),
  };

  calendar = {
    list: async (): Promise<CalendarEntry[]> =>
      (await this.pool.query('SELECT * FROM mcx_calendar ORDER BY date')).rows.map((r: any) =>
        r.kind === 'HOLIDAY'
          ? { date: r.date, kind: 'HOLIDAY', note: r.note ?? undefined }
          : { date: r.date, kind: 'SPECIAL_SESSION', openMin: Number(r.open_min), closeMin: Number(r.close_min), note: r.note ?? undefined },
      ),
    replaceAll: (entries: CalendarEntry[]) =>
      this.tx(async (c) => {
        await c.query('DELETE FROM mcx_calendar');
        for (const e of entries) {
          await c.query('INSERT INTO mcx_calendar (date, kind, open_min, close_min, note) VALUES ($1,$2,$3,$4,$5)', [
            e.date,
            e.kind,
            e.kind === 'SPECIAL_SESSION' ? e.openMin : null,
            e.kind === 'SPECIAL_SESSION' ? e.closeMin : null,
            e.note ?? null,
          ]);
        }
      }),
  };

  strategies = {
    list: async () => (await this.pool.query(`${STRATEGY_SELECT} ORDER BY s.created_at DESC`)).rows.map(mapStrategy),
    get: async (id: string) => {
      const r = (await this.pool.query(`${STRATEGY_SELECT} WHERE s.id = $1`, [id])).rows[0];
      return r ? mapStrategy(r) : null;
    },
    create: async (definition: McxStrategyDefinition) => {
      const id = randomUUID();
      await this.tx(async (c) => {
        await c.query('INSERT INTO mcx_strategies (id, name, enabled, current_version) VALUES ($1, $2, false, 1)', [id, definition.name]);
        await c.query('INSERT INTO mcx_strategy_versions (strategy_id, version, definition) VALUES ($1, 1, $2)', [id, JSON.stringify(definition)]);
      });
      return (await this.strategies.get(id))!;
    },
    update: async (id: string, definition: McxStrategyDefinition) => {
      const ok = await this.tx(async (c) => {
        const cur = (await c.query('SELECT current_version FROM mcx_strategies WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!cur) return false;
        const next = Number(cur.current_version) + 1;
        await c.query('INSERT INTO mcx_strategy_versions (strategy_id, version, definition) VALUES ($1, $2, $3)', [id, next, JSON.stringify(definition)]);
        await c.query('UPDATE mcx_strategies SET name = $2, current_version = $3, updated_at = now() WHERE id = $1', [id, definition.name, next]);
        return true;
      });
      return ok ? this.strategies.get(id) : null;
    },
    setEnabled: async (id: string, enabled: boolean, at: string) => {
      await this.pool.query(
        `UPDATE mcx_strategies SET enabled = $2, enabled_at = CASE WHEN $2 THEN $3::timestamptz ELSE enabled_at END, updated_at = now() WHERE id = $1`,
        [id, enabled, at],
      );
      return this.strategies.get(id);
    },
    remove: async (id: string) => ((await this.pool.query('DELETE FROM mcx_strategies WHERE id = $1', [id])).rowCount ?? 0) > 0,
    versions: async (id: string): Promise<McxStrategyVersion[]> =>
      (await this.pool.query('SELECT version, definition, created_at FROM mcx_strategy_versions WHERE strategy_id = $1 ORDER BY version DESC', [id])).rows.map(
        (r: any) => ({ version: Number(r.version), definition: r.definition, createdAt: iso(r.created_at)! }),
      ),
  };

  units = {
    list: async (strategyId?: string) =>
      (strategyId
        ? await this.pool.query('SELECT * FROM mcx_unit_state WHERE strategy_id = $1', [strategyId])
        : await this.pool.query('SELECT * FROM mcx_unit_state')
      ).rows.map(mapUnit),
    get: async (strategyId: string, target: string) => {
      const r = (await this.pool.query('SELECT * FROM mcx_unit_state WHERE strategy_id = $1 AND target_instrument_id = $2', [strategyId, target])).rows[0];
      return r ? mapUnit(r) : null;
    },
    upsert: async (s: UnitState) => {
      await this.pool.query(
        `INSERT INTO mcx_unit_state (strategy_id, target_instrument_id, state, last_evaluated_candle, last_result, last_signal_candle,
           last_alert_at, cooldown_until, last_evaluation, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (strategy_id, target_instrument_id) DO UPDATE SET
           state = EXCLUDED.state, last_evaluated_candle = EXCLUDED.last_evaluated_candle, last_result = EXCLUDED.last_result,
           last_signal_candle = EXCLUDED.last_signal_candle, last_alert_at = EXCLUDED.last_alert_at,
           cooldown_until = EXCLUDED.cooldown_until, last_evaluation = EXCLUDED.last_evaluation, updated_at = now()`,
        [
          s.strategyId,
          s.targetInstrumentId,
          s.state,
          s.lastEvaluatedCandle,
          s.lastResult,
          s.lastSignalCandle,
          s.lastAlertAt,
          s.cooldownUntil,
          s.lastEvaluation ? JSON.stringify(s.lastEvaluation) : null,
        ],
      );
    },
    clear: async (strategyId: string) => {
      await this.pool.query('DELETE FROM mcx_unit_state WHERE strategy_id = $1', [strategyId]);
    },
  };

  signals = {
    insert: async (s: Omit<McxSignal, 'id' | 'createdAt'>) => {
      const r = (
        await this.pool.query(
          `INSERT INTO mcx_signals (identity, strategy_id, version, target_instrument_id, trigger_timeframe, candle_time, signal_type, outcome, evaluation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (identity) DO NOTHING RETURNING *`,
          [s.identity, s.strategyId, s.version, s.targetInstrumentId, s.triggerTimeframe, s.candleTime, s.signalType, s.outcome, JSON.stringify(s.evaluation)],
        )
      ).rows[0];
      return r ? mapSignal(r) : null;
    },
    list: async (strategyId?: string, limit = 100) =>
      (strategyId
        ? await this.pool.query('SELECT * FROM mcx_signals WHERE strategy_id = $1 ORDER BY created_at DESC LIMIT $2', [strategyId, limit])
        : await this.pool.query('SELECT * FROM mcx_signals ORDER BY created_at DESC LIMIT $1', [limit])
      ).rows.map(mapSignal),
  };

  private async deliveriesFor(ids: string[]): Promise<Map<string, McxDelivery[]>> {
    const out = new Map<string, McxDelivery[]>();
    if (!ids.length) return out;
    const rows = (await this.pool.query('SELECT * FROM mcx_deliveries WHERE alert_id = ANY($1::uuid[]) ORDER BY sent_at', [ids])).rows;
    for (const r of rows as any[]) {
      const list = out.get(r.alert_id) ?? [];
      list.push({ channel: r.channel, status: r.status, error: r.error ?? undefined, sentAt: iso(r.sent_at)! });
      out.set(r.alert_id, list);
    }
    return out;
  }

  alerts = {
    insert: async (a: Omit<McxAlert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'>) => {
      const r = (
        await this.pool.query(
          `INSERT INTO mcx_alerts (signal_id, strategy_id, strategy_name, version, status, instrument, trigger_timeframe, candle_time, price, evaluation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [a.signalId, a.strategyId, a.strategyName, a.version, a.status, JSON.stringify(a.instrument), a.triggerTimeframe, a.candleTime, a.price, JSON.stringify(a.evaluation)],
        )
      ).rows[0];
      return mapAlert(r, []);
    },
    addDelivery: async (alertId: string, d: McxDelivery) => {
      await this.pool.query('INSERT INTO mcx_deliveries (alert_id, channel, status, error, sent_at) VALUES ($1,$2,$3,$4,$5)', [
        alertId,
        d.channel,
        d.status,
        d.error ?? null,
        d.sentAt,
      ]);
    },
    setStatus: async (alertId: string, status: McxAlert['status']) => {
      await this.pool.query('UPDATE mcx_alerts SET status = $2 WHERE id = $1', [alertId, status]);
    },
    acknowledge: async (alertId: string, at: string) => {
      await this.pool.query(`UPDATE mcx_alerts SET status = 'ACKNOWLEDGED', acknowledged_at = $2 WHERE id = $1`, [alertId, at]);
      return this.alerts.get(alertId);
    },
    get: async (id: string) => {
      const r = (await this.pool.query('SELECT * FROM mcx_alerts WHERE id = $1', [id])).rows[0];
      if (!r) return null;
      return mapAlert(r, (await this.deliveriesFor([id])).get(id) ?? []);
    },
    list: async (f: AlertFilters) => {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (f.strategyId) {
        vals.push(f.strategyId);
        where.push(`strategy_id = $${vals.length}`);
      }
      if (f.active) where.push('acknowledged_at IS NULL');
      vals.push(Math.min(f.limit ?? 200, 1000));
      const rows = (
        await this.pool.query(`SELECT * FROM mcx_alerts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${vals.length}`, vals)
      ).rows;
      const deliveries = await this.deliveriesFor(rows.map((r: any) => r.id));
      return rows.map((r: any) => mapAlert(r, deliveries.get(r.id) ?? []));
    },
  };

  scanRuns = {
    insert: async (run: McxScanRun) => {
      const { id, startedAt, finishedAt, status, ...summary } = run;
      await this.pool.query('INSERT INTO mcx_scan_runs (id, started_at, finished_at, status, summary) VALUES ($1,$2,$3,$4,$5)', [
        id,
        startedAt,
        finishedAt,
        status,
        JSON.stringify(summary),
      ]);
      for (const e of run.errors.slice(0, 200)) {
        await this.pool.query(
          'INSERT INTO mcx_scan_errors (run_id, strategy_id, instrument_id, condition_id, timeframe, source, message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [id, e.strategyId ?? null, e.instrumentId ?? null, e.conditionId ?? null, e.timeframe ?? null, e.source, e.message],
        );
      }
    },
    list: async (limit: number) =>
      (await this.pool.query('SELECT * FROM mcx_scan_runs ORDER BY started_at DESC LIMIT $1', [limit])).rows.map(
        (r: any): McxScanRun => ({ id: r.id, startedAt: iso(r.started_at)!, finishedAt: iso(r.finished_at)!, status: r.status, ...r.summary }),
      ),
    get: async (id: string) => {
      const r = (await this.pool.query('SELECT * FROM mcx_scan_runs WHERE id = $1', [id])).rows[0];
      return r ? ({ id: r.id, startedAt: iso(r.started_at)!, finishedAt: iso(r.finished_at)!, status: r.status, ...r.summary } as McxScanRun) : null;
    },
    prune: async (before: string) => {
      await this.pool.query('DELETE FROM mcx_scan_runs WHERE started_at < $1', [before]);
    },
  };

  settings = {
    get: async (): Promise<McxSettings> => {
      const r = (await this.pool.query(`SELECT value FROM mcx_settings WHERE key = 'settings'`)).rows[0];
      return { ...DEFAULT_MCX_SETTINGS, ...(r?.value ?? {}) };
    },
    save: async (s: McxSettings) => {
      await this.pool.query(
        `INSERT INTO mcx_settings (key, value, updated_at) VALUES ('settings', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(s)],
      );
      return s;
    },
  };

  locks = {
    // Same lease semantics as the app-wide app_locks table: free only if the previous
    // lease expired AND the last run ended at least minIntervalSeconds ago.
    acquire: async (name: string, leaseSeconds: number, minIntervalSeconds: number) => {
      const res = await this.pool.query(
        `INSERT INTO app_locks (name, locked_until) VALUES ($1, now() + make_interval(secs => $2))
         ON CONFLICT (name) DO UPDATE SET locked_until = EXCLUDED.locked_until
         WHERE app_locks.locked_until < now()
           AND (app_locks.last_run_at IS NULL OR app_locks.last_run_at < now() - make_interval(secs => $3))
         RETURNING name`,
        [name, leaseSeconds, minIntervalSeconds],
      );
      return (res.rowCount ?? 0) > 0;
    },
    release: async (name: string) => {
      await this.pool.query('UPDATE app_locks SET locked_until = now(), last_run_at = now() WHERE name = $1', [name]);
    },
  };
}
