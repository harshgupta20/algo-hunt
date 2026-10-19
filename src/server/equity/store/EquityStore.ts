/**
 * Equity persistence: strategies and watchlists only (small, changed by hand). Candles, backtests and screens
 * never touch the database.
 */
import type { EqStrategy, EqStrategyDefinition, EqWatchlist } from '@/shared/equity';

export interface WatchlistInput {
  name: string;
  symbols: string[];
}

export interface EquityStore {
  strategies: {
    list(): Promise<EqStrategy[]>;
    get(id: string): Promise<EqStrategy | null>;
    create(definition: EqStrategyDefinition): Promise<EqStrategy>;
    /** Saves a new version (version + 1); null when it doesn't exist. */
    update(id: string, definition: EqStrategyDefinition): Promise<EqStrategy | null>;
    remove(id: string): Promise<boolean>;
  };
  watchlists: {
    list(): Promise<EqWatchlist[]>;
    get(id: string): Promise<EqWatchlist | null>;
    create(input: WatchlistInput): Promise<EqWatchlist>;
    update(id: string, input: WatchlistInput): Promise<EqWatchlist | null>;
    remove(id: string): Promise<boolean>;
  };
}
