'use client';

/** Screener: which stocks meet a strategy's entry at their last completed check — fresh signals first, with values. */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ScanSearch } from 'lucide-react';
import type { EqScreenJob, EqScreenRow, EqStrategyDefinition } from '@/shared/equity';
import { EQ_TIMEFRAME } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { ColumnHead, FilterSummary, NoMatchRow, useTable, type Column } from '../../components/table/ColumnFilters';
import { Badge, EmptyState, Section, Segmented } from '../../components/ui';
import { Cell } from '../../components/form';
import { InlineSpinner } from '../../components/loaders';
import { eqApi } from '../api';
import { ChartLink } from '../ChartLink';
import { countLabel, downloadCsv, duration, num, pct, pnlClass, shortDate } from '../format';
import { E } from '../help';
import { JobProgress } from '../JobProgress';
import { StockPicker, useSymbols, type StockSource } from '../StockPicker';

type Show = 'FRESH' | 'ENTRY' | 'ALL';
let remembered: { strategy: string; source: StockSource; jobId: string | null; show: Show } | null = null;

const td = 'px-2.5 py-2 whitespace-nowrap align-top';
const th = 'px-2.5 py-2 font-medium';

const COLUMNS: Column<EqScreenRow>[] = [
  {
    key: 'stock',
    label: 'Stock',
    help: { title: 'Stock', body: 'Symbol and name.' },
    fields: [
      { key: 'stock', label: 'Stock', type: 'enum', value: (r) => r.symbol },
      { key: 'name', label: 'Name', type: 'text', value: (r) => r.name },
    ],
  },
  { key: 'asOf', label: 'As of', help: E.screener.asOf, type: 'date', value: (r) => r.asOf },
  { key: 'close', label: 'Close', align: 'right', help: { title: 'Close', body: 'Closing price at the last check.' }, type: 'number', unit: '₹', value: (r) => r.close },
  { key: 'change', label: 'Change', align: 'right', help: E.screener.change, type: 'number', unit: '%', signed: true, value: (r) => r.changePct },
  {
    key: 'entry',
    label: 'Entry',
    help: E.screener.entry,
    type: 'enum',
    order: ['Fresh signal', 'True', 'No', 'Unknown', 'Data error'],
    value: (r) => (r.error ? 'Data error' : r.fresh ? 'Fresh signal' : r.entry === true ? 'True' : r.entry === false ? 'No' : 'Unknown'),
  },
  { key: 'exit', label: 'Exit', help: E.screener.exit, type: 'enum', order: ['Exit true', 'No', 'Unknown'], value: (r) => (r.exit === true ? 'Exit true' : r.exit === false ? 'No' : 'Unknown') },
  {
    key: 'conditions',
    label: 'Conditions',
    help: E.screener.values,
    fields: [
      { key: 'met', label: 'Conditions met', type: 'enum', noSort: true, value: (r) => r.leaves.filter((l) => l.value === true).map((l) => l.text) },
      { key: 'notMet', label: 'Conditions not met', type: 'enum', noSort: true, value: (r) => r.leaves.filter((l) => l.value === false).map((l) => l.text) },
      { key: 'metCount', label: 'How many met', type: 'number', value: (r) => r.leaves.filter((l) => l.value === true).length },
    ],
  },
];

function Leaves({ row }: { row: EqScreenRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {row.leaves.map((l, i) => (
        <span key={i} className={clsx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]', l.value === true ? 'border-accent/30 bg-accent/10 text-slate-200' : l.value === false ? 'border-ink-700 text-slate-400' : 'border-warn/30 text-warn')}>
          <span aria-hidden>{l.value === true ? '✓' : l.value === false ? '✗' : '?'}</span>
          {l.text}
          {(l.left !== null || l.right !== null) && (
            <span className="tabular-nums text-slate-500">
              ({[l.left, l.right].filter((v) => v !== null).map((v) => num(v)).join(' vs ')})
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function ScreenerTab({ initialStrategyId, draft }: { initialStrategyId?: string; draft: EqStrategyDefinition | null }) {
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ['eq-strategies'], queryFn: eqApi.strategies });
  const [strategy, setStrategy] = useState(() => (initialStrategyId ? initialStrategyId : draft ? 'draft' : (remembered?.strategy ?? '')));
  const [source, setSource] = useState<StockSource>(remembered?.source ?? { kind: 'PRESET', preset: 'NIFTY500' });
  const [show, setShow] = useState<Show>(remembered?.show ?? 'ENTRY');
  const [jobId, setJobId] = useState<string | null>(remembered?.jobId ?? null);
  useEffect(() => {
    remembered = { strategy, source, jobId, show };
  }, [strategy, source, jobId, show]);
  useEffect(() => {
    if (jobId) return;
    eqApi.latestScreen().then((j) => j && (qc.setQueryData(['eq-screen-job', j.id], j), setJobId(j.id)), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, []);
  useEffect(() => {
    if (!strategy && strategies.data?.length) setStrategy(strategies.data[0]!.id);
  }, [strategy, strategies.data]);

  const job = useQuery({ queryKey: ['eq-screen-job', jobId], queryFn: () => eqApi.screenJob(jobId!), enabled: jobId !== null, retry: false, refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 1000 : false) });
  const j = job.data;
  const running = j?.status === 'RUNNING';
  const { symbols, loading } = useSymbols(source);
  const run = useMutation({
    mutationFn: () => eqApi.startScreen({ ...(strategy === 'draft' ? { definition: draft! } : { strategyId: strategy }), symbols }),
    onSuccess: (s: EqScreenJob) => {
      qc.setQueryData(['eq-screen-job', s.id], s);
      setJobId(s.id);
    },
  });
  const cancel = useMutation({ mutationFn: () => eqApi.cancelScreen(jobId!), onSuccess: (c) => qc.setQueryData(['eq-screen-job', c.id], c) });
  const result = j?.status === 'DONE' ? j.result : undefined;
  const rows = useMemo(() => (result?.rows ?? []).filter((r) => show === 'ALL' || (show === 'FRESH' ? r.fresh : r.entry === true)), [result, show]);
  const t = useTable(rows, COLUMNS);
  const counts = { fresh: result?.rows.filter((r) => r.fresh).length ?? 0, entry: result?.rows.filter((r) => r.entry === true).length ?? 0, all: result?.rows.length ?? 0 };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Screen stocks with a strategy" help={E.screener.section}>
        <div className="flex flex-col gap-4">
          <Cell label="Strategy" help={E.backtest.strategy}>
            <select aria-label="Strategy" className="input py-1.5 text-sm min-w-[18rem]" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              {!strategies.data?.length && !draft && <option value="">No saved strategies yet</option>}
              {draft && <option value="draft">Unsaved: {draft.name || 'new strategy'}</option>}
              {strategies.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {EQ_TIMEFRAME[s.definition.timeframe].label}
                </option>
              ))}
            </select>
          </Cell>
          <StockPicker value={source} onChange={setSource} />
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip content={E.screener.run}>
              <button type="button" className="btn-primary" disabled={!strategy || !symbols.length || loading || running || run.isPending} onClick={() => run.mutate()}>
                {run.isPending || running ? <InlineSpinner /> : <ScanSearch className="w-4 h-4" />} Screen {symbols.length ? countLabel(symbols) : 'stocks'}
              </button>
            </Tooltip>
            {symbols.length > 0 && !running && <span className="text-[11px] text-slate-500">≈ {duration(symbols.length * 0.36)} of Kite requests (less for ones already in memory)</span>}
          </div>
          {j && running && <JobProgress job={j} onCancel={() => cancel.mutate()} cancelling={cancel.isPending} />}
          {j?.status === 'CANCELLED' && <p className="text-xs text-slate-400">Screen cancelled.</p>}
          {j?.status === 'FAILED' && <p className="text-xs text-bear">{j.error}</p>}
          {(run.error || job.error) && <p className="text-xs text-bear">{((run.error ?? job.error) as Error).message}</p>}
        </div>
      </Section>

      {result && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-4 pt-3 pb-2">
            <h3 className="ui-section-title text-sm font-semibold text-slate-200">{result.strategyName}</h3>
            <Segmented
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                { value: 'FRESH', label: `Fresh signals (${counts.fresh})`, help: E.screener.fresh },
                { value: 'ENTRY', label: `Entry true (${counts.entry})`, help: E.screener.entry },
                { value: 'ALL', label: `All (${counts.all})`, help: E.screener.filter },
              ]}
            />
            <Tooltip content={{ title: 'Download CSV', body: 'Every stock with its signal and condition values.' }} className="ml-auto">
              <button
                type="button"
                className="btn-ghost py-1 text-xs"
                onClick={() =>
                  downloadCsv(
                    `equity-screen-${result.strategyName.replace(/\W+/g, '-')}.csv`,
                    ['symbol', 'name', 'as_of', 'close', 'change_pct', 'entry', 'fresh', 'exit', 'conditions'],
                    result.rows.map((r) => [r.symbol, r.name, r.asOf, r.close, r.changePct, r.entry, r.fresh, r.exit, r.leaves.map((l) => `${l.value === true ? 'Y' : l.value === false ? 'N' : '?'} ${l.text}`).join(' | ')]),
                  )
                }
              >
                Download CSV
              </button>
            </Tooltip>
          </div>
          <p className="px-4 pb-2 text-[11px] text-slate-500">{result.notes.join(' ')}</p>
          {rows.length ? (
            <div className="overflow-x-auto">
              <FilterSummary table={t} noun="stocks" />
              <table className="w-full text-xs">
                <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {COLUMNS.map((c) => (
                      <ColumnHead key={c.key} table={t} k={c.key} className={th} />
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700/50">
                  <NoMatchRow table={t} colSpan={7} />
                  {t.rows.map((r) => (
                    <tr key={r.symbol} className="hover:bg-ink-800/40">
                      <td className={td}>
                        <div className="flex items-center gap-1.5">
                          <Tooltip content={{ title: r.symbol, body: r.name }}>
                            <span className="font-medium text-slate-200">{r.symbol}</span>
                          </Tooltip>
                          <ChartLink symbol={r.symbol} tf={result.timeframe} />
                        </div>
                      </td>
                      <td className={clsx(td, 'text-slate-400')}>{shortDate(r.asOf)}</td>
                      <td className={clsx(td, 'text-right tabular-nums')}>{num(r.close)}</td>
                      <td className={clsx(td, 'text-right tabular-nums', pnlClass(r.changePct))}>{pct(r.changePct, 2)}</td>
                      <td className={td}>
                        {r.error ? (
                          <span className="text-warn">{r.error}</span>
                        ) : r.fresh ? (
                          <Tooltip content={E.screener.fresh}>
                            <Badge tone="accent">Fresh signal</Badge>
                          </Tooltip>
                        ) : r.entry === true ? (
                          <Badge>True</Badge>
                        ) : r.entry === false ? (
                          <span className="text-slate-500">No</span>
                        ) : (
                          <span className="text-warn">?</span>
                        )}
                      </td>
                      <td className={td}>{r.exit === true ? <Badge>Exit true</Badge> : r.exit === false ? <span className="text-slate-500">No</span> : <span className="text-slate-600">—</span>}</td>
                      <td className={td}>
                        <Leaves row={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={show === 'FRESH' ? 'No fresh signals at the last check' : show === 'ENTRY' ? 'No stock meets the entry right now' : 'No stocks'} hint={show !== 'ALL' ? 'Switch to “All” to see every stock’s values.' : undefined} />
          )}
        </section>
      )}
    </div>
  );
}
