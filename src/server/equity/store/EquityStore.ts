/**
 * Equity persistence: strategies and watchlists (small, changed by hand) and the backtest history (a line per
 * finished backtest + its packed result). Candles and screens never touch the database.
 */
import type { EqBacktestRecord, EqBacktestRun, EqStrategy, EqStrategyDefinition, EqWatchlist } from '@/shared/equity';

export interface WatchlistInput {
  name: string;
  symbols: string[];
}

/** A finished backtest to keep: its history line (id / kept / bytes are the store's) + request + result. */
export interface BacktestInput {
  run: Omit<EqBacktestRun, 'id' | 'kept' | 'bytes'>;
  request: EqBacktestRecord['request'];
  result: NonNullable<EqBacktestRecord['result']>;
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
  backtests: {
    /** The history, newest first — lines only (no results). */
    list(): Promise<EqBacktestRun[]>;
    /** One entry with its request and result (unpacked). */
    get(id: string): Promise<EqBacktestRecord | null>;
    add(input: BacktestInput): Promise<EqBacktestRun>;
    remove(id: string): Promise<boolean>;
  };
}
