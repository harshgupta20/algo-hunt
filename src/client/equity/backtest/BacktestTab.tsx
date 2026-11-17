'use client';

/**
 * Equity backtest: strategy (saved, the Strategies builder's unsaved one — or built / changed right here, tested
 * unsaved as often as you like and saved when it's worth keeping) · stocks · period · money, run in the
 * background on the server (progress, time left, cancel), results below. The form, the strategy being built and
 * the running job survive switching tabs. Every finished backtest goes into the history (History.tsx): open one to
 * see it as it was, or run it again from the form.
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, ChevronRight, CopyPlus, FlaskConical, Pencil, Plus, Save, Undo2, X } from 'lucide-react';
import type { EqBacktestJob, EqBacktestRun, EqStockSource, EqStrategy, EqStrategyDefinition } from '@/shared/equity';
import { EQ_DEFAULT_CAPITAL, EQ_PRESETS, EQ_TIMEFRAME, defaultDefinition, hasErrors, strategySummary, validateDefinition } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { Badge, EmptyState, Section, Toggle } from '../../components/ui';
import { Cell, NumberInput } from '../../components/form';
import { QuickPeriods, quickRange } from '../../components/QuickPeriods';
import { QUICK_PERIODS, latestTradingDay, type QuickPeriodKey } from '../../components/periods';
import { InlineSpinner } from '../../components/loaders';
import { eqApi } from '../api';
import { countLabel, duration, istDateTime, istToday, shortDate } from '../format';
import { E } from '../help';
import { JobProgress } from '../JobProgress';
import { StockPicker, useSymbols, type StockSource } from '../StockPicker';
import { ai } from '../../ai/store';
import { ReadsAs, StrategyForm } from '../strategies/StrategyForm';
import { History } from './History';
import { Results } from './Results';

interface Form {
  strategy: string; // a strategy id, 'draft' (the builder's), or 'history' (a deleted / unsaved one, run again)
  source: StockSource;
  range: { from: string; to: string };
  capital: number | null;
  maxPositions: number | null;
}

/** The strategy being built or changed on this page — not saved until one of the builder's save buttons. */
interface Build {
  def: EqStrategyDefinition;
  /** The saved strategy it started from; null = a new strategy. */
  baseId: string | null;
  /** The rules shown (folded away to see the rest of the page). */
  open: boolean;
}
/** The strategy list's choice for "build a new one here". */
const BUILD = 'build';

/**
 * Kept while the app is open, so leaving the tab and coming back restores the form, the strategy being built, the
 * job and the history view. `draft`: the Strategies builder's draft seen last — a different one has just arrived.
 */
let remembered: { form: Form; jobId: string | null; historyDef: EqStrategyDefinition | null; viewing: string | null; build: Build | null; draft: EqStrategyDefinition | null } | null = null;

/**
 * The builder on the Backtest page: the strategy's rules, folded away on demand, and how to keep it — a new
 * strategy, the saved one updated (its next version), or a copy.
 */
function EqBuilder({
  build,
  base,
  edited,
  setDef,
  onToggle,
  onClose,
  onSave,
  saving,
  saveError,
}: {
  build: Build;
  base: EqStrategy | undefined;
  edited: boolean;
  setDef: Dispatch<SetStateAction<EqStrategyDefinition>>;
  onToggle: () => void;
  onClose: () => void;
  onSave: (how: 'new' | 'update' | 'copy') => void;
  saving: boolean;
  saveError: string | null;
}) {
  const blocked = saving || hasErrors(validateDefinition(build.def));
  const fix = blocked && !saving ? 'Fix the problems marked in red first.' : undefined;
  const tip = (c: (typeof E.backtest)['saveNew']) => (fix ? { ...c, note: fix } : c);
  return (
    <div className="rounded-lg border border-accent/40 bg-ink-950/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={build.open ? E.backtest.builderHide : E.backtest.builderShow}>
          <button type="button" className="btn-ghost px-1.5 py-1" aria-expanded={build.open} aria-label={build.open ? 'Hide the rules' : 'Show the rules'} onClick={onToggle}>
            {build.open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </Tooltip>
        <span className="text-sm font-semibold text-slate-200">{build.def.name.trim() || 'New strategy'}</span>
        {!base ? (
          <Tooltip content={E.backtest.unsaved}>
            <Badge tone="warn">new · not saved</Badge>
          </Tooltip>
        ) : edited ? (
          <Tooltip content={E.backtest.changedRules}>
            <Badge tone="warn">changed · saved is v{base.version}</Badge>
          </Tooltip>
        ) : (
          <Tooltip content={E.backtest.sameRules}>
            <Badge>same as saved v{base.version}</Badge>
          </Tooltip>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!base && (
            <Tooltip content={tip(E.backtest.saveNew)}>
              <button type="button" className="btn-primary py-1 text-xs" disabled={blocked} onClick={() => onSave('new')}>
                {saving ? <InlineSpinner className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />} Save as strategy
              </button>
            </Tooltip>
          )}
          {base && edited && (
            <>
              <Tooltip content={tip(E.backtest.saveUpdate)}>
                <button type="button" className="btn-primary py-1 text-xs" disabled={blocked} onClick={() => onSave('update')}>
                  {saving ? <InlineSpinner className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />} Update strategy (v{base.version + 1})
                </button>
              </Tooltip>
              <Tooltip content={tip(E.backtest.saveCopy)}>
                <button type="button" className="btn-ghost py-1 text-xs" disabled={blocked} onClick={() => onSave('copy')}>
                  <CopyPlus className="w-3.5 h-3.5" /> Save as new
                </button>
              </Tooltip>
            </>
          )}
          <Tooltip content={!base ? E.backtest.discardNew : edited ? E.backtest.discardChanges : E.backtest.closeBuilder}>
            <button type="button" className="btn-ghost py-1 text-xs" disabled={saving} onClick={onClose}>
              {base && edited ? <Undo2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />} {!base ? 'Discard' : edited ? 'Discard changes' : 'Close'}
            </button>
          </Tooltip>
        </div>
      </div>
      {build.open && (
        <div className="mt-3 flex flex-col gap-3">
          <StrategyForm d={build.def} setD={setDef} plain />
          <ReadsAs d={build.def} plain />
        </div>
      )}
      {saveError && <p className="mt-2 text-xs text-bear">{saveError}</p>}
    </div>
  );
}

/** How the stocks were chosen, in words, for the history line. */
function stocksLabel(source: StockSource, label: string, symbols: string[]): string {
  if (source.kind === 'PRESET') return EQ_PRESETS.find((p) => p.value === source.preset)?.label ?? label;
  if (source.kind === 'WATCHLIST') return `${label} (watchlist)`;
  return `${countLabel(symbols)} picked`;
}

/** The platform's lookbacks, plus the long ones a stock backtest wants. */
const QUICK: readonly QuickPeriodKey[] = [...QUICK_PERIODS, '5Y', '10Y'];
/** A daily candle is final after 15:30 + Kite's settle margin (data/candles.ts) — quick periods end on that day. */
const sessionEnd = () => latestTradingDay(15 * 60 + 40);
const SECONDS_PER_REQUEST = 0.36;

export function BacktestTab({ initialStrategyId, initialHistory, draft }: { initialStrategyId?: string; initialHistory?: string; draft: EqStrategyDefinition | null }) {
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ['eq-strategies'], queryFn: eqApi.strategies });
  // A draft just handed over by the Strategies builder ("Backtest without saving") — not the one seen before.
  const [freshDraft] = useState(() => draft !== null && draft !== remembered?.draft);
  const [form, setForm] = useState<Form>(() => {
    const base: Form = remembered?.form ?? { strategy: '', source: { kind: 'PRESET', preset: 'NIFTY50' }, range: quickRange('5Y', sessionEnd(), istToday()), capital: EQ_DEFAULT_CAPITAL, maxPositions: null };
    if (freshDraft) return { ...base, strategy: 'draft' };
    if (initialStrategyId) return { ...base, strategy: initialStrategyId };
    // The builder's draft is gone (the section was left): pick a saved one instead.
    return base.strategy === 'draft' && !draft ? { ...base, strategy: '' } : base;
  });
  /** The strategy being built here — kept unless another strategy was just handed over. */
  const [build, setBuild] = useState<Build | null>(() => {
    const b = remembered?.build ?? null;
    return b && !freshDraft && (!initialStrategyId || b.baseId === initialStrategyId) ? b : null;
  });
  /** What the last save from the builder did (shown until the strategy changes). */
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(remembered?.jobId ?? null);
  /** A deleted / unsaved strategy's definition, from the history, to run again. */
  const [historyDef, setHistoryDef] = useState<EqStrategyDefinition | null>(remembered?.historyDef ?? null);
  /** A history entry shown instead of the latest run. */
  const [viewing, setViewing] = useState<string | null>(initialHistory ?? remembered?.viewing ?? null);
  useEffect(() => {
    remembered = { form, jobId, historyDef, viewing, build, draft };
  }, [form, jobId, historyDef, viewing, build, draft]);
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
  // The AI sees which backtest is on screen (a history entry, or the latest run).
  const shownId = viewing ?? (j?.status === 'DONE' ? (j.result?.historyId ?? null) : null);
  const shownLabel = viewing ? (record.data ? `Backtest: ${record.data.run.strategyName} on ${record.data.run.stocksLabel}, ${record.data.run.from} → ${record.data.run.to}` : 'Backtest from the history') : j?.result ? `Backtest: ${j.result.strategyName} on ${j.request.stocksLabel ?? countLabel(j.request.symbols)}, ${j.result.from} → ${j.result.to}` : null;
  useEffect(() => {
    ai.setPage(shownId ? { page: 'equity-backtest', backtestId: shownId, label: shownLabel ?? 'Backtest' } : { page: 'equity-backtest', label: 'Equity → Backtest' });
  }, [shownId, shownLabel]);
  useEffect(() => () => ai.setPage(null), []);
  const picked = form.strategy === 'draft' ? draft : form.strategy === 'history' ? historyDef : strategies.data?.find((s) => s.id === form.strategy)?.definition;
  /** The saved strategy the builder's rules started from (none: a new strategy — or one deleted since). */
  const base = build?.baseId ? strategies.data?.find((s) => s.id === build.baseId) : undefined;
  const edited = !!build && (!base || JSON.stringify(build.def) !== JSON.stringify(base.definition));
  const def = build?.def ?? picked;
  const buildBlocked = useMemo(() => !!build && hasErrors(validateDefinition(build.def)), [build]);
  const reversed = form.range.from > form.range.to;

  /** Leave the strategy being built (asks first when it has unsaved rules). */
  const leaveBuild = () => !build || !edited || window.confirm(`Discard “${build.def.name.trim() || 'the new strategy'}”${base ? '’s changes' : ''}? They aren’t saved.`);
  const startNew = () => {
    if (!leaveBuild()) return;
    setBuild({ def: defaultDefinition(), baseId: null, open: true });
    setSavedNote(null);
    saveBuild.reset();
  };
  const setBuildDef: Dispatch<SetStateAction<EqStrategyDefinition>> = (v) => {
    saveBuild.reset();
    setBuild((b) => (b ? { ...b, def: typeof v === 'function' ? v(b.def) : v } : b));
  };
  const saveBuild = useMutation({
    mutationFn: async (how: 'new' | 'update' | 'copy') => {
      const d = build!.def;
      const named = how === 'copy' && base && d.name.trim() === base.name.trim() ? { ...d, name: `${d.name.trim()} (copy)` } : d;
      const s = how === 'update' ? await eqApi.updateStrategy(base!.id, d) : await eqApi.createStrategy(named);
      await qc.invalidateQueries({ queryKey: ['eq-strategies'] });
      return { s, how };
    },
    onSuccess: ({ s, how }) => {
      setBuild(null);
      setForm((f) => ({ ...f, strategy: s.id }));
      setSavedNote(how === 'update' ? `Updated “${s.name}” to v${s.version}.` : `Saved “${s.name}” as a new strategy — it’s in Strategies and the Screener now.`);
    },
  });

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
      // The run's strategy replaces the one being built here (asked before it started).
      setBuild(null);
      setSavedNote(null);
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
        // Rules built or changed here are tested as they are, unsaved.
        ...(build && edited ? { definition: build.def } : build && base ? { strategyId: base.id } : form.strategy === 'draft' ? { definition: draft! } : form.strategy === 'history' ? { definition: historyDef! } : { strategyId: form.strategy }),
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
              <select
                aria-label="Strategy"
                className="input py-1.5 text-sm min-w-[18rem]"
                value={build && !base ? BUILD : form.strategy}
                onChange={(e) => {
                  if (e.target.value === BUILD) return startNew();
                  if (!leaveBuild()) return;
                  setBuild(null);
                  setSavedNote(null);
                  set({ strategy: e.target.value });
                }}
              >
                {!strategies.data?.length && !draft && !build && <option value="">No saved strategies yet</option>}
                <option value={BUILD}>{build && !base ? `Building here: ${build.def.name.trim() || 'new strategy'}` : '＋ New strategy — build it here'}</option>
                {draft && <option value="draft">Unsaved: {draft.name || 'new strategy'}</option>}
                {historyDef && <option value="history">From the history: {historyDef.name}</option>}
                {strategies.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {EQ_TIMEFRAME[s.definition.timeframe].label}
                  </option>
                ))}
              </select>
            </Cell>
            <div className="ml-auto flex flex-wrap items-center gap-2 pb-0.5">
              {picked && !build && (
                <Tooltip content={E.backtest.editHere}>
                  <button
                    type="button"
                    className="btn-ghost py-1 text-xs"
                    onClick={() => {
                      // A saved strategy's changes can update it; the builder's draft or a history entry's are a new one.
                      const saved = strategies.data?.find((s) => s.id === form.strategy);
                      setBuild({ def: structuredClone(picked), baseId: saved?.id ?? null, open: true });
                      setSavedNote(null);
                      saveBuild.reset();
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Change rules here
                  </button>
                </Tooltip>
              )}
              {(!build || base) && (
                <Tooltip content={E.backtest.newStrategy}>
                  <button type="button" className="btn-ghost py-1 text-xs" onClick={startNew}>
                    <Plus className="w-3.5 h-3.5" /> New strategy
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
          {savedNote && (
            <p className="-mt-2 flex items-center gap-1.5 text-xs text-slate-300">
              <Check className="w-3.5 h-3.5 shrink-0 text-accent-soft" /> {savedNote}
            </p>
          )}
          {build && (
            <EqBuilder
              build={build}
              base={base}
              edited={edited}
              setDef={setBuildDef}
              onToggle={() => setBuild({ ...build, open: !build.open })}
              onClose={() => leaveBuild() && setBuild(null)}
              onSave={(how) => saveBuild.mutate(how)}
              saving={saveBuild.isPending}
              saveError={saveBuild.error ? (saveBuild.error as Error).message : null}
            />
          )}
          {def && !build?.open && (
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
              <QuickPeriods keys={QUICK} end={sessionEnd()} to={istToday()} value={form.range} onPick={(range) => set({ range })} help={E.backtest.quick} />
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
            <Tooltip content={build && edited ? E.backtest.runUnsaved : E.backtest.run}>
              <button type="button" className="btn-primary" disabled={!def || !symbols.length || loading || reversed || running || run.isPending || buildBlocked} onClick={() => run.mutate()}>
                {run.isPending || running ? <InlineSpinner /> : <FlaskConical className="w-4 h-4" />} Backtest {symbols.length ? countLabel(symbols) : 'stocks'}
                {build && edited ? ' (unsaved rules)' : ''}
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
          {!strategies.isLoading && !strategies.data?.length && !draft && !build && <EmptyState title="No equity strategies yet" hint="Build one right here — “New strategy” above — or start from a template in the Strategies tab." />}
        </div>
      </Section>

      <History viewing={viewing} savedIds={savedIds} onOpen={(r) => setViewing(r.id)} onRunAgain={(r) => leaveBuild() && runAgain.mutate(r)} onRemoved={(r) => viewing === r.id && setViewing(null)} />
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
          {record.data && (record.data.result ? <Results key={viewing} r={record.data.result} /> : <EmptyState title={E.history.notKept.title} hint={String(E.history.notKept.body)} />)}
        </>
      ) : (
        j?.status === 'DONE' && j.result && <Results key={j.id} r={j.result} />
      )}
    </div>
  );
}
