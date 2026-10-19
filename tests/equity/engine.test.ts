/**
 * The equity engine, hand-checked: crossovers, fills at the close / next open, target and stop-loss (touch,
 * gaps, both in one day), the trader's pyramiding rule with exact prices, weekly values on daily checks,
 * shared cash, time exits, charges, and the figures.
 */
import { describe, expect, it } from 'vitest';
import type { EqBacktestRequest, EqStrategyDefinition } from '../../src/shared/equity';
import { all, any, cond, defaultDefinition, ind, num, price } from '../../src/shared/equity';
import { dailyBars, weeklyAsOf, weeklyBars, type Bars } from '../../src/server/equity/engine/bars';
import { runBacktest, type StockCandles } from '../../src/server/equity/engine/backtest';
import { orderCharges } from '../../src/server/equity/engine/charges';

type Row = [date: string, open: number, high: number, low: number, close: number];

const toBars = (rows: Row[]): Bars => dailyBars(rows.map(([d, open, high, low, close]) => ({ time: Date.parse(`${d}T00:00:00+05:30`) / 1000, open, high, low, close, volume: 1000 })));

/** Weekdays from `start` (a Monday), one row per close; open = previous close + `gap`, high/low = ±1 around open/close. */
function daily(start: string, closes: number[], gap = 0): Row[] {
  const rows: Row[] = [];
  let d = new Date(`${start}T00:00:00Z`);
  let prev = closes[0]!;
  for (const c of closes) {
    while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() + 86_400_000);
    const o = prev + gap;
    rows.push([d.toISOString().slice(0, 10), o, Math.max(o, c) + 1, Math.min(o, c) - 1, c]);
    prev = c;
    d = new Date(d.getTime() + 86_400_000);
  }
  return rows;
}

const plain = (patch: Partial<EqStrategyDefinition>): EqStrategyDefinition => ({
  ...defaultDefinition(),
  name: 'Test',
  exit: { targetPct: null, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: null, maxBars: null },
  sizing: { mode: 'QUANTITY', value: 10 },
  execution: { fill: 'CLOSE', stopTrigger: 'TOUCH' },
  costs: { charges: false, slippagePct: 0 },
  ...patch,
});

const request = (rows: Row[], patch: Partial<EqBacktestRequest> = {}): EqBacktestRequest => ({ symbols: ['AAA'], from: rows[0]![0], to: rows.at(-1)![0], capital: 1_000_000, maxPositions: null, ...patch });
const run = (def: EqStrategyDefinition, stocks: Array<[string, Row[]]>, patch: Partial<EqBacktestRequest> = {}) => {
  const candles: StockCandles[] = stocks.map(([symbol, rows]) => ({ symbol, name: symbol, daily: toBars(rows) }));
  const all = stocks.flatMap(([, r]) => r).map((r) => r[0]).sort();
  return runBacktest(def, { ...request(stocks[0]![1]), from: all[0]!, to: all.at(-1)!, symbols: stocks.map(([s]) => s), ...patch }, candles, null, all.at(-1)!);
};

const SMA = (period: number) => ind('SMA', { period });

describe('crossovers and fills', () => {
  // SMA(2) crosses above SMA(3) at the 7th close (12): 10.5 > 9.67 after 8.5 ≤ 8.67; back below at the 10th (9): 10 < 11 after 12 ≥ 12.
  const closes = [10, 10, 10, 9, 8, 9, 12, 13, 11, 9, 8];
  const rows = daily('2025-01-06', closes, 1);
  const def = plain({
    entry: { when: all('e', cond('e1', SMA(2), 'CROSSES_ABOVE', SMA(3))), trigger: 'WHEN_TRUE' },
    exit: { targetPct: null, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: any('x', cond('x1', SMA(2), 'CROSSES_BELOW', SMA(3))), maxBars: null },
  });

  it('fills at the signal close', () => {
    const r = run(def, [['AAA', rows]]);
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    expect(t).toMatchObject({ entryDate: rows[6]![0], exitDate: rows[9]![0], avgPrice: 12, exitPrice: 9, quantity: 10, netPnl: -30, exitReason: 'EXIT_RULE' });
    expect(t.fills[0]!.reason).toBe('Entry: SMA(2) 10.50 crosses above SMA(3) 9.67 (previous 8.50 / 8.67)');
    expect(t.fills[1]!.reason).toBe('Exit: SMA(2) 10.00 crosses below SMA(3) 11.00 (previous 12.00 / 12.00)');
    expect(r).toMatchObject({ finalEquity: 1_000_000 - 30, netPnl: -30 });
  });

  it('fills at the next trading day’s open', () => {
    const r = run({ ...def, execution: { fill: 'NEXT_OPEN', stopTrigger: 'TOUCH' } }, [['AAA', rows]]);
    const t = r.trades[0]!;
    expect(t).toMatchObject({ entryDate: rows[7]![0], exitDate: rows[10]![0], avgPrice: rows[7]![1], exitPrice: rows[10]![1] });
    expect(t.fills[0]!).toMatchObject({ signalDate: rows[6]![0], date: rows[7]![0] });
    expect(t.fills[0]!.reason).toMatch(/— bought at the next open$/);
  });
});

describe('target and stop-loss during the day', () => {
  // Bought at the first close (100); target +10 % = 110, stop −5 % = 95.
  const def = plain({
    entry: { when: all('e', cond('e1', price('close'), 'GT', num(0))), trigger: 'BECOMES_TRUE' },
    exit: { targetPct: 10, stopLossPct: 5, trailingStopPct: null, priceBase: 'AVERAGE', when: null, maxBars: null },
  });
  const day0: Row = ['2025-01-06', 100, 101, 99, 100];
  const exit = (day1: Row) => run(def, [['AAA', [day0, day1, ['2025-01-08', 100, 101, 99, 100]]]]).trades[0]!;

  it('both touched in one day → the stop counts', () => {
    expect(exit(['2025-01-07', 101, 112, 94, 105])).toMatchObject({ exitReason: 'STOP_LOSS', exitPrice: 95, exitDate: '2025-01-07' });
  });
  it('a gap below the stop sells at the open', () => {
    expect(exit(['2025-01-07', 90, 92, 88, 91])).toMatchObject({ exitReason: 'STOP_LOSS', exitPrice: 90 });
  });
  it('a gap above the target sells at the open', () => {
    expect(exit(['2025-01-07', 115, 118, 114, 116])).toMatchObject({ exitReason: 'TARGET', exitPrice: 115 });
  });
  it('the target is reached during the day', () => {
    expect(exit(['2025-01-07', 101, 111, 99, 108])).toMatchObject({ exitReason: 'TARGET', exitPrice: 110 });
  });
  it('a trailing stop follows the highest high before the day', () => {
    const t = run({ ...def, exit: { ...def.exit, targetPct: null, stopLossPct: null, trailingStopPct: 10 } }, [
      ['AAA', [day0, ['2025-01-07', 101, 130, 100, 128], ['2025-01-08', 125, 126, 116, 118], ['2025-01-09', 118, 119, 117, 118]]],
    ]).trades[0]!;
    expect(t).toMatchObject({ exitReason: 'TRAILING_STOP', exitPrice: 117, exitDate: '2025-01-08' }); // 130 × 0.9
  });
});

describe('pyramiding — the trader’s rule', () => {
  // One candle a week (Fridays), so each daily candle is its weekly candle. SMA(3) weekly:
  //   W3 close 106 crosses above SMA 102 → BUY 10 @106.
  //   W4 SMA 106 reached the last buy 106 (close 112) → ADD 10 @112, stop for all = 106.
  //   W5 SMA 112 reached the last buy 112 (close 118) → ADD 10 @118, stop for all = 112.
  //   W6 SMA 115.33 < last buy 118 → no add.   W7 low 111 reaches the stop 112 → SELL 30 @112.
  const rows: Row[] = [
    ['2025-01-03', 100, 101, 99, 100],
    ['2025-01-10', 100, 101, 99, 100],
    ['2025-01-17', 100, 101, 99, 100],
    ['2025-01-24', 100, 108, 99, 106],
    ['2025-01-31', 106, 114, 109, 112],
    ['2025-02-07', 112, 120, 115, 118],
    ['2025-02-14', 118, 119, 114, 116],
    ['2025-02-21', 115, 116, 111, 113],
  ];
  const def = plain({
    timeframe: '1w',
    entry: { when: all('e', cond('e1', price('close'), 'CROSSES_ABOVE', SMA(3))), trigger: 'WHEN_TRUE' },
    pyramid: { enabled: true, maType: 'SMA', maPeriod: 3, maxAdds: null },
  });

  it('adds a lot each time the MA reaches the last buy; the MA becomes the stop for every lot', () => {
    const r = run(def, [['AAA', rows]]);
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    expect(t.fills.map((f) => [f.date, f.kind, f.quantity, f.price, f.stopAfter])).toEqual([
      ['2025-01-24', 'ENTRY', 10, 106, null],
      ['2025-01-31', 'ADD', 10, 112, 106],
      ['2025-02-07', 'ADD', 10, 118, 112],
      ['2025-02-21', 'EXIT', 30, 112, null],
    ]);
    expect(t).toMatchObject({ exitReason: 'PYRAMID_STOP', adds: 2, quantity: 30, avgPrice: 112, grossPnl: 0 });
    expect(t.fills[1]!.reason).toBe('SMA(3) ₹106.00 reached the last buy ₹106.00 (close ₹112.00); stop for all lots → ₹106.00');
    expect(t.fills[3]!.reason).toBe('Low ₹111.00 reached the pyramiding stop ₹112.00');
  });

  it('max adds caps the lots', () => {
    const t = run({ ...def, pyramid: { ...def.pyramid, maxAdds: 1 } }, [['AAA', rows]]).trades[0]!;
    expect(t.adds).toBe(1);
    // The stop stays at 106 and no later low reaches it → still held at the end, valued at the last close.
    expect(t).toMatchObject({ exitReason: 'END', exitPrice: 113, quantity: 20 });
  });

  it('any exit closes all lots — an exit condition before the stop', () => {
    // Close crosses below SMA(2) at W6: 116 < 117 after 118 ≥ 115 — two adds done, the stop (112) untouched.
    const withExit = { ...def, exit: { ...def.exit, when: any('x', cond('x1', price('close'), 'CROSSES_BELOW', SMA(2))) } };
    const t = run(withExit, [['AAA', rows]]).trades[0]!;
    expect(t).toMatchObject({ exitReason: 'EXIT_RULE', exitDate: '2025-02-14', exitPrice: 116, quantity: 30, adds: 2 });
  });
});

describe('weekly values on a daily strategy', () => {
  it('reads the last COMPLETED week — a weekly close is known only on the week’s last day', () => {
    // Week 1 closes at 104 (Fri); week 2 closes at 110 every day. Weekly close > 105 turns true at week 2's Friday close.
    const rows = daily('2025-01-06', [100, 101, 102, 103, 104, 110, 110, 110, 110, 110, 110]);
    const def = plain({ entry: { when: all('e', cond('e1', price('close', '1w'), 'GT', num(105))), trigger: 'WHEN_TRUE' } });
    const t = run(def, [['AAA', rows]]).trades[0]!;
    expect(t.entryDate).toBe('2025-01-17'); // week 2's Friday, not Monday 13th
    expect(t.fills[0]!.reason).toBe('Entry: Weekly Close 110.00 > 105');
  });

  it('weekly candles: high / low / volume of the week, the last week complete only if Friday is in the data range', () => {
    const b = toBars(daily('2025-01-06', [100, 101, 102, 103, 104, 105, 106, 107]));
    const w = weeklyBars(b, '2025-01-15');
    expect(w.length).toBe(2);
    expect([w.date[0], w.open[0], w.close[0], w.high[0], w.low[0], w.volume[0]]).toEqual(['2025-01-10', 100, 104, 105, 99, 5000]);
    expect(w.complete).toEqual([true, false]);
    expect(weeklyBars(b, '2025-01-17').complete).toEqual([true, true]);
    expect([...weeklyAsOf(b, w)]).toEqual([-1, -1, -1, -1, 0, 0, 0, 0]);
  });
});

describe('money', () => {
  const rows = daily('2025-01-06', [100, 100, 100]);
  const def = plain({ entry: { when: all('e', cond('e1', price('close'), 'GT', num(0))), trigger: 'BECOMES_TRUE' }, sizing: { mode: 'AMOUNT', value: 60_000 } });

  it('shares cash: same-day buys in alphabetical order, the rest skipped', () => {
    const r = run(def, [['BBB', rows], ['AAA', rows]], { capital: 100_000 });
    expect(r.trades.map((t) => t.symbol)).toEqual(['AAA']);
    expect(r.trades[0]).toMatchObject({ quantity: 600, exitReason: 'END' });
    expect(r.skipped[0]).toMatchObject({ symbol: 'BBB', kind: 'ENTRY', reason: expect.stringMatching(/^Not enough cash: 600 × ₹100.00 needs ₹60,000.00, ₹40,000.00 free/) });
  });

  it('max stocks held', () => {
    const r = run(def, [['BBB', rows], ['AAA', rows]], { capital: 1_000_000, maxPositions: 1 });
    expect(r.trades.map((t) => t.symbol)).toEqual(['AAA']);
    expect(r.skipped[0]!.reason).toBe('Already holding 1 stocks (the maximum)');
  });

  it('no capital limit takes every signal', () => {
    expect(run(def, [['BBB', rows], ['AAA', rows]], { capital: null }).trades).toHaveLength(2);
  });

  it('Zerodha delivery charges per order', () => {
    expect(orderCharges('BUY', 100_000)).toBe(118.62); // STT 100 + exchange 2.97 + SEBI 0.10 + stamp 15 + GST 0.55
    expect(orderCharges('SELL', 100_000)).toBe(121.72); // STT 100 + exchange 2.97 + SEBI 0.10 + DP 15.34 + GST 3.31
  });

  it('charges and slippage come off the P&L', () => {
    const r = run({ ...def, sizing: { mode: 'QUANTITY', value: 100 }, costs: { charges: true, slippagePct: 1 } }, [['AAA', rows]]);
    const t = r.trades[0]!;
    // Bought at 101 (1 % slippage); valued at the last close 100 (END: no slippage).
    expect(t).toMatchObject({ avgPrice: 101, exitPrice: 100, grossPnl: -100, charges: orderCharges('BUY', 10_100) + orderCharges('SELL', 10_000) });
    expect(r.finalEquity).toBeCloseTo(1_000_000 + t.netPnl, 2);
  });
});

describe('entry trigger, time exit and the end of the test', () => {
  const rows = daily('2025-01-06', [100, 120, 100, 120, 100]);
  const always = all('e', cond('e1', price('close'), 'GT', num(0)));

  it('WHEN_TRUE re-enters after an exit; BECOMES_TRUE only when it turns true', () => {
    const exit = { targetPct: 10, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE' as const, when: null, maxBars: null };
    expect(run(plain({ entry: { when: always, trigger: 'WHEN_TRUE' }, exit }), [['AAA', rows]]).trades.length).toBe(3);
    expect(run(plain({ entry: { when: always, trigger: 'BECOMES_TRUE' }, exit }), [['AAA', rows]]).trades.length).toBe(1);
  });

  it('time exit after N checks', () => {
    const t = run(plain({ entry: { when: always, trigger: 'BECOMES_TRUE' }, exit: { targetPct: null, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: null, maxBars: 2 } }), [['AAA', rows]]).trades[0]!;
    expect(t).toMatchObject({ exitReason: 'TIME', entryDate: rows[0]![0], exitDate: rows[2]![0] });
  });

  it('a signal at the last check is listed (it would fill after the period)', () => {
    const r = run(plain({ entry: { when: always, trigger: 'BECOMES_TRUE' }, execution: { fill: 'NEXT_OPEN', stopTrigger: 'TOUCH' } }), [['AAA', daily('2025-01-06', [100])]]);
    expect(r.trades).toEqual([]);
    expect(r.skipped).toEqual([{ symbol: 'AAA', date: '2025-01-06', kind: 'ENTRY', reason: 'Signal at the last check — it would buy at the next open, after the period' }]);
  });
});

describe('figures', () => {
  it('return, drawdown and CAGR from the daily account value', () => {
    // 1,000 shares bought at 100; the price runs to 150, falls to 120, ends at 130 — held to the end.
    const rows = daily('2024-01-01', [100, 150, 120, 130]);
    const r = run(plain({ entry: { when: all('e', cond('e1', price('close'), 'GT', num(0))), trigger: 'BECOMES_TRUE' }, sizing: { mode: 'QUANTITY', value: 1000 } }), [['AAA', rows]], { capital: 100_000 });
    expect(r).toMatchObject({ finalEquity: 130_000, netPnl: 30_000, returnPct: 30, openAtEnd: 1 });
    expect(r.maxDrawdown).toBe(-30_000); // 150,000 → 120,000
    expect(r.maxDrawdownPct).toBe(-20);
    expect(r.cagrPct).toBeNull(); // under a month
    expect(r.stats).toMatchObject({ trades: 1, wins: 1, winRate: 100, exposurePct: 100 });
  });
});
