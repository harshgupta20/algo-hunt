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
  ProductKind,
  ScanRun,
  StrategyDefinition,
  LiveStatus,
  PaperOverride,
  PaperPlan,
  PaperTrade,
  UnitState,
  V2Alert,
  V2Connection,
  V2Instrument,
  V2Product,
  V2Settings,
  V2Signal,
  V2StrategyVersion,
} from '@/shared/v2';
import { settingsFromStored } from '@/shared/v2';
import { getPool } from '../../db/pool';
import type { AlertFilters, DatabaseSize, NewAlert, NewPaperTrade, NewSignal, ProductFilters, PruneResult, RecordStoreFilters, SignalFilters, V2Store } from './V2Store';

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

/** WHERE clauses for the filters alerts and signals share (`product` = the SQL expression of the product id). */
function recordWhere(f: RecordStoreFilters, product: string, where: string[], vals: unknown[]): void {
  const add = (v: unknown, clause: (n: string) => string) => {
    vals.push(v);
    where.push(clause(`$${vals.length}`));
  };
  if (f.connectionId) add(f.connectionId, (n) => `connection_id = ${n}`);
  if (f.strategyId) add(f.strategyId, (n) => `strategy_id = ${n}`);
  if (f.kinds?.length) add(f.kinds, (n) => `${product} IN (SELECT id FROM v2_products WHERE kind = ANY(${n}::text[]))`);
  if (f.markets?.length) add(f.markets, (n) => `${product} IN (SELECT id FROM v2_products WHERE market = ANY(${n}::text[]))`);
  if (f.search?.trim()) add(`%${f.search.trim().replace(/[%_\\]/g, '')}%`, (n) => `split_part(${product}, ':', 2) ILIKE ${n}`);
  if (f.timeframes?.length) add(f.timeframes, (n) => `trigger_timeframe = ANY(${n}::text[])`);
  if (f.since) add(f.since, (n) => `created_at >= ${n}`);
  if (f.until) add(f.until, (n) => `created_at < ${n}`);
  if (f.groups?.length) {
    add(f.groups, (n) => `EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(evaluation->'trace'->'children', '[]'::jsonb)) g WHERE g->>'result' = 'TRUE' AND g->>'id' = ANY(${n}::text[]))`);
  }
}

/** A table that a pending migration creates: answer `fallback` instead of failing. */
const noTable =
  <T>(fallback: T) =>
  (err: unknown): T => {
    if ((err as { code?: string }).code === '42P01') return fallback;
    throw err;
  };

function mapPaperTrade(r: any): PaperTrade {
  return { ...(r.trade as PaperTrade), id: r.id };
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

/** Neon's free plan: 0.5 GB of storage per project. */
const NEON_FREE_STORAGE = 512 * 1024 * 1024;

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
    /**
     * Daily sync as a difference: only contracts that are new, expired or changed (Kite can reuse a token)
     * are written — not the whole list (tens of thousands of rows) every morning. Products are small: rewritten.
     */
    replaceAll: (list: V2Instrument[], products: V2Product[]) =>
      this.tx(async (c) => {
        const have = new Map(
          (await c.query('SELECT token, symbol, lot_size, tick_size FROM v2_instruments')).rows.map((r: any) => [Number(r.token), `${r.symbol}|${Number(r.lot_size)}|${Number(r.tick_size)}`]),
        );
        const want = new Map(list.map((i) => [i.token, i]));
        const drop = [...have.keys()].filter((t) => {
          const i = want.get(t);
          return !i || have.get(t) !== `${i.symbol}|${i.lotSize}|${i.tickSize}`;
        });
        for (let i = 0; i < drop.length; i += 10_000) await c.query('DELETE FROM v2_instruments WHERE token = ANY($1::bigint[])', [drop.slice(i, i + 10_000)]);
        const dropped = new Set(drop);
        const fresh = list.filter((i) => !have.has(i.token) || dropped.has(i.token));
        for (let i = 0; i < fresh.length; i += 5000) {
          const rows = fresh.slice(i, i + 5000);
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
        // When and how many — read instead of scanning the table.
        await c.query(
          `INSERT INTO v2_settings (key, value, updated_at) VALUES ('instruments_sync', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify({ at: new Date().toISOString(), count: list.length })],
        );
      }),
    forProduct: async (productId: string) => (await this.pool.query('SELECT * FROM v2_instruments WHERE product_id = $1', [productId])).rows.map(mapInstrument),
    count: async () => {
      const sync = (await this.pool.query(`SELECT value FROM v2_settings WHERE key = 'instruments_sync'`)).rows[0]?.value as { count?: number } | undefined;
      return sync?.count ?? Number((await this.pool.query('SELECT count(*)::int AS n FROM v2_instruments')).rows[0]?.n ?? 0);
    },
    syncedAt: async () => {
      const sync = (await this.pool.query(`SELECT value FROM v2_settings WHERE key = 'instruments_sync'`)).rows[0]?.value as { at?: string } | undefined;
      return sync?.at ?? iso((await this.pool.query('SELECT max(synced_at) AS at FROM v2_instruments')).rows[0]?.at);
    },
  };

  /** WHERE clause for product filters (shared by list and counts). */
  private productWhere(f: ProductFilters, vals: unknown[]): string {
    const where: string[] = [];
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
    for (const k of new Set(f.needs ?? [])) where.push(k === 'SPOT' ? 'has_spot' : k === 'FUT' ? 'has_futures' : 'has_options');
    return where.length ? `WHERE ${where.join(' AND ')}` : '';
  }

  products = {
    list: async (f: ProductFilters = {}) => {
      const vals: unknown[] = [];
      const where = this.productWhere(f, vals);
      vals.push(Math.min(f.limit ?? 5000, 5000));
      const order = `CASE kind WHEN 'INDEX' THEN 0 WHEN 'COMMODITY' THEN 1 ELSE 2 END, has_options DESC, symbol`;
      return (await this.pool.query(`SELECT * FROM v2_products ${where} ORDER BY ${order} LIMIT $${vals.length}`, vals)).rows.map(mapProduct);
    },
    countByKind: async (f: Pick<ProductFilters, 'search' | 'market' | 'needs'> = {}) => {
      const vals: unknown[] = [];
      const rows = (await this.pool.query(`SELECT kind, count(*)::int AS n FROM v2_products ${this.productWhere(f, vals)} GROUP BY kind`, vals)).rows as Array<{ kind: ProductKind; n: number }>;
      const out: Record<ProductKind, number> = { INDEX: 0, STOCK: 0, COMMODITY: 0 };
      for (const r of rows) out[r.kind] = Number(r.n);
      return out;
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
    count: async () => Number((await this.pool.query('SELECT count(*)::int AS n FROM v2_strategies')).rows[0]?.n ?? 0),
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
    counts: async () => {
      const r = (await this.pool.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE enabled)::int AS enabled FROM v2_connections')).rows[0];
      return { total: Number(r?.total ?? 0), enabled: Number(r?.enabled ?? 0) };
    },
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
    setEnabledMany: async (ids: string[], enabled: boolean, at: string) => {
      if (!ids.length) return 0;
      const r = await this.pool.query(
        `UPDATE v2_connections SET enabled = $2, enabled_at = CASE WHEN $2 THEN $3::timestamptz ELSE enabled_at END, updated_at = now() WHERE id = ANY($1::uuid[])`,
        [ids, enabled, at],
      );
      return r.rowCount ?? 0;
    },
    remove: async (id: string) => ((await this.pool.query('DELETE FROM v2_connections WHERE id = $1', [id])).rowCount ?? 0) > 0,
  };

  units = {
    list: async (connectionId: string) => (await this.pool.query('SELECT * FROM v2_unit_state WHERE connection_id = $1 ORDER BY unit_key', [connectionId])).rows.map(mapUnit),
    get: async (connectionId: string, unitKey: string) => {
      const r = (await this.pool.query('SELECT * FROM v2_unit_state WHERE connection_id = $1 AND unit_key = $2', [connectionId, unitKey])).rows[0];
      return r ? mapUnit(r) : null;
    },
    listFor: async (connectionIds: string[]) =>
      connectionIds.length ? (await this.pool.query('SELECT * FROM v2_unit_state WHERE connection_id = ANY($1::uuid[])', [connectionIds])).rows.map(mapUnit) : [],
    upsert: async (s: UnitState) => this.units.upsertMany([s]),
    upsertMany: async (list: UnitState[]) => {
      for (let i = 0; i < list.length; i += 500) {
        const chunk = list.slice(i, i + 500);
        const vals: unknown[] = [];
        const rows = chunk.map((s) => {
          vals.push(s.connectionId, s.unitKey, s.state, s.lastEvaluatedCandle, s.lastResult, s.lastSignalCandle, s.lastAlertAt, s.cooldownUntil, s.lastEvaluation ? JSON.stringify(s.lastEvaluation) : null);
          const b = vals.length - 9;
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9}, now())`;
        });
        await this.pool.query(
          `INSERT INTO v2_unit_state (connection_id, unit_key, state, last_evaluated_candle, last_result, last_signal_candle, last_alert_at, cooldown_until, last_evaluation, updated_at)
           VALUES ${rows.join(',')}
           ON CONFLICT (connection_id, unit_key) DO UPDATE SET
             state = EXCLUDED.state, last_evaluated_candle = EXCLUDED.last_evaluated_candle, last_result = EXCLUDED.last_result,
             last_signal_candle = EXCLUDED.last_signal_candle, last_alert_at = EXCLUDED.last_alert_at,
             cooldown_until = EXCLUDED.cooldown_until, last_evaluation = EXCLUDED.last_evaluation, updated_at = now()`,
          vals,
        );
      }
    },
    clear: async (connectionId: string) => {
      await this.pool.query('DELETE FROM v2_unit_state WHERE connection_id = $1', [connectionId]);
    },
    clearMany: async (connectionIds: string[]) => {
      if (connectionIds.length) await this.pool.query('DELETE FROM v2_unit_state WHERE connection_id = ANY($1::uuid[])', [connectionIds]);
    },
    disableMany: async (connectionIds: string[]) => {
      if (connectionIds.length) await this.pool.query("UPDATE v2_unit_state SET state = 'DISABLED', updated_at = now() WHERE connection_id = ANY($1::uuid[])", [connectionIds]);
    },
  };

  signals = {
    insert: async (s: NewSignal) => {
      const r = (
        await this.pool.query(
          `INSERT INTO v2_signals (id, identity, connection_id, strategy_id, version, unit_key, trigger_timeframe, candle_time, outcome, evaluation, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, now())) ON CONFLICT (identity) DO NOTHING RETURNING *`,
          [s.id ?? randomUUID(), s.identity, s.connectionId, s.strategyId, s.version, s.unitKey, s.triggerTimeframe, s.candleTime, s.outcome, JSON.stringify(s.evaluation), s.createdAt ?? null],
        )
      ).rows[0];
      return r ? mapSignal(r) : null;
    },
    list: async (f: SignalFilters) => {
      const where: string[] = [];
      const vals: unknown[] = [];
      recordWhere(f, "evaluation->>'productId'", where, vals);
      if (f.outcomes?.length) {
        vals.push(f.outcomes);
        where.push(`outcome = ANY($${vals.length}::text[])`);
      }
      vals.push(Math.min(f.limit ?? 100, 1000));
      // Lists leave the condition trace (most of each row's size) in the database.
      const cols = `id, identity, connection_id, strategy_id, version, unit_key, trigger_timeframe, candle_time, outcome, evaluation - 'trace' AS evaluation, created_at`;
      return (await this.pool.query(`SELECT ${cols} FROM v2_signals ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${vals.length}`, vals)).rows.map(mapSignal);
    },
  };

  private async deliveriesFor(ids: string[]): Promise<Map<string, Delivery[]>> {
    const out = new Map<string, Delivery[]>();
    if (!ids.length) return out;
    const rows = (await this.pool.query('SELECT * FROM v2_deliveries WHERE alert_id = ANY($1::uuid[]) ORDER BY sent_at', [ids])).rows;
    for (const r of rows as any[]) {
      const list = out.get(r.alert_id) ?? [];
      list.push({ channel: r.channel, target: r.target ?? undefined, status: r.status, error: r.error ?? undefined, sentAt: iso(r.sent_at)! });
      out.set(r.alert_id, list);
    }
    return out;
  }

  alerts = {
    insert: async (a: NewAlert) => {
      const r = (
        await this.pool.query(
          `INSERT INTO v2_alerts (id, signal_id, connection_id, strategy_id, strategy_name, version, product_id, status, unit, trigger_timeframe, candle_time, evaluation, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz, now())) RETURNING *`,
          [a.id ?? randomUUID(), a.signalId, a.connectionId, a.strategyId, a.strategyName, a.version, a.productId, a.status, JSON.stringify(a.unit), a.triggerTimeframe, a.candleTime, JSON.stringify(a.evaluation), a.createdAt ?? null],
        )
      ).rows[0];
      return mapAlert(r, []);
    },
    addDelivery: async (alertId: string, d: Delivery) => {
      await this.pool.query('INSERT INTO v2_deliveries (alert_id, channel, target, status, error, sent_at) VALUES ($1,$2,$3,$4,$5,$6)', [alertId, d.channel, d.target ?? null, d.status, d.error ?? null, d.sentAt]);
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
      recordWhere(f, 'product_id', where, vals);
      if (f.active) where.push('acknowledged_at IS NULL');
      if (f.statuses?.length) {
        vals.push(f.statuses);
        where.push(`status = ANY($${vals.length}::text[])`);
      }
      if (f.sources?.length) {
        vals.push(f.sources);
        where.push(`COALESCE(evaluation->>'source', 'HISTORICAL') = ANY($${vals.length}::text[])`);
      }
      vals.push(Math.min(f.limit ?? 200, 1000));
      // Lists leave the condition trace (most of each row's size) and the duplicate unit in the database.
      const cols = `id, signal_id, connection_id, strategy_id, strategy_name, version, product_id, status, unit, trigger_timeframe, candle_time, evaluation - 'trace' - 'unit' AS evaluation, acknowledged_at, created_at`;
      const rows = (await this.pool.query(`SELECT ${cols} FROM v2_alerts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${vals.length}`, vals)).rows;
      const deliveries = await this.deliveriesFor(rows.map((r: any) => r.id));
      return rows.map((r: any) => mapAlert(r, deliveries.get(r.id) ?? []));
    },
    feed: async (after: string | null, limit: number) =>
      (
        await this.pool.query(
          `SELECT id, strategy_name, product_id, unit, created_at FROM v2_alerts ${after ? 'WHERE created_at > $2' : ''} ORDER BY created_at DESC LIMIT $1`,
          after ? [Math.min(limit, 100), after] : [Math.min(limit, 100)],
        )
      ).rows.map((r: any) => ({ id: r.id as string, strategyName: r.strategy_name as string, productId: r.product_id as string, unit: r.unit, createdAt: iso(r.created_at)! })),
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
      return settingsFromStored(r?.value);
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

  paper = {
    getPlan: async (strategyId: string) => {
      const r = (await this.pool.query('SELECT plan FROM v2_paper_plans WHERE strategy_id = $1', [strategyId])).rows[0];
      return r ? (r.plan as PaperPlan) : null;
    },
    savePlan: async (strategyId: string, plan: PaperPlan) => {
      await this.pool.query(
        `INSERT INTO v2_paper_plans (strategy_id, plan, updated_at) VALUES ($1, $2, now()) ON CONFLICT (strategy_id) DO UPDATE SET plan = EXCLUDED.plan, updated_at = now()`,
        [strategyId, JSON.stringify(plan)],
      );
      return plan;
    },
    listPlans: async () => (await this.pool.query('SELECT strategy_id, plan FROM v2_paper_plans')).rows.map((r: any) => ({ strategyId: r.strategy_id as string, plan: r.plan as PaperPlan })),
    insertTrade: async (t: NewPaperTrade) => {
      const id = t.id ?? randomUUID();
      const trade: PaperTrade = { ...t, id };
      const r = await this.pool.query(
        `INSERT INTO v2_paper_trades (id, strategy_id, connection_id, product_id, slot, alert_id, status, entry_at, trade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (connection_id, slot) WHERE status = 'OPEN' DO NOTHING`,
        [id, t.strategyId, t.connectionId, t.productId, t.slot, t.alertId, t.status, t.entryAt, JSON.stringify(trade)],
      );
      return r.rowCount ? trade : null;
    },
    openFor: async (connectionId: string, slot: string) => {
      const r = (await this.pool.query(`SELECT id, trade FROM v2_paper_trades WHERE connection_id = $1 AND slot = $2 AND status = 'OPEN' LIMIT 1`, [connectionId, slot])).rows[0];
      return r ? mapPaperTrade(r) : null;
    },
    listOpen: async () => (await this.pool.query(`SELECT id, trade FROM v2_paper_trades WHERE status = 'OPEN' ORDER BY entry_at`)).rows.map(mapPaperTrade),
    closeTrade: async (id: string, patch: Pick<PaperTrade, 'exitAt' | 'exitPrice' | 'exitReason' | 'grossPnl' | 'charges' | 'netPnl' | 'lastPrice' | 'lastPriceAt'>) => {
      const r = (
        await this.pool.query(
          `UPDATE v2_paper_trades SET status = 'CLOSED', exit_at = $2, net_pnl = $3, trade = trade || $4::jsonb, updated_at = now()
           WHERE id = $1 AND status = 'OPEN' RETURNING id, trade`,
          [id, patch.exitAt, patch.netPnl, JSON.stringify({ ...patch, status: 'CLOSED' })],
        )
      ).rows[0];
      return r ? mapPaperTrade(r) : null;
    },
    updateMarks: async (marks: Array<{ id: string; lastPrice: number; at: string }>) => {
      if (!marks.length) return;
      await this.pool.query(
        `UPDATE v2_paper_trades t SET trade = t.trade || jsonb_build_object('lastPrice', m.p, 'lastPriceAt', m.at)
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::float8[]) AS p, unnest($3::text[]) AS at) m
         WHERE t.id = m.id AND t.status = 'OPEN'`,
        [marks.map((m) => m.id), marks.map((m) => m.lastPrice), marks.map((m) => m.at)],
      );
    },
    listTrades: async (f: { status?: 'OPEN' | 'CLOSED'; strategyId?: string; connectionId?: string; since?: string; limit?: number }) => {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (f.status) {
        vals.push(f.status);
        where.push(`status = $${vals.length}`);
      }
      if (f.strategyId) {
        vals.push(f.strategyId);
        where.push(`strategy_id = $${vals.length}`);
      }
      if (f.connectionId) {
        vals.push(f.connectionId);
        where.push(`connection_id = $${vals.length}`);
      }
      if (f.since) {
        vals.push(f.since);
        where.push(`entry_at >= $${vals.length}`);
      }
      vals.push(Math.min(f.limit ?? 1000, 50_000));
      const sql = `SELECT id, trade FROM v2_paper_trades ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY entry_at DESC LIMIT $${vals.length}`;
      return (await this.pool.query(sql, vals)).rows.map(mapPaperTrade);
    },
    reset: async (strategyId: string) => (await this.pool.query('DELETE FROM v2_paper_trades WHERE strategy_id = $1', [strategyId])).rowCount ?? 0,
    closedVersion: async () => {
      const r = (await this.pool.query(`SELECT count(*)::int AS n, max(updated_at) AS at FROM v2_paper_trades WHERE status = 'CLOSED'`)).rows[0];
      return `${r?.n ?? 0}|${iso(r?.at) ?? ''}`;
    },
    // Until migration 011 runs (next `npm run dev` / `npm run db:migrate`) there are simply no own values.
    getOverride: async (connectionId: string) => {
      const r = (await this.pool.query('SELECT override FROM v2_paper_overrides WHERE connection_id = $1', [connectionId]).catch(noTable({ rows: [] }))).rows[0];
      return r ? (r.override as PaperOverride) : null;
    },
    saveOverride: async (connectionId: string, override: PaperOverride) => {
      if (!Object.keys(override).length) {
        await this.pool.query('DELETE FROM v2_paper_overrides WHERE connection_id = $1', [connectionId]);
        return null;
      }
      await this.pool.query(
        `INSERT INTO v2_paper_overrides (connection_id, override, updated_at) VALUES ($1, $2, now()) ON CONFLICT (connection_id) DO UPDATE SET override = EXCLUDED.override, updated_at = now()`,
        [connectionId, JSON.stringify(override)],
      );
      return override;
    },
    listOverrides: async () =>
      (await this.pool.query('SELECT connection_id, override FROM v2_paper_overrides').catch(noTable({ rows: [] }))).rows.map((r: any) => ({ connectionId: r.connection_id as string, override: r.override as PaperOverride })),
  };

  contextStamp = async (): Promise<string> =>
    String(
      (
        await this.pool.query(`SELECT concat_ws('|',
          (SELECT count(*) FROM v2_connections), (SELECT max(updated_at) FROM v2_connections),
          (SELECT count(*) FROM v2_strategies), (SELECT max(updated_at) FROM v2_strategies),
          (SELECT max(updated_at) FROM v2_settings), (SELECT max(updated_at) FROM v2_products),
          (SELECT md5(coalesce(string_agg(market || date || kind || coalesce(open_min::text, '') || coalesce(close_min::text, ''), ',' ORDER BY market, date), '')) FROM v2_calendar)
        ) AS stamp`)
      ).rows[0]?.stamp ?? '',
    );

  maintenance = {
    size: async (): Promise<DatabaseSize> => {
      const [db, tables] = await Promise.all([
        this.pool.query('SELECT pg_database_size(current_database())::bigint AS bytes'),
        this.pool.query(
          `SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 2 DESC LIMIT 12`,
        ),
      ]);
      const url = (this.pool as unknown as { options?: { connectionString?: string } }).options?.connectionString ?? '';
      return {
        engine: 'postgres',
        bytes: Number(db.rows[0]?.bytes ?? 0),
        limitBytes: /neon\.tech/i.test(url) ? NEON_FREE_STORAGE : null,
        tables: tables.rows.map((r: any) => ({ name: r.name as string, bytes: Number(r.bytes) })),
      };
    },
    prune: async (before: string): Promise<PruneResult> =>
      this.tx(async (c) => {
        const paperTrades = (await c.query(`DELETE FROM v2_paper_trades WHERE status = 'CLOSED' AND exit_at < $1`, [before])).rowCount ?? 0;
        const alerts = (await c.query('DELETE FROM v2_alerts WHERE created_at < $1', [before])).rowCount ?? 0; // deliveries go with them
        const signals = (await c.query('DELETE FROM v2_signals s WHERE s.created_at < $1 AND NOT EXISTS (SELECT 1 FROM v2_alerts a WHERE a.signal_id = s.id)', [before])).rowCount ?? 0;
        const scanRuns = (await c.query('DELETE FROM v2_scan_runs WHERE started_at < $1', [before])).rowCount ?? 0;
        return { alerts, signals, paperTrades, scanRuns };
      }),
  };

  live = {
    get: async () => {
      const r = (await this.pool.query("SELECT status, offline_notified_at FROM v2_live_status WHERE id = 'main'")).rows[0] as { status: LiveStatus; offline_notified_at: Date | null } | undefined;
      return r ? { status: r.status, offlineNotifiedAt: r.offline_notified_at ? new Date(r.offline_notified_at).toISOString() : null } : null;
    },
    save: async (status: LiveStatus) => {
      await this.pool.query(
        `INSERT INTO v2_live_status (id, worker_id, heartbeat_at, status, offline_notified_at) VALUES ('main', $1, $2, $3, NULL)
         ON CONFLICT (id) DO UPDATE SET worker_id = EXCLUDED.worker_id, heartbeat_at = EXCLUDED.heartbeat_at, status = EXCLUDED.status, offline_notified_at = NULL`,
        [status.workerId, status.heartbeatAt, JSON.stringify(status)],
      );
    },
    markOfflineNotified: async (at: string) => {
      await this.pool.query("UPDATE v2_live_status SET offline_notified_at = $1 WHERE id = 'main'", [at]);
    },
  };
}
