/**
 * Candlestick pattern detection over the most recent closed candles
 * (oldest → newest; the last candle is the one being tested). Definitions are
 * shape-based, Chartink-style. Hammer / Hanging Man and Inverted Hammer /
 * Shooting Star share a shape and are told apart by the trend before them:
 * the close just before the pattern vs the close TREND_BARS candles earlier.
 */
import type { Bar } from './types';

export type PatternGroup = 'Bullish' | 'Bearish' | 'Neutral' | 'Any';

export interface PatternDef {
  value: string;
  label: string;
  group: PatternGroup;
  /** Candles needed (pattern + trend context) before it can be tested. */
  bars: number;
  description: string;
  detect(bars: Bar[]): boolean;
}

const TREND_BARS = 5;

const body = (b: Bar) => Math.abs(b.close - b.open);
const range = (b: Bar) => b.high - b.low;
const upper = (b: Bar) => b.high - Math.max(b.open, b.close);
const lower = (b: Bar) => Math.min(b.open, b.close) - b.low;
const isBull = (b: Bar) => b.close > b.open;
const isBear = (b: Bar) => b.close < b.open;
const mid = (b: Bar) => (b.open + b.close) / 2;
const last = (bars: Bar[], back = 0) => bars[bars.length - 1 - back]!;

/** +1 uptrend / −1 downtrend / 0 flat, measured before a `len`-candle pattern. */
function trendBefore(bars: Bar[], len: number): number {
  const end = bars.length - 1 - len;
  const start = end - TREND_BARS;
  if (start < 0) return 0;
  return Math.sign(bars[end]!.close - bars[start]!.close);
}

/** Long lower shadow, tiny upper shadow (Hammer / Hanging Man shape). */
function hammerShape(b: Bar): boolean {
  const r = range(b);
  return r > 0 && lower(b) >= 2 * body(b) && lower(b) >= 0.6 * r && upper(b) <= 0.1 * r;
}

/** Long upper shadow, tiny lower shadow (Inverted Hammer / Shooting Star shape). */
function invertedShape(b: Bar): boolean {
  const r = range(b);
  return r > 0 && upper(b) >= 2 * body(b) && upper(b) >= 0.6 * r && lower(b) <= 0.1 * r;
}

const CONTEXT = 1 + TREND_BARS + 1;

const SINGLE: PatternDef[] = [
  {
    value: 'doji',
    label: 'Doji',
    group: 'Neutral',
    bars: 1,
    description: 'Open and close almost equal (body ≤ 10% of the candle’s range): indecision. Often precedes a reversal when it appears after a strong move.',
    detect: (bars) => {
      const b = last(bars);
      return range(b) > 0 && body(b) <= 0.1 * range(b);
    },
  },
  {
    value: 'hammer',
    label: 'Hammer',
    group: 'Bullish',
    bars: CONTEXT,
    description: 'After a decline: small body at the top, lower shadow at least twice the body, almost no upper shadow. Sellers pushed price down but buyers closed it back up.',
    detect: (bars) => trendBefore(bars, 1) < 0 && hammerShape(last(bars)),
  },
  {
    value: 'invertedHammer',
    label: 'Inverted Hammer',
    group: 'Bullish',
    bars: CONTEXT,
    description: 'After a decline: small body at the bottom, long upper shadow (≥ 2× body), almost no lower shadow. Early sign buyers are testing higher prices.',
    detect: (bars) => trendBefore(bars, 1) < 0 && invertedShape(last(bars)),
  },
  {
    value: 'hangingMan',
    label: 'Hanging Man',
    group: 'Bearish',
    bars: CONTEXT,
    description: 'Hammer shape after a rise: long lower shadow shows selling appeared at the top of an uptrend.',
    detect: (bars) => trendBefore(bars, 1) > 0 && hammerShape(last(bars)),
  },
  {
    value: 'shootingStar',
    label: 'Shooting Star',
    group: 'Bearish',
    bars: CONTEXT,
    description: 'After a rise: small body at the bottom and a long upper shadow (≥ 2× body). Buyers pushed higher but sellers drove it back down.',
    detect: (bars) => trendBefore(bars, 1) > 0 && invertedShape(last(bars)),
  },
  {
    value: 'bullishMarubozu',
    label: 'Bullish Marubozu',
    group: 'Bullish',
    bars: 1,
    description: 'A green candle that is almost all body (≥ 90% of its range): buyers in control from open to close.',
    detect: (bars) => {
      const b = last(bars);
      return isBull(b) && range(b) > 0 && body(b) >= 0.9 * range(b);
    },
  },
  {
    value: 'bearishMarubozu',
    label: 'Bearish Marubozu',
    group: 'Bearish',
    bars: 1,
    description: 'A red candle that is almost all body (≥ 90% of its range): sellers in control from open to close.',
    detect: (bars) => {
      const b = last(bars);
      return isBear(b) && range(b) > 0 && body(b) >= 0.9 * range(b);
    },
  },
];

const DOUBLE: PatternDef[] = [
  {
    value: 'bullishEngulfing',
    label: 'Bullish Engulfing',
    group: 'Bullish',
    bars: 2,
    description: 'A red candle followed by a bigger green candle whose body covers the red body completely.',
    detect: (bars) => {
      const p = last(bars, 1);
      const c = last(bars);
      return isBear(p) && isBull(c) && c.open <= p.close && c.close >= p.open && body(c) > body(p);
    },
  },
  {
    value: 'bearishEngulfing',
    label: 'Bearish Engulfing',
    group: 'Bearish',
    bars: 2,
    description: 'A green candle followed by a bigger red candle whose body covers the green body completely.',
    detect: (bars) => {
      const p = last(bars, 1);
      const c = last(bars);
      return isBull(p) && isBear(c) && c.open >= p.close && c.close <= p.open && body(c) > body(p);
    },
  },
  {
    value: 'bullishHarami',
    label: 'Bullish Harami',
    group: 'Bullish',
    bars: 2,
    description: 'A big red candle followed by a small green candle that sits inside the red body: the selling is losing force.',
    detect: (bars) => {
      const p = last(bars, 1);
      const c = last(bars);
      return isBear(p) && isBull(c) && c.open >= p.close && c.close <= p.open && body(c) < body(p);
    },
  },
  {
    value: 'bearishHarami',
    label: 'Bearish Harami',
    group: 'Bearish',
    bars: 2,
    description: 'A big green candle followed by a small red candle that sits inside the green body: the buying is losing force.',
    detect: (bars) => {
      const p = last(bars, 1);
      const c = last(bars);
      return isBull(p) && isBear(c) && c.open <= p.close && c.close >= p.open && body(c) < body(p);
    },
  },
  {
    value: 'piercingLine',
    label: 'Piercing Line',
    group: 'Bullish',
    bars: 2,
    description: 'A red candle, then a green candle opening at or below the red close and closing above the middle of the red body (but not above its open).',
    detect: (bars) => {
      const p = last(bars, 1);
      const c = last(bars);
      return isBear(p) && isBull(c) && c.open <= p.close && c.close > mid(p) && c.close < p.open;
    },
  },
  {
    value: 'darkCloudCover',
    label: 'Dark Cloud Cover',
    group: 'Bearish',
    bars: 2,
    description: 'A green candle, then a red candle opening at or above the green close and closing below the middle of the green body (but not below its open).',
    detect: (bars) => {
      const p = last(bars, 1);
      const c = last(bars);
      return isBull(p) && isBear(c) && c.open >= p.close && c.close < mid(p) && c.close > p.open;
    },
  },
];

const TRIPLE: PatternDef[] = [
  {
    value: 'morningStar',
    label: 'Morning Star',
    group: 'Bullish',
    bars: 3,
    description: 'Three candles: a strong red candle, a small-bodied candle (≤ 30% of the first body), then a green candle closing above the middle of the first.',
    detect: (bars) => {
      const a = last(bars, 2);
      const b = last(bars, 1);
      const c = last(bars);
      return isBear(a) && body(a) >= 0.5 * range(a) && body(b) <= 0.3 * body(a) && isBull(c) && c.close >= mid(a);
    },
  },
  {
    value: 'eveningStar',
    label: 'Evening Star',
    group: 'Bearish',
    bars: 3,
    description: 'Three candles: a strong green candle, a small-bodied candle (≤ 30% of the first body), then a red candle closing below the middle of the first.',
    detect: (bars) => {
      const a = last(bars, 2);
      const b = last(bars, 1);
      const c = last(bars);
      return isBull(a) && body(a) >= 0.5 * range(a) && body(b) <= 0.3 * body(a) && isBear(c) && c.close <= mid(a);
    },
  },
  {
    value: 'threeWhiteSoldiers',
    label: 'Three White Soldiers',
    group: 'Bullish',
    bars: 3,
    description: 'Three strong green candles in a row, each opening inside the previous body and closing higher.',
    detect: (bars) => {
      const [a, b, c] = [last(bars, 2), last(bars, 1), last(bars)];
      const strong = (x: Bar) => isBull(x) && body(x) >= 0.5 * range(x);
      return strong(a) && strong(b) && strong(c) && b.open >= a.open && b.open <= a.close && c.open >= b.open && c.open <= b.close && b.close > a.close && c.close > b.close;
    },
  },
  {
    value: 'threeBlackCrows',
    label: 'Three Black Crows',
    group: 'Bearish',
    bars: 3,
    description: 'Three strong red candles in a row, each opening inside the previous body and closing lower.',
    detect: (bars) => {
      const [a, b, c] = [last(bars, 2), last(bars, 1), last(bars)];
      const strong = (x: Bar) => isBear(x) && body(x) >= 0.5 * range(x);
      return strong(a) && strong(b) && strong(c) && b.open <= a.open && b.open >= a.close && c.open <= b.open && c.open >= b.close && b.close < a.close && c.close < b.close;
    },
  },
];

const BASE = [...SINGLE, ...DOUBLE, ...TRIPLE];

/** A pattern is testable once enough candles exist; a pattern that can't be tested yet counts as not present. */
function anyOf(group: 'Bullish' | 'Bearish'): (bars: Bar[]) => boolean {
  const members = BASE.filter((p) => p.group === group);
  return (bars) => members.some((p) => bars.length >= p.bars && p.detect(bars));
}

export const PATTERNS: PatternDef[] = [
  {
    value: 'anyBullish',
    label: 'Any Bullish Pattern',
    group: 'Any',
    bars: 1,
    description: `True when any bullish pattern forms: ${BASE.filter((p) => p.group === 'Bullish').map((p) => p.label).join(', ')}.`,
    detect: anyOf('Bullish'),
  },
  {
    value: 'anyBearish',
    label: 'Any Bearish Pattern',
    group: 'Any',
    bars: 1,
    description: `True when any bearish pattern forms: ${BASE.filter((p) => p.group === 'Bearish').map((p) => p.label).join(', ')}.`,
    detect: anyOf('Bearish'),
  },
  ...BASE,
];

export const PATTERN_BY_ID: Record<string, PatternDef> = Object.fromEntries(PATTERNS.map((p) => [p.value, p]));

/** Longest history any pattern needs. */
export const MAX_PATTERN_BARS = Math.max(...PATTERNS.map((p) => p.bars));
