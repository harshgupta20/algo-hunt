import { describe, expect, it } from 'vitest';
import { strategyDefinitionSchema, strategySummary, validateStrategy } from '../../src/shared/v2';
import type { V2Unit } from '../../src/shared/v2';
import { exampleStrategies } from '../../src/client/v2/strategies/defaults';
import { MarketCalendar } from '../../src/server/v2/calendar/MarketCalendar';
import { buildSeries, type RawCandle } from '../../src/server/v2/engine/candles';
import { evaluateUnit } from '../../src/server/v2/engine/evaluator';
import { NSE_SESSION, candlesAt, fut, ist, opt, timesEndingAt } from '../helpers/v2Fakes';

describe('V2 example strategies', () => {
  it('every example is valid and uses all its legs', () => {
    for (const ex of exampleStrategies()) {
      expect(strategyDefinitionSchema.safeParse(ex.definition).success, ex.key).toBe(true);
      expect(validateStrategy(ex.definition), ex.key).toEqual([]);
    }
  });

  it('the trader’s RSI + Bollinger sheet reads as two groups joined by OR', () => {
    const ex = exampleStrategies().find((e) => e.key === 'rsi-bb-bull-bear')!;
    const text = strategySummary(ex.definition);
    expect(text).toMatch(/Legs: A · FUT · B · CE ATM · C · PE ATM/);
    expect(text).toMatch(/Group 1 · Bullish \(CE\): \(\[A · FUT\] \[5 min\] \[Normal\] RSI\(14\) crossed above 60/);
    expect(text).toMatch(/\[B · CE ATM\] \[5 min\] \[Normal\] Close > Bollinger Bands\(20,2\) Upper/);
    expect(text).toMatch(/OR Group 2 · Bearish \(PE\): \(\[A · FUT\] \[5 min\] \[Normal\] RSI\(14\) crossed below 40/);
    expect(text).toMatch(/\[A · FUT\] \[5 min\] \[Normal\] Close < Bollinger Bands\(20,2\) Lower/);
    expect(text).toMatch(/\[C · PE ATM\] \[5 min\] \[Normal\] Close > Bollinger Bands\(20,2\) Upper/);
  });
});


describe('the trader’s RSI + Bollinger strategy on the engine', () => {
  const ex = exampleStrategies().find((e) => e.key === 'rsi-bb-bull-bear')!.definition;
  const cal = new MarketCalendar('NSE');
  const D = '2026-10-07';
  const times = timesEndingAt(ist(D, '11:00'), 5, 60, NSE_SESSION);
  // Quiet market (RSI ≈ 50, tight bands), then a big last candle up / down / flat.
  const series = (last: 'up' | 'down' | 'flat', base = 100) =>
    candlesAt(times, [...Array.from({ length: 59 }, (_, i) => base + (i % 2 ? 0.5 : -0.5)), base + (last === 'up' ? 10 : last === 'down' ? -10 : 0.5)], { spread: 0.2 });
  const A = fut('NSE:NIFTY', '2026-10-27');
  const B = opt('NSE:NIFTY', '2026-10-13', 25_000, 'CE');
  const C = opt('NSE:NIFTY', '2026-10-13', 25_000, 'PE');
  const unit: V2Unit = { key: '2026-10-13|25000', productId: 'NSE:NIFTY', expiry: '2026-10-13', baseStrike: 25_000, shift: 0, legs: { A, B, C } };

  function run(a: RawCandle[], b: RawCandle[], c: RawCandle[]) {
    const data = new Map([
      [A.token, a],
      [B.token, b],
      [C.token, c],
    ]);
    const now = ist(D, '11:05') + 30_000;
    const open = ist(D, '11:00');
    return evaluateUnit({
      strategyId: 's',
      version: 1,
      productId: 'NSE:NIFTY',
      definition: ex,
      unit,
      lookup: (inst, spec) => ({ candles: buildSeries(data.get(inst.token)!, spec.timeframe, spec.candle, cal, now) }),
      triggerOpenMs: open,
      at: cal.candleClose(open, '5m'),
    });
  }

  it('fires Group 1 on a bullish candle (future and call break out, RSI crosses 60)', () => {
    const e = run(series('up', 25_000), series('up', 150), series('down', 120));
    expect(e.result).toBe('TRUE');
    expect(e.trace.children!.map((g) => [g.label, g.result])).toEqual([
      ['Group 1 · Bullish (CE)', 'TRUE'],
      ['Group 2 · Bearish (PE)', 'FALSE'],
    ]);
  });

  it('fires Group 2 on a bearish candle (future breaks down, put breaks out)', () => {
    const e = run(series('down', 25_000), series('down', 150), series('up', 120));
    expect(e.trace.children!.map((g) => g.result)).toEqual(['FALSE', 'TRUE']);
    expect(e.result).toBe('TRUE');
  });

  it('does not fire when only the future breaks out', () => {
    const e = run(series('up', 25_000), series('flat', 150), series('flat', 120));
    expect(e.result).toBe('FALSE');
    expect(e.trace.children![0]!.children!.map((c) => c.result)).toEqual(['TRUE', 'FALSE', 'TRUE', 'FALSE']);
  });
});
