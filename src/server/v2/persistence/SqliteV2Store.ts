/**
 * SQLite implementation of V2Store (the local database, src/server/db/sqlite.ts) — the same behaviour as
 * PgV2Store: signal dedupe by identity, one open paper trade per slot, conditional close, scan locks.
 * Timestamps are ISO text, JSON is text, booleans 0 / 1; list filters take JSON arrays via json_each.
 * node:sqlite is synchronous: each method runs to completion (write groups in one transaction).
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type {
  AlertFeedItem,
  CalendarEntry,
  ConnectionConfig,
  Delivery,
  LiveStatus,
  PaperOverride,
  PaperPlan,
  PaperTrade,
  ProductKind,
  ScanRun,
  StrategyDefinition,
  UnitState,
  V2Alert,
  V2AlertItem,
  V2Connection,
  V2Instrument,
  V2Product,
  V2Settings,
  V2Signal,
  V2SignalItem,
  V2Strategy,
  V2StrategyVersion,
} from '@/shared/v2';
import { settingsFromStored } from '@/shared/v2';
import { transaction } from '../../db/sqlite';
import type { AlertFilters, DatabaseSize, NewAlert, NewPaperTrade, NewSignal, ProductFilters, PruneResult, RecordStoreFilters, SignalFilters, V2Store } from './V2Store';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Param = string | number | null;

const json = (v: unknown): string => JSON.stringify(v);
const parse = <T>(v: unknown): T => (v == null ? (null as T) : (JSON.parse(String(v)) as T));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const bool = (v: boolean): number => (v ? 1 : 0);

function mapInstrument(r: Row): V2Instrument {
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

function mapProduct(r: Row): V2Product {
  return {
    id: r.id,
    market: r.market,
    kind: r.kind,
    symbol: r.symbol,
    name: r.name,
    hasSpot: r.has_spot === 1,
    hasFutures: r.has_futures === 1,
    hasOptions: r.has_options === 1,
    futureExpiries: parse<string[]>(r.future_expiries) ?? [],
    optionExpiries: parse<string[]>(r.option_expiries) ?? [],
    strikeStep: num(r.strike_step),
    lotSize: num(r.lot_size),
  };
}

function mapConnection(r: Row): V2Connection {
  return {
    id: r.id,
    strategyId: r.strategy_id,
    productId: r.product_id,
    config: parse<ConnectionConfig>(r.config),
    enabled: r.enabled === 1,
    enabledAt: r.enabled_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapUnit(r: Row): UnitState {
  return {
    connectionId: r.connection_id,
    unitKey: r.unit_key,
    state: r.state,
    lastEvaluatedCandle: num(r.last_evaluated_candle),
    lastResult: r.last_result ?? null,
    lastSignalCandle: num(r.last_signal_candle),
    lastAlertAt: r.last_alert_at ?? null,
    cooldownUntil: r.cooldown_until ?? null,
    lastEvaluation: parse(r.last_evaluation),
    updatedAt: r.updated_at ?? undefined,
  };
}

function mapSignal(r: Row): V2Signal {
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
    evaluation: parse(r.evaluation),
    createdAt: r.created_at,
  };
}

function mapAlert(r: Row, deliveries: Delivery[]): V2Alert {
  return {
    id: r.id,
    signalId: r.signal_id,
    connectionId: r.connection_id,
    strategyId: r.strategy_id,
    strategyName: r.strategy_name,
    version: Number(r.version),
    productId: r.product_id,
    status: r.status,
    unit: parse(r.unit),
    triggerTimeframe: r.trigger_timeframe,
    candleTime: Number(r.candle_time),
    evaluation: parse(r.evaluation),
    deliveries,
    acknowledgedAt: r.acknowledged_at ?? null,
    createdAt: r.created_at,
  };
}

const mapPaperTrade = (r: Row): PaperTrade => ({ ...parse<PaperTrade>(r.trade), id: r.id });
const mapStrategy = (r: Row): V2Strategy => ({ id: r.id, name: r.name, version: Number(r.current_version), definition: parse(r.definition), createdAt: r.created_at, updatedAt: r.updated_at });

const STRATEGY_SELECT = `SELECT s.*, v.definition FROM v2_strategies s JOIN v2_strategy_versions v ON v.strategy_id = s.id AND v.version = s.current_version`;
/** `x IN (…)` for a JSON array parameter. */
const inList = (col: string) => `${col} IN (SELECT value FROM json_each(?))`;

/** WHERE clauses for the filters alerts and signals share (`product` = the SQL expression of the product id). */
function recordWhere(f: RecordStoreFilters, product: string, where: string[], vals: Param[]): void {
  const add = (v: Param, clause: string) => {
    vals.push(v);
    where.push(clause);
  };
  if (f.connectionId) add(f.connectionId, 'connection_id = ?');
  if (f.strategyId) add(f.strategyId, 'strategy_id = ?');
  if (f.kinds?.length) add(json(f.kinds), `${product} IN (SELECT id FROM v2_products WHERE ${inList('kind')})`);
  if (f.markets?.length) add(json(f.markets), `${product} IN (SELECT id FROM v2_products WHERE ${inList('market')})`);
  if (f.search?.trim()) add(`%${f.search.trim().replace(/[%_\\]/g, '')}%`, `substr(${product}, instr(${product}, ':') + 1) LIKE ?`);
  if (f.timeframes?.length) add(json(f.timeframes), inList('trigger_timeframe'));
  if (f.since) add(f.since, 'created_at >= ?');
  if (f.until) add(f.until, 'created_at < ?');
  if (f.groups?.length) {
    add(json(f.groups), `EXISTS (SELECT 1 FROM json_each(evaluation, '$.trace.children') g WHERE json_extract(g.value, '$.result') = 'TRUE' AND json_extract(g.value, '$.id') IN (SELECT value FROM json_each(?)))`);
  }
}

export class SqliteV2Store implements V2Store {
  private readonly cache = new Map<string, StatementSync>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: () => number = Date.now,
  ) {}

  private iso(): string {
    return new Date(this.clock()).toISOString();
  }

  /** Prepared once, reused. */
  private q(sql: string): StatementSync {
    let st = this.cache.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.cache.set(sql, st);
    }
    return st;
  }

  private all(sql: string, ...params: Param[]): Row[] {
    return this.q(sql).all(...params) as Row[];
  }

  private one(sql: string, ...params: Param[]): Row | undefined {
    return this.q(sql).get(...params) as Row | undefined;
  }

  private run(sql: string, ...params: Param[]): number {
    return Number(this.q(sql).run(...params).changes);
  }

  instruments = {
    replaceAll: async (list: V2Instrument[], products: V2Product[]) => {
      const at = this.iso();
      transaction(this.db, () => {
        this.run('DELETE FROM v2_instruments');
        const ins = this.q(`INSERT OR IGNORE INTO v2_instruments (token, exchange, product_id, kind, symbol, expiry, strike, lot_size, tick_size, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
        for (const r of list) ins.run(r.token, r.exchange, r.productId, r.kind, r.symbol, r.expiry, r.strike, r.lotSize, r.tickSize, at);
        this.run('DELETE FROM v2_products');
        const pr = this.q(
          `INSERT INTO v2_products (id, market, kind, symbol, name, has_spot, has_futures, has_options, future_expiries, option_expiries, strike_step, lot_size, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        );
        for (const p of products) pr.run(p.id, p.market, p.kind, p.symbol, p.name, bool(p.hasSpot), bool(p.hasFutures), bool(p.hasOptions), json(p.futureExpiries), json(p.optionExpiries), p.strikeStep, p.lotSize, at);
      });
    },
    forProduct: async (productId: string) => this.all('SELECT * FROM v2_instruments WHERE product_id = ?', productId).map(mapInstrument),
    count: async () => Number(this.one('SELECT count(*) AS n FROM v2_instruments')?.n ?? 0),
    syncedAt: async () => (this.one('SELECT max(synced_at) AS at FROM v2_instruments')?.at as string | null) ?? null,
  };

  /** WHERE clause for product filters (shared by list and counts). */
  private productWhere(f: ProductFilters, vals: Param[]): string {
    const where: string[] = [];
    if (f.ids) {
      vals.push(json(f.ids));
      where.push(inList('id'));
    }
    if (f.kind) {
      vals.push(f.kind);
      where.push('kind = ?');
    }
    if (f.market) {
      vals.push(f.market);
      where.push('market = ?');
    }
    if (f.search) {
      const like = `%${f.search.toUpperCase()}%`;
      vals.push(like, like);
      where.push('(upper(symbol) LIKE ? OR upper(name) LIKE ?)');
    }
    for (const k of new Set(f.needs ?? [])) where.push(k === 'SPOT' ? 'has_spot = 1' : k === 'FUT' ? 'has_futures = 1' : 'has_options = 1');
    return where.length ? `WHERE ${where.join(' AND ')}` : '';
  }

  products = {
    list: async (f: ProductFilters = {}) => {
      const vals: Param[] = [];
      const where = this.productWhere(f, vals);
      vals.push(Math.min(f.limit ?? 5000, 5000));
      const order = `CASE kind WHEN 'INDEX' THEN 0 WHEN 'COMMODITY' THEN 1 ELSE 2 END, has_options DESC, symbol`;
      return this.all(`SELECT * FROM v2_products ${where} ORDER BY ${order} LIMIT ?`, ...vals).map(mapProduct);
    },
    countByKind: async (f: Pick<ProductFilters, 'search' | 'market' | 'needs'> = {}) => {
      const vals: Param[] = [];
      const out: Record<ProductKind, number> = { INDEX: 0, STOCK: 0, COMMODITY: 0 };
      for (const r of this.all(`SELECT kind, count(*) AS n FROM v2_products ${this.productWhere(f, vals)} GROUP BY kind`, ...vals)) out[r.kind as ProductKind] = Number(r.n);
      return out;
    },
    get: async (id: string) => {
      const r = this.one('SELECT * FROM v2_products WHERE id = ?', id);
      return r ? mapProduct(r) : null;
    },
    count: async () => Number(this.one('SELECT count(*) AS n FROM v2_products')?.n ?? 0),
  };

  calendar = {
    list: async (): Promise<CalendarEntry[]> =>
      this.all('SELECT * FROM v2_calendar ORDER BY date, market').map((r) =>
        r.kind === 'HOLIDAY'
          ? { market: r.market, date: r.date, kind: 'HOLIDAY', note: r.note ?? undefined }
          : { market: r.market, date: r.date, kind: 'SPECIAL_SESSION', openMin: Number(r.open_min), closeMin: Number(r.close_min), note: r.note ?? undefined },
      ),
    replaceAll: async (entries: CalendarEntry[]) => {
      transaction(this.db, () => {
        this.run('DELETE FROM v2_calendar');
        for (const e of entries) {
          this.run(
            'INSERT INTO v2_calendar (market, date, kind, open_min, close_min, note) VALUES (?,?,?,?,?,?)',
            e.market,
            e.date,
            e.kind,
            e.kind === 'SPECIAL_SESSION' ? e.openMin : null,
            e.kind === 'SPECIAL_SESSION' ? e.closeMin : null,
            e.note ?? null,
          );
        }
      });
    },
  };

  strategies = {
    count: async () => Number(this.one('SELECT count(*) AS n FROM v2_strategies')?.n ?? 0),
    list: async () => this.all(`${STRATEGY_SELECT} ORDER BY s.updated_at DESC`).map(mapStrategy),
    get: async (id: string) => {
      const r = this.one(`${STRATEGY_SELECT} WHERE s.id = ?`, id);
      return r ? mapStrategy(r) : null;
    },
    create: async (definition: StrategyDefinition) => {
      const id = randomUUID();
      const at = this.iso();
      transaction(this.db, () => {
        this.run('INSERT INTO v2_strategies (id, name, current_version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', id, definition.name, at, at);
        this.run('INSERT INTO v2_strategy_versions (strategy_id, version, definition, created_at) VALUES (?, 1, ?, ?)', id, json(definition), at);
      });
      return (await this.strategies.get(id))!;
    },
    update: async (id: string, definition: StrategyDefinition) => {
      const at = this.iso();
      const ok = transaction(this.db, () => {
        const cur = this.one('SELECT current_version FROM v2_strategies WHERE id = ?', id);
        if (!cur) return false;
        const next = Number(cur.current_version) + 1;
        this.run('INSERT INTO v2_strategy_versions (strategy_id, version, definition, created_at) VALUES (?, ?, ?, ?)', id, next, json(definition), at);
        this.run('UPDATE v2_strategies SET name = ?, current_version = ?, updated_at = ? WHERE id = ?', definition.name, next, at, id);
        return true;
      });
      return ok ? this.strategies.get(id) : null;
    },
    remove: async (id: string) => this.run('DELETE FROM v2_strategies WHERE id = ?', id) > 0,
    versions: async (id: string): Promise<V2StrategyVersion[]> =>
      this.all('SELECT version, definition, created_at FROM v2_strategy_versions WHERE strategy_id = ? ORDER BY version DESC', id).map((r) => ({
        version: Number(r.version),
        definition: parse(r.definition),
        createdAt: r.created_at,
      })),
  };

  connections = {
    counts: async () => {
      const r = this.one('SELECT count(*) AS total, coalesce(sum(enabled), 0) AS enabled FROM v2_connections');
      return { total: Number(r?.total ?? 0), enabled: Number(r?.enabled ?? 0) };
    },
    list: async (strategyId?: string) =>
      (strategyId ? this.all('SELECT * FROM v2_connections WHERE strategy_id = ? ORDER BY created_at', strategyId) : this.all('SELECT * FROM v2_connections ORDER BY created_at')).map(mapConnection),
    get: async (id: string) => {
      const r = this.one('SELECT * FROM v2_connections WHERE id = ?', id);
      return r ? mapConnection(r) : null;
    },
    create: async (strategyId: string, productId: string, config: ConnectionConfig) => {
      const at = this.iso();
      const r = this.one('INSERT INTO v2_connections (id, strategy_id, product_id, config, created_at, updated_at) VALUES (?,?,?,?,?,?) RETURNING *', randomUUID(), strategyId, productId, json(config), at, at);
      return mapConnection(r!);
    },
    update: async (id: string, config: ConnectionConfig) => {
      const r = this.one('UPDATE v2_connections SET config = ?, updated_at = ? WHERE id = ? RETURNING *', json(config), this.iso(), id);
      return r ? mapConnection(r) : null;
    },
    setEnabled: async (id: string, enabled: boolean, at: string) => {
      const r = this.one('UPDATE v2_connections SET enabled = ?, enabled_at = CASE WHEN ? THEN ? ELSE enabled_at END, updated_at = ? WHERE id = ? RETURNING *', bool(enabled), bool(enabled), at, this.iso(), id);
      return r ? mapConnection(r) : null;
    },
    setEnabledMany: async (ids: string[], enabled: boolean, at: string) => {
      if (!ids.length) return 0;
      return this.run(`UPDATE v2_connections SET enabled = ?, enabled_at = CASE WHEN ? THEN ? ELSE enabled_at END, updated_at = ? WHERE ${inList('id')}`, bool(enabled), bool(enabled), at, this.iso(), json(ids));
    },
    remove: async (id: string) => this.run('DELETE FROM v2_connections WHERE id = ?', id) > 0,
  };

  units = {
    list: async (connectionId: string) => this.all('SELECT * FROM v2_unit_state WHERE connection_id = ? ORDER BY unit_key', connectionId).map(mapUnit),
    get: async (connectionId: string, unitKey: string) => {
      const r = this.one('SELECT * FROM v2_unit_state WHERE connection_id = ? AND unit_key = ?', connectionId, unitKey);
      return r ? mapUnit(r) : null;
    },
    listFor: async (connectionIds: string[]) => (connectionIds.length ? this.all(`SELECT * FROM v2_unit_state WHERE ${inList('connection_id')}`, json(connectionIds)).map(mapUnit) : []),
    upsert: async (s: UnitState) => this.units.upsertMany([s]),
    upsertMany: async (list: UnitState[]) => {
      if (!list.length) return;
      const at = this.iso();
      transaction(this.db, () => {
        for (const s of list) {
          this.run(
            `INSERT INTO v2_unit_state (connection_id, unit_key, state, last_evaluated_candle, last_result, last_signal_candle, last_alert_at, cooldown_until, last_evaluation, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT (connection_id, unit_key) DO UPDATE SET
               state = excluded.state, last_evaluated_candle = excluded.last_evaluated_candle, last_result = excluded.last_result,
               last_signal_candle = excluded.last_signal_candle, last_alert_at = excluded.last_alert_at,
               cooldown_until = excluded.cooldown_until, last_evaluation = excluded.last_evaluation, updated_at = excluded.updated_at`,
            s.connectionId,
            s.unitKey,
            s.state,
            s.lastEvaluatedCandle,
            s.lastResult,
            s.lastSignalCandle,
            s.lastAlertAt,
            s.cooldownUntil,
            s.lastEvaluation ? json(s.lastEvaluation) : null,
            at,
          );
        }
      });
    },
    clear: async (connectionId: string) => {
      this.run('DELETE FROM v2_unit_state WHERE connection_id = ?', connectionId);
    },
    clearMany: async (connectionIds: string[]) => {
      if (connectionIds.length) this.run(`DELETE FROM v2_unit_state WHERE ${inList('connection_id')}`, json(connectionIds));
    },
    disableMany: async (connectionIds: string[]) => {
      if (connectionIds.length) this.run(`UPDATE v2_unit_state SET state = 'DISABLED', updated_at = ? WHERE ${inList('connection_id')}`, this.iso(), json(connectionIds));
    },
  };

  signals = {
    insert: async (s: NewSignal) => {
      const r = this.one(
        `INSERT INTO v2_signals (id, identity, connection_id, strategy_id, version, unit_key, trigger_timeframe, candle_time, outcome, evaluation, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (identity) DO NOTHING RETURNING *`,
        s.id ?? randomUUID(),
        s.identity,
        s.connectionId,
        s.strategyId,
        s.version,
        s.unitKey,
        s.triggerTimeframe,
        s.candleTime,
        s.outcome,
        json(s.evaluation),
        s.createdAt ?? this.iso(),
      );
      return r ? mapSignal(r) : null;
    },
    list: async (f: SignalFilters): Promise<V2SignalItem[]> => {
      const where: string[] = [];
      const vals: Param[] = [];
      recordWhere(f, "json_extract(evaluation, '$.productId')", where, vals);
      if (f.outcomes?.length) {
        vals.push(json(f.outcomes));
        where.push(inList('outcome'));
      }
      vals.push(Math.min(f.limit ?? 100, 1000));
      const cols = `id, identity, connection_id, strategy_id, version, unit_key, trigger_timeframe, candle_time, outcome, json_remove(evaluation, '$.trace') AS evaluation, created_at`;
      return this.all(`SELECT ${cols} FROM v2_signals ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`, ...vals).map(mapSignal);
    },
  };

  private deliveriesFor(ids: string[]): Map<string, Delivery[]> {
    const out = new Map<string, Delivery[]>();
    if (!ids.length) return out;
    for (const r of this.all(`SELECT * FROM v2_deliveries WHERE ${inList('alert_id')} ORDER BY sent_at`, json(ids))) {
      const list = out.get(r.alert_id) ?? [];
      list.push({ channel: r.channel, target: r.target ?? undefined, status: r.status, error: r.error ?? undefined, sentAt: r.sent_at });
      out.set(r.alert_id, list);
    }
    return out;
  }

  alerts = {
    insert: async (a: NewAlert) => {
      const r = this.one(
        `INSERT INTO v2_alerts (id, signal_id, connection_id, strategy_id, strategy_name, version, product_id, status, unit, trigger_timeframe, candle_time, evaluation, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
        a.id ?? randomUUID(),
        a.signalId,
        a.connectionId,
        a.strategyId,
        a.strategyName,
        a.version,
        a.productId,
        a.status,
        json(a.unit),
        a.triggerTimeframe,
        a.candleTime,
        json(a.evaluation),
        a.createdAt ?? this.iso(),
      );
      return mapAlert(r!, []);
    },
    addDelivery: async (alertId: string, d: Delivery) => {
      this.run('INSERT INTO v2_deliveries (id, alert_id, channel, target, status, error, sent_at) VALUES (?,?,?,?,?,?,?)', randomUUID(), alertId, d.channel, d.target ?? null, d.status, d.error ?? null, d.sentAt);
    },
    setStatus: async (alertId: string, status: V2Alert['status']) => {
      this.run('UPDATE v2_alerts SET status = ? WHERE id = ?', status, alertId);
    },
    acknowledge: async (alertId: string, at: string) => {
      this.run(`UPDATE v2_alerts SET status = 'ACKNOWLEDGED', acknowledged_at = ? WHERE id = ?`, at, alertId);
      return this.alerts.get(alertId);
    },
    get: async (id: string) => {
      const r = this.one('SELECT * FROM v2_alerts WHERE id = ?', id);
      return r ? mapAlert(r, this.deliveriesFor([id]).get(id) ?? []) : null;
    },
    list: async (f: AlertFilters): Promise<V2AlertItem[]> => {
      const where: string[] = [];
      const vals: Param[] = [];
      recordWhere(f, 'product_id', where, vals);
      if (f.active) where.push('acknowledged_at IS NULL');
      if (f.statuses?.length) {
        vals.push(json(f.statuses));
        where.push(inList('status'));
      }
      if (f.sources?.length) {
        vals.push(json(f.sources));
        where.push(`COALESCE(json_extract(evaluation, '$.source'), 'HISTORICAL') IN (SELECT value FROM json_each(?))`);
      }
      vals.push(Math.min(f.limit ?? 200, 1000));
      const cols = `id, signal_id, connection_id, strategy_id, strategy_name, version, product_id, status, unit, trigger_timeframe, candle_time, json_remove(evaluation, '$.trace', '$.unit') AS evaluation, acknowledged_at, created_at`;
      const rows = this.all(`SELECT ${cols} FROM v2_alerts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`, ...vals);
      const deliveries = this.deliveriesFor(rows.map((r) => r.id));
      return rows.map((r) => mapAlert(r, deliveries.get(r.id) ?? []));
    },
    feed: async (after: string | null, limit: number): Promise<AlertFeedItem[]> =>
      (after
        ? this.all('SELECT id, strategy_name, product_id, unit, created_at FROM v2_alerts WHERE created_at > ? ORDER BY created_at DESC LIMIT ?', after, Math.min(limit, 100))
        : this.all('SELECT id, strategy_name, product_id, unit, created_at FROM v2_alerts ORDER BY created_at DESC LIMIT ?', Math.min(limit, 100))
      ).map((r) => ({ id: r.id, strategyName: r.strategy_name, productId: r.product_id, unit: parse(r.unit), createdAt: r.created_at })),
  };

  scanRuns = {
    insert: async (run: ScanRun) => {
      const { id, startedAt, finishedAt, status, ...summary } = run;
      this.run('INSERT INTO v2_scan_runs (id, started_at, finished_at, status, summary) VALUES (?,?,?,?,?)', id, startedAt, finishedAt, status, json(summary));
    },
    list: async (limit: number) =>
      this.all('SELECT * FROM v2_scan_runs ORDER BY started_at DESC LIMIT ?', limit).map((r): ScanRun => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, ...parse<object>(r.summary) }) as ScanRun),
    prune: async (before: string) => {
      this.run('DELETE FROM v2_scan_runs WHERE started_at < ?', before);
    },
  };

  settings = {
    get: async (): Promise<V2Settings> => settingsFromStored(parse(this.one(`SELECT value FROM v2_settings WHERE key = 'settings'`)?.value)),
    save: async (s: V2Settings) => {
      this.run(`INSERT INTO v2_settings (key, value, updated_at) VALUES ('settings', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, json(s), this.iso());
      return s;
    },
  };

  locks = {
    acquire: async (name: string, leaseSeconds: number, minIntervalSeconds: number) => {
      const now = this.clock();
      const iso = (ms: number) => new Date(ms).toISOString();
      const r = this.one(
        `INSERT INTO app_locks (name, locked_until) VALUES (?, ?)
         ON CONFLICT (name) DO UPDATE SET locked_until = excluded.locked_until
         WHERE app_locks.locked_until < ? AND (app_locks.last_run_at IS NULL OR app_locks.last_run_at < ?)
         RETURNING name`,
        name,
        iso(now + leaseSeconds * 1000),
        iso(now),
        iso(now - minIntervalSeconds * 1000),
      );
      return !!r;
    },
    release: async (name: string) => {
      const at = this.iso();
      this.run('UPDATE app_locks SET locked_until = ?, last_run_at = ? WHERE name = ?', at, at, name);
    },
  };

  paper = {
    getPlan: async (strategyId: string) => parse<PaperPlan | null>(this.one('SELECT plan FROM v2_paper_plans WHERE strategy_id = ?', strategyId)?.plan),
    savePlan: async (strategyId: string, plan: PaperPlan) => {
      this.run(
        `INSERT INTO v2_paper_plans (strategy_id, plan, updated_at) VALUES (?, ?, ?) ON CONFLICT (strategy_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at`,
        strategyId,
        json(plan),
        this.iso(),
      );
      return plan;
    },
    listPlans: async () => this.all('SELECT strategy_id, plan FROM v2_paper_plans').map((r) => ({ strategyId: r.strategy_id as string, plan: parse<PaperPlan>(r.plan) })),
    insertTrade: async (t: NewPaperTrade) => {
      const id = t.id ?? randomUUID();
      const trade: PaperTrade = { ...t, id };
      const changed = this.run(
        `INSERT INTO v2_paper_trades (id, strategy_id, connection_id, product_id, slot, alert_id, status, entry_at, trade, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (connection_id, slot) WHERE status = 'OPEN' DO NOTHING`,
        id,
        t.strategyId,
        t.connectionId,
        t.productId,
        t.slot,
        t.alertId,
        t.status,
        t.entryAt,
        json(trade),
        this.iso(),
      );
      return changed ? trade : null;
    },
    openFor: async (connectionId: string, slot: string) => {
      const r = this.one(`SELECT id, trade FROM v2_paper_trades WHERE connection_id = ? AND slot = ? AND status = 'OPEN' LIMIT 1`, connectionId, slot);
      return r ? mapPaperTrade(r) : null;
    },
    listOpen: async () => this.all(`SELECT id, trade FROM v2_paper_trades WHERE status = 'OPEN' ORDER BY entry_at`).map(mapPaperTrade),
    closeTrade: async (id: string, patch: Pick<PaperTrade, 'exitAt' | 'exitPrice' | 'exitReason' | 'grossPnl' | 'charges' | 'netPnl' | 'lastPrice' | 'lastPriceAt'>) =>
      transaction(this.db, () => {
        const r = this.one(`SELECT id, trade FROM v2_paper_trades WHERE id = ? AND status = 'OPEN'`, id);
        if (!r) return null; // closed already (another process got there first)
        const trade: PaperTrade = { ...mapPaperTrade(r), ...patch, status: 'CLOSED' };
        this.run(`UPDATE v2_paper_trades SET status = 'CLOSED', exit_at = ?, net_pnl = ?, trade = ?, updated_at = ? WHERE id = ? AND status = 'OPEN'`, patch.exitAt, patch.netPnl, json(trade), this.iso(), id);
        return trade;
      }),
    updateMarks: async (marks: Array<{ id: string; lastPrice: number; at: string }>) => {
      if (!marks.length) return;
      transaction(this.db, () => {
        for (const m of marks) this.run(`UPDATE v2_paper_trades SET trade = json_set(trade, '$.lastPrice', ?, '$.lastPriceAt', ?) WHERE id = ? AND status = 'OPEN'`, m.lastPrice, m.at, m.id);
      });
    },
    listTrades: async (f: { status?: 'OPEN' | 'CLOSED'; strategyId?: string; connectionId?: string; since?: string; limit?: number }) => {
      const where: string[] = [];
      const vals: Param[] = [];
      if (f.status) {
        vals.push(f.status);
        where.push('status = ?');
      }
      if (f.strategyId) {
        vals.push(f.strategyId);
        where.push('strategy_id = ?');
      }
      if (f.connectionId) {
        vals.push(f.connectionId);
        where.push('connection_id = ?');
      }
      if (f.since) {
        vals.push(f.since);
        where.push('entry_at >= ?');
      }
      vals.push(Math.min(f.limit ?? 1000, 50_000));
      return this.all(`SELECT id, trade FROM v2_paper_trades ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY entry_at DESC LIMIT ?`, ...vals).map(mapPaperTrade);
    },
    reset: async (strategyId: string) => this.run('DELETE FROM v2_paper_trades WHERE strategy_id = ?', strategyId),
    closedVersion: async () => {
      const r = this.one(`SELECT count(*) AS n, max(updated_at) AS at FROM v2_paper_trades WHERE status = 'CLOSED'`);
      return `${r?.n ?? 0}|${r?.at ?? ''}`;
    },
    getOverride: async (connectionId: string) => parse<PaperOverride | null>(this.one('SELECT override FROM v2_paper_overrides WHERE connection_id = ?', connectionId)?.override),
    saveOverride: async (connectionId: string, override: PaperOverride) => {
      if (!Object.keys(override).length) {
        this.run('DELETE FROM v2_paper_overrides WHERE connection_id = ?', connectionId);
        return null;
      }
      this.run(
        `INSERT INTO v2_paper_overrides (connection_id, override, updated_at) VALUES (?, ?, ?) ON CONFLICT (connection_id) DO UPDATE SET override = excluded.override, updated_at = excluded.updated_at`,
        connectionId,
        json(override),
        this.iso(),
      );
      return override;
    },
    listOverrides: async () => this.all('SELECT connection_id, override FROM v2_paper_overrides').map((r) => ({ connectionId: r.connection_id as string, override: parse<PaperOverride>(r.override) })),
  };

  contextStamp = async (): Promise<string> =>
    String(
      this.one(`SELECT concat_ws('|',
        (SELECT count(*) FROM v2_connections), (SELECT max(updated_at) FROM v2_connections),
        (SELECT count(*) FROM v2_strategies), (SELECT max(updated_at) FROM v2_strategies),
        (SELECT max(updated_at) FROM v2_settings), (SELECT max(updated_at) FROM v2_products),
        (SELECT group_concat(market || date || kind || coalesce(open_min, '') || coalesce(close_min, ''), ',') FROM (SELECT * FROM v2_calendar ORDER BY market, date))
      ) AS stamp`)?.stamp ?? '',
    );

  maintenance = {
    size: async (): Promise<DatabaseSize> => {
      const page = Number((this.one('PRAGMA page_size') as { page_size: number }).page_size);
      const pages = Number((this.one('PRAGMA page_count') as { page_count: number }).page_count);
      let tables: DatabaseSize['tables'] = [];
      try {
        tables = this.all("SELECT name, sum(pgsize) AS bytes FROM dbstat WHERE name LIKE 'v2\\_%' ESCAPE '\\' OR name IN ('kite_session', 'user_preferences') GROUP BY name ORDER BY 2 DESC LIMIT 12").map((r) => ({ name: String(r.name), bytes: Number(r.bytes) }));
      } catch {
        /* this SQLite has no dbstat table — the total is enough */
      }
      return { engine: 'sqlite', bytes: page * pages, limitBytes: null, tables };
    },
    prune: async (before: string): Promise<PruneResult> =>
      transaction(this.db, () => {
        const paperTrades = this.run(`DELETE FROM v2_paper_trades WHERE status = 'CLOSED' AND exit_at < ?`, before);
        const alerts = this.run('DELETE FROM v2_alerts WHERE created_at < ?', before); // deliveries go with them
        const signals = this.run('DELETE FROM v2_signals WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM v2_alerts a WHERE a.signal_id = v2_signals.id)', before);
        const scanRuns = this.run('DELETE FROM v2_scan_runs WHERE started_at < ?', before);
        return { alerts, signals, paperTrades, scanRuns };
      }),
  };

  live = {
    get: async () => {
      const r = this.one("SELECT status, offline_notified_at FROM v2_live_status WHERE id = 'main'");
      return r ? { status: parse<LiveStatus>(r.status), offlineNotifiedAt: (r.offline_notified_at as string | null) ?? null } : null;
    },
    save: async (status: LiveStatus) => {
      this.run(
        `INSERT INTO v2_live_status (id, worker_id, heartbeat_at, status, offline_notified_at) VALUES ('main', ?, ?, ?, NULL)
         ON CONFLICT (id) DO UPDATE SET worker_id = excluded.worker_id, heartbeat_at = excluded.heartbeat_at, status = excluded.status, offline_notified_at = NULL`,
        status.workerId,
        status.heartbeatAt,
        json(status),
      );
    },
    markOfflineNotified: async (at: string) => {
      this.run("UPDATE v2_live_status SET offline_notified_at = ? WHERE id = 'main'", at);
    },
  };
}
