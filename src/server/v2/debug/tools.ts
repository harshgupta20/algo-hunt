/**
 * Side-effect-free tools:
 *   explain — evaluate a strategy on a product right now (same data + engine as
 *             the scanner): every condition's values per unit and what the alert
 *             policy would do. Nothing is saved or sent.
 *   compare — run one strategy over past trigger candles on many products and
 *             list where it would have alerted, so the trader can see which
 *             products suit the strategy. Alerts only — no trade scoring.
 */
import type {
  AlertPolicy,
  CompareProductResult,
  CompareResult,
  ConditionTrace,
  ConnectionConfig,
  ExprTrace,
  SignalOutcome,
  StrategyDefinition,
  Timeframe,
  TriState,
  UnitEvaluation,
  UnitState,
  V2Instrument,
  V2Product,
  V2Unit,
} from '@/shared/v2';
import { TIMEFRAME } from '@/shared/v2';
import { istDate } from '../../utils/marketTime';
import { decide, initialState } from '../alerts/alertPolicy';
import { calendars, dateStartMs, type MarketCalendar } from '../calendar/MarketCalendar';
import { CandleService } from '../data/CandleService';
import type { V2DataProvider } from '../data/DataProvider';
import type { ProductService } from '../data/ProductService';
import { alignIndex, evaluateUnit, type UnitEvalInput } from '../engine/evaluator';
import { legInstrument, seriesOf } from '../engine/series';
import type { V2Store } from '../persistence/V2Store';
import { clockFor } from '../scanner/V2Scanner';
import { atmReference, resolveUnits } from '../universe/resolve';

export interface ToolDeps {
  store: V2Store;
  provider: V2DataProvider;
  products: ProductService;
  clock?: () => number;
}

export interface ExplainUnit {
  unit: V2Unit;
  evaluation?: UnitEvaluation;
  prevResult: TriState | null;
  outcome?: SignalOutcome;
  state: UnitState | null;
  error?: string;
}

export interface ExplainResult {
  productId: string;
  evaluatedAt: number;
  triggerCandle: number;
  at: number;
  references: Array<{ symbol: string; ltp?: number }>;
  errors: string[];
  notes: string[];
  units: ExplainUnit[];
  requests: number;
}

export interface CompareRequest {
  products: string[];
  from: string;
  to: string;
  expiry?: ConnectionConfig['expiry'];
  strikeShift?: number;
  trigger?: AlertPolicy['trigger'];
  cooldownMinutes?: number | null;
}

export const COMPARE_MAX_PRODUCTS = 20;
/** Longest comparison span (calendar days) per trigger timeframe. */
export const COMPARE_MAX_DAYS: Record<Timeframe, number> = {
  '1m': 2,
  '3m': 5,
  '5m': 7,
  '10m': 10,
  '15m': 20,
  '30m': 30,
  '1h': 60,
  '2h': 90,
  '4h': 120,
  '1d': 365,
  '1w': 730,
};

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

function leaves(t: ExprTrace, out: ConditionTrace[] = []): ConditionTrace[] {
  if (t.condition) out.push(t.condition);
  t.children?.forEach((c) => leaves(c, out));
  return out;
}

/** Open times (ms) of every trigger candle in [from, to] that closed by `until`. */
export function triggerOpens(cal: MarketCalendar, from: string, to: string, tf: Timeframe, until: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!cal.isTradingDay(d)) continue;
    if (tf === '1d') out.push(dateStartMs(d));
    else if (tf === '1w') {
      const wk = cal.periodOpen(dateStartMs(d), '1w');
      if (!seen.has(wk)) {
        seen.add(wk);
        out.push(wk);
      }
    } else {
      const end = cal.sessionEnd(d);
      for (let open = cal.sessionStart(d); open < end; open = cal.candleClose(open, tf)) out.push(open);
    }
  }
  return out.filter((o) => cal.candleClose(o, tf) <= until);
}

async function fetchUnits(candles: CandleService, d: StrategyDefinition, units: V2Unit[], errors: string[]): Promise<void> {
  const jobs = new Map<string, { inst: V2Instrument; tf: Timeframe }>();
  for (const u of units) {
    for (const s of seriesOf(d)) {
      const inst = legInstrument(s.leg, u);
      if (inst) jobs.set(CandleService.nativeKey(inst, TIMEFRAME[s.timeframe].native), { inst, tf: s.timeframe });
    }
  }
  await Promise.all([...jobs.values()].map((j) => candles.fetchSeries(j.inst, j.tf).catch((err) => errors.push(`${j.inst.symbol}: ${msg(err)}`))));
}

export class V2Tools {
  constructor(private readonly deps: ToolDeps) {}

  private now(): number {
    return this.deps.clock ? this.deps.clock() : Date.now();
  }

  async explain(input: {
    definition: StrategyDefinition;
    strategyId?: string;
    version?: number;
    product: V2Product;
    config: ConnectionConfig;
    connectionId?: string;
    enabledAt?: string | null;
  }): Promise<ExplainResult> {
    const now = this.now();
    const { definition: d, product, config } = input;
    const cals = calendars(await this.deps.store.calendar.list());
    const cal = cals[product.market];
    const today = istDate(now);
    const errors: string[] = [];
    let requests = 0;

    const clock = clockFor(cal, d, now);
    if (!clock) throw new Error('No completed trigger candle in the last two weeks of the calendar');
    const all = await this.deps.products.instruments(product.id, now);
    const ref = atmReference(d, all, config, today);
    let price: number | undefined;
    if (ref) {
      try {
        price = (await this.deps.provider.getLtp([ref])).get(ref.token);
        requests++;
      } catch (err) {
        errors.push(`Live price failed: ${msg(err)}`);
      }
    }
    const res = resolveUnits(d, product.id, all, config, price, today);
    errors.push(...res.errors);
    const candles = new CandleService(this.deps.provider, cals, now);
    await fetchUnits(candles, d, res.units, errors);
    requests += candles.requests;
    const states = input.connectionId ? new Map((await this.deps.store.units.list(input.connectionId)).map((s) => [s.unitKey, s])) : new Map<string, UnitState>();
    const memo = new Map<string, unknown>();

    const units: ExplainUnit[] = res.units.map((unit) => {
      const state = states.get(unit.key) ?? null;
      try {
        const base: UnitEvalInput = {
          strategyId: input.strategyId ?? 'draft',
          version: input.version ?? 0,
          productId: product.id,
          definition: d,
          unit,
          lookup: candles.lookup,
          triggerOpenMs: clock.triggerOpenMs,
          at: clock.at,
          memo,
        };
        const evaluation = evaluateUnit(base);
        const prevResult = clock.prevOpenMs === null || clock.prevAt === null ? null : evaluateUnit({ ...base, mode: 'COMPLETED_CANDLE', triggerOpenMs: clock.prevOpenMs, at: clock.prevAt }).result;
        const decision = decide({
          policy: config.alert,
          state: state ?? initialState(input.connectionId ?? 'draft', unit.key),
          result: evaluation.result,
          prevResult,
          triggerCandle: evaluation.triggerCandle,
          at: clock.at,
          now,
          enabledAt: input.enabledAt ?? null,
          mode: d.evaluation.mode,
        });
        return { unit, evaluation, prevResult, outcome: decision.outcome, state };
      } catch (err) {
        return { unit, prevResult: null, state, error: msg(err) };
      }
    });

    return {
      productId: product.id,
      evaluatedAt: now,
      triggerCandle: Math.floor(clock.triggerOpenMs / 1000),
      at: clock.at,
      references: res.references.map((r) => ({ symbol: r.instrument.symbol, ltp: r.ltp })),
      errors,
      notes: res.notes,
      units,
      requests,
    };
  }

  async compare(d: StrategyDefinition, req: CompareRequest): Promise<CompareResult> {
    const now = this.now();
    const tf = d.evaluation.triggerTimeframe;
    if (req.from > req.to) throw new Error('"from" must be on or before "to"');
    const span = (Date.parse(req.to) - Date.parse(req.from)) / DAY + 1;
    if (span > COMPARE_MAX_DAYS[tf]) throw new Error(`Comparisons on ${TIMEFRAME[tf].label} candles are limited to ${COMPARE_MAX_DAYS[tf]} days`);
    const ids = [...new Set(req.products)];
    if (!ids.length) throw new Error('Choose at least one product');
    if (ids.length > COMPARE_MAX_PRODUCTS) throw new Error(`Compare at most ${COMPARE_MAX_PRODUCTS} products at a time`);

    const cals = calendars(await this.deps.store.calendar.list());
    const products = new Map((await this.deps.store.products.list({ ids })).map((p) => [p.id, p]));
    const today = istDate(now);
    const until = Math.min(now, dateStartMs(addDays(req.to, 1)));
    const policy: AlertPolicy = { channels: { telegram: false, email: false }, trigger: req.trigger ?? 'ON_TRANSITION', cooldownMinutes: req.cooldownMinutes ?? null, oncePerCandle: true };
    const config: ConnectionConfig = { expiry: req.expiry ?? { mode: 'CURRENT' }, strikeShifts: [req.strikeShift ?? 0], alert: policy };
    let requests = 0;

    const results: CompareProductResult[] = [];
    for (const id of ids) {
      const product = products.get(id);
      const r: CompareProductResult = { productId: id, productName: product?.name ?? id, unit: null, candles: 0, decided: 0, alerts: [], errors: [], notes: [] };
      results.push(r);
      if (!product) {
        r.errors.push('Not in the product catalogue — sync products');
        continue;
      }
      try {
        const cal = cals[product.market];
        const candles = new CandleService(this.deps.provider, cals, until, Infinity, { from: req.from, to: req.to });
        const all = await this.deps.products.instruments(id, now);
        const opens = triggerOpens(cal, req.from, req.to, tf, until);
        r.candles = opens.length;

        // ATM from the reference's price at the first trigger candle of the period (fixed for the period).
        const ref = atmReference(d, all, config, today);
        let price: number | undefined;
        if (ref && opens.length) {
          await candles.fetchSeries(ref, tf).catch((err) => r.errors.push(`${ref.symbol}: ${msg(err)}`));
          const res = candles.lookup(ref, { leg: 'A', timeframe: tf, candle: { type: 'NORMAL' } });
          if (!('error' in res)) {
            const i = alignIndex(res.candles, 'COMPLETED_CANDLE', cal.candleClose(opens[0]!, tf));
            price = i >= 0 ? res.candles[i]!.close : res.candles.at(-1)?.close;
          }
          if (price === undefined && !r.errors.length) {
            try {
              requests++;
              price = (await this.deps.provider.getLtp([ref])).get(ref.token);
              if (price !== undefined) r.notes.push('No price at the start of the period — ATM taken from the live price');
            } catch {
              /* the resolver below reports the missing price */
            }
          }
        }
        const res = resolveUnits(d, id, all, config, price, today);
        r.errors.push(...res.errors.filter((e) => !r.errors.some((x) => x.includes(e))));
        r.notes.push(...res.notes);
        const unit = res.units[0];
        if (!unit) {
          requests += candles.requests;
          continue;
        }
        r.unit = unit;
        if (unit.baseStrike !== null) r.notes.push(`Option legs fixed at the strikes around ATM ${unit.atmStrike} (start of the period), expiry ${unit.expiry}`);
        await fetchUnits(candles, d, [unit], r.errors);
        requests += candles.requests;

        const memo = new Map<string, unknown>();
        const base: Omit<UnitEvalInput, 'triggerOpenMs' | 'at'> = { strategyId: 'compare', version: 0, productId: id, definition: d, unit, lookup: candles.lookup, mode: 'COMPLETED_CANDLE', memo };
        let state = initialState('compare', unit.key);
        let prev: TriState | null = null;
        if (opens.length) {
          const p = cal.lastCompletedOpen(opens[0]!, tf);
          if (p !== null) prev = evaluateUnit({ ...base, triggerOpenMs: p, at: cal.candleClose(p, tf) }).result;
        }
        for (const open of opens) {
          const at = cal.candleClose(open, tf);
          const e = evaluateUnit({ ...base, triggerOpenMs: open, at });
          if (e.result !== 'UNKNOWN') r.decided++;
          const decision = decide({ policy, state, result: e.result, prevResult: prev, triggerCandle: e.triggerCandle, at, now: at, enabledAt: null, mode: 'COMPLETED_CANDLE' });
          state = { ...decision.next, lastEvaluatedCandle: e.triggerCandle };
          if (decision.outcome) r.alerts.push({ candleTime: e.triggerCandle, prices: e.prices, trace: e.trace });
          prev = e.result;
        }
        if (r.candles && r.decided < r.candles) {
          const unknown = r.candles - r.decided;
          const reasons = new Set<string>();
          const last = evaluateUnit({ ...base, triggerOpenMs: opens[0]!, at: cal.candleClose(opens[0]!, tf) });
          for (const c of leaves(last.trace)) if (c.reason) reasons.add(c.reason);
          r.notes.push(`${unknown} of ${r.candles} candles had too little data to decide${reasons.size ? ` (e.g. ${[...reasons][0]})` : ''}`);
        }
      } catch (err) {
        r.errors.push(msg(err));
      }
    }

    return {
      from: req.from,
      to: req.to,
      triggerTimeframe: tf,
      products: results.sort((a, b) => b.alerts.length - a.alerts.length),
      requests,
      notes: ['Alerts only (no trade scoring). Contracts are the ones listed today; candles before a contract existed count as “too little data”.'],
    };
  }
}
