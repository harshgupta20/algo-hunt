import { describe, expect, it } from 'vitest';
import type { Condition, OHLCV, StrategyDef } from '@ash/shared';
import { CustomStrategyEvaluator } from '../src/server/services/strategy/customEvaluator';
import { computeRsiSeries } from '../src/server/services/indicator/rsi';
import { MCX_SESSION } from '../src/server/utils/marketTime';

const ist = (s: string) => Date.parse(`${s}+05:30`) / 1000;
const MIN = 60;

function strategy(...conditions: Array<Omit<Condition, 'type' | 'id' | 'instrument'> & { instrument?: Condition['instrument'] }>): StrategyDef {
  return {
    id: 's',
    name: 's',
    status: 'active',
    version: 1,
    market: {},
    root: {
      type: 'group',
      id: 'root',
      logic: 'AND',
      children: conditions.map((c, i) => ({ type: 'condition' as const, id: `c${i}`, instrument: 'future' as const, ...c })),
    },
    createdAt: '',
    updatedAt: '',
  };
}

const candle = (time: number, close: number, extra: Partial<OHLCV> = {}): OHLCV => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 100,
  ...extra,
});

/** 15-minute NSE candles for one day from 09:15, with the given closes. */
function nseDay(date: string, closes: number[]): OHLCV[] {
  return closes.map((c, i) => candle(ist(`${date}T09:15:00`) + i * 15 * MIN, c));
}

/** Feed candles one by one; return the indexes where the strategy fired. */
function firings(ev: CustomStrategyEvaluator, bars: OHLCV[]): number[] {
  const out: number[] = [];
  bars.forEach((b, i) => {
    ev.update('future', b);
    if (ev.evaluate()) out.push(i);
  });
  return out;
}

const DAILY_CLOSE: Omit<Condition, 'type' | 'id' | 'instrument' | 'operator'> = {
  indicator: { kind: 'PRICE', field: 'close' },
  timeframe: '1d',
};

describe('multi-timeframe conditions (Daily inside a 15-minute run)', () => {
  it('reads the still-forming daily candle, never the day’s final candle (no look-ahead)', () => {
    const ev = new CustomStrategyEvaluator(strategy({ ...DAILY_CLOSE, operator: 'gt', value: 105 }), { baseTimeframe: '15m' });
    expect(ev.requirements()).toEqual([{ instrument: 'future', timeframe: '1d' }]);
    // Kite's daily series includes TODAY's final candle (close 200) — a look-ahead trap.
    ev.seed('future', '1d', [candle(ist('2026-09-21T00:00:00'), 99), candle(ist('2026-09-22T00:00:00'), 100), candle(ist('2026-09-23T00:00:00'), 200)]);
    const today = nseDay('2026-09-23', [100, 101, 103, 104, 106, 107]);
    // Fires only when the running daily close (= latest 15m close) passes 105.
    expect(firings(ev, today)).toEqual([4]);
  });

  it('uses the previous completed day as the “previous” value for crosses', () => {
    const ev = new CustomStrategyEvaluator(strategy({ ...DAILY_CLOSE, operator: 'crossAbove', value: 100.5 }), { baseTimeframe: '15m' });
    ev.seed('future', '1d', [candle(ist('2026-09-21T00:00:00'), 99), candle(ist('2026-09-22T00:00:00'), 100)]);
    expect(firings(ev, nseDay('2026-09-23', [100, 101, 102]))).toEqual([1]);
  });

  it('computes daily indicators on seeded history + the forming candle', () => {
    const history = [100, 102, 101, 104, 103, 106, 105, 108, 107, 110];
    const ev = new CustomStrategyEvaluator(strategy({ indicator: { kind: 'RSI', params: { period: 5 } }, timeframe: '1d', operator: 'gt', value: 0 }), {
      baseTimeframe: '15m',
    });
    ev.seed('future', '1d', history.map((c, i) => candle(ist('2026-09-09T00:00:00') + i * 86_400, c)));
    ev.update('future', nseDay('2026-09-23', [104])[0]!);
    const match = ev.evaluate();
    const expected = computeRsiSeries([...history, 104], 5).at(-1)!;
    expect(match?.traces[0]?.curr).toBeCloseTo(expected, 10);
    expect(match?.traces[0]?.label).toBe('Future Daily RSI(5)');
  });

  it('switches to Kite’s final candle once the day has closed', () => {
    const ev = new CustomStrategyEvaluator(strategy({ ...DAILY_CLOSE, operator: 'crossBelow', value: 140 }), { baseTimeframe: '15m' });
    // Day 1's official close is 150 even though our 15m candles closed near 100.
    ev.seed('future', '1d', [candle(ist('2026-09-22T00:00:00'), 150)]);
    const day1 = nseDay('2026-09-22', Array.from({ length: 25 }, () => 100)); // 09:15 … 15:15 (closes 15:30)
    const day2 = nseDay('2026-09-23', [120]);
    const fired: number[] = [];
    [...day1, ...day2].forEach((b, i) => {
      ev.update('future', b);
      const m = ev.evaluate();
      if (m) fired.push(i);
    });
    // Day 1 never "crosses below" (no previous day); day 2 opens with prev = 150 (official) → 120 crosses below 140.
    expect(fired).toEqual([25]);
  });

  it('reads the last CLOSED candle of a smaller timeframe (15m inside a 1h run)', () => {
    const ev = new CustomStrategyEvaluator(strategy({ indicator: { kind: 'PRICE', field: 'close' }, timeframe: '15m', operator: 'gt', value: 0 }), {
      baseTimeframe: '1h',
    });
    ev.seed('future', '15m', nseDay('2026-09-23', [10, 11, 12, 13, 14, 15]));
    ev.update('future', candle(ist('2026-09-23T09:15:00'), 13)); // 1h candle 09:15–10:15
    expect(ev.evaluate()?.traces[0]?.curr).toBe(13); // the 10:00–10:15 candle, not 10:15–10:30 (14)
  });

  it('aligns MCX hourly candles to 09:00 and runs in the evening session', () => {
    const ev = new CustomStrategyEvaluator(strategy({ indicator: { kind: 'PRICE', field: 'close' }, timeframe: '1h', operator: 'gt', value: 5000 }), {
      baseTimeframe: '15m',
      session: MCX_SESSION,
    });
    ev.seed('future', '1h', [candle(ist('2026-09-23T20:00:00'), 4990)]);
    const bars = [0, 1, 2, 3].map((i) => candle(ist('2026-09-23T21:00:00') + i * 15 * MIN, 4995 + i * 5));
    expect(firings(ev, bars)).toEqual([2]); // running 21:00 hourly close: 4995, 5000, 5005 → fires at 5005
  });
});

describe('Heikin Ashi candles', () => {
  it('feeds indicators Heikin Ashi candles when a condition asks for them', () => {
    const ev = new CustomStrategyEvaluator(
      strategy(
        { indicator: { kind: 'PRICE', field: 'close' }, candle: 'heikinAshi', operator: 'gt', value: 0 },
        { indicator: { kind: 'PRICE', field: 'close' }, operator: 'gt', value: 0 },
      ),
      { baseTimeframe: '15m' },
    );
    ev.update('future', candle(ist('2026-09-23T09:15:00'), 11, { open: 10, high: 12, low: 9 }));
    const m = ev.evaluate()!;
    expect(m.traces[0]).toMatchObject({ label: 'Future HA PRICE close', curr: 10.5 }); // (10+12+9+11)/4
    expect(m.traces[1]).toMatchObject({ curr: 11 });
  });
});

describe('candle-pattern conditions', () => {
  it('fire on the candle that completes the pattern', () => {
    const ev = new CustomStrategyEvaluator(strategy({ indicator: { kind: 'PATTERN', field: 'bullishEngulfing' }, operator: 'detected' }), {
      baseTimeframe: '15m',
    });
    const t = ist('2026-09-23T09:15:00');
    const bars = [
      candle(t, 100, { open: 102, high: 102.5, low: 99.5 }),
      candle(t + 900, 103, { open: 99.5, high: 103.5, low: 99 }),
      candle(t + 1800, 103.5, { open: 103, high: 104, low: 102.5 }),
    ];
    expect(firings(ev, bars)).toEqual([1]);
  });
});
