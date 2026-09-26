'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { ScanRun } from '@/shared/v2';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { Badge, Card, EmptyState, Spinner } from '../components/ui';
import { v2Api } from './api';
import { istStampIso } from './format';
import { H } from './help';

const TONE: Record<ScanRun['status'], 'bull' | 'warn' | 'bear' | 'default'> = { OK: 'bull', PARTIAL: 'warn', FAILED: 'bear', SKIPPED: 'default' };
const STATUS_HELP: Record<ScanRun['status'], string> = {
  OK: 'The cycle completed without errors.',
  PARTIAL: 'Some units were evaluated but something failed (a series, a channel, the budget…).',
  FAILED: 'Nothing could be evaluated (e.g. Kite not connected).',
  SKIPPED: 'Nothing to do.',
};

export function ScannerTab() {
  const [hideIdle, setHideIdle] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ['v2-runs'], queryFn: () => v2Api.scanRuns(200), refetchInterval: 30_000 });
  const settings = useQuery({ queryKey: ['v2-settings'], queryFn: v2Api.settings });
  const list = (runs.data ?? []).filter((r) => !hideIdle || r.unitsEvaluated > 0 || r.errors.length > 0);

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
          <div className="p-4">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="No scanner cycles recorded" hint="Cycles run every minute during market hours once a connection is switched on." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500 bg-ink-850">
                <tr>
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2">Started (IST)</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Connections</th>
                  <th className="px-3 py-2 text-right">Units</th>
                  <th className="px-3 py-2 text-right">Evaluated</th>
                  <th className="px-3 py-2 text-right">Requests</th>
                  <th className="px-3 py-2 text-right">Signals</th>
                  <th className="px-3 py-2 text-right">Alerts</th>
                  <th className="px-3 py-2 text-right">
                    <span className="inline-flex items-center gap-1">
                      Errors <InfoTip content={H.scanner.errors} />
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right">Took</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {list.map((r) => {
                  const isOpen = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-ink-850/60 cursor-pointer" onClick={() => setOpen(isOpen ? null : r.id)}>
                        <td className="px-3 py-2 text-slate-500">{isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{istStampIso(r.startedAt)}</td>
                        <td className="px-3 py-2">
                          <Tooltip content={{ title: r.status, body: STATUS_HELP[r.status] }}>
                            <Badge tone={TONE[r.status]}>{r.status}</Badge>
                          </Tooltip>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.connections}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.units}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.unitsEvaluated}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.requests}
                          <span className="text-slate-500"> / {r.budget}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.signals}</td>
                        <td className={clsx('px-3 py-2 text-right tabular-nums', r.alerts > 0 && 'text-bull font-semibold')}>{r.alerts}</td>
                        <td className={clsx('px-3 py-2 text-right tabular-nums', r.errors.length > 0 && 'text-warn')}>{r.errors.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000).toFixed(1)}s</td>
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
        )}
      </Card>
    </div>
  );
}
