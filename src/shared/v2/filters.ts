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
  limit?: number;
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
