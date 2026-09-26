/**
 * Postgres implementation of V2Store on the v2_* tables (migration 007).
 * bigint columns come back as strings from node-postgres and are converted here.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  CalendarEntry,
  ConnectionConfig,
  Delivery,
  ScanRun,
  StrategyDefinition,
  UnitState,
  V2Alert,
  V2Connection,
  V2Instrument,
  V2Product,
  V2Settings,
  V2Signal,
  V2StrategyVersion,
} from '@/shared/v2';
import { DEFAULT_V2_SETTINGS } from '@/shared/v2';
import { getPool } from '../../db/pool';
import type { AlertFilters, ProductFilters, V2Store } from './V2Store';

/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

function mapInstrument(r: any): V2Instrument {
  return {
    id: `K:${r.token}`,
    token: Number(r.token),
    exchange: r.exchange,
    productId: r.product_id,
    kind: r.kind,
    symbol: r.symbol,
    expiry: r.expiry ?? null,
    strike: num(r.strike),
    lotSize: Number(r.lot_size),
    tickSize: Number(r.tick_size),
  };
}

function mapProduct(r: any): V2Product {
  return {
    id: r.id,
    market: r.market,
    kind: r.kind,
    symbol: r.symbol,
    name: r.name,
    hasSpot: r.has_spot,
    hasFutures: r.has_futures,
    hasOptions: r.has_options,
    futureExpiries: r.future_expiries ?? [],
    optionExpiries: r.option_expiries ?? [],
    strikeStep: num(r.strike_step),
    lotSize: num(r.lot_size),
  };
}

function mapConnection(r: any): V2Connection {
  return {
    id: r.id,
    strategyId: r.strategy_id,
    productId: r.product_id,
    config: r.config,
    enabled: r.enabled,
    enabledAt: iso(r.enabled_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

function mapUnit(r: any): UnitState {
  return {
    connectionId: r.connection_id,
    unitKey: r.unit_key,
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

function mapSignal(r: any): V2Signal {
  return {
    id: r.id,
    identity: r.identity,
    connectionId: r.connection_id,
    strategyId: r.strategy_id,
    version: Number(r.version),
    unitKey: r.unit_key,
    triggerTimeframe: r.trigger_timeframe,
    candleTime: Number(r.candle_time),
    outcome: r.outcome,
    evaluation: r.evaluation,
    createdAt: iso(r.created_at)!,
  };
}

function mapAlert(r: any, deliveries: Delivery[]): V2Alert {
  return {
    id: r.id,
    signalId: r.signal_id,
    connectionId: r.connection_id,
    strategyId: r.strategy_id,
    strategyName: r.strategy_name,
    version: Number(r.version),
    productId: r.product_id,
    status: r.status,
    unit: r.unit,
    triggerTimeframe: r.trigger_timeframe,
    candleTime: Number(r.candle_time),
    evaluation: r.evaluation,
    deliveries,
    acknowledgedAt: iso(r.acknowledged_at),
    createdAt: iso(r.created_at)!,
  };
}

const STRATEGY_SELECT = `SELECT s.*, v.definition FROM v2_strategies s
  JOIN v2_strategy_versions v ON v.strategy_id = s.id AND v.version = s.current_version`;

export class PgV2Store implements V2Store {
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
    replaceAll: (list: V2Instrument[], products: V2Product[]) =>
      this.tx(async (c) => {
        await c.query('DELETE FROM v2_instruments');
        for (let i = 0; i < list.length; i += 5000) {
          const rows = list.slice(i, i + 5000);
          await c.query(
            `INSERT INTO v2_instruments (token, exchange, product_id, kind, symbol, expiry, strike, lot_size, tick_size)
             SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::float8[], $8::int[], $9::float8[])
             ON CONFLICT (token) DO NOTHING`,
            [
              rows.map((r) => r.token),
              rows.map((r) => r.exchange),
              rows.map((r) => r.productId),
              rows.map((r) => r.kind),
              rows.map((r) => r.symbol),
              rows.map((r) => r.expiry),
              rows.map((r) => r.strike),
              rows.map((r) => r.lotSize),
              rows.map((r) => r.tickSize),
            ],
          );
        }
        await c.query('DELETE FROM v2_products');
        for (let i = 0; i < products.length; i += 1000) {
          const rows = products.slice(i, i + 1000);
          await c.query(
            `INSERT INTO v2_products (id, market, kind, symbol, name, has_spot, has_futures, has_options, future_expiries, option_expiries, strike_step, lot_size)
             SELECT id, market, kind, symbol, name, has_spot, has_futures, has_options, fe::jsonb, oe::jsonb, step, lot
             FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::bool[], $7::bool[], $8::bool[], $9::text[], $10::text[], $11::float8[], $12::int[])
               AS t(id, market, kind, symbol, name, has_spot, has_futures, has_options, fe, oe, step, lot)`,
            [
              rows.map((p) => p.id),
              rows.map((p) => p.market),
              rows.map((p) => p.kind),
              rows.map((p) => p.symbol),
              rows.map((p) => p.name),
              rows.map((p) => p.hasSpot),
              rows.map((p) => p.hasFutures),
              rows.map((p) => p.hasOptions),
              rows.map((p) => JSON.stringify(p.futureExpiries)),
              rows.map((p) => JSON.stringify(p.optionExpiries)),
              rows.map((p) => p.strikeStep),
              rows.map((p) => p.lotSize),
            ],
          );
        }
      }),
    forProduct: async (productId: string) => (await this.pool.query('SELECT * FROM v2_instruments WHERE product_id = $1', [productId])).rows.map(mapInstrument),
    count: async () => Number((await this.pool.query('SELECT count(*)::int AS n FROM v2_instruments')).rows[0]?.n ?? 0),
    syncedAt: async () => iso((await this.pool.query('SELECT max(synced_at) AS at FROM v2_instruments')).rows[0]?.at),
  };

  products = {
    list: async (f: ProductFilters = {}) => {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (f.ids) {
        vals.push(f.ids);
        where.push(`id = ANY($${vals.length}::text[])`);
      }
      if (f.kind) {
        vals.push(f.kind);
        where.push(`kind = $${vals.length}`);
      }
      if (f.market) {
        vals.push(f.market);
        where.push(`market = $${vals.length}`);
      }
      if (f.search) {
        vals.push(`%${f.search.toUpperCase()}%`);
        where.push(`(upper(symbol) LIKE $${vals.length} OR upper(name) LIKE $${vals.length})`);
      }
      vals.push(Math.min(f.limit ?? 5000, 5000));
      const order = `CASE kind WHEN 'INDEX' THEN 0 WHEN 'COMMODITY' THEN 1 ELSE 2 END, has_options DESC, symbol`;
      return (await this.pool.query(`SELECT * FROM v2_products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT $${vals.length}`, vals)).rows.map(
        mapProduct,
      );
    },
    get: async (id: string) => {
      const r = (await this.pool.query('SELECT * FROM v2_products WHERE id = $1', [id])).rows[0];
      return r ? mapProduct(r) : null;
    },
    count: async () => Number((await this.pool.query('SELECT count(*)::int AS n FROM v2_products')).rows[0]?.n ?? 0),
  };

  calendar = {
    list: async (): Promise<CalendarEntry[]> =>
      (await this.pool.query('SELECT * FROM v2_calendar ORDER BY date, market')).rows.map((r: any) =>
        r.kind === 'HOLIDAY'
          ? { market: r.market, date: r.date, kind: 'HOLIDAY', note: r.note ?? undefined }
          : { market: r.market, date: r.date, kind: 'SPECIAL_SESSION', openMin: Number(r.open_min), closeMin: Number(r.close_min), note: r.note ?? undefined },
      ),
    replaceAll: (entries: CalendarEntry[]) =>
      this.tx(async (c) => {
        await c.query('DELETE FROM v2_calendar');
        for (const e of entries) {
          await c.query('INSERT INTO v2_calendar (market, date, kind, open_min, close_min, note) VALUES ($1,$2,$3,$4,$5,$6)', [
            e.market,
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
    list: async () =>
      (await this.pool.query(`${STRATEGY_SELECT} ORDER BY s.updated_at DESC`)).rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        version: Number(r.current_version),
        definition: r.definition,
        createdAt: iso(r.created_at)!,
        updatedAt: iso(r.updated_at)!,
      })),
    get: async (id: string) => {
      const r = (await this.pool.query(`${STRATEGY_SELECT} WHERE s.id = $1`, [id])).rows[0];
      return r ? { id: r.id, name: r.name, version: Number(r.current_version), definition: r.definition, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! } : null;
    },
    create: async (definition: StrategyDefinition) => {
      const id = randomUUID();
      await this.tx(async (c) => {
        await c.query('INSERT INTO v2_strategies (id, name, current_version) VALUES ($1, $2, 1)', [id, definition.name]);
        await c.query('INSERT INTO v2_strategy_versions (strategy_id, version, definition) VALUES ($1, 1, $2)', [id, JSON.stringify(definition)]);
      });
      return (await this.strategies.get(id))!;
    },
    update: async (id: string, definition: StrategyDefinition) => {
      const ok = await this.tx(async (c) => {
        const cur = (await c.query('SELECT current_version FROM v2_strategies WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!cur) return false;
        const next = Number(cur.current_version) + 1;
        await c.query('INSERT INTO v2_strategy_versions (strategy_id, version, definition) VALUES ($1, $2, $3)', [id, next, JSON.stringify(definition)]);
        await c.query('UPDATE v2_strategies SET name = $2, current_version = $3, updated_at = now() WHERE id = $1', [id, definition.name, next]);
        return true;
      });
      return ok ? this.strategies.get(id) : null;
    },
    remove: async (id: string) => ((await this.pool.query('DELETE FROM v2_strategies WHERE id = $1', [id])).rowCount ?? 0) > 0,
    versions: async (id: string): Promise<V2StrategyVersion[]> =>
      (await this.pool.query('SELECT version, definition, created_at FROM v2_strategy_versions WHERE strategy_id = $1 ORDER BY version DESC', [id])).rows.map(
        (r: any) => ({ version: Number(r.version), definition: r.definition, createdAt: iso(r.created_at)! }),
      ),
  };

  connections = {
    list: async (strategyId?: string) =>
      (strategyId
        ? await this.pool.query('SELECT * FROM v2_connections WHERE strategy_id = $1 ORDER BY created_at', [strategyId])
        : await this.pool.query('SELECT * FROM v2_connections ORDER BY created_at')
      ).rows.map(mapConnection),
    get: async (id: string) => {
      const r = (await this.pool.query('SELECT * FROM v2_connections WHERE id = $1', [id])).rows[0];
      return r ? mapConnection(r) : null;
    },
    create: async (strategyId: string, productId: string, config: ConnectionConfig) => {
      const r = (
        await this.pool.query('INSERT INTO v2_connections (id, strategy_id, product_id, config) VALUES ($1,$2,$3,$4) RETURNING *', [
          randomUUID(),
          strategyId,
          productId,
          JSON.stringify(config),
        ])
      ).rows[0];
      return mapConnection(r);
    },
    update: async (id: string, config: ConnectionConfig) => {
      const r = (await this.pool.query('UPDATE v2_connections SET config = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, JSON.stringify(config)])).rows[0];
      return r ? mapConnection(r) : null;
    },
    setEnabled: async (id: string, enabled: boolean, at: string) => {
      const r = (
        await this.pool.query(
          `UPDATE v2_connections SET enabled = $2, enabled_at = CASE WHEN $2 THEN $3::timestamptz ELSE enabled_at END, updated_at = now() WHERE id = $1 RETURNING *`,
          [id, enabled, at],
        )
      ).rows[0];
      return r ? mapConnection(r) : null;
    },
    remove: async (id: string) => ((await this.pool.query('DELETE FROM v2_connections WHERE id = $1', [id])).rowCount ?? 0) > 0,
  };

  units = {
    list: async (connectionId: string) => (await this.pool.query('SELECT * FROM v2_unit_state WHERE connection_id = $1 ORDER BY unit_key', [connectionId])).rows.map(mapUnit),
    get: async (connectionId: string, unitKey: string) => {
      const r = (await this.pool.query('SELECT * FROM v2_unit_state WHERE connection_id = $1 AND unit_key = $2', [connectionId, unitKey])).rows[0];
      return r ? mapUnit(r) : null;
    },
    upsert: async (s: UnitState) => {
      await this.pool.query(
        `INSERT INTO v2_unit_state (connection_id, unit_key, state, last_evaluated_candle, last_result, last_signal_candle, last_alert_at, cooldown_until, last_evaluation, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (connection_id, unit_key) DO UPDATE SET
           state = EXCLUDED.state, last_evaluated_candle = EXCLUDED.last_evaluated_candle, last_result = EXCLUDED.last_result,
           last_signal_candle = EXCLUDED.last_signal_candle, last_alert_at = EXCLUDED.last_alert_at,
           cooldown_until = EXCLUDED.cooldown_until, last_evaluation = EXCLUDED.last_evaluation, updated_at = now()`,
        [s.connectionId, s.unitKey, s.state, s.lastEvaluatedCandle, s.lastResult, s.lastSignalCandle, s.lastAlertAt, s.cooldownUntil, s.lastEvaluation ? JSON.stringify(s.lastEvaluation) : null],
      );
    },
    clear: async (connectionId: string) => {
      await this.pool.query('DELETE FROM v2_unit_state WHERE connection_id = $1', [connectionId]);
    },
  };

  signals = {
    insert: async (s: Omit<V2Signal, 'id' | 'createdAt'>) => {
      const r = (
        await this.pool.query(
          `INSERT INTO v2_signals (identity, connection_id, strategy_id, version, unit_key, trigger_timeframe, candle_time, outcome, evaluation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (identity) DO NOTHING RETURNING *`,
          [s.identity, s.connectionId, s.strategyId, s.version, s.unitKey, s.triggerTimeframe, s.candleTime, s.outcome, JSON.stringify(s.evaluation)],
        )
      ).rows[0];
      return r ? mapSignal(r) : null;
    },
    list: async (f: { connectionId?: string; strategyId?: string; limit?: number }) => {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (f.connectionId) {
        vals.push(f.connectionId);
        where.push(`connection_id = $${vals.length}`);
      }
      if (f.strategyId) {
        vals.push(f.strategyId);
        where.push(`strategy_id = $${vals.length}`);
      }
      vals.push(Math.min(f.limit ?? 100, 500));
      return (await this.pool.query(`SELECT * FROM v2_signals ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${vals.length}`, vals)).rows.map(mapSignal);
    },
  };

  private async deliveriesFor(ids: string[]): Promise<Map<string, Delivery[]>> {
    const out = new Map<string, Delivery[]>();
    if (!ids.length) return out;
    const rows = (await this.pool.query('SELECT * FROM v2_deliveries WHERE alert_id = ANY($1::uuid[]) ORDER BY sent_at', [ids])).rows;
    for (const r of rows as any[]) {
      const list = out.get(r.alert_id) ?? [];
      list.push({ channel: r.channel, status: r.status, error: r.error ?? undefined, sentAt: iso(r.sent_at)! });
      out.set(r.alert_id, list);
    }
    return out;
  }

  alerts = {
    insert: async (a: Omit<V2Alert, 'id' | 'createdAt' | 'deliveries' | 'acknowledgedAt'>) => {
      const r = (
        await this.pool.query(
          `INSERT INTO v2_alerts (signal_id, connection_id, strategy_id, strategy_name, version, product_id, status, unit, trigger_timeframe, candle_time, evaluation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [a.signalId, a.connectionId, a.strategyId, a.strategyName, a.version, a.productId, a.status, JSON.stringify(a.unit), a.triggerTimeframe, a.candleTime, JSON.stringify(a.evaluation)],
        )
      ).rows[0];
      return mapAlert(r, []);
    },
    addDelivery: async (alertId: string, d: Delivery) => {
      await this.pool.query('INSERT INTO v2_deliveries (alert_id, channel, status, error, sent_at) VALUES ($1,$2,$3,$4,$5)', [alertId, d.channel, d.status, d.error ?? null, d.sentAt]);
    },
    setStatus: async (alertId: string, status: V2Alert['status']) => {
      await this.pool.query('UPDATE v2_alerts SET status = $2 WHERE id = $1', [alertId, status]);
    },
    acknowledge: async (alertId: string, at: string) => {
      await this.pool.query(`UPDATE v2_alerts SET status = 'ACKNOWLEDGED', acknowledged_at = $2 WHERE id = $1`, [alertId, at]);
      return this.alerts.get(alertId);
    },
    get: async (id: string) => {
      const r = (await this.pool.query('SELECT * FROM v2_alerts WHERE id = $1', [id])).rows[0];
      if (!r) return null;
      return mapAlert(r, (await this.deliveriesFor([id])).get(id) ?? []);
    },
    list: async (f: AlertFilters) => {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (f.connectionId) {
        vals.push(f.connectionId);
        where.push(`connection_id = $${vals.length}`);
      }
      if (f.strategyId) {
        vals.push(f.strategyId);
        where.push(`strategy_id = $${vals.length}`);
      }
      if (f.active) where.push('acknowledged_at IS NULL');
      vals.push(Math.min(f.limit ?? 200, 1000));
      const rows = (await this.pool.query(`SELECT * FROM v2_alerts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${vals.length}`, vals)).rows;
      const deliveries = await this.deliveriesFor(rows.map((r: any) => r.id));
      return rows.map((r: any) => mapAlert(r, deliveries.get(r.id) ?? []));
    },
  };

  scanRuns = {
    insert: async (run: ScanRun) => {
      const { id, startedAt, finishedAt, status, ...summary } = run;
      await this.pool.query('INSERT INTO v2_scan_runs (id, started_at, finished_at, status, summary) VALUES ($1,$2,$3,$4,$5)', [id, startedAt, finishedAt, status, JSON.stringify(summary)]);
    },
    list: async (limit: number) =>
      (await this.pool.query('SELECT * FROM v2_scan_runs ORDER BY started_at DESC LIMIT $1', [limit])).rows.map(
        (r: any): ScanRun => ({ id: r.id, startedAt: iso(r.started_at)!, finishedAt: iso(r.finished_at)!, status: r.status, ...r.summary }),
      ),
    prune: async (before: string) => {
      await this.pool.query('DELETE FROM v2_scan_runs WHERE started_at < $1', [before]);
    },
  };

  settings = {
    get: async (): Promise<V2Settings> => {
      const r = (await this.pool.query(`SELECT value FROM v2_settings WHERE key = 'settings'`)).rows[0];
      return { ...DEFAULT_V2_SETTINGS, ...(r?.value ?? {}) };
    },
    save: async (s: V2Settings) => {
      await this.pool.query(
        `INSERT INTO v2_settings (key, value, updated_at) VALUES ('settings', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(s)],
      );
      return s;
    },
  };

  locks = {
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
