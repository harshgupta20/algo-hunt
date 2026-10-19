/**
 * Equity backtests and screens as background jobs (memory only): the page starts one, polls its progress and
 * picks up the result — also after switching tabs. One of each kind runs at a time (starting another cancels
 * it; its candles stay cached); finished jobs are kept for an hour.
 */
import { randomUUID } from 'node:crypto';
import type { EqJob } from '@/shared/equity';
import type { CandleStats } from './data/candles';

const KEEP_MS = 60 * 60_000;

export class JobCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'JobCancelled';
  }
}

export interface JobRun {
  /** Throws when the job was cancelled. */
  checkpoint(): void;
  progress(p: { phase?: 'FETCH' | 'RUN'; done?: number; total?: number; current?: string | null }): void;
  stats: CandleStats;
}

interface Entry<Req, Res> {
  job: EqJob<Req, Res>;
  run: JobRun;
  cancel: boolean;
  /** Pace for the time left: only stocks that waited for Kite count (cached ones finish at once). */
  pace: { done: number; fetched: number; at: number; items: number; ms: number };
}

export class Jobs<Req, Res> {
  private readonly entries = new Map<string, Entry<Req, Res>>();

  constructor(
    private readonly kind: EqJob<Req, Res>['kind'],
    private readonly now: () => number,
  ) {}

  start(meta: { strategyName: string; request: Req; total: number }, work: (run: JobRun) => Promise<Res>): EqJob<Req, Res> {
    for (const e of this.entries.values()) if (e.job.status === 'RUNNING') e.cancel = true;
    for (const [id, e] of this.entries) if (e.job.finishedAt !== null && this.now() - e.job.finishedAt > KEEP_MS) this.entries.delete(id);
    const at = this.now();
    const job: EqJob<Req, Res> = { id: randomUUID(), kind: this.kind, strategyName: meta.strategyName, status: 'RUNNING', startedAt: at, finishedAt: null, phase: 'FETCH', done: 0, total: meta.total, current: null, fetched: 0, cached: 0, etaSeconds: null, error: null, request: meta.request };
    const entry: Entry<Req, Res> = {
      job,
      cancel: false,
      pace: { done: 0, fetched: 0, at, items: 0, ms: 0 },
      run: {
        stats: { fetched: 0, cached: 0 },
        checkpoint: () => {
          if (entry.cancel) throw new JobCancelled();
        },
        progress: (p) => {
          const { pace, run } = entry;
          if (p.done !== undefined && p.done > pace.done) {
            const t = this.now();
            if (run.stats.fetched > pace.fetched) {
              pace.items += p.done - pace.done;
              pace.ms += t - pace.at;
            }
            Object.assign(pace, { done: p.done, fetched: run.stats.fetched, at: t });
          }
          Object.assign(job, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
        },
      },
    };
    this.entries.set(job.id, entry);
    const finish = (status: EqJob<Req, Res>['status'], result?: Res, error?: string) => Object.assign(job, { status, result, error: error ?? null, finishedAt: this.now(), current: null, etaSeconds: null });
    work(entry.run).then(
      (result) => finish('DONE', result),
      (err: unknown) => (err instanceof JobCancelled ? finish('CANCELLED') : finish('FAILED', undefined, err instanceof Error ? err.message : String(err))),
    );
    return this.view(entry);
  }

  get(id: string): EqJob<Req, Res> | null {
    const e = this.entries.get(id);
    return e ? this.view(e) : null;
  }

  latest(): EqJob<Req, Res> | null {
    const last = [...this.entries.values()].at(-1);
    if (!last || (last.job.finishedAt !== null && this.now() - last.job.finishedAt > KEEP_MS)) return null;
    return this.view(last);
  }

  cancel(id: string): EqJob<Req, Res> | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.job.status === 'RUNNING') e.cancel = true;
    return this.view(e);
  }

  private view(e: Entry<Req, Res>): EqJob<Req, Res> {
    const j = e.job;
    const { items, ms } = e.pace;
    const etaSeconds = j.status === 'RUNNING' && j.phase === 'FETCH' && items > 0 ? Math.round(((ms / items) * (j.total - j.done)) / 1000) : null;
    return { ...j, fetched: e.run.stats.fetched, cached: e.run.stats.cached, etaSeconds };
  }
}
