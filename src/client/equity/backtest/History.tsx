'use client';

/**
 * Backtest history: every finished backtest — when it ran, which strategy (and version), on which stocks, over which
 * period with how much money, and how it did. Filter by strategy; open one to see its full result as it was; run it
 * again; delete it. Lines come from the server's memory copy (the database is read once).
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type { EqBacktestRun } from '@/shared/equity';
import { EQ_TIMEFRAME } from '@/shared/equity';
import { Tooltip, type TooltipContent } from '../../components/Tooltip';
import { Badge, EmptyState, IconButton, Section } from '../../components/ui';
import { Cell } from '../../components/form';
import { eqApi } from '../api';
import { duration, istDateTime, pct, pnlClass, shortDate, signedInr } from '../format';
import { E } from '../help';
import { compactInr } from './charts';
import { ai } from '../../ai/store';
import { AI } from '../../ai/help';

const th = 'px-2.5 py-2 font-medium whitespace-nowrap text-left';
const td = 'px-2.5 py-2 whitespace-nowrap align-middle';
const PAGE = 15;

/** Runs of one strategy: by id when it's saved, by name for unsaved / deleted ones. */
const groupOf = (r: EqBacktestRun) => (r.strategyId ? `id:${r.strategyId}` : `name:${r.strategyName}`);

function Th({ help, children, right }: { help: TooltipContent; children: string; right?: boolean }) {
  return (
    <th className={clsx(th, right && 'text-right')}>
      <Tooltip content={help}>
        <span className="uppercase tracking-wide">{children}</span>
      </Tooltip>
    </th>
  );
}

function Row({ r, active, savedStrategy, onOpen, onRunAgain, onRemoved }: { r: EqBacktestRun; active: boolean; savedStrategy: boolean; onOpen: () => void; onRunAgain: () => void; onRemoved: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => eqApi.removeBacktestRecord(r.id),
    onSuccess: () => {
      onRemoved();
      return qc.invalidateQueries({ queryKey: ['eq-backtest-history'] });
    },
  });
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  const btn = 'p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800';
  const result = r.returnPct !== null ? pct(r.returnPct) : signedInr(r.netPnl);
  return (
    <tr className={clsx('hover:bg-ink-800/40', active && 'bg-accent/10')}>
      <td className={clsx(td, 'text-slate-300')}>
        <Tooltip content={{ ...E.history.ranAt, note: `Took ${duration(r.seconds)}.` }}>
          <span>{istDateTime(r.ranAt)}</span>
        </Tooltip>
      </td>
      <td className={td}>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-slate-200">{r.strategyName}</span>
          {r.strategyVersion !== null && <span className="text-[10px] text-slate-500">v{r.strategyVersion}</span>}
          <Badge tone="accent">{EQ_TIMEFRAME[r.timeframe].short}</Badge>
          {r.strategyVersion === null ? <Badge>unsaved</Badge> : !savedStrategy && <Badge tone="warn">deleted</Badge>}
        </div>
      </td>
      <td className={clsx(td, 'text-slate-300')}>
        {r.stocksLabel} <span className="text-slate-500">· {r.symbols.toLocaleString('en-IN')}</span>
      </td>
      <td className={clsx(td, 'text-slate-400')}>
        {shortDate(r.from)} → {shortDate(r.to)}
      </td>
      <td className={clsx(td, 'text-right tabular-nums text-slate-400')}>
        {r.capital === null ? 'no limit' : compactInr(r.capital)}
        {r.maxPositions !== null && <span className="text-slate-500"> · max {r.maxPositions}</span>}
      </td>
      <td className={clsx(td, 'text-right tabular-nums')}>
        <span className={clsx('font-medium', pnlClass(r.returnPct ?? r.netPnl))}>{result}</span>
        {r.cagrPct !== null && <span className="text-slate-500"> · {pct(r.cagrPct)}/yr</span>}
      </td>
      <td className={clsx(td, 'text-right tabular-nums', r.maxDrawdownPct ? 'text-bear' : 'text-slate-500')}>{r.maxDrawdownPct === null ? '—' : pct(r.maxDrawdownPct)}</td>
      <td className={clsx(td, 'text-right tabular-nums text-slate-300')}>
        {r.trades.toLocaleString('en-IN')} <span className="text-slate-500">· {r.trades ? `${Math.round(r.winRate)}% won` : '—'}</span>
      </td>
      <td className={clsx(td, 'text-right tabular-nums', pnlClass(r.benchmarkReturnPct))}>{r.benchmarkReturnPct === null ? '—' : pct(r.benchmarkReturnPct)}</td>
      <td className={clsx(td, 'text-right')}>
        <div className="flex items-center justify-end gap-0.5">
          <IconButton help={r.kept ? E.history.open : E.history.notKept} onClick={onOpen} className={clsx(btn, active && 'text-accent-soft')}>
            <Eye className="w-3.5 h-3.5" />
          </IconButton>
          {r.kept && (
            <IconButton
              help={AI.analyse}
              onClick={() => {
                ai.setPage({ page: 'equity-backtest', backtestId: r.id, label: `Backtest: ${r.strategyName} on ${r.stocksLabel}, ${r.from} → ${r.to}` });
                ai.open({ text: 'Analyse this backtest — what drove the result and where is the risk?', send: true });
              }}
              className={btn}
            >
              <Sparkles className="w-3.5 h-3.5" />
            </IconButton>
          )}
          <IconButton help={E.history.runAgain} onClick={onRunAgain} className={btn}>
            <RotateCcw className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            help={confirm ? { ...E.history.remove, title: 'Click again to delete' } : E.history.remove}
            onClick={() => (confirm ? remove.mutate() : setConfirm(true))}
            className={confirm ? 'p-1.5 rounded-md bg-bear/15 text-bear' : 'p-1.5 rounded-md text-slate-400 hover:text-bear hover:bg-bear/10'}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}

/** `savedIds`: the strategies that exist now (null while loading — nothing is shown as deleted then). */
export function History({ viewing, savedIds, onOpen, onRunAgain, onRemoved }: { viewing: string | null; savedIds: Set<string> | null; onOpen: (r: EqBacktestRun) => void; onRunAgain: (r: EqBacktestRun) => void; onRemoved: (r: EqBacktestRun) => void }) {
  const history = useQuery({ queryKey: ['eq-backtest-history'], queryFn: eqApi.backtestHistory });
  const [group, setGroup] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const runs = useMemo(() => history.data ?? [], [history.data]);
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const r of runs) {
      const g = m.get(groupOf(r)) ?? { label: r.strategyId ? r.strategyName : `${r.strategyName} (${r.strategyVersion === null ? 'unsaved' : 'deleted'})`, count: 0 };
      g.count++;
      m.set(groupOf(r), g);
    }
    return [...m].sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [runs]);
  const list = group === 'all' ? runs : runs.filter((r) => groupOf(r) === group);

  return (
    <Section
      title={`Backtest history${runs.length ? ` (${runs.length.toLocaleString('en-IN')})` : ''}`}
      help={E.history.section}
      actions={
        runs.length > 0 && (
          <Cell label="Strategy" help={E.history.filter}>
            <select aria-label="Filter the history by strategy" className="input py-1 text-xs min-w-[14rem]" value={group} onChange={(e) => (setGroup(e.target.value), setShown(PAGE))}>
              <option value="all">All strategies</option>
              {groups.map(([key, g]) => (
                <option key={key} value={key}>
                  {g.label} ({g.count})
                </option>
              ))}
            </select>
          </Cell>
        )
      }
    >
      {history.isLoading ? (
        <p className="text-xs text-slate-500">Loading the history…</p>
      ) : history.error ? (
        <p className="text-xs text-bear">{(history.error as Error).message}</p>
      ) : !runs.length ? (
        <EmptyState title="No backtests yet" hint="Every backtest you run is kept here — when, which strategy, which stocks and how it did." />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-ink-850 text-[10px] text-slate-500">
              <tr>
                <Th help={E.history.ranAt}>Ran</Th>
                <Th help={E.history.strategy}>Strategy</Th>
                <Th help={E.history.stocks}>Stocks</Th>
                <Th help={E.history.period}>Period</Th>
                <Th help={E.history.capital} right>
                  Capital
                </Th>
                <Th help={E.history.result} right>
                  Return
                </Th>
                <Th help={E.history.drawdown} right>
                  Max DD
                </Th>
                <Th help={E.history.trades} right>
                  Trades
                </Th>
                <Th help={E.history.benchmark} right>
                  NIFTY 50
                </Th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/50">
              {list.slice(0, shown).map((r) => (
                <Row key={r.id} r={r} active={r.id === viewing} savedStrategy={r.strategyId !== null && (!savedIds || savedIds.has(r.strategyId))} onOpen={() => onOpen(r)} onRunAgain={() => onRunAgain(r)} onRemoved={() => onRemoved(r)} />
              ))}
            </tbody>
          </table>
          {list.length > shown && (
            <button type="button" className="btn-ghost mx-4 mt-2 py-1 text-xs" onClick={() => setShown((n) => n + PAGE * 2)}>
              Show more ({(list.length - shown).toLocaleString('en-IN')} older)
            </button>
          )}
        </div>
      )}
    </Section>
  );
}
