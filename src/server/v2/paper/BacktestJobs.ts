/**
 * Backtests as background jobs (memory only, nothing saved): the page starts one, then polls its progress
 * and picks up the result — also after switching tabs. One runs at a time (starting another cancels the
 * running one, whose candles stay in the cache); finished jobs are kept for an hour.
 */
import { randomUUID } from 'node:crypto';
import type { BacktestJob, BacktestRequest, BacktestResult } from '@/shared/v2';
import type { BacktestRun } from './backtest';

const KEEP_MS = 60 * 60_000;

export class BacktestCancelled extends Error {
  constructor() {
    super('Backtest cancelled');
    this.name = 'BacktestCancelled';
  }
}

interface Entry {
  job: BacktestJob;
  run: BacktestRun;
  cancel: boolean;
  /** Pace for the time left: only products that asked Kite count (ones answered from memory finish at once). */
  pace: { done: number; fetched: number; at: number; products: number; ms: number };
}

export class BacktestJobs {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number) {}

  start(meta: { strategyId: string; strategyName: string; request: BacktestRequest; total: number }, work: (run: BacktestRun) => Promise<BacktestResult>): BacktestJob {
    for (const e of this.entries.values()) if (e.job.status === 'RUNNING') e.cancel = true;
    for (const [id, e] of this.entries) if (e.job.finishedAt !== null && this.now() - e.job.finishedAt > KEEP_MS) this.entries.delete(id);

    const at = this.now();
    const job: BacktestJob = {
      id: randomUUID(),
      strategyId: meta.strategyId,
      strategyName: meta.strategyName,
      status: 'RUNNING',
      startedAt: at,
      finishedAt: null,
      phase: 'CANDLES',
      done: 0,
      total: meta.total,
      current: null,
      fetched: 0,
      cached: 0,
      etaSeconds: null,
      error: null,
      request: meta.request,
    };
    const entry: Entry = {
      job,
      cancel: false,
      pace: { done: 0, fetched: 0, at, products: 0, ms: 0 },
      run: {
        stats: { fetched: 0, cached: 0 },
        checkpoint: () => {
          if (entry.cancel) throw new BacktestCancelled();
        },
        progress: (p) => {
          const { pace, run } = entry;
          if (p.done > pace.done) {
            const t = this.now();
            if (run.stats.fetched > pace.fetched) {
              pace.products += p.done - pace.done;
              pace.ms += t - pace.at;
            }
            Object.assign(pace, { done: p.done, fetched: run.stats.fetched, at: t });
          }
          Object.assign(job, p);
        },
      },
    };
    this.entries.set(job.id, entry);

    const finish = (status: BacktestJob['status'], result?: BacktestResult, error?: string) => {
      Object.assign(job, { status, result, error: error ?? null, finishedAt: this.now(), current: null, etaSeconds: null });
    };
    work(entry.run).then(
      (result) => finish('DONE', result),
      (err: unknown) => (err instanceof BacktestCancelled ? finish('CANCELLED') : finish('FAILED', undefined, err instanceof Error ? err.message : String(err))),
    );
    return this.view(entry);
  }

  get(id: string): BacktestJob | null {
    const e = this.entries.get(id);
    return e ? this.view(e) : null;
  }

  /** The most recently started job (unless it finished over an hour ago). */
  latest(): BacktestJob | null {
    const last = [...this.entries.values()].at(-1);
    if (!last || (last.job.finishedAt !== null && this.now() - last.job.finishedAt > KEEP_MS)) return null;
    return this.view(last);
  }

  cancel(id: string): BacktestJob | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.job.status === 'RUNNING') e.cancel = true;
    return this.view(e);
  }

  /** A snapshot with the live counters and the time left (at the pace of products that asked Kite). */
  private view(e: Entry): BacktestJob {
    const j = e.job;
    const { products, ms } = e.pace;
    const etaSeconds = j.status === 'RUNNING' && j.phase === 'CANDLES' && products > 0 ? Math.round(((ms / products) * (j.total - j.done)) / 1000) : null;
    return { ...j, fetched: e.run.stats.fetched, cached: e.run.stats.cached, etaSeconds };
  }
}
