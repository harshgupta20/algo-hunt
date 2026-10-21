/**
 * Conditions over a stock's whole history at once: every operand is read at every CHECK (each close of the
 * strategy's timeframe), every condition / group becomes one tri-state value per check (1 true, 0 false,
 * −1 unknown = too little history).
 *
 * Every operand reads the strategy's own candles.
 *
 *   Daily strategy   a check per trading day.
 *   Weekly strategy  a check per completed week, on its last trading day (no half weeks).
 *   Crossings        compare this check with the previous one (TradingView ta.crossover / ta.crossunder).
 *   Equal            values within 1 part in 10⁹ are equal (floating-point noise never decides a signal).
 */
import type { EqCondition, EqLeafValue, EqNode, EqOperand, EqTimeframe } from '@/shared/equity';
import { EQ_OPERATOR, conditionText, fmtNum, operandText } from '@/shared/equity';
import { weeklyBars, type Bars, type WeeklyBars } from './bars';
import { columnKey, operandColumn } from './indicators';

export const TRUE = 1;
export const FALSE = 0;
export const UNKNOWN = -1;

export interface StockSeries {
  daily: Bars;
  weekly: WeeklyBars;
}

export function stockSeries(daily: Bars, endDate: string): StockSeries {
  return { daily, weekly: weeklyBars(daily, endDate) };
}

export interface Timeline {
  tf: EqTimeframe;
  /** Daily index of each check (the candle whose close is checked). */
  daily: Int32Array;
  /** Index of each check in its own timeframe's candles. */
  own: Int32Array;
  /** Daily index → check index (−1 when the day isn't a check). */
  checkAt: Int32Array;
}

export function buildTimeline(s: StockSeries, tf: EqTimeframe): Timeline {
  const n = s.daily.length;
  const checkAt = new Int32Array(n).fill(-1);
  if (tf === '1d') {
    const idx = Int32Array.from({ length: n }, (_, i) => i);
    idx.forEach((i) => (checkAt[i] = i));
    return { tf, daily: idx, own: idx.slice(), checkAt };
  }
  const weeks: number[] = [];
  for (let k = 0; k < s.weekly.length; k++) if (s.weekly.complete[k]) weeks.push(k);
  const daily = Int32Array.from(weeks, (k) => s.weekly.lastDaily[k]!);
  daily.forEach((d, j) => (checkAt[d] = j));
  return { tf, daily, own: Int32Array.from(weeks), checkAt };
}

type Series = Exclude<EqOperand, { kind: 'NUMBER' }>;

export class Evaluator {
  private readonly cols = new Map<string, Float64Array>();
  private readonly reads = new Map<string, Float64Array>();
  private readonly memo = new WeakMap<EqNode, Int8Array>();

  constructor(
    readonly s: StockSeries,
    readonly t: Timeline,
  ) {}

  get checks(): number {
    return this.t.daily.length;
  }

  private column(o: Series): Float64Array {
    const key = columnKey(this.t.tf, o);
    let col = this.cols.get(key);
    if (!col) {
      col = operandColumn(this.t.tf === '1d' ? this.s.daily : this.s.weekly, o);
      this.cols.set(key, col);
    }
    return col;
  }

  /** The operand's value at every check (NaN = not known yet). */
  read(o: EqOperand): Float64Array {
    const n = this.checks;
    if (o.kind === 'NUMBER') return new Float64Array(n).fill(o.value);
    const back = o.barsAgo ?? 0;
    const key = `${columnKey(this.t.tf, o)}|${back}`;
    const hit = this.reads.get(key);
    if (hit) return hit;
    const col = this.column(o);
    const out = new Float64Array(n).fill(NaN);
    for (let k = 0; k < n; k++) {
      const i = this.t.own[k]! - back;
      if (i >= 0 && i < col.length) out[k] = col[i]!;
    }
    this.reads.set(key, out);
    return out;
  }

  /** Tri-state per check. */
  node(n: EqNode): Int8Array {
    const hit = this.memo.get(n);
    if (hit) return hit;
    const len = this.checks;
    const out = new Int8Array(len);
    if (n.type === 'CONDITION') {
      const L = this.read(n.left);
      const R = this.read(n.right);
      for (let k = 0; k < len; k++) out[k] = compare(n.op, L, R, k);
    } else {
      const kids = n.children.map((c) => this.node(c));
      for (let k = 0; k < len; k++) {
        let unknown = false;
        let decided = false;
        for (const c of kids) {
          const v = c[k]!;
          if (n.type === 'AND' ? v === FALSE : v === TRUE) {
            decided = true;
            break;
          }
          if (v === UNKNOWN) unknown = true;
        }
        out[k] = decided ? (n.type === 'AND' ? FALSE : TRUE) : !kids.length || unknown ? UNKNOWN : n.type === 'AND' ? TRUE : FALSE;
      }
    }
    this.memo.set(n, out);
    return out;
  }

  /** Why a group / condition is true at check k, with the values — the trade's audit text. */
  describe(n: EqNode, k: number): string {
    if (n.type === 'CONDITION') return this.conditionWithValues(n, k);
    const kids = n.type === 'OR' ? n.children.filter((c) => this.node(c)[k] === TRUE) : n.children;
    return (kids.length ? kids : n.children).map((c) => this.describe(c, k)).join(n.type === 'AND' ? '; ' : ' | ');
  }

  /** Every condition's value at check k (for the screener). */
  leaves(n: EqNode, k: number, out: EqLeafValue[] = []): EqLeafValue[] {
    if (n.type !== 'CONDITION') {
      n.children.forEach((c) => this.leaves(c, k, out));
      return out;
    }
    const v = k >= 0 ? this.node(n)[k]! : UNKNOWN;
    const L = k >= 0 ? this.read(n.left)[k]! : NaN;
    const R = k >= 0 ? this.read(n.right)[k]! : NaN;
    out.push({ text: conditionText(n, this.t.tf), value: v === UNKNOWN ? null : v === TRUE, left: Number.isFinite(L) ? L : null, right: Number.isFinite(R) ? R : null });
    return out;
  }

  private conditionWithValues(c: EqCondition, k: number): string {
    const L = this.read(c.left);
    const R = this.read(c.right);
    const v = (o: EqOperand, col: Float64Array, i: number) => (o.kind === 'NUMBER' ? '' : ` ${fmtNum(col[i])}`);
    const tf = this.t.tf;
    const now = `${operandText(c.left, tf)}${v(c.left, L, k)} ${EQ_OPERATOR[c.op].symbol} ${operandText(c.right, tf)}${v(c.right, R, k)}`;
    if (!EQ_OPERATOR[c.op].cross || k < 1) return now;
    const before = [c.left.kind === 'NUMBER' ? null : fmtNum(L[k - 1]), c.right.kind === 'NUMBER' ? null : fmtNum(R[k - 1])].filter(Boolean).join(' / ');
    return `${now} (previous ${before})`;
  }
}

/**
 * Values within 1 part in 10⁹ are EQUAL: floating-point noise must never decide a signal. (A flat stock's RSI is
 * constant, so it equals its own SMA — but a rolling sum's last binary digit can land either side.)
 */
const tol = (a: number, b: number) => 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
export const above = (a: number, b: number) => a - b > tol(a, b);
export const below = (a: number, b: number) => b - a > tol(a, b);
/** a ≥ b / a ≤ b with the same tolerance — for the simulator's price rules (stops, targets, pyramiding). */
export const atLeast = (a: number, b: number) => !below(a, b);
export const atMost = (a: number, b: number) => !above(a, b);

function compare(op: EqCondition['op'], L: Float64Array, R: Float64Array, k: number): number {
  const l = L[k]!;
  const r = R[k]!;
  if (!Number.isFinite(l) || !Number.isFinite(r)) return UNKNOWN;
  switch (op) {
    case 'GT':
      return above(l, r) ? TRUE : FALSE;
    case 'GTE':
      return below(l, r) ? FALSE : TRUE;
    case 'LT':
      return below(l, r) ? TRUE : FALSE;
    case 'LTE':
      return above(l, r) ? FALSE : TRUE;
    case 'CROSSES_ABOVE':
    case 'CROSSES_BELOW': {
      if (k < 1) return UNKNOWN;
      const pl = L[k - 1]!;
      const pr = R[k - 1]!;
      if (!Number.isFinite(pl) || !Number.isFinite(pr)) return UNKNOWN;
      return op === 'CROSSES_ABOVE' ? (above(l, r) && !above(pl, pr) ? TRUE : FALSE) : below(l, r) && !below(pl, pr) ? TRUE : FALSE;
    }
  }
}
