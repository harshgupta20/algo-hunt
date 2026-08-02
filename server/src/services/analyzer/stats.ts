/**
 * Aggregates backtest alerts into summary statistics, distributions, and
 * heatmap buckets. Reuses isoWeek from the live store for weekly grouping.
 */
import type { BacktestAlert, BacktestStats, CountBucket, Timeframe } from '@ash/shared';
import { isoWeek } from '../../db/store.js';
import { tradingDaysInRange } from './dateRange.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function counter(): Map<string, number> {
  return new Map<string, number>();
}
function bump(m: Map<string, number>, key: string): void {
  m.set(key, (m.get(key) ?? 0) + 1);
}
function toBuckets(m: Map<string, number>, sortByKey = true): CountBucket[] {
  const arr = [...m.entries()].map(([key, count]) => ({ key, count }));
  return sortByKey ? arr.sort((a, b) => a.key.localeCompare(b.key)) : arr.sort((a, b) => b.count - a.count);
}

/** IST hour (0–23) for a candle bucket in epoch ms. */
function istHour(bucketMs: number): number {
  const istMinutes = (Math.floor(bucketMs / 60_000) + 330) % 1440; // +5:30
  return Math.floor(istMinutes / 60);
}

export interface StatsContext {
  from: string;
  to: string;
  underlying: string;
  expiry: string;
  timeframe: Timeframe;
}

export function computeStats(alerts: BacktestAlert[], ctx: StatsContext): BacktestStats {
  const byDay = counter();
  const byWeek = counter();
  const byMonth = counter();
  const byUnderlying = counter();
  const byExpiry = counter();
  const byTimeframe = counter();
  const byScenario = counter();
  const byWeekday = counter();
  const byHour = counter();
  let s1 = 0;
  let s2 = 0;

  for (const a of alerts) {
    const day = a.timestamp.slice(0, 10);
    bump(byDay, day);
    bump(byWeek, isoWeek(a.timestamp));
    bump(byMonth, a.timestamp.slice(0, 7));
    bump(byUnderlying, a.underlying);
    bump(byExpiry, a.expiry || '—');
    bump(byTimeframe, a.timeframe);
    bump(byScenario, a.scenario ? `Scenario ${a.scenario}` : (a.variant ?? 'Triggered'));
    bump(byWeekday, WEEKDAYS[(new Date(a.bucket).getUTCDay() + 6) % 7]!);
    bump(byHour, `${String(istHour(a.bucket)).padStart(2, '0')}:00`);
    if (a.scenario === 1) s1++;
    else s2++;
  }

  const tradingDays = tradingDaysInRange(ctx.from, ctx.to);
  const dayCounts = [...byDay.values()];
  const weeks = Math.max(1, byWeek.size);

  // Ensure heatmap axes are dense (all weekdays present, sorted).
  const weekdayBuckets: CountBucket[] = WEEKDAYS.slice(0, 5).map((k) => ({ key: k, count: byWeekday.get(k) ?? 0 }));
  const hourBuckets: CountBucket[] = Array.from({ length: 7 }, (_, i) => {
    const key = `${String(9 + i).padStart(2, '0')}:00`;
    return { key, count: byHour.get(key) ?? 0 };
  });

  return {
    totalAlerts: alerts.length,
    scenario1: s1,
    scenario2: s2,
    avgPerDay: round2(alerts.length / tradingDays),
    maxPerDay: dayCounts.length ? Math.max(...dayCounts) : 0,
    minPerDay: dayCounts.length ? Math.min(...dayCounts) : 0,
    avgPerWeek: round2(alerts.length / weeks),
    tradingDays,
    byDay: toBuckets(byDay),
    byWeek: toBuckets(byWeek),
    byMonth: toBuckets(byMonth),
    byUnderlying: toBuckets(byUnderlying, false),
    byExpiry: toBuckets(byExpiry),
    byTimeframe: toBuckets(byTimeframe),
    byScenario: toBuckets(byScenario),
    byWeekday: weekdayBuckets,
    byHour: hourBuckets,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
