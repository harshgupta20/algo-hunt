'use client';

/**
 * Returns: how much each stock / index moved over 1D · 1W · 1M · 3M · 6M · 1Y · 2Y · 3Y, to its last finished close —
 * on a stock list, indices, a watchlist or picked stocks. Every lookback is a sortable, filterable column, with how
 * many rose / fell and the median above the table.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { TrendingUp } from 'lucide-react';
import type { EqReturnPeriod, EqReturnsJob, EqReturnsRow } from '@/shared/equity';
import { EQ_PRESETS, EQ_RETURN_PERIODS } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { ColumnHead, FilterSummary, NoMatchRow, useTable, type Column } from '../../components/table/ColumnFilters';
import { Section } from '../../components/ui';
import { InlineSpinner } from '../../components/loaders';
import { eqApi } from '../api';
import { ChartLink } from '../ChartLink';
import { countLabel, downloadCsv, duration, num, pct, pnlClass, shortDate } from '../format';
import { E } from '../help';
import { JobProgress } from '../JobProgress';
import { StockPicker, useSymbols, type StockSource } from '../StockPicker';

const R = E.returns;
/** Kept while the app is open, so leaving the tab and coming back shows the same list and result. */
let remembered: { source: StockSource; jobId: string | null } | null = null;

const td = 'px-2.5 py-2 whitespace-nowrap';
const th = 'px-2.5 py-2 font-medium';
/** Long lists render this many rows until "Show all" (every row is still sorted and filtered). */
const FIRST_ROWS = 300;
const SECONDS_PER_REQUEST = 0.36;

/** How the stocks were chosen, in words. */
function stocksLabel(source: StockSource, label: string, symbols: string[]): string {
  if (source.kind === 'PRESET') return EQ_PRESETS.find((p) => p.value === source.preset)?.label ?? label;
  if (source.kind === 'WATCHLIST') return `${label} (watchlist)`;
  return `${countLabel(symbols)} picked`;
}

const periodHelp = (key: EqReturnPeriod, words: string) => (key === '1D' ? R.day : { ...R.period, title: `${key} move — ${words}` });

const COLUMNS: Column<EqReturnsRow>[] = [
  {
    key: 'stock',
    label: 'Stock',
    help: R.stock,
    fields: [
      { key: 'stock', label: 'Stock', type: 'enum', value: (r) => r.symbol },
      { key: 'name', label: 'Name', type: 'text', value: (r) => r.name },
    ],
  },
  { key: 'close', label: 'Close', align: 'right', help: R.close, type: 'number', value: (r) => r.close },
  { key: 'asOf', label: 'As of', help: R.asOf, type: 'date', value: (r) => r.asOf },
  ...EQ_RETURN_PERIODS.map(
    (p): Column<EqReturnsRow> => ({ key: p.key, label: p.key, align: 'right', help: periodHelp(p.key, p.words), type: 'number', unit: '%', signed: true, value: (r) => r.moves[p.key].pct }),
  ),
];

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** For each lookback: how many rose / fell and the median move, over the rows shown (after filters). */
function Breadth({ rows, filtered }: { rows: EqReturnsRow[]; filtered: boolean }) {
  return (
    <div className="grid grid-cols-4 gap-2 px-4 pb-3 sm:grid-cols-8">
      {EQ_RETURN_PERIODS.map((p) => {
        const xs = rows.map((r) => r.moves[p.key].pct).filter((v): v is number => v !== null);
        const up = xs.filter((v) => v > 0).length;
        const down = xs.filter((v) => v < 0).length;
        const mid = median(xs);
        const avg = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
        return (
          <Tooltip
            key={p.key}
            className="block"
            content={{
              ...R.breadth,
              title: `${p.key} — ${p.words}`,
              body: xs.length
                ? `Of ${xs.length.toLocaleString('en-IN')} ${filtered ? 'filtered ' : ''}rows with a ${p.key} move: ${up.toLocaleString('en-IN')} rose, ${down.toLocaleString('en-IN')} fell${xs.length - up - down ? `, ${xs.length - up - down} unchanged` : ''}. Median ${pct(mid, 2)}, average ${pct(avg, 2)}.`
                : `No row has a ${p.key} move.`,
              note: R.breadth.body,
            }}
          >
            <div className="cursor-help rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-2">
              <div className="ui-label text-[10px] font-semibold uppercase tracking-wide text-slate-500">{p.key}</div>
              <div className={clsx('text-sm font-semibold tabular-nums', pnlClass(mid))}>{pct(mid, 1)}</div>
              <div className="text-[10px] tabular-nums text-slate-500">
                <span className="text-bull">{up.toLocaleString('en-IN')}▲</span> <span className="text-bear">{down.toLocaleString('en-IN')}▼</span>
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function MoveCell({ row, period, words }: { row: EqReturnsRow; period: EqReturnPeriod; words: string }) {
  const m = row.moves[period];
  const unit = row.index ? '' : '₹';
  if (m.pct === null) {
    return (
      <Tooltip content={{ title: `${row.symbol} · ${period}`, body: row.firstDate ? `No close ${words} back — Kite’s candles for it start on ${shortDate(row.firstDate)} (listed, or first traded, after that date).` : 'No candles.' }}>
        <span className="cursor-help text-slate-600">—</span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={{ title: `${row.symbol} · ${period} ${pct(m.pct, 2)}`, body: `${unit}${num(row.close)} on ${shortDate(row.asOf)} vs ${unit}${num(m.base)} on ${shortDate(m.from)}.` }}>
      <span className={clsx('cursor-help tabular-nums', pnlClass(m.pct))}>{pct(m.pct, 1)}</span>
    </Tooltip>
  );
}

export function ReturnsTab() {
  const qc = useQueryClient();
  const [source, setSource] = useState<StockSource>(remembered?.source ?? { kind: 'PRESET', preset: 'NIFTY50' });
  const [jobId, setJobId] = useState<string | null>(remembered?.jobId ?? null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    remembered = { source, jobId };
  }, [source, jobId]);
  useEffect(() => {
    if (jobId) return;
    eqApi.latestReturns().then((j) => j && (qc.setQueryData(['eq-returns-job', j.id], j), setJobId(j.id)), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, []);

  const job = useQuery({ queryKey: ['eq-returns-job', jobId], queryFn: () => eqApi.returnsJob(jobId!), enabled: jobId !== null, retry: false, refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 1000 : false) });
  const j = job.data;
  const running = j?.status === 'RUNNING';
  const { symbols, loading, label } = useSymbols(source);
  const run = useMutation({
    mutationFn: () => eqApi.startReturns({ symbols, stocksLabel: stocksLabel(source, label, symbols) }),
    onSuccess: (s: EqReturnsJob) => {
      qc.setQueryData(['eq-returns-job', s.id], s);
      setJobId(s.id);
      setShowAll(false);
    },
  });
  const cancel = useMutation({ mutationFn: () => eqApi.cancelReturns(jobId!), onSuccess: (c) => qc.setQueryData(['eq-returns-job', c.id], c) });
  const result = j?.status === 'DONE' ? j.result : undefined;
  const t = useTable(result?.rows, COLUMNS, { sort: { key: 'stock', desc: false } });
  const shown = useMemo(() => (showAll ? t.rows : t.rows.slice(0, FIRST_ROWS)), [t.rows, showAll]);

  return (
    <div className="flex flex-col gap-4">
      <Section title="How much each stock moved" help={R.section}>
        <div className="flex flex-col gap-4">
          <StockPicker value={source} onChange={setSource} />
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip content={R.run}>
              <button type="button" className="btn-primary" disabled={!symbols.length || loading || running || run.isPending} onClick={() => run.mutate()}>
                {run.isPending || running ? <InlineSpinner /> : <TrendingUp className="w-4 h-4" />} Measure {symbols.length ? countLabel(symbols) : 'stocks'}
              </button>
            </Tooltip>
            {symbols.length > 0 && !running && <span className="text-[11px] text-slate-500">≈ {duration(symbols.length * SECONDS_PER_REQUEST)} of Kite requests (less for ones already in memory)</span>}
          </div>
          {j && running && <JobProgress job={j} onCancel={() => cancel.mutate()} cancelling={cancel.isPending} />}
          {j?.status === 'CANCELLED' && <p className="text-xs text-slate-400">Cancelled.</p>}
          {j?.status === 'FAILED' && <p className="text-xs text-bear">{j.error}</p>}
          {(run.error || job.error) && <p className="text-xs text-bear">{((run.error ?? job.error) as Error).message}</p>}
        </div>
      </Section>

      {result && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-4 pt-3 pb-2">
            <h3 className="ui-section-title text-sm font-semibold text-slate-200">
              {result.label} <span className="font-normal text-slate-500">· to the close of {shortDate(result.asOf)}</span>
            </h3>
            <Tooltip content={R.csv} className="ml-auto">
              <button
                type="button"
                className="btn-ghost py-1 text-xs"
                onClick={() =>
                  downloadCsv(
                    `equity-returns-${result.label.replace(/\W+/g, '-')}-${result.asOf}.csv`,
                    ['symbol', 'name', 'as_of', 'close', ...EQ_RETURN_PERIODS.map((p) => `${p.key.toLowerCase()}_pct`)],
                    t.rows.map((r) => [r.symbol, r.name, r.asOf, r.close, ...EQ_RETURN_PERIODS.map((p) => r.moves[p.key].pct)]),
                  )
                }
              >
                Download CSV
              </button>
            </Tooltip>
          </div>
          <p className="px-4 pb-2 text-[11px] text-slate-500">{result.notes.join(' ')}</p>
          <Breadth rows={t.rows} filtered={t.active > 0} />
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
                <NoMatchRow table={t} colSpan={COLUMNS.length} />
                {shown.map((r) => (
                  <tr key={r.symbol} className="hover:bg-ink-800/40">
                    <td className={td}>
                      <div className="flex items-center gap-1.5">
                        <Tooltip content={{ title: r.symbol, body: r.name }}>
                          <span className="font-medium text-slate-200">{r.symbol}</span>
                        </Tooltip>
                        <ChartLink symbol={r.symbol} tf="1d" />
                      </div>
                    </td>
                    {r.error ? (
                      <td colSpan={COLUMNS.length - 1} className={clsx(td, 'text-warn')}>
                        {r.error}
                      </td>
                    ) : (
                      <>
                        <td className={clsx(td, 'text-right tabular-nums')}>{num(r.close)}</td>
                        <td className={clsx(td, r.asOf && r.asOf < result.asOf ? 'text-warn' : 'text-slate-400')}>{shortDate(r.asOf)}</td>
                        {EQ_RETURN_PERIODS.map((p) => (
                          <td key={p.key} className={clsx(td, 'text-right')}>
                            <MoveCell row={r} period={p.key} words={p.words} />
                          </td>
                        ))}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length < t.rows.length && (
            <div className="flex justify-center border-t border-ink-700/50 py-2">
              <Tooltip content={R.showAll}>
                <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setShowAll(true)}>
                  Show all {t.rows.length.toLocaleString('en-IN')} (first {FIRST_ROWS} shown)
                </button>
              </Tooltip>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
