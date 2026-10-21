/**
 * The equity engine, hand-checked: crossovers, fills at the close / next open, target and stop-loss (touch,
 * gaps, both in one day), the trader's pyramiding rule with exact prices, weekly candles, shared cash, time exits,
 * charges, the app's fixed order rules (next open + slippage shown in the order), and the figures.
 */
import { describe, expect, it } from 'vitest';
import type { EqBacktestRequest, EqOrderRules, EqStrategyDefinition } from '../../src/shared/equity';
import { EQ_ORDER_RULES, all, any, cond, defaultDefinition, ind, num, price } from '../../src/shared/equity';
import { dailyBars, weeklyBars, type Bars } from '../../src/server/equity/engine/bars';
import { coarsePriceNotes, runBacktest, type StockCandles } from '../../src/server/equity/engine/backtest';
import { orderCharges, saleCharges } from '../../src/server/equity/engine/charges';

type Row = [date: string, open: number, high: number, low: number, close: number, volume?: number];

const toBars = (rows: Row[]): Bars => dailyBars(rows.map(([d, open, high, low, close, volume = 1000]) => ({ time: Date.parse(`${d}T00:00:00+05:30`) / 1000, open, high, low, close, volume })));

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
  ...patch,
});

/** Hand-checkable fills: at the signal close, no charges, no slippage (real backtests use EQ_ORDER_RULES). */
const SIMPLE: EqOrderRules = { fill: 'CLOSE', stopTrigger: 'TOUCH', charges: false, slippagePct: 0 };

const request = (rows: Row[], patch: Partial<EqBacktestRequest> = {}): EqBacktestRequest => ({ symbols: ['AAA'], from: rows[0]![0], to: rows.at(-1)![0], capital: 1_000_000, maxPositions: null, ...patch });
const run = (def: EqStrategyDefinition, stocks: Array<[string, Row[]]>, patch: Partial<EqBacktestRequest> = {}, rules: EqOrderRules = SIMPLE) => {
  const candles: StockCandles[] = stocks.map(([symbol, rows]) => ({ symbol, name: symbol, daily: toBars(rows) }));
  const all = stocks.flatMap(([, r]) => r).map((r) => r[0]).sort();
  return runBacktest(def, { ...request(stocks[0]![1]), from: all[0]!, to: all.at(-1)!, symbols: stocks.map(([s]) => s), ...patch }, candles, null, all.at(-1)!, rules);
};

const SMA = (period: number) => ind('SMA', { period });
/** Results list trades newest first; these tests read them in order. */
const oldestFirst = <T extends { entryDate: string }>(ts: T[]) => [...ts].sort((a, b) => a.entryDate.localeCompare(b.entryDate));

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
    const r = run(def, [['AAA', rows]], {}, { ...SIMPLE, fill: 'NEXT_OPEN' });
    const t = r.trades[0]!;
    expect(t).toMatchObject({ entryDate: rows[7]![0], exitDate: rows[10]![0], avgPrice: rows[7]![1], exitPrice: rows[10]![1] });
    expect(t.fills[0]!).toMatchObject({ signalDate: rows[6]![0], date: rows[7]![0] });
    expect(t.fills[0]!.reason).toMatch(/— bought at the next open$/);
  });

  it('a real backtest (EQ_ORDER_RULES): the candles’ own prices at the next open — no charges, no slippage', () => {
    const r = run(def, [['AAA', rows]], {}, EQ_ORDER_RULES);
    const [buy, sell] = r.trades[0]!.fills;
    expect(buy).toMatchObject({ date: rows[7]![0], price: 13, charges: 0 });
    expect(buy!.reason).toMatch(/— bought at the next open$/);
    expect(sell).toMatchObject({ date: rows[10]![0], price: 10, charges: 0 });
    expect(r.trades[0]).toMatchObject({ charges: 0, netPnl: (10 - 13) * 10 });
  });

  it('with slippage and charges switched on, the order shows the open and the slippage', () => {
    const r = run(def, [['AAA', rows]], {}, { ...EQ_ORDER_RULES, charges: true, slippagePct: 0.1 });
    const [buy, sell] = r.trades[0]!.fills;
    // Bought at the 8th open (13) + 0.1 % = 13.013 → 13.02 (whole paise, rounded up); sold at the 11th open (10) − 0.1 %.
    expect(buy).toMatchObject({ date: rows[7]![0], price: 13.02, charges: orderCharges('BUY', 130.2) });
    expect(buy!.reason).toMatch(/— bought at the next open \(₹13\.00 \+ 0\.1% slippage\)$/);
    expect(sell).toMatchObject({ date: rows[10]![0], price: 9.99, charges: orderCharges('SELL', 99.9) });
    expect(sell!.reason).toMatch(/— sold at the next open \(₹10\.00 − 0\.1% slippage\)$/);
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

describe('weekly candles', () => {
  it('a weekly strategy reads every value on weekly candles, checked on the week’s last day', () => {
    // Week 1 closes at 104 (Fri); week 2 closes at 110 every day. Close > 105 turns true at week 2's Friday close.
    const rows = daily('2025-01-06', [100, 101, 102, 103, 104, 110, 110, 110, 110, 110, 110]);
    const def = plain({ timeframe: '1w', entry: { when: all('e', cond('e1', price('close'), 'GT', num(105))), trigger: 'WHEN_TRUE' } });
    const t = run(def, [['AAA', rows]]).trades[0]!;
    expect(t.entryDate).toBe('2025-01-17'); // week 2's Friday, not Monday 13th
    expect(t.fills[0]!.reason).toBe('Entry: Close 110.00 > 105');
  });

  it('weekly candles: high / low / volume of the week, the last week complete only if Friday is in the data range', () => {
    const b = toBars(daily('2025-01-06', [100, 101, 102, 103, 104, 105, 106, 107]));
    const w = weeklyBars(b, '2025-01-15');
    expect(w.length).toBe(2);
    expect([w.date[0], w.open[0], w.close[0], w.high[0], w.low[0], w.volume[0]]).toEqual(['2025-01-10', 100, 104, 105, 99, 5000]);
    expect(w.complete).toEqual([true, false]);
    expect(weeklyBars(b, '2025-01-17').complete).toEqual([true, true]);
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
    expect(orderCharges('BUY', 100_000)).toBe(118.74); // STT 100 + exchange 3.07 + SEBI 0.10 + stamp 15 + GST 0.57
    expect(orderCharges('SELL', 100_000)).toBe(119.08); // STT 100 + exchange 3.07 + SEBI 0.10 + GST 0.57 + DP 15.34 (GST included)
    expect(orderCharges('SELL', 13_786.2)).toBe(29.64); // the MARUTI sale that showed ₹32.39 when GST was added to the DP charge twice
  });

  it('charges and slippage come off the P&L', () => {
    const r = run({ ...def, sizing: { mode: 'QUANTITY', value: 100 } }, [['AAA', rows]], {}, { ...SIMPLE, charges: true, slippagePct: 1 });
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
    // Bought at 100; day 2's high reaches the 110 target → sold there, and bought again at day 2's close (120).
    const again = oldestFirst(run(plain({ entry: { when: always, trigger: 'WHEN_TRUE' }, exit }), [['AAA', rows]]).trades);
    expect(again.map((t) => [t.entryDate, t.exitDate, t.exitReason])).toEqual([
      [rows[0]![0], rows[1]![0], 'TARGET'],
      [rows[1]![0], rows[4]![0], 'END'],
    ]);
    expect(run(plain({ entry: { when: always, trigger: 'BECOMES_TRUE' }, exit }), [['AAA', rows]]).trades.length).toBe(1);
  });

  it('a stock sold at the open can signal again that evening and buy at the next open', () => {
    // Close crosses above 105 at day 2 (110) → bought day 3's open; close < 105 at day 3 → sold day 4's open;
    // close crosses above 105 again at day 4 (108) → bought day 5's open (a crossing is never repeated, so
    // skipping it would lose the trade).
    const r = daily('2025-01-06', [100, 110, 104, 108, 109, 109]);
    const def = plain({
      entry: { when: all('e', cond('e1', price('close'), 'CROSSES_ABOVE', num(105))), trigger: 'WHEN_TRUE' },
      exit: { targetPct: null, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: any('x', cond('x1', price('close'), 'LT', num(105))), maxBars: null },
    });
    const t = oldestFirst(run(def, [['AAA', r]], {}, { ...SIMPLE, fill: 'NEXT_OPEN' }).trades);
    expect(t.map((x) => [x.entryDate, x.exitDate])).toEqual([
      [r[2]![0], r[3]![0]],
      [r[4]![0], r[5]![0]],
    ]);
  });

  it('a sale AT a close blocks a re-buy at that same close', () => {
    // Fills at the close: day 1 buys at 100, the 2-day time exit sells at day 3's close — no buy at that close.
    const t = oldestFirst(run(plain({ entry: { when: always, trigger: 'WHEN_TRUE' }, exit: { targetPct: null, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: null, maxBars: 2 } }), [['AAA', rows]]).trades);
    expect(t.map((x) => [x.entryDate, x.exitDate, x.exitReason])).toEqual([
      [rows[0]![0], rows[2]![0], 'TIME'],
      [rows[3]![0], rows[4]![0], 'END'],
    ]);
  });

  it('time exit after N checks', () => {
    const t = run(plain({ entry: { when: always, trigger: 'BECOMES_TRUE' }, exit: { targetPct: null, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: null, maxBars: 2 } }), [['AAA', rows]]).trades[0]!;
    expect(t).toMatchObject({ exitReason: 'TIME', entryDate: rows[0]![0], exitDate: rows[2]![0] });
  });

  it('a signal at the last check is listed (it would fill after the period)', () => {
    const r = run(plain({ entry: { when: always, trigger: 'BECOMES_TRUE' } }), [['AAA', daily('2025-01-06', [100])]], {}, { ...SIMPLE, fill: 'NEXT_OPEN' });
    expect(r.trades).toEqual([]);
    expect(r.skipped).toEqual([{ symbol: 'AAA', date: '2025-01-06', kind: 'ENTRY', reason: 'Signal at the last check — it would buy at the next open, after the period' }]);
  });
});

describe('real-market limits', () => {
  const cross105 = all('e', cond('e1', price('close'), 'CROSSES_ABOVE', num(105)));
  const below105 = any('x', cond('x1', price('close'), 'LT', num(105)));
  const NEXT: EqOrderRules = { ...SIMPLE, fill: 'NEXT_OPEN' };
  const noExit = { targetPct: null, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE' as const, when: null, maxBars: null };

  it('repairs bad ticks: an open outside the high–low, a high below the low', () => {
    const b = toBars([['2025-01-06', 67, 66, 64.15, 66], ['2025-01-07', 60.7, 59.35, 60, 60.98]]);
    expect([b.open[0], b.high[0], b.low[0], b.close[0]]).toEqual([67, 67, 64.15, 66]);
    expect([b.high[1], b.low[1]]).toEqual([60.98, 59.35]);
  });

  it('a zero-volume day trades nothing: the buy lapses, a queued sale waits', () => {
    const def = plain({ entry: { when: cross105, trigger: 'WHEN_TRUE' }, exit: { ...noExit, when: below105 } });
    const quiet: Row[] = [['2025-01-06', 100, 101, 99, 100], ['2025-01-07', 100, 111, 99, 110], ['2025-01-08', 110, 110, 110, 110, 0]];
    const r1 = run(def, [['AAA', quiet]], {}, NEXT);
    expect(r1.trades).toEqual([]);
    expect(r1.skipped[0]).toMatchObject({ kind: 'ENTRY', reason: 'No trades in AAA that day (zero volume)' });
    const waits: Row[] = [
      ['2025-01-06', 100, 101, 99, 100],
      ['2025-01-07', 100, 111, 99, 110],
      ['2025-01-08', 110, 112, 109, 110],
      ['2025-01-09', 110, 111, 99, 100],
      ['2025-01-10', 100, 100, 100, 100, 0],
      ['2025-01-13', 98, 99, 97, 98],
    ];
    expect(run(def, [['AAA', waits]], {}, NEXT).trades[0]).toMatchObject({ entryDate: '2025-01-08', exitDate: '2025-01-13', exitPrice: 98 });
  });

  it('a lot bought and sold the same day pays intraday charges (no DP charge)', () => {
    // Close crosses above 105 on day 2 → bought at day 3's open (110); day 3's low reaches the 2 % stop (107.80).
    const rows: Row[] = [
      ['2025-01-06', 100, 101, 99, 100],
      ['2025-01-07', 100, 111, 99, 110],
      ['2025-01-08', 110, 111, 100, 104],
    ];
    const def = plain({ entry: { when: cross105, trigger: 'WHEN_TRUE' }, exit: { ...noExit, stopLossPct: 2 }, sizing: { mode: 'QUANTITY', value: 100 } });
    const r = run(def, [['AAA', rows]], {}, { ...NEXT, charges: true });
    const [buy, sell] = r.trades[0]!.fills;
    expect(buy).toMatchObject({ date: '2025-01-08', price: 110, charges: orderCharges('BUY', 11_000, true) });
    expect(sell).toMatchObject({ date: '2025-01-08', price: 107.8, charges: orderCharges('SELL', 10_780, true) });
    expect(sell!.charges).toBeLessThan(15.34); // no DP charge
    expect(r.trades[0]!.charges).toBeCloseTo(buy!.charges + sell!.charges, 6);
    expect(r.finalEquity).toBeCloseTo(1_000_000 + r.trades[0]!.netPnl, 2);
    // One sale order of shares bought today and earlier: intraday on the first, delivery (with DP) on the rest.
    expect(saleCharges(100, 10, 5)).toBe(Math.round((orderCharges('SELL', 1000, true) + orderCharges('SELL', 500)) * 100) / 100);
  });

  it('“max stocks held” doesn’t count a stock already being sold at the next open', () => {
    // AAA: bought day 3, exit signal day 4 (sold day 5's open). BBB signals on day 4 → bought day 5 after AAA's sale.
    const aaa = daily('2025-01-06', [100, 110, 110, 100, 100, 100]);
    const bbb = daily('2025-01-06', [100, 100, 100, 110, 110, 110]);
    const def = plain({ entry: { when: cross105, trigger: 'WHEN_TRUE' }, exit: { ...noExit, when: below105 } });
    const t = run(def, [['AAA', aaa], ['BBB', bbb]], { maxPositions: 1 }, NEXT).trades;
    expect(oldestFirst(t).map((x) => [x.symbol, x.entryDate])).toEqual([
      ['AAA', aaa[2]![0]],
      ['BBB', bbb[4]![0]],
    ]);
  });

  it('a pyramid add that would open at or below the stop it sets is not bought', () => {
    // Bought at day 2's open (100). Day 2: SMA(2) 102 ≥ 100 → add at day 3's open (104), stop 102. Day 3: SMA(2) 105
    // reaches the last buy (104), close 106 → a second add queued with stop 105 — but day 4 opens at 104: not bought.
    const rows: Row[] = [
      ['2025-01-06', 100, 101, 99, 100],
      ['2025-01-07', 100, 105, 99, 104],
      ['2025-01-08', 104, 107, 103, 106],
      ['2025-01-09', 104, 105, 103, 104],
      ['2025-01-10', 104, 105, 103, 104.5],
    ];
    const def = plain({ entry: { when: all('e', cond('e1', price('close'), 'GT', num(0))), trigger: 'BECOMES_TRUE' }, exit: noExit, pyramid: { enabled: true, maType: 'SMA', maPeriod: 2, maxAdds: null } });
    const r = run(def, [['AAA', rows]], {}, NEXT);
    expect(r.trades[0]).toMatchObject({ adds: 1, exitReason: 'END' });
    expect(r.skipped[0]).toMatchObject({ kind: 'ADD', date: '2025-01-09', reason: 'Opened at ₹104.00, at or below the new stop ₹105.00 — no add' });
    // Day 5: SMA(2) 104.25 ≥ 104 with the close at 104.5 → an add signalled at the last check, listed.
    expect(r.skipped[1]).toMatchObject({ kind: 'ADD', date: '2025-01-10', reason: 'Signal at the last check — it would add at the next open, after the period' });
  });

  it('a next-open order lapses when the stock doesn’t trade on the next market day', () => {
    const aaa = daily('2025-01-06', [100, 100, 100, 100]);
    const bbb: Row[] = [aaa[0]!, ['2025-01-07', 100, 111, 99, 110], ['2025-01-09', 110, 111, 109, 110]].map((r, i) => (i === 0 ? ['2025-01-06', 100, 101, 99, 100] : r)) as Row[];
    const def = plain({ entry: { when: cross105, trigger: 'WHEN_TRUE' }, exit: noExit });
    const r = run(def, [['AAA', aaa], ['BBB', bbb]], {}, NEXT);
    expect(r.trades).toEqual([]);
    expect(r.skipped).toEqual([{ symbol: 'BBB', date: '2025-01-09', kind: 'ENTRY', reason: 'No trade in BBB on 2025-01-08, the day after the signal — the next-open order lapsed' }]);
  });

  it('circuit locks: no buy at the upper circuit; a sale waits through the lower circuit', () => {
    const def = plain({ entry: { when: cross105, trigger: 'WHEN_TRUE' }, exit: { ...noExit, when: below105 } });
    // Signal day 2; day 3 is locked up at 115.50 (one price, above 110.05) → the buy lapses. (Paise prices: whole
    // rupees on a ₹100 stock would look like Kite's rounded history, where one-price days aren't locks.)
    const up: Row[] = [['2025-01-06', 100.05, 101.1, 99.15, 100.2], ['2025-01-07', 100.25, 111.3, 99.35, 110.05], ['2025-01-08', 115.5, 115.5, 115.5, 115.5]];
    const r1 = run(def, [['AAA', up]], {}, NEXT);
    expect(r1.trades).toEqual([]);
    expect(r1.skipped[0]).toMatchObject({ kind: 'ENTRY', reason: 'Locked at the upper circuit (₹115.50 all day) — no sellers to buy from' });
    // Bought day 3; exit signal day 4 (100.15 < 105); day 5 locked down at 95.15 → no sale; sold at day 6's open.
    const down: Row[] = [
      ['2025-01-06', 100.05, 101.1, 99.15, 100.2],
      ['2025-01-07', 100.25, 111.3, 99.35, 110.05],
      ['2025-01-08', 110.1, 112.15, 109.2, 110.35],
      ['2025-01-09', 110.4, 111.45, 99.55, 100.15],
      ['2025-01-10', 95.15, 95.15, 95.15, 95.15],
      ['2025-01-13', 96.35, 97.4, 94.45, 95.6],
    ];
    const t = run(def, [['AAA', down]], {}, NEXT).trades[0]!;
    expect(t).toMatchObject({ entryDate: '2025-01-08', exitDate: '2025-01-13', exitPrice: 96.35, exitReason: 'EXIT_RULE' });
    // The same days in rounded (coarse) history: a one-price day isn't taken as a lock — the sale fills at day 5's open.
    const rounded = down.map(([d, o, h, l, c]): Row => [d, Math.round(o), Math.round(h), Math.round(l), Math.round(c)]);
    expect(run(def, [['AAA', rounded]], {}, NEXT).trades[0]).toMatchObject({ exitDate: '2025-01-10', exitPrice: 95 });
  });

  it('pyramiding on a flat stock: an MA equal to the last buy counts (floating-point noise doesn’t decide)', () => {
    const rows = daily('2025-01-06', Array(12).fill(6.05));
    const def = plain({ entry: { when: all('e', cond('e1', price('close'), 'GT', num(0))), trigger: 'BECOMES_TRUE' }, exit: noExit, pyramid: { enabled: true, maType: 'WMA', maPeriod: 5, maxAdds: 1 } });
    expect(run(def, [['AAA', rows]]).trades[0]!.adds).toBe(1);
  });

  it('flags orders that were large against the day’s traded volume', () => {
    // 1,000 shares per buy against 1,000 traded a day (the helper's volume) → 100 % of the day.
    const rows = daily('2025-01-06', [100.05, 110.15, 110.25, 100.35, 100.45]);
    const def = plain({ entry: { when: cross105, trigger: 'WHEN_TRUE' }, exit: { ...noExit, when: below105 }, sizing: { mode: 'QUANTITY', value: 1000 } });
    const r = run(def, [['AAA', rows]], {}, NEXT);
    expect(r.perSymbol[0]!.notes).toContain("2 orders were over 10% of that day's traded volume (up to 100%) — a real order that size would likely have moved the price, so its fill here is optimistic");
  });

  it('flags stretches where Kite’s adjusted prices move in coarse steps', () => {
    const steps = Array.from({ length: 80 }, (_, i) => 6 + 0.5 * (i % 4));
    const coarse = toBars(daily('2012-01-02', steps));
    expect(coarsePriceNotes(coarse, '2012-01-01', '2012-12-31')[0]).toMatch(/^Kite's prices from 2012-01-02 to 2012-04-20 move in coarse steps \(up to \d+\.\d% of the price\)/);
    const fine = toBars(daily('2012-01-02', steps.map((x, i) => x + 0.05 * (i % 3))));
    expect(coarsePriceNotes(fine, '2012-01-01', '2012-12-31')).toEqual([]);
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
