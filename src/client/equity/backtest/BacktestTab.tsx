'use client';

/**
 * Equity backtest: strategy (saved or the builder's unsaved one) · stocks · period · money, run in the
 * background on the server (progress, time left, cancel), results below. The form and the running job survive
 * switching tabs.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import type { EqBacktestJob, EqStrategyDefinition } from '@/shared/equity';
import { EQ_DEFAULT_CAPITAL, EQ_TIMEFRAME, strategySummary } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { EmptyState, Section, Toggle } from '../../components/ui';
import { Cell, NumberInput } from '../../components/form';
import { InlineSpinner } from '../../components/loaders';
import { eqApi } from '../api';
import { duration, istToday, yearsAgo } from '../format';
import { E } from '../help';
import { JobProgress } from '../JobProgress';
import { StockPicker, useSymbols, type StockSource } from '../StockPicker';
import { Results } from './Results';

interface Form {
  strategy: string; // a strategy id, or 'draft'
  source: StockSource;
  range: { from: string; to: string };
  capital: number | null;
  maxPositions: number | null;
}

/** Kept while the app is open, so leaving the tab and coming back restores the form and the job. */
let remembered: { form: Form; jobId: string | null } | null = null;

const QUICK = [1, 3, 5, 10];
const SECONDS_PER_REQUEST = 0.36;

export function BacktestTab({ initialStrategyId, draft }: { initialStrategyId?: string; draft: EqStrategyDefinition | null }) {
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ['eq-strategies'], queryFn: eqApi.strategies });
  const [form, setForm] = useState<Form>(() => {
    const base: Form = remembered?.form ?? { strategy: '', source: { kind: 'PRESET', preset: 'NIFTY50' }, range: { from: yearsAgo(5), to: istToday() }, capital: EQ_DEFAULT_CAPITAL, maxPositions: null };
    if (draft) return { ...base, strategy: 'draft' };
    if (initialStrategyId) return { ...base, strategy: initialStrategyId };
    return base;
  });
  const [jobId, setJobId] = useState<string | null>(remembered?.jobId ?? null);
  useEffect(() => {
    remembered = { form, jobId };
  }, [form, jobId]);
  // After a page reload: pick up the server's latest backtest (its result, or its progress).
  useEffect(() => {
    if (jobId) return;
    eqApi.latestBacktest().then((j) => j && (qc.setQueryData(['eq-backtest-job', j.id], j), setJobId(j.id)), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, []);
  // Pick the first saved strategy when nothing is chosen yet.
  useEffect(() => {
    if (!form.strategy && strategies.data?.length) setForm((f) => ({ ...f, strategy: strategies.data![0]!.id }));
  }, [form.strategy, strategies.data]);

  const job = useQuery({
    queryKey: ['eq-backtest-job', jobId],
    queryFn: () => eqApi.backtestJob(jobId!),
    enabled: jobId !== null,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 1000 : false),
  });
  const j = job.data;
  const running = j?.status === 'RUNNING';
  const { symbols, loading } = useSymbols(form.source);
  const def = form.strategy === 'draft' ? draft : strategies.data?.find((s) => s.id === form.strategy)?.definition;
  const reversed = form.range.from > form.range.to;

  const run = useMutation({
    mutationFn: () =>
      eqApi.startBacktest({
        ...(form.strategy === 'draft' ? { definition: draft! } : { strategyId: form.strategy }),
        symbols,
        from: form.range.from,
        to: form.range.to,
        capital: form.capital,
        maxPositions: form.maxPositions,
      }),
    onSuccess: (started: EqBacktestJob) => {
      qc.setQueryData(['eq-backtest-job', started.id], started);
      setJobId(started.id);
    },
  });
  const cancel = useMutation({ mutationFn: () => eqApi.cancelBacktest(jobId!), onSuccess: (c) => qc.setQueryData(['eq-backtest-job', c.id], c) });
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="flex flex-col gap-4">
      <Section title="Backtest an equity strategy" help={E.backtest.section}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Cell label="Strategy" help={E.backtest.strategy}>
              <select aria-label="Strategy" className="input py-1.5 text-sm min-w-[18rem]" value={form.strategy} onChange={(e) => set({ strategy: e.target.value })}>
                {!strategies.data?.length && !draft && <option value="">No saved strategies yet</option>}
                {draft && <option value="draft">Unsaved: {draft.name || 'new strategy'}</option>}
                {strategies.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {EQ_TIMEFRAME[s.definition.timeframe].label}
                  </option>
                ))}
              </select>
            </Cell>
          </div>
          {def && (
            <ul className="-mt-2 flex flex-col gap-0.5 text-[11px] text-slate-500">
              {strategySummary(def).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}

          <StockPicker value={form.source} onChange={(source) => set({ source })} />

          <div className="flex flex-wrap items-end gap-5">
            <Cell label="Period" help={E.backtest.period}>
              <input type="date" aria-label="From" className="input py-1 text-xs" value={form.range.from} max={form.range.to} onChange={(e) => set({ range: { ...form.range, from: e.target.value } })} />
              <span className="text-xs text-slate-500">to</span>
              <input type="date" aria-label="To" className="input py-1 text-xs" value={form.range.to} min={form.range.from} max={istToday()} onChange={(e) => set({ range: { ...form.range, to: e.target.value } })} />
            </Cell>
            <Cell label="Quick" help={E.backtest.quick}>
              {QUICK.map((n) => (
                <Tooltip key={n} content={{ ...E.backtest.quick, title: `Last ${n} year${n === 1 ? '' : 's'}` }}>
                  <button type="button" className="btn-ghost py-1 text-xs" onClick={() => set({ range: { from: yearsAgo(n), to: istToday() } })}>
                    {n} yr
                  </button>
                </Tooltip>
              ))}
            </Cell>
            <Cell label="Starting capital" help={E.backtest.capital}>
              <span className="text-xs text-slate-400">₹</span>
              <NumberInput label="Starting capital" min={1000} max={1e11} step={50_000} disabled={form.capital === null} className="input py-1 text-xs w-32 tabular-nums disabled:opacity-40" value={form.capital} placeholder="no limit" onChange={(capital) => set({ capital })} />
              <Toggle checked={form.capital === null} onChange={(off) => set({ capital: off ? null : EQ_DEFAULT_CAPITAL })} label="No limit" help={E.backtest.noLimit} />
            </Cell>
            <Cell label="Max stocks held" help={E.backtest.maxPositions}>
              <Tooltip content={{ ...E.backtest.maxPositions, note: form.maxPositions === null ? 'Off — no limit.' : 'On.' }}>
                <input type="checkbox" aria-label="Limit stocks held" className="accent-[rgb(var(--accent))]" checked={form.maxPositions !== null} onChange={(e) => set({ maxPositions: e.target.checked ? 10 : null })} />
              </Tooltip>
              <NumberInput label="Max stocks held" min={1} max={5000} step={1} disabled={form.maxPositions === null} className="input py-1 text-xs w-20 tabular-nums disabled:opacity-40" value={form.maxPositions ?? 10} placeholder="no limit" onChange={(n) => set({ maxPositions: Math.round(n) })} />
            </Cell>
          </div>
          {reversed && <p className="-mt-2 text-xs text-warn">“From” must be on or before “to”.</p>}

          <div className="flex flex-wrap items-center gap-3">
            <Tooltip content={E.backtest.run}>
              <button type="button" className="btn-primary" disabled={!def || !symbols.length || loading || reversed || running || run.isPending} onClick={() => run.mutate()}>
                {run.isPending || running ? <InlineSpinner /> : <FlaskConical className="w-4 h-4" />} Backtest {symbols.length ? symbols.length.toLocaleString('en-IN') : ''} stock{symbols.length === 1 ? '' : 's'}
              </button>
            </Tooltip>
            {symbols.length > 0 && !running && (
              <Tooltip content={E.backtest.estimate}>
                <span className="text-[11px] text-slate-500">≈ {duration(symbols.length * SECONDS_PER_REQUEST)} of Kite requests (less for stocks already in memory)</span>
              </Tooltip>
            )}
          </div>
          {j && running && <JobProgress job={j} onCancel={() => cancel.mutate()} cancelling={cancel.isPending} />}
          {j?.status === 'CANCELLED' && <p className="text-xs text-slate-400">Backtest cancelled. Candles fetched so far stay in memory, so running it again picks up quickly.</p>}
          {j?.status === 'FAILED' && <p className="text-xs text-bear">{j.error}</p>}
          {(run.error || job.error || cancel.error) && <p className="text-xs text-bear">{((run.error ?? job.error ?? cancel.error) as Error).message}</p>}
          {!strategies.isLoading && !strategies.data?.length && !draft && <EmptyState title="No equity strategies yet" hint="Create one in the Strategies tab (start from a template), then backtest it here." />}
        </div>
      </Section>

      {j?.status === 'DONE' && j.result && <Results r={j.result} />}
    </div>
  );
}
