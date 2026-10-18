/**
 * Backtest jobs: the time left follows the pace of products that had to ask Kite — products answered from
 * memory finish at once and mustn't make the estimate look short.
 */
import { describe, expect, it } from 'vitest';
import type { BacktestRequest, BacktestResult } from '../../src/shared/v2';
import { BacktestJobs } from '../../src/server/v2/paper/BacktestJobs';

describe('backtest jobs', () => {
  it('time left counts only products that asked Kite', async () => {
    const clock = { now: 0 };
    const jobs = new BacktestJobs(() => clock.now);
    let release!: () => void;
    const job = jobs.start({ strategyId: 's', strategyName: 'S', request: {} as BacktestRequest, total: 10 }, async (run) => {
      const at = (done: number) => run.progress({ phase: 'CANDLES', done, total: 10, current: null });
      // 4 products from memory (instant), then 2 that wait 2 s each for Kite.
      for (let i = 0; i < 4; i++) {
        at(i);
        run.stats.cached += 3;
      }
      for (let i = 4; i < 6; i++) {
        at(i);
        clock.now += 2000;
        run.stats.fetched += 5;
      }
      at(6);
      await new Promise<void>((r) => (release = r));
      return {} as BacktestResult;
    });
    expect(jobs.get(job.id)).toMatchObject({ status: 'RUNNING', done: 6, fetched: 10, cached: 12, etaSeconds: 8 }); // 4 left × 2 s
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(jobs.get(job.id)).toMatchObject({ status: 'DONE', etaSeconds: null });
    expect(jobs.latest()?.id).toBe(job.id);
    clock.now += 61 * 60_000;
    expect(jobs.latest()).toBeNull(); // finished over an hour ago
  });
});
