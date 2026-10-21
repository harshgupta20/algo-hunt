/**
 * Equity store on Postgres (Neon): eq_strategies and eq_watchlists (db/migrations/012_equity.sql), and the
 * backtest history eq_backtests (014). Strategies, watchlists and the history LINES are small and change only
 * when the trader acts, so each is read ONCE per process and then served from memory; every write goes to the
 * database first and then updates the copy. A history entry's packed result is read only when it's opened
 * (Neon transfer stays near zero).
 */
import type pg from 'pg';
import type { EqBacktestRecord, EqBacktestRun, EqStrategy, EqStrategyDefinition, EqWatchlist } from '@/shared/equity';
import { getPool } from '../../db/pool';
import type { BacktestInput, EquityStore, WatchlistInput } from './EquityStore';
import { MAX_KEPT_BYTES, packResult, unpackResult } from './pack';

interface StrategyRow {
  id: string;
  name: string;
  definition: EqStrategyDefinition;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface WatchlistRow {
  id: string;
  name: string;
  symbols: string[];
  created_at: Date;
  updated_at: Date;
}

interface BacktestRow {
  id: string;
  strategy_id: string | null;
  run: Omit<EqBacktestRun, 'id' | 'strategyId'>;
}

const backtestRun = (r: BacktestRow): EqBacktestRun => ({ ...r.run, id: r.id, strategyId: r.strategy_id });
const byRecent = (a: EqBacktestRun, b: EqBacktestRun) => b.ranAt.localeCompare(a.ranAt);

const strategy = (r: StrategyRow): EqStrategy => ({ id: r.id, name: r.name, definition: r.definition, version: r.version, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });
const watchlist = (r: WatchlistRow): EqWatchlist => ({ id: r.id, name: r.name, symbols: r.symbols, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });
const byNewest = <T extends { updatedAt: string; name: string }>(a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name);
const clone = <T>(v: T): T => structuredClone(v);

/** A table read once, then kept in memory. */
class Cached<T extends { id: string; updatedAt: string; name: string }> {
  private rows: Map<string, T> | null = null;
  private loading: Promise<Map<string, T>> | null = null;

  constructor(private readonly load: () => Promise<T[]>) {}

  async all(): Promise<Map<string, T>> {
    if (this.rows) return this.rows;
    this.loading ??= this.load()
      .then((list) => (this.rows = new Map(list.map((r) => [r.id, r]))))
      .finally(() => (this.loading = null));
    return this.loading;
  }

  async list(): Promise<T[]> {
    return [...(await this.all()).values()].map(clone).sort(byNewest);
  }

  async get(id: string): Promise<T | null> {
    const r = (await this.all()).get(id);
    return r ? clone(r) : null;
  }

  async put(r: T) {
    (await this.all()).set(r.id, r);
    return clone(r);
  }

  async drop(id: string) {
    (await this.all()).delete(id);
  }
}

export class PgEquityStore implements EquityStore {
  private readonly s: Cached<EqStrategy>;
  private readonly w: Cached<EqWatchlist>;
  /** The history lines, read once (results stay in the database until an entry is opened). */
  private runs: Promise<Map<string, EqBacktestRun>> | null = null;

  private runMap(): Promise<Map<string, EqBacktestRun>> {
    this.runs ??= this.pool()
      .query<BacktestRow>('SELECT id, strategy_id, run FROM eq_backtests')
      .then((r) => new Map(r.rows.map((x) => [x.id, backtestRun(x)])));
    return this.runs.catch((err: unknown) => {
      this.runs = null; // try again next time
      throw err;
    });
  }

  constructor(private readonly pool: () => pg.Pool = getPool) {
    this.s = new Cached(async () => (await this.pool().query<StrategyRow>('SELECT id, name, definition, version, created_at, updated_at FROM eq_strategies')).rows.map(strategy));
    this.w = new Cached(async () => (await this.pool().query<WatchlistRow>('SELECT id, name, symbols, created_at, updated_at FROM eq_watchlists')).rows.map(watchlist));
  }

  strategies = {
    list: () => this.s.list(),
    get: (id: string) => this.s.get(id),
    create: async (definition: EqStrategyDefinition) => {
      const { rows } = await this.pool().query<StrategyRow>('INSERT INTO eq_strategies (name, definition) VALUES ($1, $2) RETURNING id, name, definition, version, created_at, updated_at', [definition.name, JSON.stringify(definition)]);
      return this.s.put(strategy(rows[0]!));
    },
    update: async (id: string, definition: EqStrategyDefinition) => {
      const { rows } = await this.pool().query<StrategyRow>(
        'UPDATE eq_strategies SET name = $2, definition = $3, version = version + 1, updated_at = now() WHERE id = $1 RETURNING id, name, definition, version, created_at, updated_at',
        [id, definition.name, JSON.stringify(definition)],
      );
      return rows[0] ? this.s.put(strategy(rows[0])) : null;
    },
    remove: async (id: string) => {
      const { rowCount } = await this.pool().query('DELETE FROM eq_strategies WHERE id = $1', [id]);
      await this.s.drop(id);
      // Its backtests stay in the history (the database sets their strategy to NULL; so does the copy).
      if (this.runs) for (const r of (await this.runMap()).values()) if (r.strategyId === id) r.strategyId = null;
      return (rowCount ?? 0) > 0;
    },
  };

  watchlists = {
    list: () => this.w.list(),
    get: (id: string) => this.w.get(id),
    create: async (input: WatchlistInput) => {
      const { rows } = await this.pool().query<WatchlistRow>('INSERT INTO eq_watchlists (name, symbols) VALUES ($1, $2) RETURNING id, name, symbols, created_at, updated_at', [input.name, JSON.stringify(input.symbols)]);
      return this.w.put(watchlist(rows[0]!));
    },
    update: async (id: string, input: WatchlistInput) => {
      const { rows } = await this.pool().query<WatchlistRow>('UPDATE eq_watchlists SET name = $2, symbols = $3, updated_at = now() WHERE id = $1 RETURNING id, name, symbols, created_at, updated_at', [id, input.name, JSON.stringify(input.symbols)]);
      return rows[0] ? this.w.put(watchlist(rows[0])) : null;
    },
    remove: async (id: string) => {
      const { rowCount } = await this.pool().query('DELETE FROM eq_watchlists WHERE id = $1', [id]);
      await this.w.drop(id);
      return (rowCount ?? 0) > 0;
    },
  };

  backtests = {
    list: async () => [...(await this.runMap()).values()].map(clone).sort(byRecent),
    get: async (id: string): Promise<EqBacktestRecord | null> => {
      const r = (await this.pool().query<BacktestRow & { request: EqBacktestRecord['request']; result: Buffer | null }>('SELECT id, strategy_id, run, request, result FROM eq_backtests WHERE id = $1', [id])).rows[0];
      return r ? { run: backtestRun(r), request: r.request, result: r.result ? await unpackResult(r.result) : null } : null;
    },
    add: async (input: BacktestInput) => {
      const packed = await packResult(input.result);
      const kept = packed.length <= MAX_KEPT_BYTES;
      const { strategyId, ...run } = { ...input.run, kept, bytes: packed.length };
      // A strategy deleted while the backtest ran: keep the entry, without the link.
      const { rows } = await this.pool().query<BacktestRow>(
        `INSERT INTO eq_backtests (strategy_id, ran_at, run, request, result) VALUES ((SELECT id FROM eq_strategies WHERE id = $1::uuid), $2, $3, $4, $5)
         RETURNING id, strategy_id, run`,
        [strategyId, run.ranAt, JSON.stringify(run), JSON.stringify(input.request), kept ? packed : null],
      );
      const out = backtestRun(rows[0]!);
      (await this.runMap()).set(out.id, out);
      return clone(out);
    },
    remove: async (id: string) => {
      const { rowCount } = await this.pool().query('DELETE FROM eq_backtests WHERE id = $1', [id]);
      (await this.runMap()).delete(id);
      return (rowCount ?? 0) > 0;
    },
  };
}
