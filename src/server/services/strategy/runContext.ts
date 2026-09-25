/**
 * Server-side enforcement of strategy market profiles. Whatever a request
 * sends, fields the strategy FIXES always win, runs may only use the
 * strategy's underlyings, and anything still missing is a clear 400.
 */
import type { AnalyzerParams, RunContext, StrategyDef, StrategyMarket } from '@ash/shared';
import {
  BUILTIN_STRATEGY_NAME,
  MARKET_FIELD_LABEL,
  UNDERLYING_BY_SYMBOL,
  applyMarket,
  fixedUnderlyings,
  marketOf,
  underlyingNotAllowed,
  type MarketField,
} from '@ash/shared';
import type { DataStore } from '../../db/store';
import { HttpError } from '../../api/http';

export interface StrategyRef {
  def: StrategyDef | null;
  market: StrategyMarket;
  name: string;
}

export async function loadStrategy(store: DataStore, strategy: string): Promise<StrategyRef> {
  if (strategy === 'rsi-sync') return { def: null, market: marketOf('rsi-sync'), name: BUILTIN_STRATEGY_NAME };
  const def = await store.strategies.get(strategy);
  if (!def) throw new HttpError(404, 'Strategy not found');
  return { def, market: marketOf(strategy, def), name: def.name };
}

/** Reject unknown symbols in a market profile. */
export function validateMarket(m: StrategyMarket | undefined): void {
  const unknown = (m?.underlyings ?? []).filter((u) => !UNDERLYING_BY_SYMBOL[u]);
  if (unknown.length) throw new HttpError(400, `Unknown underlying: ${unknown.join(', ')}`);
}

function requireComplete(ctx: Partial<RunContext>, strategyName: string): RunContext {
  const missing = (Object.keys(MARKET_FIELD_LABEL) as MarketField[]).filter((f) => !ctx[f]);
  if (missing.length) {
    const names = missing.map((f) => MARKET_FIELD_LABEL[f].toLowerCase()).join(', ');
    throw new HttpError(400, `Choose ${names} — "${strategyName}" leaves ${missing.length > 1 ? 'them' : 'it'} open.`);
  }
  return ctx as RunContext;
}

type AnalyzerRequest = Omit<AnalyzerParams, keyof RunContext> & Partial<RunContext>;

/**
 * Effective backtest parameters. A basket strategy runs across all of its
 * underlyings; `forChart` narrows to the single underlying being charted.
 */
export async function resolveAnalyzerParams(
  store: DataStore,
  req: AnalyzerRequest,
  opts: { forChart?: boolean } = {},
): Promise<AnalyzerParams> {
  const { market, name } = await loadStrategy(store, req.strategy);
  const basket = fixedUnderlyings(market);
  let underlying = req.underlying;
  let underlyings = req.underlyings;
  let groupName = req.groupName;

  if (basket.length) {
    if (opts.forChart) {
      underlying = req.underlying && basket.includes(req.underlying) ? req.underlying : basket[0];
      underlyings = undefined;
    } else {
      underlying = basket[0];
      underlyings = basket.length > 1 ? basket : undefined;
      groupName = basket.length > 1 ? name : undefined;
    }
  } else if (!underlying && underlyings?.length) {
    underlying = underlyings[0];
  }

  const ctx = requireComplete(
    applyMarket({ underlying, expiryType: req.expiryType, strikeSelection: req.strikeSelection, timeframe: req.timeframe }, market),
    name,
  );
  if (ctx.strikeSelection === 'CUSTOM' && req.customStrike === undefined) {
    throw new HttpError(400, 'Pick the strike price for a CUSTOM strike.');
  }
  return { ...req, ...ctx, underlyings, groupName } as AnalyzerParams;
}

/** Effective monitor context: fixed fields applied; the underlying must be allowed. */
export async function resolveMonitorContext<T extends RunContext & { strategy: string }>(store: DataStore, input: T): Promise<T> {
  const { def, market } = await loadStrategy(store, input.strategy);
  if (def?.status === 'disabled') throw new HttpError(400, `Strategy "${def.name}" is disabled — publish it first.`);
  const bad = underlyingNotAllowed(input.underlying, market);
  if (bad) throw new HttpError(400, bad);
  return applyMarket(input, market);
}
