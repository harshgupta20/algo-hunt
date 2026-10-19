/** In-memory equity store (tests, and a fallback when no database is configured). */
import { randomUUID } from 'node:crypto';
import type { EqStrategy, EqStrategyDefinition, EqWatchlist } from '@/shared/equity';
import type { EquityStore, WatchlistInput } from './EquityStore';

const byNewest = <T extends { updatedAt: string; name: string }>(a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name);
const clone = <T>(v: T): T => structuredClone(v);

export class MemoryEquityStore implements EquityStore {
  private readonly s = new Map<string, EqStrategy>();
  private readonly w = new Map<string, EqWatchlist>();

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
    remove: async (id: string) => this.s.delete(id),
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
}
