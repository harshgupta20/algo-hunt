/** In-memory equity store (tests, and a fallback when no database is configured). */
import { randomUUID } from 'node:crypto';
import type { EqBacktestRecord, EqBacktestRun, EqStrategy, EqStrategyDefinition, EqWatchlist } from '@/shared/equity';
import type { BacktestInput, EquityStore, WatchlistInput } from './EquityStore';
import { MAX_KEPT_BYTES, packResult, unpackResult } from './pack';

const byNewest = <T extends { updatedAt: string; name: string }>(a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name);
const clone = <T>(v: T): T => structuredClone(v);

export class MemoryEquityStore implements EquityStore {
  private readonly s = new Map<string, EqStrategy>();
  private readonly w = new Map<string, EqWatchlist>();
  private readonly b = new Map<string, { run: EqBacktestRun; request: EqBacktestRecord['request']; packed: Buffer | null }>();

  constructor(private readonly now: () => number = Date.now) {}

  private stamp() {
    return new Date(this.now()).toISOString();
  }

  strategies = {
    list: async () => [...this.s.values()].map(clone).sort(byNewest),
    get: async (id: string) => (this.s.has(id) ? clone(this.s.get(id)!) : null),
    create: async (definition: EqStrategyDefinition) => {
      const at = this.stamp();
      const row: EqStrategy = { id: randomUUID(), name: definition.name, definition: clone(definition), version: 1, createdAt: at, updatedAt: at };
      this.s.set(row.id, row);
      return clone(row);
    },
    update: async (id: string, definition: EqStrategyDefinition) => {
      const old = this.s.get(id);
      if (!old) return null;
      const row: EqStrategy = { ...old, name: definition.name, definition: clone(definition), version: old.version + 1, updatedAt: this.stamp() };
      this.s.set(id, row);
      return clone(row);
    },
    remove: async (id: string) => {
      for (const e of this.b.values()) if (e.run.strategyId === id) e.run.strategyId = null; // kept in the history
      return this.s.delete(id);
    },
  };

  watchlists = {
    list: async () => [...this.w.values()].map(clone).sort(byNewest),
    get: async (id: string) => (this.w.has(id) ? clone(this.w.get(id)!) : null),
    create: async (input: WatchlistInput) => {
      const at = this.stamp();
      const row: EqWatchlist = { id: randomUUID(), name: input.name, symbols: [...input.symbols], createdAt: at, updatedAt: at };
      this.w.set(row.id, row);
      return clone(row);
    },
    update: async (id: string, input: WatchlistInput) => {
      const old = this.w.get(id);
      if (!old) return null;
      const row: EqWatchlist = { ...old, name: input.name, symbols: [...input.symbols], updatedAt: this.stamp() };
      this.w.set(id, row);
      return clone(row);
    },
    remove: async (id: string) => this.w.delete(id),
  };

  backtests = {
    list: async () => [...this.b.values()].map((e) => clone(e.run)).sort((a, b) => b.ranAt.localeCompare(a.ranAt)),
    get: async (id: string): Promise<EqBacktestRecord | null> => {
      const e = this.b.get(id);
      return e ? { run: clone(e.run), request: clone(e.request), result: e.packed ? await unpackResult(e.packed) : null } : null;
    },
    add: async (input: BacktestInput) => {
      const packed = await packResult(input.result);
      const kept = packed.length <= MAX_KEPT_BYTES;
      const strategyId = input.run.strategyId && this.s.has(input.run.strategyId) ? input.run.strategyId : null;
      const run: EqBacktestRun = { ...clone(input.run), strategyId, id: randomUUID(), kept, bytes: packed.length };
      this.b.set(run.id, { run, request: clone(input.request), packed: kept ? packed : null });
      return clone(run);
    },
    remove: async (id: string) => this.b.delete(id),
  };
}
