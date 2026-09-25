import { describe, expect, it } from 'vitest';
import type { Alert } from '@ash/shared';
import { summarize } from '../src/server/db/store';

const alert = (triggeredAt: string, scenario?: 1 | 2): Alert =>
  ({
    id: triggeredAt,
    configId: 'c',
    underlying: 'NIFTY',
    expiry: '2026-09-29',
    strike: 25000,
    timeframe: '15m',
    strategy: 'rsi-sync',
    scenario,
    bucket: Date.parse(triggeredAt),
    snapshot: { futureRsi: 61, callRsi: 61, putRsi: 39 },
    triggeredAt,
    title: 'NIFTY Strategy Triggered',
  }) as Alert;

describe('dashboard summary', () => {
  // Friday 25 Sep 2026, 12:00 IST.
  const now = Date.parse('2026-09-25T12:00:00+05:30');

  it('counts today and this week on IST calendar days', () => {
    const s = summarize(
      [
        alert('2026-09-25T09:30:00+05:30', 1), // today
        alert('2026-09-25T00:10:00+05:30', 2), // today in IST (still 24 Sep in UTC)
        alert('2026-09-22T11:00:00+05:30', 1), // Tuesday, same ISO week
        alert('2026-09-18T11:00:00+05:30', 1), // previous week
      ],
      now,
    );
    expect(s.alertsToday).toBe(2);
    expect(s.alertsThisWeek).toBe(3);
    expect(s.totalAlerts).toBe(4);
    expect(s.scenario1Count).toBe(3);
    expect(s.alertsPerDay.find((d) => d.key === '2026-09-25')?.count).toBe(2);
  });
});
