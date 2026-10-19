'use client';

/** A backtest / screen running on the server: stocks done, the stock being fetched, time left, Kite requests, cancel. */
import { X } from 'lucide-react';
import type { EqJob } from '@/shared/equity';
import { Tooltip } from '../components/Tooltip';
import { InlineSpinner } from '../components/loaders';
import { duration } from './format';
import { E } from './help';

export function JobProgress({ job, onCancel, cancelling }: { job: EqJob<unknown, unknown>; onCancel: () => void; cancelling: boolean }) {
  const pct = job.total ? (job.done / job.total) * 100 : 0;
  const what = job.kind === 'BACKTEST' ? 'Simulating every day…' : 'Checking every stock…';
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-accent/30 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <InlineSpinner className="w-3.5 h-3.5 text-accent" />
        <Tooltip content={E.backtest.progress}>
          <span className="font-semibold text-slate-200">{job.phase === 'RUN' ? what : `Fetching candles · ${job.done.toLocaleString('en-IN')} / ${job.total.toLocaleString('en-IN')} stocks`}</span>
        </Tooltip>
        {job.current && <span className="text-slate-400">{job.current}</span>}
        {job.phase === 'FETCH' && <span className="text-slate-400">· {job.etaSeconds === null ? 'estimating time left…' : `~${duration(job.etaSeconds)} left`}</span>}
        <Tooltip content={E.backtest.calls}>
          <span className="text-slate-500">
            · {job.fetched.toLocaleString('en-IN')} Kite request{job.fetched === 1 ? '' : 's'}
            {job.cached > 0 && ` · ${job.cached.toLocaleString('en-IN')} from memory`}
          </span>
        </Tooltip>
        <Tooltip content={E.backtest.cancel} className="ml-auto">
          <button type="button" className="btn-ghost py-1 text-xs" disabled={cancelling} onClick={onCancel}>
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </Tooltip>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done} aria-label="Stocks done">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{job.strategyName} — runs in the background: switch tabs freely, the result waits here.</p>
    </div>
  );
}
