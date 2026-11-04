'use client';

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { ScanRun } from '@/shared/v2';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { ColumnHead, FilterSummary, NoMatchRow, useTable, type Column } from '../components/table/ColumnFilters';
import { Badge, Card, EmptyState } from '../components/ui';
import { v2Api } from './api';
import { istStampIso } from './format';
import { H } from './help';
import { SkeletonRows } from '../components/loaders';

const TONE: Record<ScanRun['status'], 'bull' | 'warn' | 'bear' | 'default'> = { OK: 'bull', PARTIAL: 'warn', FAILED: 'bear', SKIPPED: 'default' };
const STATUS_HELP: Record<ScanRun['status'], string> = {
  OK: 'The cycle completed without errors.',
  PARTIAL: 'Some units were evaluated but something failed (a series, a channel, the budget…).',
  FAILED: 'Nothing could be evaluated (e.g. Kite not connected).',
  SKIPPED: 'Nothing to do.',
};

const took = (r: ScanRun) => (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000;

const RUN_COLUMNS: Column<ScanRun>[] = [
  {
    key: 'started',
    label: 'Started (IST)',
    help: { title: 'Started', body: 'When the scanner cycle started (IST), and whether it ran by itself or from “Scan now”.' },
    fields: [
      { key: 'started', label: 'Started', type: 'datetime', value: (r) => r.startedAt },
      { key: 'trigger', label: 'Run by', type: 'enum', noSort: true, value: (r) => (r.trigger === 'manual' ? 'Manual (Scan now)' : 'Automatic') },
    ],
  },
  { key: 'status', label: 'Status', help: { title: 'Status', body: 'OK, partial (something failed), failed or skipped (nothing to do) — hover a badge for details.' }, type: 'enum', value: (r) => r.status, order: ['OK', 'PARTIAL', 'FAILED', 'SKIPPED'] },
  { key: 'connections', label: 'Connections', align: 'right', help: { title: 'Connections', body: 'Switched-on connections in the cycle.' }, type: 'number', value: (r) => r.connections },
  { key: 'units', label: 'Units', align: 'right', help: { title: 'Units', body: 'Units (strike · expiry combinations) the connections cover.' }, type: 'number', value: (r) => r.units },
  {
    key: 'evaluated',
    label: 'Evaluated',
    align: 'right',
    help: { title: 'Evaluated', body: 'Units checked in this cycle; “+N next” were left for the next cycle by the request budget.' },
    fields: [
      { key: 'evaluated', label: 'Evaluated', type: 'number', value: (r) => r.unitsEvaluated },
      { key: 'deferred', label: 'Left for next cycle', type: 'number', value: (r) => r.deferred ?? 0 },
    ],
  },
  {
    key: 'requests',
    label: 'Requests',
    align: 'right',
    help: H.scanner.budget,
    fields: [
      { key: 'requests', label: 'Requests', type: 'number', value: (r) => r.requests },
      { key: 'budget', label: 'Budget', type: 'number', value: (r) => r.budget },
    ],
  },
  { key: 'signals', label: 'Signals', align: 'right', help: { title: 'Signals', body: 'Times a strategy fired in this cycle (delivered or suppressed).' }, type: 'number', value: (r) => r.signals },
  { key: 'alerts', label: 'Alerts', align: 'right', help: { title: 'Alerts', body: 'Alerts sent in this cycle.' }, type: 'number', value: (r) => r.alerts },
  {
    key: 'errors',
    label: 'Errors',
    align: 'right',
    help: H.scanner.errors,
    fields: [
      { key: 'errors', label: 'Errors', type: 'number', value: (r) => r.errors.length },
      { key: 'errorSource', label: 'Error source', type: 'enum', noSort: true, value: (r) => r.errors.map((e) => e.source) },
      { key: 'errorText', label: 'Error message', type: 'text', noSort: true, value: (r) => r.errors.map((e) => e.message) },
    ],
  },
  { key: 'took', label: 'Took', align: 'right', help: { title: 'Took', body: 'How long the cycle ran, in seconds.' }, type: 'number', unit: 's', value: took },
];

export function ScannerTab() {
  const [hideIdle, setHideIdle] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ['v2-runs'], queryFn: () => v2Api.scanRuns(60), refetchInterval: 60_000 });
  const settings = useQuery({ queryKey: ['v2-settings'], queryFn: v2Api.settings });
  const list = useMemo(() => (runs.data ?? []).filter((r) => !hideIdle || r.unitsEvaluated > 0 || r.errors.length > 0), [runs.data, hideIdle]);
  const t = useTable(list, RUN_COLUMNS);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          Budget {settings.data?.requestBudget ?? '—'} requests / cycle <InfoTip content={H.scanner.budget} />
        </span>
        <Tooltip content={H.scanner.hideIdle}>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} /> Hide idle cycles
          </label>
        </Tooltip>
      </div>
      <Card className="p-0 overflow-hidden">
        {runs.isLoading ? (
          <SkeletonRows rows={6} dense />
        ) : list.length === 0 ? (
          <EmptyState title="No scanner cycles recorded" hint="Cycles run every minute during market hours once a connection is switched on." />
        ) : (
          <>
          <FilterSummary table={t} noun="cycles" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500 bg-ink-850">
                <tr>
                  <th className="px-3 py-2" />
                  {RUN_COLUMNS.map((c) => (
                    <ColumnHead key={c.key} table={t} k={c.key} className="px-3 py-2" />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                <NoMatchRow table={t} colSpan={11} />
                {t.rows.map((r) => {
                  const isOpen = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-ink-850/60 cursor-pointer" onClick={() => setOpen(isOpen ? null : r.id)}>
                        <td className="px-3 py-2 text-slate-500">{isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {istStampIso(r.startedAt)}
                          {r.trigger === 'manual' && (
                            <Tooltip content={H.scanner.manual}>
                              <span className="ml-2">
                                <Badge>Manual</Badge>
                              </span>
                            </Tooltip>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Tooltip content={{ title: r.status, body: STATUS_HELP[r.status] }}>
                            <Badge tone={TONE[r.status]}>{r.status}</Badge>
                          </Tooltip>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.connections}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.units}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.unitsEvaluated}
                          {!!r.deferred && (
                            <Tooltip content={H.scanner.deferred}>
                              <span className="ml-1 text-slate-500">+{r.deferred} next</span>
                            </Tooltip>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.requests}
                          <span className="text-slate-500"> / {r.budget}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.signals}</td>
                        <td className={clsx('px-3 py-2 text-right tabular-nums', r.alerts > 0 && 'text-bull font-semibold')}>{r.alerts}</td>
                        <td className={clsx('px-3 py-2 text-right tabular-nums', r.errors.length > 0 && 'text-warn')}>{r.errors.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{took(r).toFixed(1)}s</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={11} className="px-6 py-3 bg-ink-850/50">
                            {r.notes.map((n, i) => (
                              <p key={i} className="text-xs text-slate-400">
                                {n}
                              </p>
                            ))}
                            {r.errors.map((e, i) => (
                              <p key={i} className="text-xs text-warn">
                                [{e.source}] {e.productId ? `${e.productId}: ` : ''}
                                {e.message}
                                {e.timeframe && <span className="text-slate-500"> · {e.timeframe}</span>}
                              </p>
                            ))}
                            {!r.notes.length && !r.errors.length && <p className="text-xs text-slate-500">No notes.</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </div>
  );
}
