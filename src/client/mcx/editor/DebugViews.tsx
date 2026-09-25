'use client';

/**
 * "Why did it (not) fire": the explain result per contract, and the replay
 * table over past candles.
 */
import { Fragment, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Tooltip } from '../../components/Tooltip';
import { EmptyState } from '../../components/ui';
import type { ExplainResult, ReplayResult } from '../api';
import { InstrumentTag, OutcomeBadge, TraceView, TriBadge, UnitStateBadge } from '../components';
import { candleRange, fmtNum, istStamp, istStampMs } from '../format';

export function ExplainView({ result }: { result: ExplainResult }) {
  const [open, setOpen] = useState<string | null>(result.units.find((u) => u.outcome)?.target.id ?? result.units[0]?.target.id ?? null);
  const tf = result.units[0]?.evaluation?.triggerTimeframe;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-400">
        Evaluated {istStampMs(result.evaluatedAt)} IST on the {tf ? candleRange(result.triggerCandle, tf) : istStamp(result.triggerCandle)} candle ·{' '}
        {result.requests} data request{result.requests === 1 ? '' : 's'}
        {result.resolution.references.length > 0 && <> · reference {result.resolution.references.map((r) => `${r.symbol} ${fmtNum(r.ltp)}`).join(', ')}</>}
      </p>
      {[...result.errors, ...result.resolution.errors].map((e) => (
        <p key={e} className="text-xs text-warn">
          {e}
        </p>
      ))}
      {result.units.length === 0 && <EmptyState title="No contracts to evaluate" hint="The universe resolved to nothing — see the messages above." />}
      {result.units.map((u) => {
        const isOpen = open === u.target.id;
        return (
          <div key={u.target.id} className="rounded-lg border border-ink-700/60 bg-ink-850">
            <button type="button" onClick={() => setOpen(isOpen ? null : u.target.id)} className="w-full flex flex-wrap items-center gap-3 px-3 py-2 text-left">
              {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
              <InstrumentTag i={u.target} />
              <TriBadge value={u.evaluation?.result} />
              <Tooltip content={{ title: 'Previous candle', body: 'The strategy’s result on the trigger candle before this one. “Becomes true” alerts need it to be False.' }}>
                <span className="text-[11px] text-slate-500">prev {u.prevResult ?? '—'}</span>
              </Tooltip>
              {u.outcome ? <OutcomeBadge outcome={u.outcome} /> : <span className="text-[11px] text-slate-500">no signal</span>}
              {u.state && <UnitStateBadge state={u.state.state} />}
              {u.evaluation?.price !== undefined && <span className="ml-auto text-xs tabular-nums text-slate-400">close {fmtNum(u.evaluation.price)}</span>}
            </button>
            {isOpen && (
              <div className="px-3 pb-3 border-t border-ink-700/60 pt-2">
                {u.error && <p className="text-xs text-bear">{u.error}</p>}
                {u.evaluation && <TraceView trace={u.evaluation.trace} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ReplayView({ result }: { result: ReplayResult }) {
  const [onlySignals, setOnlySignals] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span>
          {result.candles} trigger candle{result.candles === 1 ? '' : 's'} · {result.units.reduce((n, u) => n + u.signals, 0)} signal(s) · {result.requests} request(s)
        </span>
        <Tooltip content={{ title: 'Only signal candles', body: 'Show only candles where the strategy would have signalled. Untick to see every candle with its failing conditions.' }}>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlySignals} onChange={(e) => setOnlySignals(e.target.checked)} /> Only signals
          </label>
        </Tooltip>
      </div>
      {[...result.notes, ...result.errors].map((n) => (
        <p key={n} className={clsx('text-[11px]', result.errors.includes(n) ? 'text-warn' : 'text-slate-500')}>
          {n}
        </p>
      ))}
      {result.units.map((u) => {
        const rows = onlySignals ? u.rows.filter((r) => r.outcome) : u.rows;
        return (
          <div key={u.target.id} className="rounded-lg border border-ink-700/60 bg-ink-850 p-3">
            <div className="flex items-center gap-3 mb-2">
              <InstrumentTag i={u.target} />
              <span className="text-xs text-slate-500">{u.signals} signal(s)</span>
            </div>
            {rows.length === 0 ? (
              <p className="text-xs text-slate-500">{onlySignals ? 'No signals in this period.' : 'No candles.'}</p>
            ) : (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500 sticky top-0 bg-ink-850">
                    <tr>
                      <th className="py-1 pr-3">Candle (IST)</th>
                      <th className="py-1 pr-3">Result</th>
                      <th className="py-1 pr-3">Signal</th>
                      <th className="py-1 pr-3 text-right">Close</th>
                      <th className="py-1">Not met</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700/40">
                    {rows.map((r) => {
                      const key = `${u.target.id}:${r.candleTime}`;
                      return (
                        <Fragment key={key}>
                          <tr className={clsx(r.trace && 'cursor-pointer hover:bg-ink-800/60')} onClick={() => r.trace && setOpen(open === key ? null : key)}>
                            <td className="py-1 pr-3 whitespace-nowrap">{candleRange(r.candleTime, result.triggerTimeframe)}</td>
                            <td className="py-1 pr-3">
                              <TriBadge value={r.result} />
                            </td>
                            <td className="py-1 pr-3">{r.outcome ? <OutcomeBadge outcome={r.outcome} /> : <span className="text-slate-600">—</span>}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(r.price)}</td>
                            <td className="py-1 text-slate-500">{r.failing.join(' · ') || '—'}</td>
                          </tr>
                          {open === key && r.trace && (
                            <tr>
                              <td colSpan={5} className="py-2">
                                <TraceView trace={r.trace} />
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
          </div>
        );
      })}
    </div>
  );
}
