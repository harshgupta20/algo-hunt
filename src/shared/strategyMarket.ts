/**
 * Market-profile rules shared by the builder, the run forms (backtest +
 * monitors) and the server that enforces them. A strategy FIXES some of
 * underlying / expiry / strike / timeframe and leaves the rest OPEN; a run
 * supplies only the open ones, and fixed values always win.
 */
import type { ExpiryType, StrikeSelection } from './types/config';
import type { Timeframe } from './types/market';
import type { StrategyDef, StrategyMarket } from './types/builder';

export type MarketField = 'underlying' | 'expiryType' | 'strikeSelection' | 'timeframe';

export const MARKET_FIELDS: MarketField[] = ['underlying', 'expiryType', 'strikeSelection', 'timeframe'];

export const MARKET_FIELD_LABEL: Record<MarketField, string> = {
  underlying: 'Underlying',
  expiryType: 'Expiry',
  strikeSelection: 'Strike',
  timeframe: 'Timeframe',
};

/** The run-time context a backtest or monitor needs. */
export interface RunContext {
  underlying: string;
  expiryType: ExpiryType;
  strikeSelection: StrikeSelection;
  timeframe: Timeframe;
}

/** The built-in RSI strategy runs anywhere: every field is open. */
export const UNIVERSAL_MARKET: StrategyMarket = {};

/** Market profile of a strategy id ('rsi-sync' or a custom definition). */
export function marketOf(strategy: string, custom?: Pick<StrategyDef, 'id' | 'market'> | null): StrategyMarket {
  if (strategy === 'rsi-sync' || !custom) return UNIVERSAL_MARKET;
  return custom.market ?? UNIVERSAL_MARKET;
}

export function fixedUnderlyings(m: StrategyMarket): string[] {
  return m.underlyings?.filter(Boolean) ?? [];
}

/** Whether each field is fixed by the strategy. */
export function fixedFields(m: StrategyMarket): Record<MarketField, boolean> {
  return {
    underlying: fixedUnderlyings(m).length > 0,
    expiryType: m.expiryType !== undefined,
    strikeSelection: m.strikeSelection !== undefined,
    timeframe: m.timeframe !== undefined,
  };
}

export function openFields(m: StrategyMarket): MarketField[] {
  const fixed = fixedFields(m);
  return MARKET_FIELDS.filter((f) => !fixed[f]);
}

/** Specific = everything fixed: it runs exactly as defined. */
export function isSpecific(m: StrategyMarket): boolean {
  return openFields(m).length === 0;
}

/** Fixed values override the run's choices. Basket underlyings are handled by the caller. */
export function applyMarket<T extends Partial<RunContext>>(run: T, m: StrategyMarket): T {
  const u = fixedUnderlyings(m);
  return {
    ...run,
    ...(u.length === 1 && { underlying: u[0] }),
    ...(m.expiryType && { expiryType: m.expiryType }),
    ...(m.strikeSelection && { strikeSelection: m.strikeSelection }),
    ...(m.timeframe && { timeframe: m.timeframe }),
  };
}

/** Why a run's underlying is not allowed by the strategy, if it isn't. */
export function underlyingNotAllowed(underlying: string, m: StrategyMarket): string | undefined {
  const u = fixedUnderlyings(m);
  if (u.length === 0 || u.includes(underlying)) return undefined;
  return `This strategy only runs on ${u.join(', ')} — not ${underlying}.`;
}

const EXPIRY_SHORT: Record<ExpiryType, string> = {
  'current-weekly': 'Current weekly',
  'next-weekly': 'Next weekly',
  monthly: 'Monthly',
};

export function expiryLabel(e: ExpiryType): string {
  return EXPIRY_SHORT[e];
}

/** Human summary of the fixed part, e.g. "NIFTY · Current weekly · ATM · 15m". */
export function describeFixed(m: StrategyMarket): string {
  const parts: string[] = [];
  const u = fixedUnderlyings(m);
  if (u.length) parts.push(u.join(', '));
  if (m.expiryType) parts.push(expiryLabel(m.expiryType));
  if (m.strikeSelection) parts.push(m.strikeSelection);
  if (m.timeframe) parts.push(m.timeframe);
  return parts.join(' · ');
}

/** Human list of what a run must choose, e.g. "underlying and timeframe". */
export function describeOpen(m: StrategyMarket): string {
  const names = openFields(m).map((f) => MARKET_FIELD_LABEL[f].toLowerCase());
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
