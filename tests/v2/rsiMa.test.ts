/**
 * RSI-based MA in Futures & Options: a moving average of an indicator's own values (as Equity has it) — SMA / EMA /
 * WMA, starting once the indicator has `length` values, as TradingView does.
 */
import { describe, expect, it } from 'vitest';
import type { Operand, V2Unit } from '../../src/shared/v2';
import { conditionText, operandHistory, strategyDefinitionSchema, validateStrategy } from '../../src/shared/v2';
import { indicatorKey, indicatorValues, movingAverage } from '../../src/server/v2/engine/indicators';
import { evaluateUnit } from '../../src/server/v2/engine/evaluator';
import type { Candle } from '../../src/server/v2/engine/candles';
import { and, cond, fut, legSeries, strategy } from '../helpers/v2Fakes';

type Ind = Extract<Operand, { kind: 'INDICATOR' }>;

// Up, a pullback, up again: RSI swings across its own average more than once.
const closes = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 6) + i * 0.3);
const candles: Candle[] = closes.map((c, i) => ({ time: i * 60, open: c, high: c + 1, low: c - 1, close: c, volume: 100, closeMs: (i + 1) * 60_000, complete: true }));
const A = legSeries('A', '1m');
const rsi: Ind = { kind: 'INDICATOR', series: A, indicator: 'RSI', params: { period: 14 } };
const rsiMa = (type: 'SMA' | 'EMA' | 'WMA', period: number): Ind => ({ ...rsi, ma: { type, period } });

const defined = (xs: Array<number | undefined>) => xs.filter((x): x is number => x !== undefined);

describe('RSI-based MA', () => {
  const raw = indicatorValues(candles, rsi);
  const firstRsi = raw.findIndex((v) => v !== undefined);

  it('SMA: the average of the last N RSI values, from the N-th RSI value on', () => {
    const ma = indicatorValues(candles, rsiMa('SMA', 9));
    expect(ma.findIndex((v) => v !== undefined)).toBe(firstRsi + 8);
    const last9 = defined(raw).slice(-9);
    expect(ma.at(-1)).toBeCloseTo(last9.reduce((a, b) => a + b, 0) / 9, 10);
  });

  it('WMA weighs the newest value most; EMA is seeded with the SMA of the first N', () => {
    const vals = defined(raw);
    const wma = indicatorValues(candles, rsiMa('WMA', 4)).at(-1)!;
    const w = vals.slice(-4);
    expect(wma).toBeCloseTo((1 * w[0]! + 2 * w[1]! + 3 * w[2]! + 4 * w[3]!) / 10, 10);

    const ema = indicatorValues(candles, rsiMa('EMA', 5));
    let e = vals.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    for (const v of vals.slice(5)) e = v * (2 / 6) + e * (4 / 6);
    expect(ema.at(-1)).toBeCloseTo(e, 10);
  });

  it('skips values that aren’t there yet rather than counting them', () => {
    expect(movingAverage([undefined, undefined, 1, 2, 3], 'SMA', 2)).toEqual([undefined, undefined, undefined, 1.5, 2.5]);
  });

  it('is cached apart from the plain RSI, needs the extra history and reads “SMA(14) of RSI(14)”', () => {
    expect(indicatorKey(rsiMa('SMA', 14))).not.toBe(indicatorKey(rsi));
    expect(indicatorKey(rsiMa('SMA', 14))).not.toBe(indicatorKey(rsiMa('EMA', 14)));
    expect(operandHistory(rsiMa('SMA', 14))).toBe(15 + 13);
    const c = cond(rsi, 'CROSSED_ABOVE', rsiMa('SMA', 14));
    expect(conditionText(c as never, [{ id: 'A', kind: 'FUT' }])).toBe('[FUT] [1 min] [Normal] RSI(14) crossed above SMA(14) of RSI(14)');
  });

  it('is valid on RSI / ADX only, with a whole-number length', () => {
    const ok = strategy([{ id: 'A', kind: 'FUT' }], and(cond(rsi, 'CROSSED_ABOVE', rsiMa('SMA', 14))));
    expect(strategyDefinitionSchema.safeParse(ok).success).toBe(true);
    expect(validateStrategy(ok)).toEqual([]);
    const sma: Ind = { kind: 'INDICATOR', series: A, indicator: 'SMA', params: { period: 20 }, ma: { type: 'SMA', period: 5 } };
    expect(validateStrategy(strategy([{ id: 'A', kind: 'FUT' }], and(cond({ kind: 'FIELD', series: A, field: 'close' }, 'GT', sma)))).map((i) => i.message).join()).toMatch(
      /SMA doesn't take a moving average/,
    );
    expect(strategyDefinitionSchema.safeParse({ ...ok, expression: and(cond(rsi, 'GT', rsiMa('SMA', 0))) }).success).toBe(false);
  });

  it('“RSI crossed above its MA” fires on the candle the engine’s own values cross, and not on the next', () => {
    const ma = indicatorValues(candles, rsiMa('SMA', 9));
    const k = raw.findIndex((v, i) => i > 0 && v !== undefined && ma[i] !== undefined && raw[i - 1] !== undefined && ma[i - 1] !== undefined && raw[i - 1]! <= ma[i - 1]! && v > ma[i]!);
    expect(k).toBeGreaterThan(0);
    const d = strategy([{ id: 'A', kind: 'FUT' }], and(cond(rsi, 'CROSSED_ABOVE', rsiMa('SMA', 9))), '1m');
    const inst = fut('NSE:NIFTY', '2026-10-27');
    const unit: V2Unit = { key: 'FUT|2026-10-27', productId: 'NSE:NIFTY', expiry: '2026-10-27', baseStrike: null, shift: 0, legs: { A: inst } };
    const at = (i: number) =>
      evaluateUnit({ strategyId: 's', version: 1, productId: 'NSE:NIFTY', definition: d, unit, lookup: () => ({ candles }), triggerOpenMs: candles[i]!.time * 1000, at: candles[i]!.closeMs }).result;
    expect(at(k)).toBe('TRUE');
    expect(at(k + 1)).toBe('FALSE');
  });
});

describe('RSI-based MA matches the Equity engine (verified against an independent oracle) value for value', () => {
  // A 600-candle random walk with real highs and lows.
  let s = 7;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let p = 1000;
  const walk = Array.from({ length: 600 }, (_, i) => {
    const open = p;
    p = Math.max(1, p * (1 + (rnd() - 0.48) * 0.02));
    const high = Math.max(open, p) * (1 + rnd() * 0.004);
    const low = Math.min(open, p) * (1 - rnd() * 0.004);
    return { time: i * 60, open, high, low, close: p, volume: 1000, closeMs: (i + 1) * 60_000, complete: true };
  });
  const bars = {
    date: walk.map((_, i) => `d${i}`),
    open: Float64Array.from(walk, (c) => c.open),
    high: Float64Array.from(walk, (c) => c.high),
    low: Float64Array.from(walk, (c) => c.low),
    close: Float64Array.from(walk, (c) => c.close),
    volume: Float64Array.from(walk, (c) => c.volume),
    length: walk.length,
  };

  const cases: Array<[string, Record<string, number>, 'SMA' | 'EMA' | 'WMA', number]> = [];
  for (const type of ['SMA', 'EMA', 'WMA'] as const) for (const len of [1, 5, 9, 14, 50]) cases.push(['RSI', { period: 14 }, type, len]);
  for (const type of ['SMA', 'EMA', 'WMA'] as const) cases.push(['RSI', { period: 7 }, type, 21]);
  for (const type of ['SMA', 'EMA', 'WMA'] as const) cases.push(['ADX', { period: 14, smoothing: 14 }, type, 9]);

  it.each(cases)('%s %o with %s(%i)', async (indicator, params, type, period) => {
    const { operandColumn } = await import('../../src/server/equity/engine/indicators');
    const fo = indicatorValues(walk, { kind: 'INDICATOR', series: A, indicator, params, ma: { type, period } });
    const eq = operandColumn(bars, { kind: 'INDICATOR', indicator: indicator as 'RSI', params, ma: { type, period } });
    expect(fo.length).toBe(eq.length);
    let compared = 0;
    fo.forEach((v, i) => {
      const e = eq[i]!;
      if (v === undefined) expect(Number.isFinite(e), `candle ${i}: Equity has ${e}, F&O none`).toBe(false);
      else {
        expect(Number.isFinite(e), `candle ${i}: F&O has ${v}, Equity none`).toBe(true);
        expect(v).toBeCloseTo(e, 9);
        compared++;
      }
    });
    expect(compared).toBeGreaterThan(400);
  });
});
