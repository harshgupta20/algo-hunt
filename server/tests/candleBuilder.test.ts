import { describe, expect, it } from 'vitest';
import { CandleBuilder } from '../src/services/indicator/candleBuilder.js';
import type { Tick } from '@ash/shared';

// 2024-01-01T00:00:00Z — aligned to 5m/15m/30m/1h boundaries so relative
// offsets below land in predictable buckets.
const T0 = 1_704_067_200_000;
const MIN = 60_000;

function tick(token: number, ltp: number, timestamp: number): Tick {
  return { token, ltp, timestamp };
}

describe('CandleBuilder', () => {
  it('does not close a candle while ticks stay in the same 15m bucket', () => {
    const b = new CandleBuilder(1, '15m');
    expect(b.update(tick(1, 100, T0)).closed).toBeUndefined();
    expect(b.update(tick(1, 105, T0 + 3 * MIN)).closed).toBeUndefined();
    expect(b.update(tick(1, 95, T0 + 10 * MIN)).closed).toBeUndefined();
    const c = b.current!;
    expect(c.open).toBe(100);
    expect(c.high).toBe(105);
    expect(c.low).toBe(95);
    expect(c.close).toBe(95);
    expect(c.closed).toBe(false);
  });

  it('closes the previous candle with correct OHLC on bucket rollover', () => {
    const b = new CandleBuilder(1, '15m');
    b.update(tick(1, 100, T0));
    b.update(tick(1, 110, T0 + 5 * MIN));
    b.update(tick(1, 90, T0 + 9 * MIN));
    const { closed } = b.update(tick(1, 102, T0 + 16 * MIN)); // next bucket
    expect(closed).toBeDefined();
    expect(closed!.open).toBe(100);
    expect(closed!.high).toBe(110);
    expect(closed!.low).toBe(90);
    expect(closed!.close).toBe(90);
    expect(closed!.closed).toBe(true);
    // new forming candle started from the rollover tick
    expect(b.current!.open).toBe(102);
  });

  it('aligns buckets to the timeframe boundary', () => {
    const b = new CandleBuilder(1, '15m');
    b.update(tick(1, 100, T0 + 2 * MIN));
    const first = b.current!.bucket;
    b.update(tick(1, 100, T0 + 7 * MIN));
    expect(b.current!.bucket).toBe(first); // same 15m bucket
    const { closed } = b.update(tick(1, 100, T0 + 15 * MIN));
    expect(closed).toBeDefined();
    expect(b.current!.bucket - first).toBe(15 * MIN);
  });

  it('ignores out-of-order ticks from an already-passed bucket', () => {
    const b = new CandleBuilder(1, '5m');
    b.update(tick(1, 100, T0));
    b.update(tick(1, 101, T0 + 6 * MIN)); // rolls to next bucket
    const res = b.update(tick(1, 999, T0 + 1 * MIN)); // stale tick
    expect(res.closed).toBeUndefined();
    expect(b.current!.high).toBe(101); // unaffected by stale tick
  });
});
