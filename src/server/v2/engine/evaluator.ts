/**
 * Evaluates one unit (a connection's legs resolved to contracts, for one strike position) at a clock time T.
 *
 * Alignment: in COMPLETED_CANDLE mode every series reads its last candle that
 * had completed by T (the trigger candle's close) — a 1h series evaluated on a
 * 15m trigger uses the last closed hour. In LIVE_CANDLE mode T = now and each
 * series reads its latest (possibly forming) candle.
 *
 * Crosses compare each operand's value on its aligned candle with its value on
 * the candle before (prev ≤ other && curr > other for CROSSED_ABOVE).
 *
 * Three-valued logic: missing data is UNKNOWN (never "false"), so a condition
 * without enough history can't make an OR fire or a NOT pass; UNKNOWN never alerts.
 */
import type {
  ConditionNode,
  ConditionTrace,
  EvaluationMode,
  ExprNode,
  ExprTrace,
  LegId,
  Operand,
  OperandTrace,
  Operator,
  PatternNode,
  SeriesSpec,
  StrategyDefinition,
  Timeframe,
  TriState,
  UnitEvaluation,
  V2Instrument,
  V2Unit,
} from '@/shared/v2';
import { CANDLE_TYPES, INDICATOR, PATTERN, TIMEFRAME, conditionText, nodeText, operandCore } from '@/shared/v2';
import type { Candle } from './candles';
import { fieldValue, indicatorKey, indicatorValues, patternValues } from './indicators';
import { forEachLeaf, legInstrument, seriesKey } from './series';

export type SeriesResult = { candles: Candle[] } | { error: string };
/** Returns the built series for an instrument (from the cycle's fetched data). */
export type SeriesLookup = (instrument: V2Instrument, spec: SeriesSpec) => SeriesResult;

export interface UnitEvalInput {
  strategyId: string;
  version: number;
  productId: string;
  definition: StrategyDefinition;
  unit: V2Unit;
  lookup: SeriesLookup;
  /** Open time (ms) of the trigger candle being evaluated. */
  triggerOpenMs: number;
  /** Evaluation time T (ms): the trigger candle's close (completed) or now (live). */
  at: number;
  mode?: EvaluationMode;
  /** Shared per-cycle memo for indicator / pattern arrays. */
  memo?: Map<string, unknown>;
}

/** How long to wait for a just-closed trigger candle to appear in the data before evaluating without it. */
export const DATA_GRACE_MS = 3 * 60_000;

const EPS = 1e-9;
const eq = (a: number, b: number) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

export function compare(op: Operator, cur: [number, number], prev?: [number, number]): boolean {
  const [a, b] = cur;
  switch (op) {
    case 'GT':
      return a > b && !eq(a, b);
    case 'LT':
      return a < b && !eq(a, b);
    case 'GTE':
      return a > b || eq(a, b);
    case 'LTE':
      return a < b || eq(a, b);
    case 'EQ':
      return eq(a, b);
    case 'CROSSED_ABOVE':
      return !!prev && (prev[0] < prev[1] || eq(prev[0], prev[1])) && a > b && !eq(a, b);
    case 'CROSSED_BELOW':
      return !!prev && (prev[0] > prev[1] || eq(prev[0], prev[1])) && a < b && !eq(a, b);
  }
}

export function and3(values: TriState[]): TriState {
  if (values.includes('FALSE')) return 'FALSE';
  if (!values.length || values.includes('UNKNOWN')) return 'UNKNOWN';
  return 'TRUE';
}

export function or3(values: TriState[]): TriState {
  if (values.includes('TRUE')) return 'TRUE';
  if (!values.length || values.includes('UNKNOWN')) return 'UNKNOWN';
  return 'FALSE';
}

export function not3(v: TriState): TriState {
  return v === 'TRUE' ? 'FALSE' : v === 'FALSE' ? 'TRUE' : 'UNKNOWN';
}

/** Index of the candle a series reads at T. */
export function alignIndex(candles: Candle[], mode: EvaluationMode, at: number): number {
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i]!;
    if (mode === 'LIVE_CANDLE' ? c.time * 1000 <= at : c.complete && c.closeMs <= at) return i;
  }
  return -1;
}

const istTime = (sec: number) => new Date(sec * 1000 + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ');

function seriesLabel(instrument: V2Instrument, s: SeriesSpec): string {
  const candle = s.candle.type === 'VOLUME' ? `Vol ${s.candle.volumePerCandle}` : (CANDLE_TYPES.find((c) => c.type === s.candle.type)?.short ?? s.candle.type);
  return `${instrument.symbol} · ${TIMEFRAME[s.timeframe].label} · ${candle}`;
}

interface ResolvedOperand {
  label: string;
  leg?: LegId;
  constant?: number;
  values?: Array<number | undefined>;
  candles?: Candle[];
  idx: number;
  /** Candles of history the operand needs (for messages). */
  need?: number;
  error?: string;
}

class UnitContext {
  readonly memo: Map<string, unknown>;
  readonly mode: EvaluationMode;
  constructor(readonly input: UnitEvalInput) {
    this.memo = input.memo ?? new Map();
    this.mode = input.mode ?? input.definition.evaluation.mode;
  }

  private series(s: SeriesSpec): { instrument: V2Instrument; candles: Candle[]; idx: number } | { error: string; instrument?: V2Instrument } {
    const instrument = legInstrument(s.leg, this.input.unit);
    if (!instrument) {
      const def = this.input.definition.legs.find((l) => l.id === s.leg);
      return { error: !def ? `leg ${s.leg} is not defined` : `no ${def.kind} contract for leg ${s.leg} on this product${def.kind === 'CE' || def.kind === 'PE' ? ' / strike' : ''}` };
    }
    const res = this.input.lookup(instrument, s);
    if ('error' in res) return { error: res.error, instrument };
    return { instrument, candles: res.candles, idx: alignIndex(res.candles, this.mode, this.input.at) };
  }

  private cached<T>(key: string, fn: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, fn());
    return this.memo.get(key) as T;
  }

  operand(o: Operand): ResolvedOperand {
    if (o.kind === 'CONSTANT') return { label: String(o.value), constant: o.value, idx: 0 };
    const s = this.series(o.series);
    const label = `${s.instrument ? seriesLabel(s.instrument, o.series) : o.series.leg} · ${operandCore(o)}`;
    const leg = o.series.leg;
    if ('error' in s) return { label, leg, idx: -1, error: s.error };
    const key = `${seriesKey(s.instrument, o.series)}|${this.mode}`;
    let values: Array<number | undefined>;
    let need = 1;
    switch (o.kind) {
      case 'FIELD':
        values = this.cached(`${key}|F:${o.field}`, () => s.candles.map((c) => fieldValue(c, o.field)));
        break;
      case 'OI_CHANGE':
        need = o.lookback + 1;
        values = this.cached(`${key}|OI:${o.lookback}`, () =>
          s.candles.map((c, i) => {
            const past = s.candles[i - o.lookback];
            return c.oi !== undefined && past?.oi !== undefined ? c.oi - past.oi : undefined;
          }),
        );
        break;
      case 'INDICATOR': {
        const spec = INDICATOR[o.indicator];
        need = spec ? spec.requiredHistory(o.params) : 1;
        const raw = this.cached(`${key}|I:${indicatorKey(o)}`, () => indicatorValues(s.candles, o));
        const m = o.multiplier ?? 1;
        values = m === 1 ? raw : raw.map((v) => (v === undefined ? undefined : v * m));
        break;
      }
    }
    return { label, leg, values, candles: s.candles, idx: s.idx, need };
  }

  pattern(n: PatternNode): { values?: Array<boolean | undefined>; candles?: Candle[]; idx: number; label: string; error?: string } {
    const s = this.series(n.series);
    const label = `${s.instrument ? seriesLabel(s.instrument, n.series) : n.series.leg} · ${PATTERN[n.pattern]?.label ?? n.pattern}`;
    if ('error' in s) return { label, idx: -1, error: s.error };
    const values = this.cached(`${seriesKey(s.instrument, n.series)}|${this.mode}|P:${n.pattern}`, () => patternValues(s.candles, n.pattern));
    return { label, values, candles: s.candles, idx: s.idx };
  }
}

function valueAt(r: ResolvedOperand, i: number): number | undefined {
  if (r.constant !== undefined) return r.constant;
  return i >= 0 ? r.values?.[i] : undefined;
}

function traceOf(r: ResolvedOperand): OperandTrace {
  if (r.constant !== undefined) return { label: r.label, value: r.constant };
  const c = r.idx >= 0 ? r.candles?.[r.idx] : undefined;
  const p = r.idx >= 1 ? r.candles?.[r.idx - 1] : undefined;
  return {
    label: r.label,
    leg: r.leg,
    value: valueAt(r, r.idx),
    prev: valueAt(r, r.idx - 1),
    candleTime: c?.time,
    prevCandleTime: p?.time,
    complete: c?.complete,
  };
}

function missingReason(r: ResolvedOperand, mode: EvaluationMode, at: number, prev: boolean): string | undefined {
  if (r.constant !== undefined) return undefined;
  if (r.error) return `${r.label}: ${r.error}`;
  if (r.idx < 0) return `${r.label}: no ${mode === 'COMPLETED_CANDLE' ? 'completed ' : ''}candle at or before ${istTime(at / 1000)} IST`;
  if (valueAt(r, r.idx) === undefined) return `${r.label}: not enough history (${r.idx + 1} candle${r.idx === 0 ? '' : 's'}, needs ~${r.need ?? 1})`;
  if (prev && valueAt(r, r.idx - 1) === undefined) return `${r.label}: no value on the previous candle to detect a cross`;
  return undefined;
}

function evalCondition(ctx: UnitContext, n: ConditionNode): ConditionTrace {
  const { input, mode } = ctx;
  const text = conditionText(n, input.definition.legs);
  const cross = n.operator === 'CROSSED_ABOVE' || n.operator === 'CROSSED_BELOW';
  const l = ctx.operand(n.left);
  const r = ctx.operand(n.right);
  const base: ConditionTrace = { id: n.id, kind: 'CONDITION', text, result: 'UNKNOWN', operator: n.operator, left: traceOf(l), right: traceOf(r) };
  const reason = missingReason(l, mode, input.at, cross) ?? missingReason(r, mode, input.at, cross);
  if (reason) return { ...base, reason };
  const cur: [number, number] = [valueAt(l, l.idx)!, valueAt(r, r.idx)!];
  const prev: [number, number] | undefined = cross ? [valueAt(l, l.idx - 1)!, valueAt(r, r.idx - 1)!] : undefined;
  return { ...base, result: compare(n.operator, cur, prev) ? 'TRUE' : 'FALSE' };
}

function evalPattern(ctx: UnitContext, n: PatternNode): ConditionTrace {
  const text = nodeText(n, ctx.input.definition.legs);
  const p = ctx.pattern(n);
  const c = p.idx >= 0 ? p.candles?.[p.idx] : undefined;
  const base: ConditionTrace = {
    id: n.id,
    kind: 'PATTERN',
    text,
    result: 'UNKNOWN',
    pattern: n.pattern,
    left: { label: p.label, leg: n.series.leg, candleTime: c?.time, complete: c?.complete },
  };
  if (p.error) return { ...base, reason: `${p.label}: ${p.error}` };
  if (p.idx < 0) return { ...base, reason: `${p.label}: no candle at or before ${istTime(ctx.input.at / 1000)} IST` };
  const v = p.values?.[p.idx];
  if (v === undefined) return { ...base, reason: `${p.label}: not enough candles to test the pattern` };
  return { ...base, result: v ? 'TRUE' : 'FALSE', left: { ...base.left!, value: v ? 1 : 0 } };
}

function evalNode(ctx: UnitContext, n: ExprNode): ExprTrace {
  switch (n.type) {
    case 'CONDITION': {
      const c = evalCondition(ctx, n);
      return { id: n.id, type: n.type, result: c.result, condition: c };
    }
    case 'PATTERN': {
      const c = evalPattern(ctx, n);
      return { id: n.id, type: n.type, result: c.result, condition: c };
    }
    case 'NOT': {
      const child = evalNode(ctx, n.child);
      return { id: n.id, type: n.type, result: not3(child.result), children: [child] };
    }
    default: {
      // No short-circuit: every child is evaluated so "why (not)" shows all of them.
      const children = n.children.map((c) => evalNode(ctx, c));
      const results = children.map((c) => c.result);
      return { id: n.id, type: n.type, label: n.label, result: n.type === 'AND' ? and3(results) : or3(results), children };
    }
  }
}

/** Close of each leg's normal candle on the trigger timeframe at T (legs whose data was fetched). */
function pricesAt(input: UnitEvalInput, mode: EvaluationMode): Partial<Record<LegId, number>> {
  const out: Partial<Record<LegId, number>> = {};
  for (const { id: leg } of input.definition.legs) {
    const inst = legInstrument(leg, input.unit);
    if (!inst) continue;
    const res = input.lookup(inst, { leg, timeframe: input.definition.evaluation.triggerTimeframe, candle: { type: 'NORMAL' } });
    if ('error' in res) continue;
    const i = alignIndex(res.candles, mode, input.at);
    if (i >= 0) out[leg] = res.candles[i]!.close;
  }
  return out;
}

export function evaluateUnit(input: UnitEvalInput): UnitEvaluation {
  const ctx = new UnitContext(input);
  const trace = evalNode(ctx, input.definition.expression);
  return {
    strategyId: input.strategyId,
    version: input.version,
    productId: input.productId,
    unit: input.unit,
    mode: ctx.mode,
    triggerTimeframe: input.definition.evaluation.triggerTimeframe,
    triggerCandle: Math.floor(input.triggerOpenMs / 1000),
    evaluatedAt: input.at,
    result: trace.result,
    trace,
    prices: pricesAt(input, ctx.mode),
  };
}

/**
 * Completed-candle mode: the trigger candle just closed but a series on the
 * trigger timeframe doesn't have it yet (the data vendor lags a few seconds).
 * Returns why to wait, or undefined when the unit can be evaluated.
 */
export function pendingReason(input: UnitEvalInput, now: number): string | undefined {
  if ((input.mode ?? input.definition.evaluation.mode) !== 'COMPLETED_CANDLE') return undefined;
  if (now - input.at >= DATA_GRACE_MS) return undefined;
  const tf: Timeframe = input.definition.evaluation.triggerTimeframe;
  let reason: string | undefined;
  forEachLeaf(input.definition.expression, (leaf) => {
    if (reason) return;
    const specs = leaf.type === 'PATTERN' ? [leaf.series] : [leaf.left, leaf.right].flatMap((o) => (o.kind === 'CONSTANT' ? [] : [o.series]));
    for (const s of specs) {
      if (s.timeframe !== tf || s.candle.type === 'VOLUME') continue;
      const instrument = legInstrument(s.leg, input.unit);
      if (!instrument) continue;
      const res = input.lookup(instrument, s);
      if ('error' in res || !res.candles.length) continue;
      const last = res.candles.filter((c) => c.complete).at(-1);
      if (!last || last.time * 1000 < input.triggerOpenMs) {
        reason = `${instrument.symbol} ${TIMEFRAME[tf].label} candle ${istTime(input.triggerOpenMs / 1000)} not available yet`;
        return;
      }
    }
  });
  return reason;
}
