/** Chart axes always cover the data (the top / bottom tick is rounded outward, never inward). */
import { expect, it } from 'vitest';
import { niceTicks } from '../../src/client/v2/paper/EquityChart';

it('ticks cover the whole range with 2–7 round steps', () => {
  for (const [lo, hi] of [[-3900, 3500], [0, 4738], [-34241, 0], [0, 0], [-850, 1500], [0, 63.35]] as const) {
    const t = niceTicks(lo, hi);
    expect(t[0]!).toBeLessThanOrEqual(lo);
    expect(t.at(-1)!).toBeGreaterThanOrEqual(hi);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.length).toBeLessThanOrEqual(7);
  }
  expect(niceTicks(-3900, 3500)).toEqual([-4000, -2000, 0, 2000, 4000]);
});
