/**
 * Indicators over whole columns (one value per candle, NaN while warming up). The recursive averages reuse the
 * app's streaming primitives (Ema, Rma seeded with an SMA; Wilder's RsiCalculator) so every number matches
 * TradingView and the F&O section; the rest are ports of services/indicator/library.ts (tests cross-check
 * both, candle by candle).
 */
import type { EqMaType, EqOperand, PriceField } from '@/shared/equity';
import { EQ_INDICATOR } from '@/shared/equity';
import { RsiCalculator } from '../../services/indicator/rsi';
import { Ema, Rma } from '../../services/indicator/types';
import type { Bars } from './bars';

type Col = Float64Array;

const blank = (n: number): Col => new Float64Array(n).fill(NaN);

function firstFinite(a: Col): number {
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]!)) return i;
  return -1;
}

/** Feed the defined part of `src` through a streaming accumulator. */
function stream(src: Col, make: () => { push(x: number): number | undefined }): Col {
  const out = blank(src.length);
  const f = firstFinite(src);
  if (f < 0) return out;
  const acc = make();
  for (let i = f; i < src.length; i++) {
    const v = acc.push(src[i]!);
    if (v !== undefined) out[i] = v;
  }
  return out;
}

export function sma(src: Col, n: number): Col {
  const out = blank(src.length);
  const f = firstFinite(src);
  if (f < 0) return out;
  let sum = 0;
  for (let i = f; i < src.length; i++) {
    sum += src[i]!;
    if (i - f >= n) sum -= src[i - n]!;
    if (i - f + 1 >= n) out[i] = sum / n;
  }
  return out;
}

export const ema = (src: Col, n: number): Col => stream(src, () => new Ema(n));
export const rma = (src: Col, n: number): Col => stream(src, () => new Rma(n));

export function wma(src: Col, n: number): Col {
  const out = blank(src.length);
  const f = firstFinite(src);
  if (f < 0) return out;
  const norm = (n * (n + 1)) / 2;
  for (let i = f + n - 1; i < src.length; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += (n - j) * src[i - j]!;
    out[i] = s / norm;
  }
  return out;
}

export const movingAverage = (type: EqMaType, src: Col, n: number): Col => (type === 'EMA' ? ema(src, n) : type === 'WMA' ? wma(src, n) : sma(src, n));

export function rsi(src: Col, n: number): Col {
  return stream(src, () => {
    const calc = new RsiCalculator(n);
    return { push: (x: number) => calc.update(x) };
  });
}

export function macd(close: Col, fast: number, slow: number, signal: number): { line: Col; signal: Col; hist: Col } {
  const n = close.length;
  const line = blank(n);
  const sig = blank(n);
  const hist = blank(n);
  const f = new Ema(fast);
  const s = new Ema(slow);
  const g = new Ema(signal);
  for (let i = 0; i < n; i++) {
    const a = f.push(close[i]!);
    const b = s.push(close[i]!);
    if (a === undefined || b === undefined) continue;
    line[i] = a - b;
    const v = g.push(a - b);
    if (v !== undefined) {
      sig[i] = v;
      hist[i] = a - b - v;
    }
  }
  return { line, signal: sig, hist };
}

export function bollinger(close: Col, n: number, k: number): Record<'upper' | 'mid' | 'lower' | 'percentB' | 'bandwidth', Col> {
  const len = close.length;
  const out = { upper: blank(len), mid: blank(len), lower: blank(len), percentB: blank(len), bandwidth: blank(len) };
  for (let i = n - 1; i < len; i++) {
    let mean = 0;
    for (let j = i - n + 1; j <= i; j++) mean += close[j]!;
    mean /= n;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (close[j]! - mean) ** 2;
    const std = Math.sqrt(v / n);
    const upper = mean + k * std;
    const lower = mean - k * std;
    out.mid[i] = mean;
    out.upper[i] = upper;
    out.lower[i] = lower;
    if (upper !== lower) out.percentB[i] = (close[i]! - lower) / (upper - lower);
    if (mean !== 0) out.bandwidth[i] = ((upper - lower) / mean) * 100;
  }
  return out;
}

/** True range; the first candle's is high − low (TradingView ta.tr(true)). */
export function trueRange(b: Bars): Col {
  const tr = new Float64Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const hl = b.high[i]! - b.low[i]!;
    tr[i] = i === 0 ? hl : Math.max(hl, Math.abs(b.high[i]! - b.close[i - 1]!), Math.abs(b.low[i]! - b.close[i - 1]!));
  }
  return tr;
}

export const atr = (b: Bars, n: number): Col => rma(trueRange(b), n);

/** Port of the library's Supertrend (ATR = Wilder average seeded with the SMA of the first N true ranges). */
export function supertrend(b: Bars, n: number, mult: number): { value: Col; direction: Col } {
  const len = b.length;
  const value = blank(len);
  const direction = blank(len);
  const atrCol = atr(b, n);
  let finalUpper: number | undefined;
  let finalLower: number | undefined;
  let st: number | undefined;
  let dir = 1;
  for (let i = 0; i < len; i++) {
    const a = atrCol[i]!;
    if (!Number.isFinite(a)) continue;
    const close = b.close[i]!;
    const hl2 = (b.high[i]! + b.low[i]!) / 2;
    const basicUpper = hl2 + mult * a;
    const basicLower = hl2 - mult * a;
    const prevUpper = finalUpper ?? basicUpper;
    const prevLower = finalLower ?? basicLower;
    const pc = i > 0 ? b.close[i - 1]! : close;
    const fu = basicUpper < prevUpper || pc > prevUpper ? basicUpper : prevUpper;
    const fl = basicLower > prevLower || pc < prevLower ? basicLower : prevLower;
    if (st === undefined) {
      st = fu;
      dir = -1;
    } else if (st === prevUpper) {
      dir = close <= fu ? -1 : 1;
      st = dir === -1 ? fu : fl;
    } else {
      dir = close >= fl ? 1 : -1;
      st = dir === 1 ? fl : fu;
    }
    finalUpper = fu;
    finalLower = fl;
    value[i] = st;
    direction[i] = dir;
  }
  return { value, direction };
}

/** Wilder's +DI / −DI (TradingView ta.dmi) and ADX = RMA(smoothing) of DX. */
export function dmi(b: Bars, n: number, smoothing: number): { plus: Col; minus: Col; adx: Col } {
  const len = b.length;
  const plus = blank(len);
  const minus = blank(len);
  const adx = blank(len);
  const tr = new Rma(n);
  const p = new Rma(n);
  const m = new Rma(n);
  const ax = new Rma(smoothing);
  for (let i = 1; i < len; i++) {
    const up = b.high[i]! - b.high[i - 1]!;
    const down = b.low[i - 1]! - b.low[i]!;
    const t = Math.max(b.high[i]! - b.low[i]!, Math.abs(b.high[i]! - b.close[i - 1]!), Math.abs(b.low[i]! - b.close[i - 1]!));
    const a = tr.push(t);
    const pv = p.push(up > down && up > 0 ? up : 0);
    const mv = m.push(down > up && down > 0 ? down : 0);
    if (a === undefined || pv === undefined || mv === undefined) continue;
    const pdi = a === 0 ? 0 : (100 * pv) / a;
    const mdi = a === 0 ? 0 : (100 * mv) / a;
    plus[i] = pdi;
    minus[i] = mdi;
    const sum = pdi + mdi;
    const v = ax.push((100 * Math.abs(pdi - mdi)) / (sum === 0 ? 1 : sum));
    if (v !== undefined) adx[i] = v;
  }
  return { plus, minus, adx };
}

/** Highest / lowest of the PREVIOUS n values (the current candle excluded). */
export function extreme(src: Col, n: number, kind: 'max' | 'min'): Col {
  const out = blank(src.length);
  for (let i = n; i < src.length; i++) {
    let v = kind === 'max' ? -Infinity : Infinity;
    for (let j = i - n; j < i; j++) v = kind === 'max' ? Math.max(v, src[j]!) : Math.min(v, src[j]!);
    out[i] = v;
  }
  return out;
}

export function roc(src: Col, n: number): Col {
  const out = blank(src.length);
  for (let i = n; i < src.length; i++) if (src[i - n]! !== 0) out[i] = (100 * (src[i]! - src[i - n]!)) / src[i - n]!;
  return out;
}

export const field = (b: Bars, f: PriceField): Col => b[f];

type IndicatorOperand = Extract<EqOperand, { kind: 'INDICATOR' }>;

/** The indicator's selected line, before its own moving average and multiplier. */
function baseLine(b: Bars, o: IndicatorOperand): Col {
  const spec = EQ_INDICATOR[o.indicator];
  const p = (name: string) => o.params[name] ?? spec.params.find((x) => x.name === name)!.default;
  const src = () => field(b, o.source ?? spec.defaultSource ?? 'close');
  const out = o.output ?? spec.outputs?.[0]?.value;
  switch (o.indicator) {
    case 'SMA':
      return sma(src(), p('period'));
    case 'EMA':
      return ema(src(), p('period'));
    case 'WMA':
      return wma(src(), p('period'));
    case 'RSI':
      return rsi(src(), p('period'));
    case 'MACD': {
      const m = macd(src(), p('fast'), p('slow'), p('signal'));
      return out === 'signal' ? m.signal : out === 'hist' ? m.hist : m.line;
    }
    case 'BB': {
      const bb = bollinger(src(), p('period'), p('stdDev'));
      return bb[(out as keyof typeof bb) ?? 'mid'] ?? bb.mid;
    }
    case 'ATR':
      return atr(b, p('period'));
    case 'SUPERTREND': {
      const s = supertrend(b, p('period'), p('multiplier'));
      return out === 'direction' ? s.direction : s.value;
    }
    case 'ADX':
      return dmi(b, p('period'), p('smoothing')).adx;
    case 'DMI': {
      const d = dmi(b, p('period'), 14);
      return out === 'minus' ? d.minus : d.plus;
    }
    case 'HIGHEST':
      return extreme(src(), p('period'), 'max');
    case 'LOWEST':
      return extreme(src(), p('period'), 'min');
    case 'ROC':
      return roc(src(), p('period'));
  }
}

/** One value per candle of `b` for a price / indicator operand (numbers are handled by the evaluator). */
export function operandColumn(b: Bars, o: Exclude<EqOperand, { kind: 'NUMBER' }>): Col {
  if (o.kind === 'PRICE') return field(b, o.field);
  let col = baseLine(b, o);
  if (o.ma) col = movingAverage(o.ma.type, col, o.ma.period);
  if (o.multiplier !== undefined && o.multiplier !== 1) col = col.map((v) => v * o.multiplier!);
  return col;
}

/** JSON with object keys sorted at every level. */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/** Memo key of an operand's column on a timeframe (bars-ago only shifts the read, so it's not part of it). */
export function columnKey(tf: string, o: Exclude<EqOperand, { kind: 'NUMBER' }>): string {
  return `${tf}|${stable({ ...o, barsAgo: undefined, timeframe: undefined })}`;
}
