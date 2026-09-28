'use client';

/**
 * Paper trading results — built for deciding what to keep, tune or drop:
 *   headline      net P&L, return on the money needed, win rate, profit factor, average trade, drawdown
 *   charts        P&L (cumulative / by day), how trades closed, P&L by entry time
 *   ranking       every connection (or strategy), sortable, with its trend and its paper settings (edit inline)
 *   open          positions at the latest price, where they sit between stop and target, close now
 *   log           closed trades (all / winners / losers), CSV
 * Paper trading is on for every connection by default; nothing is sent to the broker.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Pencil, RefreshCw, Trash2, Wallet, X } from 'lucide-react';
import clsx from 'clsx';
import type { PaperStats, PaperSummary, PaperTrade } from '@/shared/v2';
import { paperGroups } from '@/shared/v2';
import { InfoTip, Tooltip, type TooltipContent } from '../../components/Tooltip';
import { Badge, EmptyState, IconButton, StatCard } from '../../components/ui';
import { InlineSpinner, SkeletonRows, SkeletonStatGrid } from '../../components/loaders';
import { v2Api } from '../api';
import { InstrumentChip, Segmented } from '../components';
import { FilterBar, activeCount, toQuery, useFilters } from '../FilterBar';
import { istStampIso } from '../format';
import { H } from '../help';
import { PnlBars, RangeBar, Sparkline } from './charts';
import { EquityChart } from './EquityChart';
import { inr, pct, pnlClass, signedInr } from './money';
import { PaperChip, PaperConnectionEditor, paperBrief } from './PaperFields';

const symbolOf = (productId: string) => productId.split(':')[1] ?? productId;
export const th = 'px-2.5 py-2 font-medium whitespace-nowrap';
export const td = 'px-2.5 py-2 whitespace-nowrap align-middle';
export const FEW_TRADES = 10;

function held(t: PaperTrade): string {
  const ms = Date.parse(t.exitAt ?? new Date().toISOString()) - Date.parse(t.entryAt);
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `${Math.round(m / (24 * 60))} d`;
}

function ago(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : istStampIso(iso);
}

const qty = (t: PaperTrade) => (t.lotSize > 1 ? `${t.lots} × ${t.lotSize}` : `${t.quantity}`);
export const pf = (s: PaperStats) => (typeof s.profitFactor === 'number' ? s.profitFactor.toFixed(2) : s.wins ? 'no losses' : '—');

/** A column header with its explanation (the tooltip sits inside the cell); sortable when `sort` is given. */
export function Th({ help, children, sort }: { help: TooltipContent; children: string; sort?: { active: boolean; desc: boolean; onClick: () => void } }) {
  return (
    <th className={th} aria-sort={sort?.active ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <Tooltip content={sort ? { ...help, note: H.paper.sort.body } : help}>
        {sort ? (
          <button type="button" onClick={sort.onClick} className={clsx('inline-flex items-center gap-0.5 uppercase tracking-wide', sort.active ? 'text-slate-200' : 'hover:text-slate-300')}>
            {children}
            {sort.active && (sort.desc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
          </button>
        ) : (
          <span className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">{children}</span>
        )}
      </Tooltip>
    </th>
  );
}

function SideBadge({ side }: { side: PaperTrade['side'] }) {
  return (
    <Tooltip content={side === 'BUY' ? H.paper.buy : H.paper.sell}>
      <Badge tone={side === 'BUY' ? 'accent' : 'default'}>{side === 'BUY' ? 'Buy' : 'Sell'}</Badge>
    </Tooltip>
  );
}

function TradeFlags({ t }: { t: PaperTrade }) {
  return (
    <>
      {t.overBudget && (
        <Tooltip content={{ ...H.paper.overBudget, note: `Used ${inr(t.capitalUsed)} of ${inr(t.cashPerTrade)}.` }}>
          <Badge tone="warn">over budget</Badge>
        </Tooltip>
      )}
      {t.marginEstimated && (
        <Tooltip content={H.paper.margin}>
          <span className="text-[10px] text-slate-500">≈ margin</span>
        </Tooltip>
      )}
    </>
  );
}

function ProductCell({ t, strategy }: { t: PaperTrade; strategy?: string }) {
  return (
    <div className="leading-tight">
      <div className="font-medium text-slate-200">
        {symbolOf(t.productId)}
        {t.groupLabel && <span className="font-normal text-slate-500"> · {t.groupLabel}</span>}
      </div>
      <div className="max-w-[13rem] truncate text-[11px] text-slate-500">{strategy ?? '—'}</div>
    </div>
  );
}

function ContractCell({ t }: { t: PaperTrade }) {
  return (
    <div className="flex flex-col items-start gap-0.5 leading-tight">
      <InstrumentChip i={t.instrument} />
      {(t.overBudget || t.marginEstimated) && (
        <div className="flex items-center gap-1.5">
          <TradeFlags t={t} />
        </div>
      )}
    </div>
  );
}

export function toCsv(trades: PaperTrade[], names: Map<string, string>): string {
  const head = ['entry_at', 'exit_at', 'strategy', 'product', 'group', 'contract', 'side', 'lots', 'quantity', 'entry_price', 'exit_price', 'exit_reason', 'money_used', 'gross_pnl', 'charges', 'net_pnl', 'status'];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = trades.map((t) =>
    [t.entryAt, t.exitAt, names.get(t.strategyId) ?? t.strategyId, t.productId, t.groupLabel ?? '', t.instrument.symbol, t.side, t.lots, t.quantity, t.entryPrice, t.exitPrice, t.exitReason, t.capitalUsed, t.grossPnl, t.charges, t.status === 'OPEN' ? t.openPnl : t.netPnl, t.status]
      .map(cell)
      .join(','),
  );
  return [head.join(','), ...rows].join('\n');
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function Panel({ title, help, aside, children, className, flush }: { title: string; help: TooltipContent; aside?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={clsx('card overflow-hidden', className)}>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <InfoTip content={help} />
        {aside && <div className="ml-auto flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
      <div className={flush ? '' : 'px-4 pb-4'}>{children}</div>
    </section>
  );
}

// ---- headline --------------------------------------------------------------------------------

function Headline({ o }: { o: PaperStats }) {
  const tone = (n: number | null | undefined) => (n === null || n === undefined || Math.abs(n) < 0.005 ? undefined : n > 0 ? 'bull' : 'bear');
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Net P&L" value={signedInr(o.netPnl)} tone={tone(o.netPnl)} hint={`today ${signedInr(o.todayPnl)} · ${inr(o.charges, 0)} charges`} help={{ ...H.paper.net, note: `Gross ${signedInr(o.grossPnl)} − charges ${inr(o.charges)}.` }} />
      <StatCard label="Return" value={pct(o.returnPct)} tone={tone(o.returnPct)} hint={o.capitalPeak ? `on ${inr(o.capitalPeak, 0)} needed` : 'no money used yet'} help={{ ...H.paper.ret, note: H.paper.capital.body }} />
      <StatCard label="Win rate" value={o.winRate === null ? '—' : `${o.winRate.toFixed(0)}%`} hint={`${o.wins} won · ${o.losses} lost of ${o.trades}`} help={H.paper.winRate} />
      <StatCard
        label="Profit factor"
        value={pf(o)}
        tone={o.profitFactor === null ? (o.wins ? 'bull' : undefined) : o.profitFactor >= 1 ? 'bull' : 'bear'}
        hint={o.avgWin !== null || o.avgLoss !== null ? `avg win ${o.avgWin === null ? '—' : signedInr(Math.round(o.avgWin))} · loss ${o.avgLoss === null ? '—' : signedInr(Math.round(o.avgLoss))}` : 'no closed trades'}
        help={{ ...H.paper.pf, note: H.paper.avgWinLoss.body }}
      />
      <StatCard
        label="Average trade"
        value={o.avgPnl === null ? '—' : signedInr(Math.round(o.avgPnl))}
        tone={tone(o.avgPnl)}
        hint={o.best !== null ? `best ${signedInr(Math.round(o.best))} · worst ${signedInr(Math.round(o.worst ?? 0))}` : undefined}
        help={H.paper.expectancy}
      />
      <StatCard label="Max drawdown" value={o.maxDrawdown ? signedInr(Math.round(o.maxDrawdown)) : '₹0'} tone={o.maxDrawdown < 0 ? 'bear' : undefined} hint={o.overBudget ? `${o.overBudget} trade(s) over budget` : 'deepest dip from a high'} help={H.paper.drawdown} />
    </div>
  );
}

// ---- charts ----------------------------------------------------------------------------------

const REASON_ORDER = ['TARGET', 'STOP', 'SQUARE_OFF', 'OPPOSITE', 'EXPIRY', 'MANUAL', 'END'] as const;

export function HowClosed({ sum }: { sum: PaperSummary }) {
  const total = sum.reasons.reduce((a, r) => a + r.trades, 0);
  if (!total) return <p className="py-6 text-center text-xs text-slate-500">No closed trades in this period.</p>;
  const rows = REASON_ORDER.map((k) => sum.reasons.find((r) => r.reason === k)).filter((r): r is PaperSummary['reasons'][number] => !!r);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.reason}>
          <Tooltip content={{ ...H.paper.reasons[r.reason], note: `${r.trades} trade(s), ${Math.round((r.trades / total) * 100)}% of closed · net ${signedInr(r.pnl)}` }} className="block">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-slate-300">{H.paper.reasons[r.reason].title}</span>
              <div className="h-2 flex-1 rounded-full bg-ink-800">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(3, (r.trades / total) * 100)}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-slate-400">{r.trades}</span>
              <span className={clsx('w-20 shrink-0 text-right tabular-nums font-medium', pnlClass(r.pnl))}>{signedInr(Math.round(r.pnl))}</span>
            </div>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

export function ByHour({ sum }: { sum: PaperSummary }) {
  if (!sum.hours.length) return <p className="py-6 text-center text-xs text-slate-500">No closed trades in this period.</p>;
  const lo = Math.min(...sum.hours.map((h) => h.hour));
  const hi = Math.max(...sum.hours.map((h) => h.hour));
  const hh = (h: number) => String(h).padStart(2, '0');
  const items = Array.from({ length: hi - lo + 1 }, (_, i) => {
    const hour = lo + i;
    const h = sum.hours.find((x) => x.hour === hour);
    return {
      key: String(hour),
      label: `${hh(hour)}h`,
      pnl: h?.pnl ?? 0,
      lines: h ? [`${h.trades} trade(s) opened ${hh(hour)}:00–${hh(hour)}:59`, `${Math.round((h.wins / h.trades) * 100)}% won`] : ['No trades opened in this hour'],
    };
  });
  return <PnlBars items={items} height={150} ariaLabel="Net P&L by the hour trades were opened" />;
}

export function PnlPanel({ sum }: { sum: PaperSummary }) {
  const [view, setView] = useState<'cum' | 'day'>('cum');
  const days = sum.daily.map((d) => ({
    key: d.date,
    label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    pnl: d.pnl,
    lines: [`${d.trades} trade(s) closed`, `${Math.round((d.wins / d.trades) * 100)}% won`],
  }));
  return (
    <Panel
      title="Profit & loss"
      help={view === 'cum' ? H.paper.cumulative : H.paper.byDay}
      className="lg:col-span-2"
      aside={
        <Segmented
          label="P&L chart"
          value={view}
          onChange={setView}
          options={[
            { value: 'cum', label: 'Cumulative', help: H.paper.cumulative },
            { value: 'day', label: 'By day', help: H.paper.byDay },
          ]}
        />
      }
    >
      {!sum.equity.length ? (
        <p className="py-28 text-center text-xs text-slate-500">No closed trades in this period yet — every alert opens one automatically.</p>
      ) : view === 'cum' ? (
        <EquityChart points={sum.equity} height={300} />
      ) : (
        <PnlBars items={days} height={300} ariaLabel="Net P&L per day" />
      )}
    </Panel>
  );
}

// ---- ranking ---------------------------------------------------------------------------------

type SortKey = 'net' | 'trades' | 'winRate' | 'pf' | 'avg' | 'ret' | 'dd' | 'name';
const sortValue = (s: PaperStats, k: SortKey): number | null =>
  k === 'net'
    ? s.trades
      ? s.netPnl
      : null
    : k === 'trades'
      ? s.trades
      : k === 'winRate'
        ? s.winRate
        : k === 'pf'
          ? (s.profitFactor ?? (s.wins ? Number.MAX_SAFE_INTEGER : null))
          : k === 'avg'
            ? s.avgPnl
            : k === 'ret'
              ? s.returnPct
              : k === 'dd'
                ? s.trades
                  ? s.maxDrawdown
                  : null
                : null;

function WinRate({ s }: { s: PaperStats }) {
  if (s.winRate === null) return <span className="text-slate-500">—</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 tabular-nums">{s.winRate.toFixed(0)}%</span>
      <div className="h-1.5 w-10 rounded-full bg-ink-700" aria-hidden>
        <div className="h-1.5 rounded-full bg-slate-400" style={{ width: `${s.winRate}%` }} />
      </div>
    </div>
  );
}

export function StatCells({ s }: { s: PaperStats }) {
  const few = s.trades > 0 && s.trades < FEW_TRADES;
  return (
    <>
      <td className={clsx(td, 'tabular-nums')}>
        {s.trades}
        {s.open > 0 && <span className="text-slate-500"> +{s.open} open</span>}
        {few && (
          <Tooltip content={H.paper.fewTrades}>
            <span className="ml-1.5 rounded bg-ink-800 px-1 text-[9px] uppercase tracking-wide text-slate-500">few</span>
          </Tooltip>
        )}
      </td>
      <td className={td}>
        <WinRate s={s} />
      </td>
      <td className={clsx(td, 'tabular-nums', s.profitFactor === null ? 'text-slate-400' : s.profitFactor >= 1 ? 'text-bull' : 'text-bear')}>{pf(s)}</td>
      <td className={clsx(td, 'tabular-nums', pnlClass(s.avgPnl))}>{s.avgPnl === null ? '—' : signedInr(Math.round(s.avgPnl))}</td>
      <td className={clsx(td, 'tabular-nums font-semibold', pnlClass(s.netPnl))}>{s.trades ? signedInr(s.netPnl) : '—'}</td>
      <td className={clsx(td, 'tabular-nums', pnlClass(s.returnPct))}>{pct(s.returnPct)}</td>
      <td className={clsx(td, 'tabular-nums', s.maxDrawdown < 0 ? 'text-bear' : 'text-slate-500')}>{s.maxDrawdown ? signedInr(Math.round(s.maxDrawdown)) : '—'}</td>
    </>
  );
}

function Ranking({ sum, onEditStrategy, onReset, resetting }: { sum: PaperSummary; onEditStrategy: (id: string) => void; onReset: (id: string, name: string, n: number) => void; resetting: boolean }) {
  const [view, setView] = useState<'connections' | 'strategies'>('connections');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'net', desc: true });
  const [editing, setEditing] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ['v2-paper-settings'], queryFn: v2Api.paperSettings, staleTime: 30_000 });
  const strategies = useQuery({ queryKey: ['v2-strategies'], queryFn: v2Api.strategies });
  const by = (k: SortKey) => ({ active: sort.key === k, desc: sort.desc, onClick: () => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'name' })) });
  const order = <T,>(rows: T[], stats: (r: T) => PaperStats, name: (r: T) => string) =>
    [...rows].sort((a, b) => {
      if (sort.key === 'name') return (sort.desc ? -1 : 1) * name(a).localeCompare(name(b));
      const va = sortValue(stats(a), sort.key);
      const vb = sortValue(stats(b), sort.key);
      if (va === null && vb === null) return name(a).localeCompare(name(b));
      if (va === null) return 1;
      if (vb === null) return -1;
      return sort.desc ? vb - va : va - vb;
    });
  const conns = order(sum.connections, (c) => c.stats, (c) => `${c.symbol} ${c.strategyName}`);
  const strats = order(sum.strategies, (s) => s.stats, (s) => s.name);
  const defs = new Map(strategies.data?.map((s) => [s.id, s.definition]));

  return (
    <Panel
      title={view === 'connections' ? 'Connections ranked' : 'Strategies ranked'}
      help={H.paper.ranking}
      flush
      aside={
        <Segmented
          label="Rank"
          value={view}
          onChange={(v) => (setView(v), setEditing(null))}
          options={[
            { value: 'connections', label: `Connections (${sum.connections.length})`, help: H.paper.view },
            { value: 'strategies', label: `Strategies (${sum.strategies.length})`, help: H.paper.view },
          ]}
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className={clsx(th, 'w-8')}>#</th>
              <Th help={view === 'connections' ? { title: 'Product · strategy', body: 'The connection: product and the strategy it runs.' } : { title: 'Strategy', body: 'All of the strategy’s connections together.' }} sort={by('name')}>
                {view === 'connections' ? 'Product · strategy' : 'Strategy'}
              </Th>
              <Th help={H.paper.trend}>Trend</Th>
              <Th help={H.paper.trades} sort={by('trades')}>
                Trades
              </Th>
              <Th help={H.paper.winRate} sort={by('winRate')}>
                Won
              </Th>
              <Th help={H.paper.pf} sort={by('pf')}>
                Profit f.
              </Th>
              <Th help={H.paper.expectancy} sort={by('avg')}>
                Avg / trade
              </Th>
              <Th help={H.paper.net} sort={by('net')}>
                Net P&L
              </Th>
              <Th help={H.paper.ret} sort={by('ret')}>
                Return
              </Th>
              <Th help={H.paper.drawdown} sort={by('dd')}>
                Drawdown
              </Th>
              <Th help={view === 'connections' ? H.paper.chip : H.paper.editPlan}>Paper settings</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/50">
            {view === 'connections' &&
              conns.map((c, i) => {
                const plan = settings.data?.plans[c.strategyId];
                const def = defs.get(c.strategyId);
                return (
                  <Fragment key={c.connectionId}>
                    <tr className={clsx(!c.switchedOn && 'opacity-60')}>
                      <td className={clsx(td, 'text-slate-500 tabular-nums')}>{i + 1}</td>
                      <td className={td}>
                        <div className="leading-tight">
                          <div className="flex items-center gap-1.5 font-medium text-slate-200">
                            {c.symbol}
                            {!c.switchedOn && (
                              <Tooltip content={{ title: 'Connection switched off', body: 'Not scanned now — its past paper trades are still counted.' }}>
                                <span className="rounded bg-ink-800 px-1 text-[9px] font-normal uppercase tracking-wide text-slate-500">off</span>
                              </Tooltip>
                            )}
                          </div>
                          <div className="max-w-[12rem] truncate text-[11px] text-slate-500">{c.strategyName}</div>
                        </div>
                      </td>
                      <td className={td}>
                        <Tooltip content={H.paper.trend}>
                          <Sparkline points={c.spark} />
                        </Tooltip>
                      </td>
                      <StatCells s={c.stats} />
                      <td className={td}>
                        <PaperChip enabled={c.paper.enabled} brief={paperBrief(c.paper)} custom={c.paper.custom} onClick={() => setEditing(editing === c.connectionId ? null : c.connectionId)} active={editing === c.connectionId} />
                      </td>
                    </tr>
                    {editing === c.connectionId && (
                      <tr>
                        <td colSpan={11} className="bg-ink-950/40 px-3 py-3">
                          {plan && def ? (
                            <PaperConnectionEditor
                              connectionId={c.connectionId}
                              label={`${c.symbol} · ${c.strategyName}`}
                              strategyPlan={plan}
                              override={settings.data?.overrides[c.connectionId]}
                              hasGroups={paperGroups(def).length > 0}
                              onClose={() => setEditing(null)}
                            />
                          ) : (
                            <InlineSpinner className="w-4 h-4 text-slate-500" />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            {view === 'strategies' &&
              strats.map((s, i) => {
                const plan = settings.data?.plans[s.strategyId];
                return (
                  <tr key={s.strategyId}>
                    <td className={clsx(td, 'text-slate-500 tabular-nums')}>{i + 1}</td>
                    <td className={td}>
                      <div className="leading-tight">
                        <div className="font-medium text-slate-200">{s.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {s.connections} connection{s.connections === 1 ? '' : 's'}
                        </div>
                      </div>
                    </td>
                    <td className={td}>
                      <Tooltip content={H.paper.trend}>
                        <Sparkline points={s.spark} />
                      </Tooltip>
                    </td>
                    <StatCells s={s.stats} />
                    <td className={td}>
                      <div className="flex items-center gap-1">
                        <Tooltip content={s.enabled ? { ...H.paper.planOn, note: 'Defaults for its connections — ✎ to change them.' } : H.paper.planOff}>
                          <span className={clsx('rounded-md border px-2 py-0.5 text-[11px] tabular-nums whitespace-nowrap', s.enabled ? 'border-ink-700 bg-ink-850 text-slate-300' : 'border-ink-700 text-slate-500 line-through')}>
                            📄 {s.enabled && plan ? paperBrief(plan) : 'paper off'}
                          </span>
                        </Tooltip>
                        <IconButton help={H.paper.editPlan} onClick={() => onEditStrategy(s.strategyId)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-ink-800">
                          <Pencil className="w-3.5 h-3.5" />
                        </IconButton>
                        <IconButton
                          help={H.paper.reset}
                          disabled={resetting || (!s.stats.trades && !s.stats.open)}
                          onClick={() => onReset(s.strategyId, s.name, s.stats.trades + s.stats.open)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10 disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {view === 'connections' && !conns.length && <EmptyState title="No switched-on connections" hint="Switch connections on in the Connections tab — each one paper trades its alerts automatically." />}
    </Panel>
  );
}

/** Closed trades: when, product, contract, side, size, fills, why it closed, how long, charges, net P&L. */
export function TradeTable({ trades, names, rows, onMore, opened }: { trades: PaperTrade[]; names: Map<string, string>; rows: number; onMore: () => void; opened?: boolean }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              {opened && <th className={th}>Opened</th>}
              <th className={th}>Closed</th>
              <th className={th}>Product · strategy</th>
              <th className={th}>Contract</th>
              <th className={th}>Side</th>
              <Th help={{ title: 'Quantity', body: 'Lots × lot size (or shares for stocks).' }}>Qty</Th>
              <Th help={{ title: 'Entry → exit', body: 'Fill prices, including slippage (a target fills at its own price).' }}>Entry → exit</Th>
              <Th help={{ title: 'Why it closed', body: 'Target, stop-loss, square-off, the other group firing, expiry, closed by hand or the end of a backtest — hover a badge for details.' }}>Why</Th>
              <Th help={{ title: 'Held', body: 'Time from entry to exit.' }}>Held</Th>
              <Th help={H.paper.charges}>Charges</Th>
              <Th help={H.paper.net}>Net P&L</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/50">
            {trades.slice(0, rows).map((t) => (
              <tr key={t.id}>
                {opened && <td className={clsx(td, 'text-slate-400')}>{istStampIso(t.entryAt)}</td>}
                <td className={clsx(td, 'text-slate-400')}>{t.exitAt ? istStampIso(t.exitAt) : '—'}</td>
                <td className={td}>
                  <ProductCell t={t} strategy={names.get(t.strategyId)} />
                </td>
                <td className={td}>
                  <ContractCell t={t} />
                </td>
                <td className={td}>
                  <SideBadge side={t.side} />
                </td>
                <td className={clsx(td, 'tabular-nums')}>{qty(t)}</td>
                <td className={clsx(td, 'tabular-nums')}>
                  {inr(t.entryPrice)} → {t.exitPrice === null ? '—' : inr(t.exitPrice)}
                </td>
                <td className={td}>
                  {t.exitReason && (
                    <Tooltip content={H.paper.reasons[t.exitReason]}>
                      <Badge>{H.paper.reasons[t.exitReason].title}</Badge>
                    </Tooltip>
                  )}
                </td>
                <td className={clsx(td, 'text-slate-400')}>{held(t)}</td>
                <td className={clsx(td, 'tabular-nums text-slate-400')}>{inr(t.charges ?? 0)}</td>
                <td className={clsx(td, 'tabular-nums font-semibold', pnlClass(t.netPnl))}>{signedInr(t.netPnl ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trades.length > rows && (
        <div className="flex justify-center p-3">
          <Tooltip content={H.paper.more}>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={onMore}>
              Show 50 more of {trades.length - rows}
            </button>
          </Tooltip>
        </div>
      )}
    </>
  );
}

// ---- the tab ---------------------------------------------------------------------------------

export function PaperTab({ initialStrategyId, onEditStrategy }: { initialStrategyId?: string; onEditStrategy: (strategyId?: string) => void }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useFilters('paper', { strategyId: initialStrategyId });
  const [logView, setLogView] = useState<'all' | 'win' | 'loss'>('all');
  const [logRows, setLogRows] = useState(50);
  const strategies = useQuery({ queryKey: ['v2-strategies'], queryFn: v2Api.strategies });
  const { sources: _s, statuses: _st, outcomes: _o, ...q } = toQuery(filters, strategies.data ?? []);
  const { from: _from, to: _to, ...qOpen } = q; // open positions: every period
  const ready = !filters.groups.length || !!strategies.data;
  const summary = useQuery({ queryKey: ['v2-paper', 'summary', q], queryFn: () => v2Api.paperSummary(q), refetchInterval: 15_000, enabled: ready, placeholderData: keepPreviousData });
  const open = useQuery({ queryKey: ['v2-paper', 'open', qOpen], queryFn: () => v2Api.paperTrades({ ...qOpen, status: 'OPEN', limit: 500 }), refetchInterval: 5_000, enabled: ready, placeholderData: keepPreviousData });
  const log = useQuery({ queryKey: ['v2-paper', 'log', q], queryFn: () => v2Api.paperTrades({ ...q, status: 'CLOSED', limit: 2_000 }), refetchInterval: 30_000, enabled: ready, placeholderData: keepPreviousData });
  const refresh = () => qc.invalidateQueries({ queryKey: ['v2-paper'] });
  const close = useMutation({ mutationFn: (id: string) => v2Api.closePaperTrade(id), onSettled: refresh });
  const reset = useMutation({ mutationFn: (id: string) => v2Api.resetPaper(id), onSettled: refresh });
  const names = new Map((strategies.data ?? []).map((s) => [s.id, s.name]));
  const sum = summary.data;
  const openPnl = (open.data ?? []).reduce((a, t) => a + (t.openPnl ?? 0), 0);
  const trades = useMemo(() => (log.data ?? []).filter((t) => (logView === 'all' ? true : logView === 'win' ? (t.netPnl ?? 0) > 0 : (t.netPnl ?? 0) < 0)), [log.data, logView]);
  const switchedOn = sum?.connections.filter((c) => c.switchedOn) ?? [];
  const onReset = (id: string, name: string, n: number) => {
    if (window.confirm(`Delete all ${n} paper trade(s) of “${name}” (open ones too)? The settings stay. This cannot be undone.`)) reset.mutate(id);
  };

  return (
    <div className="flex flex-col gap-4">
      <FilterBar value={filters} onChange={(v) => (setFilters(v), setLogRows(50))} strategies={strategies.data ?? []} fields={['sides']} shown={sum ? `${sum.overall.trades} closed · ${sum.overall.open} open trade(s)${activeCount(filters, ['sides']) ? ' match' : ''}` : undefined} />
      <div className="flex flex-wrap items-center gap-3">
        <IconButton help={H.paper.refresh} onClick={refresh} className="btn-ghost py-1.5 text-xs">
          <RefreshCw className={clsx('w-3.5 h-3.5', (summary.isFetching || open.isFetching) && 'animate-spin')} /> Refresh
        </IconButton>
        {sum && (
          <Tooltip content={{ ...H.tabs.paper, note: 'Switched-on connections that paper trade their alerts. Switch one off, or change its values, with its 📄 chip.' }} className="ml-auto">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <Wallet className="w-3.5 h-3.5 text-accent-soft" /> Paper trading on for {switchedOn.filter((c) => c.paper.enabled).length} of {switchedOn.length} switched-on connection(s) · nothing is sent to your broker
            </span>
          </Tooltip>
        )}
      </div>

      {summary.isLoading ? (
        <SkeletonStatGrid count={6} />
      ) : summary.error ? (
        <p className="text-sm text-bear">{(summary.error as Error).message}</p>
      ) : (
        sum && (
          <>
            <Headline o={sum.overall} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <PnlPanel sum={sum} />
              <div className="flex flex-col gap-4">
                <Panel title="How trades closed" help={H.paper.howClosed}>
                  <HowClosed sum={sum} />
                </Panel>
                <Panel title="P&L by entry time" help={H.paper.byHour}>
                  <ByHour sum={sum} />
                </Panel>
              </div>
            </div>
            <Ranking sum={sum} onEditStrategy={(id) => onEditStrategy(id)} onReset={onReset} resetting={reset.isPending} />
          </>
        )
      )}

      <Panel
        title="Open positions"
        help={H.paper.positions}
        flush
        aside={
          open.data?.length ? (
            <Tooltip content={H.paper.unrealized}>
              <span className="text-xs text-slate-400">
                {open.data.length} open · <span className={clsx('font-semibold tabular-nums', pnlClass(openPnl))}>{signedInr(Math.round(openPnl))}</span> open P&L
              </span>
            </Tooltip>
          ) : undefined
        }
      >
        {open.isLoading ? (
          <SkeletonRows rows={3} dense />
        ) : open.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={th}>Opened</th>
                  <th className={th}>Product · strategy</th>
                  <th className={th}>Contract</th>
                  <th className={th}>Side</th>
                  <Th help={{ title: 'Quantity', body: 'Lots × lot size (or shares for stocks).' }}>Qty</Th>
                  <Th help={{ title: 'Entry → last', body: 'Fill price (with slippage) and the latest price seen.' }}>Entry → last</Th>
                  <Th help={H.paper.range}>Stop → target</Th>
                  <Th help={H.paper.unrealized}>Open P&L</Th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                {open.data.map((t) => (
                  <tr key={t.id}>
                    <td className={clsx(td, 'text-slate-400')}>{istStampIso(t.entryAt)}</td>
                    <td className={td}>
                      <ProductCell t={t} strategy={names.get(t.strategyId)} />
                    </td>
                    <td className={td}>
                      <ContractCell t={t} />
                    </td>
                    <td className={td}>
                      <SideBadge side={t.side} />
                    </td>
                    <td className={clsx(td, 'tabular-nums')}>{qty(t)}</td>
                    <td className={clsx(td, 'tabular-nums')}>
                      <Tooltip content={H.paper.lastPrice}>
                        <span>
                          {inr(t.entryPrice)} → {t.lastPrice === null ? '—' : inr(t.lastPrice)} <span className="text-[10px] text-slate-500">{ago(t.lastPriceAt)}</span>
                        </span>
                      </Tooltip>
                    </td>
                    <td className={td}>
                      <Tooltip content={{ ...H.paper.range, note: `Stop ${t.stopPrice === null ? '—' : inr(t.stopPrice)} · entry ${inr(t.entryPrice)} · target ${t.targetPrice === null ? '—' : inr(t.targetPrice)}` }}>
                        <RangeBar t={t} />
                      </Tooltip>
                    </td>
                    <td className={clsx(td, 'tabular-nums font-semibold', pnlClass(t.openPnl))}>{t.openPnl === undefined ? '—' : signedInr(t.openPnl)}</td>
                    <td className={clsx(td, 'text-right')}>
                      <Tooltip content={H.paper.close}>
                        <button type="button" className="btn-ghost py-1 text-xs" disabled={close.isPending} onClick={() => close.mutate(t.id)}>
                          {close.isPending && close.variables === t.id ? <InlineSpinner className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />} Close
                        </button>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No open paper trades" hint="The next alert of a switched-on connection opens one." />
        )}
        {close.error && <p className="px-4 pb-3 text-xs text-bear">{(close.error as Error).message}</p>}
      </Panel>

      <Panel
        title="Trade log"
        help={H.paper.log}
        flush
        aside={
          <>
            <Segmented
              label="Show trades"
              value={logView}
              onChange={(v) => (setLogView(v), setLogRows(50))}
              options={[
                { value: 'all', label: `All (${log.data?.length ?? 0})`, help: H.paper.logFilter },
                { value: 'win', label: 'Winners', help: H.paper.logFilter },
                { value: 'loss', label: 'Losers', help: H.paper.logFilter },
              ]}
            />
            <IconButton
              help={H.paper.csv}
              disabled={!trades.length && !open.data?.length}
              onClick={() => download(`paper-trades-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([...(open.data ?? []), ...trades], names))}
              className="btn-ghost py-1 text-xs"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </IconButton>
          </>
        }
      >
        {log.isLoading ? (
          <SkeletonRows rows={4} dense />
        ) : trades.length ? (
          <TradeTable trades={trades} names={names} rows={logRows} onMore={() => setLogRows((n) => n + 50)} />
        ) : (
          <EmptyState title={logView === 'all' ? 'No closed paper trades in this period' : logView === 'win' ? 'No winning trades in this period' : 'No losing trades in this period'} />
        )}
      </Panel>
    </div>
  );
}
