/**
 * Filters the trader applies to alerts, signals and paper trades — one model for the API and the UI.
 * Dates are IST calendar days (inclusive); groups are the ids of the top-level groups that fired
 * (the UI offers them by label, e.g. "Bullish").
 */
import type { PaperSide } from './paper';
import type { AlertStatus, EvaluationSource, Market, ProductKind, SignalOutcome, Timeframe } from './types';

export interface RecordFilters {
  strategyId?: string;
  connectionId?: string;
  kinds?: ProductKind[];
  markets?: Market[];
  /** Product symbol contains (any case). */
  search?: string;
  /** The strategy's trigger timeframe. */
  timeframes?: Timeframe[];
  /** From / to IST date (yyyy-mm-dd, inclusive). */
  from?: string;
  to?: string;
  groups?: string[];
  /** Page size. */
  limit?: number;
  /** The next page: rows older than this cursor (see pageCursor). */
  before?: string;
}

export interface AlertQuery extends RecordFilters {
  active?: boolean;
  statuses?: AlertStatus[];
  sources?: EvaluationSource[];
}

export interface SignalQuery extends RecordFilters {
  outcomes?: SignalOutcome[];
}

export interface PaperQuery extends RecordFilters {
  status?: 'OPEN' | 'CLOSED';
  sides?: PaperSide[];
  /** Closed trades that made money (net > 0) / lost money (net < 0). */
  result?: 'win' | 'loss';
}

/**
 * Paging for long lists (newest first): a page ends at some row; the next page is everything older than it.
 * The cursor is that row's time (alerts / signals: recorded; paper trades: entered) and id — "time|id".
 */
export function pageCursor(at: string, id: string): string {
  return `${at}|${id}`;
}

export function parseCursor(v: string | null | undefined): { at: string; id: string } | undefined {
  if (!v) return undefined;
  const i = v.lastIndexOf('|');
  const at = v.slice(0, i);
  const id = v.slice(i + 1);
  if (i < 1 || Number.isNaN(Date.parse(at)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid page cursor');
  return { at: new Date(at).toISOString(), id };
}

/** Newest first, ties by id (the order pages follow). */
export function newestFirst<T extends { id: string }>(time: (r: T) => string): (a: T, b: T) => number {
  return (a, b) => time(b).localeCompare(time(a)) || b.id.localeCompare(a.id);
}

/** Is the row older than the cursor (on the next page)? */
export function olderThan(at: string, id: string, c: { at: string; id: string }): boolean {
  return at < c.at || (at === c.at && id < c.id);
}

export const PRODUCT_KINDS: ProductKind[] = ['INDEX', 'STOCK', 'COMMODITY'];
export const MARKETS: Market[] = ['NSE', 'MCX'];
export const ALERT_STATUSES: AlertStatus[] = ['SENT', 'PARTIAL', 'FAILED', 'ACKNOWLEDGED'];
export const EVALUATION_SOURCES: EvaluationSource[] = ['LIVE_VERIFIED', 'HISTORICAL', 'LIVE', 'LIVE_UNVERIFIED'];
export const SIGNAL_OUTCOMES: SignalOutcome[] = ['ALERTED', 'NO_CHANNEL', 'SUPPRESSED_COOLDOWN', 'SUPPRESSED_ACKNOWLEDGED', 'SUPPRESSED_STALE', 'SUPPRESSED_BEFORE_ENABLE'];

/** Query-string form (lists comma-separated), for the API client. */
export function filterParams(q: object): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else p.set(k, v === true ? '1' : String(v));
  }
  return p;
}
