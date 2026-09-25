import { describe, expect, it } from 'vitest';
import type { Condition } from '@ash/shared';
import { createIndicator, indicatorLabel } from '../src/server/services/indicator/registry';
import { builderCatalog } from '../src/server/services/strategy/builderCatalog';
import { adaptComparison, defaultComparison, newIndicatorRef, priceLevelLooksWrong } from '../src/client/views/builder/comparison';
import type { Bar } from '../src/server/services/indicator/types';

const bar = (close: number, i: number): Bar => ({ time: 1_704_067_200 + i * 900, open: close, high: close, low: close, close, volume: 100 });

describe('Bollinger %B and Bandwidth', () => {
  // closes 1,2,3 · period 3 · 2 std: mean 2, std √(2/3) → upper 3.633, lower 0.367
  const std = Math.sqrt(2 / 3);
  const upper = 2 + 2 * std;
  const lower = 2 - 2 * std;

  it('%B places the close inside the band (0 = lower, 1 = upper)', () => {
    const b = createIndicator({ kind: 'BBANDS', params: { period: 3, mult: 2 }, field: 'percentB' });
    [1, 2, 3].forEach((c, i) => b.update(bar(c, i)));
    expect(b.value()).toBeCloseTo((3 - lower) / (upper - lower), 10);
  });

  it('Bandwidth is the band width as a % of the middle band', () => {
    const b = createIndicator({ kind: 'BBANDS', params: { period: 3, mult: 2 }, field: 'bandwidth' });
    [1, 2, 3].forEach((c, i) => b.update(bar(c, i)));
    expect(b.value()).toBeCloseTo(((upper - lower) / 2) * 100, 10);
  });

  it('%B is undefined on a flat series (no band to place the close in)', () => {
    const b = createIndicator({ kind: 'BBANDS', params: { period: 3, mult: 2 }, field: 'percentB' });
    [5, 5, 5].forEach((c, i) => b.update(bar(c, i)));
    expect(b.value()).toBeUndefined();
  });

  it('labels the new outputs readably in alert explanations', () => {
    expect(indicatorLabel({ kind: 'BBANDS', params: { period: 20, mult: 2 }, field: 'percentB' })).toBe('BBANDS(20,2) %B');
    expect(indicatorLabel({ kind: 'BBANDS', params: { period: 20, mult: 2 }, field: 'bandwidth' })).toBe('BBANDS(20,2) bandwidth %');
  });
});

describe('builder comparison rules', () => {
  const catalog = builderCatalog();
  const rsiCross: Condition = {
    type: 'condition',
    id: 'c',
    instrument: 'future',
    indicator: newIndicatorRef(catalog, 'RSI'),
    operator: 'crossAbove',
    value: 60,
  };

  it('switching RSI → Bollinger compares the band with the close instead of keeping RSI’s 60', () => {
    const bb = newIndicatorRef(catalog, 'BBANDS');
    expect(bb.field).toBe('upper');
    expect(adaptComparison(catalog, rsiCross, bb)).toMatchObject({ compareTo: { kind: 'PRICE', field: 'close' }, compareInstrument: 'future' });
  });

  it('switching a band to %B / Bandwidth goes back to a number with a typical level', () => {
    const bandVsClose: Condition = { ...rsiCross, indicator: newIndicatorRef(catalog, 'BBANDS'), compareTo: newIndicatorRef(catalog, 'PRICE') };
    expect(adaptComparison(catalog, bandVsClose, { ...bandVsClose.indicator, field: 'percentB' })).toMatchObject({ compareTo: undefined, value: 1 });
    expect(adaptComparison(catalog, bandVsClose, { ...bandVsClose.indicator, field: 'bandwidth' })).toMatchObject({ compareTo: undefined, value: 2 });
  });

  it('keeps a deliberately typed price level when the unit doesn’t change (Upper → Lower)', () => {
    const typed: Condition = { ...rsiCross, indicator: newIndicatorRef(catalog, 'BBANDS'), value: 25000 };
    expect(adaptComparison(catalog, typed, { ...typed.indicator, field: 'lower' })).toEqual({});
  });

  it('leaves range / percent conditions alone', () => {
    const between: Condition = { ...rsiCross, operator: 'between', value: 40, value2: 60 };
    expect(adaptComparison(catalog, between, newIndicatorRef(catalog, 'BBANDS'))).toEqual({});
  });

  it('picks a sensible partner indicator per type', () => {
    const on = (kind: string, params?: Record<string, number>) => defaultComparison(catalog, { ...rsiCross, indicator: newIndicatorRef(catalog, kind, params) }).compareTo;
    expect(on('VWAP')).toMatchObject({ kind: 'PRICE' });
    expect(on('EMA', { period: 20 })).toMatchObject({ kind: 'EMA', params: { period: 50 } });
    expect(on('EMA', { period: 50 })).toMatchObject({ kind: 'EMA', params: { period: 200 } });
    expect(on('RSI')).toMatchObject({ kind: 'RSI' }); // same indicator, other leg
  });

  it('flags a futures price compared with an oscillator-style number', () => {
    const bbUpper60: Condition = { ...rsiCross, indicator: newIndicatorRef(catalog, 'BBANDS'), value: 60 };
    expect(priceLevelLooksWrong(bbUpper60, 'value')).toBe(true);
    expect(priceLevelLooksWrong({ ...bbUpper60, value: 25000 }, 'value')).toBe(false);
    expect(priceLevelLooksWrong({ ...bbUpper60, instrument: 'call' }, 'value')).toBe(false); // premiums can be small
    expect(priceLevelLooksWrong(rsiCross, 'value')).toBe(false);
    expect(priceLevelLooksWrong({ ...bbUpper60, indicator: { ...bbUpper60.indicator, field: 'percentB' }, value: 1 }, 'value')).toBe(false);
  });
});
