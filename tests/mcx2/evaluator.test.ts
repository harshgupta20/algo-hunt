import { describe, expect, it } from 'vitest';
import type { ExprNode, McxStrategyDefinition, SeriesSpec } from '../../src/shared/mcx';
import { McxMarketCalendar } from '../../src/server/mcx/calendar/McxMarketCalendar';
import { buildSeries, type RawCandle } from '../../src/server/mcx/engine/candles';
import { and3, compare, evaluateUnit, not3, or3, pendingReason, type SeriesLookup } from '../../src/server/mcx/engine/evaluator';
import { indicatorValues } from '../../src/server/mcx/engine/indicators';
import { seriesKey } from '../../src/server/mcx/engine/series';
import { futureUnit } from '../../src/server/mcx/universe/UniverseResolver';
import { FUT as TARGET, and, candlesAt, cond, field, future, ind, ist, not, num, or, sessionTimes } from '../helpers/mcxFakes';

const cal = new McxMarketCalendar();
const D = '2026-10-07';
const fut = future('CRUDEOIL', '2026-10-19');

function lookupFrom(data: Record<string, RawCandle[]>, now: number): SeriesLookup {
  return (inst, spec) => {
    const raw = data[spec.timeframe === '2h' || spec.timeframe === '4h' ? '1h' : spec.timeframe];
    if (!raw) return { error: 'series not fetched this cycle' };
    return { candles: buildSeries(raw, spec.timeframe, spec.candle, cal, now) };
  };
}

function def(expression: ExprNode, triggerTimeframe: SeriesSpec['timeframe'] = '15m', mode: 'COMPLETED_CANDLE' | 'LIVE_CANDLE' = 'COMPLETED_CANDLE'): McxStrategyDefinition {
  return {
    schemaVersion: 2,
    market: 'MCX',
    name: 't',
    universe: { underlying: 'CRUDEOIL', target: { kind: 'FUTURE', expiry: { mode: 'CURRENT' } } },
    evaluation: { mode, triggerTimeframe },
    expression,
    alert: { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION', cooldownMinutes: null, oncePerCandle: true },
  };
}

function run(expression: ExprNode, data: Record<string, RawCandle[]>, openHHMM: string, opts: { now?: number; tf?: SeriesSpec['timeframe']; mode?: 'COMPLETED_CANDLE' | 'LIVE_CANDLE' } = {}) {
  const tf = opts.tf ?? '15m';
  const open = ist(D, openHHMM);
  const now = opts.now ?? cal.candleClose(open, tf) + 30_000;
  const at = opts.mode === 'LIVE_CANDLE' ? now : cal.candleClose(open, tf);
  return evaluateUnit({
    strategyId: 's',
    version: 1,
    definition: def(expression, tf, opts.mode),
    unit: futureUnit(fut),
    lookup: lookupFrom(data, now),
    triggerOpenMs: open,
    at,
  });
}

describe('operators', () => {
  it('compares with an epsilon for equality', () => {
    expect(compare('GT', [2, 1])).toBe(true);
    expect(compare('GT', [1, 1])).toBe(false);
    expect(compare('GTE', [1, 1 + 1e-12])).toBe(true);
    expect(compare('EQ', [0.1 + 0.2, 0.3])).toBe(true);
    expect(compare('LT', [1, 2])).toBe(true);
    expect(compare('LTE', [2, 2])).toBe(true);
  });

  it('crosses: prev ≤ threshold and curr > threshold', () => {
    expect(compare('CROSSED_ABOVE', [61, 60], [59, 60])).toBe(true);
    expect(compare('CROSSED_ABOVE', [61, 60], [60, 60])).toBe(true); // touching counts as "from below"
    expect(compare('CROSSED_ABOVE', [60, 60], [59, 60])).toBe(false); // must end strictly above
    expect(compare('CROSSED_ABOVE', [62, 60], [61, 60])).toBe(false); // already above
    expect(compare('CROSSED_BELOW', [39, 40], [40, 40])).toBe(true);
    expect(compare('CROSSED_BELOW', [39, 40], [38, 40])).toBe(false);
    expect(compare('CROSSED_ABOVE', [61, 60])).toBe(false); // no previous value
  });

  it('uses three-valued AND / OR / NOT', () => {
    expect(and3(['TRUE', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(and3(['FALSE', 'UNKNOWN'])).toBe('FALSE');
    expect(or3(['FALSE', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(or3(['TRUE', 'UNKNOWN'])).toBe('TRUE');
    expect(not3('UNKNOWN')).toBe('UNKNOWN');
    expect(not3('TRUE')).toBe('FALSE');
  });
});

describe('unit evaluation', () => {
  const t15 = sessionTimes(D, 15, 8); // 09:00 … 10:45
  const closes = [100, 101, 102, 103, 104, 103, 106, 110];
  const data = { '15m': candlesAt(t15, closes) };

  it('reads the last completed candle and the one before for crosses', () => {
    const e = run(cond(field(TARGET('15m')), 'CROSSED_ABOVE', num(105)), data, '10:30');
    expect(e.result).toBe('TRUE'); // 103 → 106
    const c = e.trace.condition!;
    expect(c.left).toMatchObject({ value: 106, prev: 103, candleTime: t15[6]! / 1000, complete: true });
    expect(e.prices).toEqual({ FUT: 106 });
  });

  it('never reads the forming candle in completed mode', () => {
    // At 10:50 the 10:45 candle is forming; the 10:30 candle is the latest completed one.
    const e = run(cond(field(TARGET('15m')), 'GT', num(107)), data, '10:30', { now: ist(D, '10:50') });
    expect(e.result).toBe('FALSE');
    expect(e.trace.condition!.left!.value).toBe(106);
  });

  it('reads the forming candle in live mode', () => {
    const e = run(cond(field(TARGET('15m')), 'GT', num(107)), data, '10:45', { now: ist(D, '10:50'), mode: 'LIVE_CANDLE' });
    expect(e.result).toBe('TRUE');
    expect(e.trace.condition!.left).toMatchObject({ value: 110, complete: false });
  });

  it('aligns a slower series to its last candle closed by T', () => {
    const h = candlesAt([ist(D, '09:00'), ist(D, '10:00')], [50, 70]);
    // T = 10:45: the 10:00 hour is still open → the 09:00 hour (close 50) is used.
    const e = run(cond(field(TARGET('1h')), 'LT', num(60)), { ...data, '1h': h }, '10:30');
    expect(e.result).toBe('TRUE');
    expect(e.trace.condition!.left!.candleTime).toBe(ist(D, '09:00') / 1000);
  });

  it('is UNKNOWN (with a reason) when an indicator lacks history — and UNKNOWN never passes NOT', () => {
    const rsi = cond(ind(TARGET('15m'), 'RSI', { period: 14 }), 'GT', num(50));
    const e = run(rsi, data, '10:30');
    expect(e.result).toBe('UNKNOWN');
    expect(e.trace.condition!.reason).toMatch(/not enough history \(7 candles, needs ~15\)/);
    expect(run(not(rsi), data, '10:30').result).toBe('UNKNOWN');
    expect(run(or(rsi, cond(field(TARGET('15m')), 'GT', num(0))), data, '10:30').result).toBe('TRUE');
    expect(run(and(rsi, cond(field(TARGET('15m')), 'LT', num(0))), data, '10:30').result).toBe('FALSE');
  });

  it('reports a missing series instead of guessing', () => {
    const e = run(cond(field(TARGET('5m')), 'GT', num(1)), data, '10:30');
    expect(e.result).toBe('UNKNOWN');
    expect(e.trace.condition!.reason).toMatch(/series not fetched/);
  });

  it('computes indicators on any source (SMA of volume) and applies multipliers', () => {
    const vols = [100, 200, 300, 400, 500, 600, 700, 2000];
    const d = { '15m': candlesAt(t15, closes, { volume: vols }) };
    const e = run(cond(field(TARGET('15m'), 'volume'), 'GT', ind(TARGET('15m'), 'SMA', { period: 3 }, { source: 'volume', multiplier: 1.5 })), d, '10:30');
    // T = 10:45 → candle #7 (700) vs 1.5 × SMA(500, 600, 700) = 900.
    expect(e.trace.condition!.right!.value).toBe(900);
    expect(e.result).toBe('FALSE');
    const series = buildSeries(d['15m'], '15m', { type: 'NORMAL' }, cal, ist(D, '11:00'));
    expect(indicatorValues(series, { kind: 'INDICATOR', series: TARGET('15m'), indicator: 'SMA', params: { period: 3 }, source: 'volume' }).at(-1)).toBe((600 + 700 + 2000) / 3);
  });

  it('waits briefly for a just-closed trigger candle that the vendor has not published yet', () => {
    const partial = { '15m': candlesAt(t15.slice(0, 5), closes.slice(0, 5)) }; // 09:00 … 10:00 — no 10:15 candle yet
    const open = ist(D, '10:15');
    const input = {
      strategyId: 's',
      version: 1,
      definition: def(cond(field(TARGET('15m')), 'GT', num(1))),
      unit: futureUnit(fut),
      lookup: lookupFrom(partial, ist(D, '10:30') + 20_000),
      triggerOpenMs: open,
      at: cal.candleClose(open, '15m'),
    };
    expect(pendingReason(input, ist(D, '10:30') + 20_000)).toMatch(/not available yet/);
    expect(pendingReason(input, ist(D, '10:34'))).toBeUndefined(); // past the grace → evaluate without it
  });

  it('keys series by instrument and shape', () => {
    expect(seriesKey(fut, TARGET('5m', { type: 'VOLUME', volumePerCandle: 5000 }))).toBe(`${fut.token}|5m|VOLUME:5000`);
  });
});
