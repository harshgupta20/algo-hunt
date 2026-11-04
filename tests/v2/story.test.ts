/**
 * A trade's story: its price path (1-minute candles merged so the trade fits, a little after the exit) and what it
 * tells — the stop as it moved, when the target started trailing, the best / worst price — and a paper trade's path
 * read from Kite.
 */
import { describe, expect, it } from 'vitest';
import type { PaperPlan, PaperSide, PaperTrade } from '../../src/shared/v2';
import { defaultPaperPlan, tradePath, tradeStory } from '../../src/shared/v2';
import { buildTrade } from '../../src/server/v2/paper/PaperTrader';
import { cond, field, fut, ist, legSeries, num, strategy } from '../helpers/v2Fakes';

const D = '2026-10-07';
const nifty = { ...fut('NSE:NIFTY', '2026-10-27'), lotSize: 75 };
const S = strategy([{ id: 'A', kind: 'FUT' }], cond(field(legSeries('A')), 'GT', num(1)));

/** `n` minutes from `from`, each from f(j) = [open, high, low, close]. */
const minutes = (from: string, n: number, f: (j: number) => [number, number, number, number]) =>
  Array.from({ length: n }, (_, j) => {
    const [open, high, low, close] = f(j);
    return { time: (ist(D, from) + j * 60_000) / 1000, open, high, low, close };
  });

function trade(side: PaperSide, plan: Partial<PaperPlan>): PaperTrade {
  const p = { ...defaultPaperPlan(S), slippagePct: 0, ...plan };
  const ids = { strategyId: 's', connectionId: 'backtest:NSE:NIFTY', productId: 'NSE:NIFTY', slot: 'NSE:NIFTY', unitKey: 'u', alertId: null };
  return { ...buildTrade({ plan: p, instrument: nifty, productKind: 'INDEX', side, ref: 100, at: ist(D, '10:00'), ids, group: null, leg: 'A' }), id: 't1' };
}

describe('trade path', () => {
  const flat = minutes('10:00', 260, (j) => [100 + j, 101 + j, 99 + j, 100.5 + j]);

  it('merges the minutes held into at most 48 bars, then up to 12 bars of the same size after the exit', () => {
    const path = tradePath(flat, ist(D, '10:00'), ist(D, '13:20'))!; // 200 minutes → 5-minute bars
    expect(path).toMatchObject({ step: 5, held: 40 });
    expect(path.bars).toHaveLength(52);
    expect(path.bars[0]).toEqual([ist(D, '10:00') / 1000, 100, 105, 99, 104.5]);
    expect(path.bars[40]![0]).toBe(ist(D, '13:20') / 1000); // the first bar after the exit
  });

  it('a live entry seconds into a minute starts at that minute; an open trade runs to the last candle', () => {
    const path = tradePath(flat, ist(D, '10:00') + 30_000, null)!;
    expect(path.bars[0]![0]).toBe(ist(D, '10:00') / 1000);
    expect(path.held).toBe(path.bars.length);
    expect(tradePath(flat, ist(D, '15:00'), null)).toBeUndefined(); // no minute inside
  });
});

describe('trade story', () => {
  it('a sell with a trailing stop: the stop follows the lowest price down, the story says where it ended', () => {
    // Ten minutes down to a low of 89.9, then a minute up through the trail.
    const ms = [...minutes('10:00', 10, (j) => [100 - j, 100.1 - j, 98.9 - j, 99 - j]), ...minutes('10:10', 1, () => [90, 92, 89.95, 91.8])];
    const open = trade('SELL', { targetPct: null, stopPct: 5, trailPct: 2 });
    const t: PaperTrade = { ...open, status: 'CLOSED', peakPrice: 89.9, exitAt: new Date(ist(D, '10:11')).toISOString(), exitPrice: 91.7, exitReason: 'TRAIL' };
    const story = tradeStory(t, tradePath(ms, ist(D, '10:00'), ist(D, '10:11'))!);
    // No target: trailing from the entry — 2 % above 100 is tighter than the 5 % stop-loss.
    expect(story.bars[0]!.stop).toEqual({ price: 102, reason: 'TRAIL' });
    expect(story.moves[0]).toMatchObject({ at: ist(D, '10:01'), best: 98.9, from: { price: 102 }, to: { price: 100.9, reason: 'TRAIL' } });
    expect(story.finalStop).toEqual({ price: 91.7, reason: 'TRAIL' }); // 89.9 × 1.02 = 91.698
    expect(story.best).toEqual({ price: 89.9, at: ist(D, '10:09'), pnl: (100 - 89.9) * 75 });
    expect(story.worst).toMatchObject({ price: 100.1, at: ist(D, '10:00') });
    expect(story.trailingFrom).toBeNull();
    expect(story.after).toBeNull();
  });

  it('a buy that trails past its target: the stop-loss until the target, then the trail takes over', () => {
    const ms = minutes('10:00', 20, (j) => [100 + j, 101 + j, 99.5 + j, 100.8 + j]);
    const open = trade('BUY', { targetPct: 10, stopPct: 5, trailPct: 3 });
    const story = tradeStory({ ...open, peakPrice: 119, trailingAt: new Date(ist(D, '10:09')).toISOString(), lastPrice: 118.8 }, tradePath(ms, ist(D, '10:00'), null)!);
    // The 10:09 minute's high (110) reaches the target 110: the stop-loss (95) until then, the trail from 10:10.
    expect(story.trailingFrom).toEqual({ at: ist(D, '10:09'), bar: 9 });
    expect(story.bars[9]!.stop).toEqual({ price: 95, reason: 'STOP' });
    expect(story.bars[10]!.stop).toEqual({ price: 106.7, reason: 'TRAIL' }); // 110 × 0.97
    expect(story.moves[0]).toMatchObject({ bar: 10, from: { reason: 'STOP' }, to: { reason: 'TRAIL' } });
    expect(story.finalStop).toEqual({ price: 115.45, reason: 'TRAIL' }); // open: the trade's own best 119 × 0.97 = 115.43
  });
});
