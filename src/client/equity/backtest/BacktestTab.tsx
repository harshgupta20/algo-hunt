'use client';

/**
 * Equity backtest: strategy (saved or the builder's unsaved one) · stocks · period · money, run in the
 * background on the server (progress, time left, cancel), results below. The form and the running job survive
 * switching tabs. Every finished backtest goes into the history (History.tsx): open one to see it as it was, or
 * run it again from the form.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import type { EqBacktestJob, EqBacktestRun, EqStockSource, EqStrategyDefinition } from '@/shared/equity';
import { EQ_DEFAULT_CAPITAL, EQ_PRESETS, EQ_TIMEFRAME, strategySummary } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { EmptyState, Section, Toggle } from '../../components/ui';
import { Cell, NumberInput } from '../../components/form';
import { InlineSpinner } from '../../components/loaders';
import { eqApi } from '../api';
import { countLabel, duration, istDateTime, istToday, shortDate, yearsAgo } from '../format';
import { E } from '../help';
import { JobProgress } from '../JobProgress';
import { StockPicker, useSymbols, type StockSource } from '../StockPicker';
import { History } from './History';
import { Results } from './Results';

interface Form {
  strategy: string; // a strategy id, 'draft' (the builder's), or 'history' (a deleted / unsaved one, run again)
  source: StockSource;
  range: { from: string; to: string };
  capital: number | null;
  maxPositions: number | null;
}

/** Kept while the app is open, so leaving the tab and coming back restores the form, the job and the history view. */
let remembered: { form: Form; jobId: string | null; historyDef: EqStrategyDefinition | null; viewing: string | null } | null = null;

/** How the stocks were chosen, in words, for the history line. */
function stocksLabel(source: StockSource, label: string, symbols: string[]): string {
  if (source.kind === 'PRESET') return EQ_PRESETS.find((p) => p.value === source.preset)?.label ?? label;
  if (source.kind === 'WATCHLIST') return `${label} (watchlist)`;
  return `${countLabel(symbols)} picked`;
}

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
  /** A deleted / unsaved strategy's definition, from the history, to run again. */
  const [historyDef, setHistoryDef] = useState<EqStrategyDefinition | null>(remembered?.historyDef ?? null);
  /** A history entry shown instead of the latest run. */
  const [viewing, setViewing] = useState<string | null>(remembered?.viewing ?? null);
  useEffect(() => {
    remembered = { form, jobId, historyDef, viewing };
  }, [form, jobId, historyDef, viewing]);
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
  // A finished run is in the history now.
  useEffect(() => {
    if (j?.status === 'DONE') void qc.invalidateQueries({ queryKey: ['eq-backtest-history'] });
  }, [j?.id, j?.status, qc]);
  const record = useQuery({ queryKey: ['eq-backtest-record', viewing], queryFn: () => eqApi.backtestRecord(viewing!), enabled: viewing !== null, staleTime: Infinity, retry: false });
  const savedIds = useMemo(() => (strategies.data ? new Set(strategies.data.map((s) => s.id)) : null), [strategies.data]);
  const { symbols, loading, label } = useSymbols(form.source);
  const def = form.strategy === 'draft' ? draft : form.strategy === 'history' ? historyDef : strategies.data?.find((s) => s.id === form.strategy)?.definition;
  const reversed = form.range.from > form.range.to;

  /** Fill the form from a history entry: its strategy as it is now (or as it was, if deleted / unsaved), stocks, period, money. */
  const runAgain = useMutation({
    mutationFn: async (r: EqBacktestRun) => {
      const [rec, lists] = await Promise.all([eqApi.backtestRecord(r.id), eqApi.watchlists()]);
      return { rec, watchlists: new Set(lists.map((w) => w.id)) };
    },
    onSuccess: ({ rec, watchlists }) => {
      qc.setQueryData(['eq-backtest-record', rec.run.id], rec);
      const exists = rec.run.strategyId !== null && strategies.data?.some((s) => s.id === rec.run.strategyId);
      if (!exists) setHistoryDef(rec.request.definition);
      // The same choice again (an index list = its members today); a watchlist deleted since → the stocks it had.
      const saved = rec.request.source;
      const source: EqStockSource = saved && !(saved.kind === 'WATCHLIST' && !watchlists.has(saved.id)) ? saved : { kind: 'PICK', symbols: rec.request.symbols };
      setForm({ strategy: exists ? rec.run.strategyId! : 'history', source, range: { from: rec.request.from, to: rec.request.to }, capital: rec.request.capital, maxPositions: rec.request.maxPositions });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  const run = useMutation({
    mutationFn: () =>
      eqApi.startBacktest({
        ...(form.strategy === 'draft' ? { definition: draft! } : form.strategy === 'history' ? { definition: historyDef! } : { strategyId: form.strategy }),
        symbols,
        from: form.range.from,
        to: form.range.to,
        capital: form.capital,
        maxPositions: form.maxPositions,
        stocksLabel: stocksLabel(form.source, label, symbols),
        source: form.source,
      }),
    onSuccess: (started: EqBacktestJob) => {
      qc.setQueryData(['eq-backtest-job', started.id], started);
      setJobId(started.id);
      setViewing(null);
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
                {historyDef && <option value="history">From the history: {historyDef.name}</option>}
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
                {run.isPending || running ? <InlineSpinner /> : <FlaskConical className="w-4 h-4" />} Backtest {symbols.length ? countLabel(symbols) : 'stocks'}
              </button>
            </Tooltip>
            {symbols.length > 0 && !running && (
              <Tooltip content={E.backtest.estimate}>
                <span className="text-[11px] text-slate-500">≈ {duration(symbols.length * SECONDS_PER_REQUEST)} of Kite requests (less for ones already in memory)</span>
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

      <History viewing={viewing} savedIds={savedIds} onOpen={(r) => setViewing(r.id)} onRunAgain={(r) => runAgain.mutate(r)} onRemoved={(r) => viewing === r.id && setViewing(null)} />
      {runAgain.error && <p className="text-xs text-bear">{(runAgain.error as Error).message}</p>}

      {viewing ? (
        <>
          <div className="card flex flex-wrap items-center gap-3 border-accent/40 p-3 text-xs">
            <Tooltip content={E.history.viewing}>
              <span className="font-semibold text-accent-soft">From the history</span>
            </Tooltip>
            {record.data && (
              <span className="text-slate-300">
                {record.data.run.strategyName}
                {record.data.run.strategyVersion !== null ? ` v${record.data.run.strategyVersion}` : ''} · {record.data.run.stocksLabel} · {shortDate(record.data.run.from)} → {shortDate(record.data.run.to)} · ran {istDateTime(record.data.run.ranAt)}
              </span>
            )}
            <Tooltip content={{ title: 'Back to the latest run', body: 'Close this saved backtest and show the latest run (if one finished in the last hour).' }} className="ml-auto">
              <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setViewing(null)}>
                <ArrowLeft className="w-3.5 h-3.5" /> Latest run
              </button>
            </Tooltip>
          </div>
          {record.isLoading && <p className="text-xs text-slate-500">Opening the saved backtest…</p>}
          {record.error && <p className="text-xs text-bear">{(record.error as Error).message}</p>}
          {record.data && (record.data.result ? <Results r={record.data.result} /> : <EmptyState title={E.history.notKept.title} hint={String(E.history.notKept.body)} />)}
        </>
      ) : (
        j?.status === 'DONE' && j.result && <Results r={j.result} />
      )}
    </div>
  );
}
