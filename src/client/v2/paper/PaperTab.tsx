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
import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronRight, CloudOff, CloudUpload, Download, HardDrive, Pencil, RefreshCw, Trash2, Wallet, X } from 'lucide-react';
import clsx from 'clsx';
import type { LegKind, PaperBookStatus, PaperExitReason, PaperStats, PaperSummary, PaperTrade } from '@/shared/v2';
import { pageCursor, paperGroups, planSizing, resolveRules, stopNow, trailing, trailsPastTarget } from '@/shared/v2';
import { InfoTip, Tooltip, type TooltipContent } from '../../components/Tooltip';
import { ColumnHead, FilterSummary, NoMatchRow, useTable, type Column, type Table } from '../../components/table/ColumnFilters';
import { Badge, EmptyState, IconButton, StatCard } from '../../components/ui';
import { InlineSpinner, SkeletonRows, SkeletonStatGrid } from '../../components/loaders';
import { v2Api } from '../api';
import { InstrumentChip, Segmented } from '../components';
import { FilterBar, activeCount, toQuery, useFilters } from '../FilterBar';
import { LoadMore, flatPages } from '../LoadMore';
import { istStampIso } from '../format';
import { H } from '../help';
import { PnlBars, RangeBar, Sparkline } from './charts';
import { EquityChart } from './EquityChart';
import { inr, pct, pnlClass, signedInr } from './money';
import { PaperChip, PaperConnectionEditor, paperBrief } from './PaperFields';
import { TradeStoryPanel } from './TradeStory';

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

// ---- columns (sorting + filters) ----------------------------------------------------------------

const heldMinutes = (t: PaperTrade) => Math.max(0, Math.round((Date.parse(t.exitAt ?? new Date().toISOString()) - Date.parse(t.entryAt)) / 60_000));
const KIND_TEXT: Record<LegKind, string> = { FUT: 'Future', CE: 'Call (CE)', PE: 'Put (PE)', SPOT: 'Stock / spot' };
const sideText = (v: string) => (v === 'BUY' ? 'Buy' : v === 'SELL' ? 'Sell' : v);
const reasonText = (v: string) => H.paper.reasons[v as PaperExitReason]?.title ?? v;
const flags = (t: PaperTrade) => [...(t.overBudget ? ['Over budget'] : []), ...(t.marginEstimated ? ['≈ margin'] : [])];

/** The columns both trade tables share: product · group · strategy, the contract, side and size. */
function tradeColumns(names: Map<string, string>): Column<PaperTrade>[] {
  return [
    { key: 'opened', label: 'Opened', help: { title: 'Opened', body: 'When the trade was entered (IST).' }, type: 'datetime', value: (t) => t.entryAt },
    { key: 'closed', label: 'Closed', help: { title: 'Closed', body: 'When the trade was closed (IST).' }, type: 'datetime', value: (t) => t.exitAt },
    {
      key: 'product',
      label: 'Product · strategy',
      help: { title: 'Product · strategy', body: 'The product, the group that fired (e.g. Bullish) and the strategy — filter by any of them.' },
      fields: [
        { key: 'product', label: 'Product', type: 'enum', value: (t) => symbolOf(t.productId) },
        { key: 'group', label: 'Group', type: 'enum', value: (t) => t.groupLabel },
        { key: 'strategy', label: 'Strategy', type: 'enum', value: (t) => names.get(t.strategyId) ?? t.strategyId },
      ],
    },
    {
      key: 'contract',
      label: 'Contract',
      help: { title: 'Contract', body: 'The contract traded — filter by its symbol, type (future, call, put, stock), strike or expiry.' },
      fields: [
        { key: 'contract', label: 'Contract', type: 'text', value: (t) => t.instrument.symbol },
        { key: 'kind', label: 'Type', type: 'enum', value: (t) => t.instrument.kind, display: (v) => KIND_TEXT[v as LegKind] ?? v, order: ['FUT', 'CE', 'PE', 'SPOT'] },
        { key: 'strike', label: 'Strike', type: 'number', value: (t) => t.instrument.strike },
        { key: 'expiry', label: 'Expiry', type: 'date', value: (t) => t.instrument.expiry },
        { key: 'flags', label: 'Flags', type: 'enum', noSort: true, value: flags },
        { key: 'pricesFrom', label: 'Prices from', type: 'enum', noSort: true, value: pricesFrom },
      ],
    },
    { key: 'side', label: 'Side', help: { title: 'Side', body: 'Bought or sold (the strategy’s groups decide).' }, type: 'enum', value: (t) => t.side, display: sideText },
    {
      key: 'qty',
      label: 'Qty',
      help: { title: 'Quantity', body: 'Lots × lot size (or shares for stocks).' },
      fields: [
        { key: 'lots', label: 'Lots', type: 'number', value: (t) => t.lots },
        { key: 'quantity', label: 'Quantity (units)', type: 'number', value: (t) => t.quantity },
      ],
    },
  ];
}

/** Closed trades: the shared columns, then fills, why, held, charges, net P&L. */
function closedColumns(names: Map<string, string>): Column<PaperTrade>[] {
  return [
    ...tradeColumns(names),
    {
      key: 'prices',
      label: 'Entry → exit',
      help: { title: 'Entry → exit', body: 'Fill prices, including slippage (a target fills at its own price).' },
      fields: [
        { key: 'entry', label: 'Entry price', type: 'number', unit: '₹', value: (t) => t.entryPrice },
        { key: 'exit', label: 'Exit price', type: 'number', unit: '₹', value: (t) => t.exitPrice },
      ],
    },
    {
      key: 'why',
      label: 'Why',
      help: { title: 'Why it closed', body: 'Target, stop-loss, square-off, the other group firing, expiry, closed by hand or the end of a backtest — hover a badge for details.' },
      type: 'enum',
      value: (t) => t.exitReason,
      display: reasonText,
    },
    { key: 'held', label: 'Held', help: { title: 'Held', body: 'Time from entry to exit.', note: 'Filter in minutes (60 = an hour, 1440 = a day).' }, type: 'number', unit: 'min', value: heldMinutes },
    { key: 'charges', label: 'Charges', help: H.paper.charges, type: 'number', unit: '₹', value: (t) => t.charges ?? 0 },
    {
      key: 'net',
      label: 'Net P&L',
      help: H.paper.net,
      fields: [
        { key: 'net', label: 'Net P&L', type: 'number', unit: '₹', signed: true, value: (t) => t.netPnl ?? 0 },
        { key: 'gross', label: 'Gross P&L', type: 'number', unit: '₹', signed: true, value: (t) => t.grossPnl },
      ],
    },
  ];
}

/** Open positions: the shared columns, then entry → last, stop → target, open P&L. */
function openColumns(names: Map<string, string>): Column<PaperTrade>[] {
  return [
    ...tradeColumns(names),
    {
      key: 'prices',
      label: 'Entry → last',
      help: { title: 'Entry → last', body: 'Fill price (with slippage) and the latest price seen.' },
      fields: [
        { key: 'entry', label: 'Entry price', type: 'number', unit: '₹', value: (t) => t.entryPrice },
        { key: 'last', label: 'Last price', type: 'number', unit: '₹', value: (t) => t.lastPrice },
        { key: 'lastAt', label: 'Last price at', type: 'datetime', value: (t) => t.lastPriceAt },
      ],
    },
    {
      key: 'range',
      label: 'Stop → target',
      help: H.paper.range,
      fields: [
        { key: 'stop', label: 'Stop now', type: 'number', unit: '₹', value: (t) => stopNow(t)?.price },
        { key: 'stopKind', label: 'Stop type', type: 'enum', value: (t) => (stopNow(t)?.reason === 'TRAIL' ? 'Trailing' : stopNow(t) ? 'Fixed' : null) },
        { key: 'target', label: 'Target', type: 'number', unit: '₹', value: (t) => t.targetPrice },
      ],
    },
    { key: 'openPnl', label: 'Open P&L', help: H.paper.unrealized, type: 'number', unit: '₹', signed: true, value: (t) => t.openPnl },
  ];
}

/** Trades · won · profit factor · avg · net · return · drawdown — the columns StatCells draws, for any row with stats. */
export function statColumns<R>(stats: (r: R) => PaperStats): Column<R>[] {
  return [
    {
      key: 'trades',
      label: 'Trades',
      help: H.paper.trades,
      fields: [
        { key: 'trades', label: 'Closed trades', type: 'number', value: (r) => stats(r).trades },
        { key: 'open', label: 'Open trades', type: 'number', value: (r) => stats(r).open },
        {
          key: 'sample',
          label: 'Sample size',
          type: 'enum',
          noSort: true,
          order: ['No trades', `Few (under ${FEW_TRADES})`, `${FEW_TRADES} or more`],
          value: (r) => (!stats(r).trades ? 'No trades' : stats(r).trades < FEW_TRADES ? `Few (under ${FEW_TRADES})` : `${FEW_TRADES} or more`),
        },
      ],
    },
    { key: 'winRate', label: 'Won', help: H.paper.winRate, type: 'number', unit: '%', value: (r) => stats(r).winRate },
    // No losses = an infinite profit factor (sorts first, passes "≥ 1").
    { key: 'pf', label: 'Profit f.', help: H.paper.pf, type: 'number', value: (r) => stats(r).profitFactor ?? (stats(r).wins ? Infinity : null) },
    { key: 'avg', label: 'Avg / trade', help: H.paper.expectancy, type: 'number', unit: '₹', signed: true, value: (r) => stats(r).avgPnl },
    { key: 'net', label: 'Net P&L', help: H.paper.net, type: 'number', unit: '₹', signed: true, value: (r) => (stats(r).trades ? stats(r).netPnl : null) },
    { key: 'ret', label: 'Return', help: H.paper.ret, type: 'number', unit: '%', signed: true, value: (r) => stats(r).returnPct },
    { key: 'dd', label: 'Drawdown', help: H.paper.drawdown, type: 'number', unit: '₹', value: (r) => (stats(r).trades ? stats(r).maxDrawdown : null) },
  ];
}

/** The headers of StatCells. */
export function StatHeads<R>({ table }: { table: Table<R> }) {
  return (
    <>
      {['trades', 'winRate', 'pf', 'avg', 'net', 'ret', 'dd'].map((k) => (
        <ColumnHead key={k} table={table} k={k} className={th} />
      ))}
    </>
  );
}

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

/** Where a trade's contract prices came from: Upstox ids are `U:…` (a backtest's NSE / BSE contracts), the rest Kite. */
const pricesFrom = (t: PaperTrade) => (t.instrument.id.startsWith('U:') ? 'Upstox' : 'Kite');

function ContractCell({ t }: { t: PaperTrade }) {
  return (
    <div className="flex flex-col items-start gap-0.5 leading-tight">
      <span className="flex items-center gap-1">
        <InstrumentChip i={t.instrument} />
        {pricesFrom(t) === 'Upstox' && (
          <Tooltip content={H.backtest.upstoxPrices}>
            <span className="cursor-help rounded bg-ink-800 px-1 text-[9px] font-medium uppercase tracking-wide text-slate-500">Upstox</span>
          </Tooltip>
        )}
      </span>
      {(t.overBudget || t.marginEstimated) && (
        <div className="flex items-center gap-1.5">
          <TradeFlags t={t} />
        </div>
      )}
    </div>
  );
}

export function toCsv(trades: PaperTrade[], names: Map<string, string>): string {
  const head = ['entry_at', 'exit_at', 'strategy', 'product', 'group', 'contract', 'prices_from', 'side', 'lots', 'quantity', 'entry_price', 'exit_price', 'exit_reason', 'money_used', 'gross_pnl', 'charges', 'net_pnl', 'status'];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = trades.map((t) =>
    [t.entryAt, t.exitAt, names.get(t.strategyId) ?? t.strategyId, t.productId, t.groupLabel ?? '', t.instrument.symbol, pricesFrom(t), t.side, t.lots, t.quantity, t.entryPrice, t.exitPrice, t.exitReason, t.capitalUsed, t.grossPnl, t.charges, t.status === 'OPEN' ? t.openPnl : t.netPnl, t.status]
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
      <div className="ui-panel-head flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        <h3 className="ui-section-title text-sm font-semibold text-slate-200">{title}</h3>
        <InfoTip content={help} />
        {aside && <div className="ml-auto flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
      <div className={flush ? 'ui-panel-body-flush' : 'ui-panel-body px-4 pb-4'}>{children}</div>
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

/** The stop (fixed, or trailing with its % and best price), entry and target of an open trade, in words. */
function rangeNote(t: PaperTrade): string {
  const stop = stopNow(t);
  const stopText = stop === null ? 'Stop —' : stop.reason === 'TRAIL' ? `Trailing stop ${inr(stop.price)} (${t.terms.trailPct}% from the best ${inr(t.peakPrice ?? t.entryPrice)})` : `Stop ${inr(stop.price)}`;
  const target = t.targetPrice === null ? 'target —' : !trailsPastTarget(t) ? `target ${inr(t.targetPrice)}` : trailing(t) ? `target ${inr(t.targetPrice)} reached — trailing` : `target ${inr(t.targetPrice)} starts trailing`;
  return `${stopText} · entry ${inr(t.entryPrice)} · ${target}${t.conditions?.stopWhen ? ' · plus trailing rules' : ''}`;
}

const REASON_ORDER = ['TARGET', 'TARGET_RULE', 'STOP', 'TRAIL', 'STOP_RULE', 'SQUARE_OFF', 'OPPOSITE', 'EXPIRY', 'MANUAL', 'END'] as const;

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

const RANK_SORT = { key: 'net', desc: true };

type RankedConnection = PaperSummary['connections'][number];
type RankedStrategy = PaperSummary['strategies'][number];

const paperState = (p: { enabled: boolean; custom?: boolean }) => (!p.enabled ? 'Paper off' : p.custom ? 'On · own values' : 'On');

const CONNECTION_COLUMNS: Column<RankedConnection>[] = [
  {
    key: 'name',
    label: 'Product · strategy',
    help: { title: 'Product · strategy', body: 'The connection: product and the strategy it runs.' },
    fields: [
      { key: 'name', label: 'Product', type: 'enum', value: (c) => c.symbol },
      { key: 'strategy', label: 'Strategy', type: 'enum', value: (c) => c.strategyName },
      { key: 'switched', label: 'Connection', type: 'enum', noSort: true, value: (c) => (c.switchedOn ? 'Switched on' : 'Switched off') },
    ],
  },
  ...statColumns<RankedConnection>((c) => c.stats),
  { key: 'paper', label: 'Paper settings', help: H.paper.chip, type: 'enum', value: (c) => paperState(c.paper), order: ['On', 'On · own values', 'Paper off'] },
];

const STRATEGY_COLUMNS: Column<RankedStrategy>[] = [
  {
    key: 'name',
    label: 'Strategy',
    help: { title: 'Strategy', body: 'All of the strategy’s connections together.' },
    fields: [
      { key: 'name', label: 'Strategy', type: 'enum', value: (s) => s.name },
      { key: 'connections', label: 'Connections', type: 'number', value: (s) => s.connections },
    ],
  },
  ...statColumns<RankedStrategy>((s) => s.stats),
  { key: 'paper', label: 'Paper settings', help: H.paper.editPlan, type: 'enum', value: (s) => paperState(s), order: ['On', 'Paper off'] },
];

function Ranking({ sum, onEditStrategy, onReset, resetting }: { sum: PaperSummary; onEditStrategy: (id: string) => void; onReset: (id: string, name: string, n: number) => void; resetting: boolean }) {
  const [view, setView] = useState<'connections' | 'strategies'>('connections');
  const [editing, setEditing] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ['v2-paper-settings'], queryFn: v2Api.paperSettings, staleTime: 30_000 });
  const strategies = useQuery({ queryKey: ['v2-strategies'], queryFn: v2Api.strategies });
  const connT = useTable(sum.connections, CONNECTION_COLUMNS, { sort: RANK_SORT });
  const stratT = useTable(sum.strategies, STRATEGY_COLUMNS, { sort: RANK_SORT });
  const conns = connT.rows;
  const strats = stratT.rows;
  const defs = new Map(strategies.data?.map((s) => [s.id, s.definition]));
  const heads = <R,>(t: Table<R>) => (
    <tr>
      <th className={clsx(th, 'w-8')}>#</th>
      <ColumnHead table={t} k="name" className={th} />
      <Th help={H.paper.trend}>Trend</Th>
      <StatHeads table={t} />
      <ColumnHead table={t} k="paper" className={th} />
    </tr>
  );

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
      {view === 'connections' ? <FilterSummary table={connT} noun="connections" /> : <FilterSummary table={stratT} noun="strategies" />}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">{view === 'connections' ? heads(connT) : heads(stratT)}</thead>
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
                        <PaperChip enabled={c.paper.enabled} brief={paperBrief(c.paper, def ? planSizing(def, resolveRules(def, plan?.rules)) : undefined)} custom={c.paper.custom} onClick={() => setEditing(editing === c.connectionId ? null : c.connectionId)} active={editing === c.connectionId} />
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
                              sizing={planSizing(def, resolveRules(def, plan.rules))}
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
                            📄 {s.enabled && plan ? paperBrief(plan, defs.get(s.strategyId) ? planSizing(defs.get(s.strategyId)!, resolveRules(defs.get(s.strategyId)!, plan.rules)) : undefined) : 'paper off'}
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
            {view === 'connections' ? <NoMatchRow table={connT} colSpan={11} /> : <NoMatchRow table={stratT} colSpan={11} />}
          </tbody>
        </table>
      </div>
      {view === 'connections' && !connT.total && <EmptyState title="No switched-on connections" hint="Switch connections on in the Connections tab — each one paper trades its alerts automatically." />}
    </Panel>
  );
}

/** The arrow that opens a trade's story. */
export function StoryToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Tooltip content={H.paper.story}>
      <button type="button" aria-expanded={open} aria-label="Trade story" className="rounded p-0.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200" onClick={onClick}>
        <ChevronRight className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
      </button>
    </Tooltip>
  );
}

/** A row click that wasn't on a link or button inside it. */
const onRow = (toggle: () => void) => (e: MouseEvent) => {
  if (!(e.target as HTMLElement).closest('a,button,input')) toggle();
};

/**
 * Closed trades: when, product, contract, side, size, fills, why it closed, how long, charges, net P&L; a row opens
 * its story. Every column sorts and filters. Paging: `pageSize` shows the given trades a page at a time (all are
 * here, so the filters search all of them); `more` loads the next page from the server (the filters search the
 * pages loaded).
 */
export function TradeTable({
  trades,
  names,
  opened,
  pageSize,
  more,
}: {
  trades: PaperTrade[];
  names: Map<string, string>;
  opened?: boolean;
  pageSize?: number;
  more?: { hasMore: boolean; loading: boolean; onMore: () => void };
}) {
  const [story, setStory] = useState<string | null>(null);
  const [limit, setLimit] = useState(pageSize ?? Infinity);
  const toggle = (id: string) => () => setStory((cur) => (cur === id ? null : id));
  const columns = useMemo(() => closedColumns(names), [names]);
  const table = useTable(trades, columns, { partial: !!more?.hasMore });
  const rows = pageSize ? table.rows.slice(0, limit) : table.rows;
  const head = (k: string) => <ColumnHead table={table} k={k} className={th} />;
  return (
    <>
      <FilterSummary table={table} noun="trades" />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className={clsx(th, 'w-6 pr-0')}>
                <span className="sr-only">Story</span>
              </th>
              {opened && head('opened')}
              {head('closed')}
              {head('product')}
              {head('contract')}
              {head('side')}
              {head('qty')}
              {head('prices')}
              {head('why')}
              {head('held')}
              {head('charges')}
              {head('net')}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/50">
            <NoMatchRow table={table} colSpan={opened ? 12 : 11} />
            {rows.map((t) => (
              <Fragment key={t.id}>
                <tr className={clsx('cursor-pointer hover:bg-ink-850/50', story === t.id && 'bg-ink-850/60')} onClick={onRow(toggle(t.id))}>
                  <td className={clsx(td, 'w-6 pr-0')}>
                    <StoryToggle open={story === t.id} onClick={toggle(t.id)} />
                  </td>
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
                {story === t.id && (
                  <tr>
                    <td colSpan={opened ? 12 : 11} className="p-0">
                      <TradeStoryPanel t={t} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize ? (
        <LoadMore hasMore={table.rows.length > limit} loading={false} onMore={() => setLimit((n) => n + pageSize)} shown={Math.min(limit, table.rows.length)} noun="trades" help={H.paper.more} />
      ) : (
        more && <LoadMore hasMore={more.hasMore} loading={more.loading} onMore={more.onMore} shown={trades.length} noun="trades" help={H.paper.more} auto={!table.active} />
      )}
    </>
  );
}

// ---- the tab ---------------------------------------------------------------------------------

/** Trade-log rows per page (the next page loads as you scroll). */
const LOG_PAGE = 50;
const count = (n: number | undefined) => (n === undefined ? '' : ` (${n.toLocaleString('en-IN')})`);

/** Where the paper trades stand: on this computer until the next close, synced, or a sync waiting for the database. */
function SyncChip({ s }: { s: PaperBookStatus }) {
  const waiting = s.waiting + s.pricesWaiting;
  const when = (iso: string | null) => (iso ? istStampIso(iso) : '');
  const [icon, text, tone] = s.lastError
    ? [<CloudOff key="i" className="h-3.5 w-3.5" />, `Database sync waiting — the database can’t be reached; ${s.waiting} trade(s) safe on this computer`, 'text-warn']
    : waiting
      ? [<HardDrive key="i" className="h-3.5 w-3.5" />, `${s.waiting} trade(s) saved on this computer · to the database after the close${s.nextSyncAt ? ` (${when(s.nextSyncAt)})` : ''}`, 'text-slate-400']
      : [<CloudUpload key="i" className="h-3.5 w-3.5" />, s.lastSyncAt ? `Synced with the database · ${when(s.lastSyncAt)}` : 'Nothing waiting for the database', 'text-slate-500'];
  return (
    <Tooltip content={{ ...H.paper.sync, example: s.lastSyncAt ? `Last sync: ${when(s.lastSyncAt)}` : undefined }}>
      <span tabIndex={0} className={clsx('inline-flex items-center gap-1.5 text-[11px] outline-none', tone)}>
        {icon}
        {text}
      </span>
    </Tooltip>
  );
}

export function PaperTab({ initialStrategyId, onEditStrategy }: { initialStrategyId?: string; onEditStrategy: (strategyId?: string) => void }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useFilters('paper', { strategyIds: initialStrategyId ? [initialStrategyId] : undefined });
  const [logView, setLogView] = useState<'all' | 'win' | 'loss'>('all');
  const [openStory, setOpenStory] = useState<string | null>(null);
  const toggleOpen = (id: string) => () => setOpenStory((cur) => (cur === id ? null : id));
  const strategies = useQuery({ queryKey: ['v2-strategies'], queryFn: v2Api.strategies });
  const { sources: _s, statuses: _st, outcomes: _o, ...q } = toQuery(filters, strategies.data ?? []);
  const { from: _from, to: _to, ...qOpen } = q; // open positions: every period
  const ready = !filters.groups.length || !!strategies.data;
  // Trades per strategy under the other filters (the strategy chips' numbers).
  const { strategyIds: _chosen, ...qAll } = q;
  const counts = useQuery({ queryKey: ['v2-paper', 'counts', qAll], queryFn: () => v2Api.paperCounts(qAll), enabled: ready, placeholderData: keepPreviousData, refetchInterval: 60_000 });
  const summary = useQuery({ queryKey: ['v2-paper', 'summary', q], queryFn: () => v2Api.paperSummary(q), refetchInterval: 60_000, enabled: ready, placeholderData: keepPreviousData });
  const open = useQuery({ queryKey: ['v2-paper', 'open', qOpen], queryFn: () => v2Api.paperTrades({ ...qOpen, status: 'OPEN', limit: 500 }), refetchInterval: 5_000, enabled: ready, placeholderData: keepPreviousData });
  const sync = useQuery({ queryKey: ['v2-paper', 'sync'], queryFn: v2Api.paperSync, refetchInterval: 60_000 });
  // The trade log a page at a time; every filter (and winners / losers) is applied by the server.
  const result = logView === 'all' ? undefined : logView;
  const log = useInfiniteQuery({
    queryKey: ['v2-paper', 'log', q, result],
    queryFn: ({ pageParam }) => v2Api.paperTrades({ ...q, status: 'CLOSED', result, limit: LOG_PAGE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.length < LOG_PAGE ? undefined : pageCursor(page[page.length - 1]!.entryAt, page[page.length - 1]!.id)),
    refetchInterval: 120_000,
    enabled: ready,
    placeholderData: keepPreviousData,
  });
  // CSV: every matching trade, not just the pages loaded.
  const csv = useMutation({
    mutationFn: async () => {
      const closed = await v2Api.paperTrades({ ...q, status: 'CLOSED', result, limit: 50_000 });
      download(`paper-trades-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([...(open.data ?? []), ...closed], names));
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['v2-paper'] });
  const close = useMutation({ mutationFn: (id: string) => v2Api.closePaperTrade(id), onSettled: refresh });
  const reset = useMutation({ mutationFn: (id: string) => v2Api.resetPaper(id), onSettled: refresh });
  const names = useMemo(() => new Map((strategies.data ?? []).map((s) => [s.id, s.name])), [strategies.data]);
  const openCols = useMemo(() => openColumns(names), [names]);
  const openT = useTable(open.data, openCols);
  const sum = summary.data;
  const openPnl = (open.data ?? []).reduce((a, t) => a + (t.openPnl ?? 0), 0);
  const trades = useMemo(() => flatPages(log.data?.pages), [log.data]);
  const switchedOn = sum?.connections.filter((c) => c.switchedOn) ?? [];
  const onReset = (id: string, name: string, n: number) => {
    if (window.confirm(`Delete all ${n} paper trade(s) of “${name}” (open ones too)? The settings stay. This cannot be undone.`)) reset.mutate(id);
  };

  return (
    <div className="flex flex-col gap-4">
      <FilterBar value={filters} onChange={setFilters} strategies={strategies.data ?? []} counts={counts.data?.counts} countNoun="paper trades" fields={['sides']} shown={sum ? `${sum.overall.trades} closed · ${sum.overall.open} open trade(s)${activeCount(filters, ['sides']) ? ' match' : ''}` : undefined} />
      <div className="flex flex-wrap items-center gap-3">
        <IconButton help={H.paper.refresh} onClick={refresh} className="btn-ghost py-1.5 text-xs">
          <RefreshCw className={clsx('w-3.5 h-3.5', (summary.isFetching || open.isFetching) && 'animate-spin')} /> Refresh
        </IconButton>
        {sync.data && <SyncChip s={sync.data} />}
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
          <>
          <FilterSummary table={openT} noun="open trades" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-ink-850 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className={clsx(th, 'w-6 pr-0')}>
                    <span className="sr-only">Story</span>
                  </th>
                  {(['opened', 'product', 'contract', 'side', 'qty', 'prices', 'range', 'openPnl'] as const).map((k) => (
                    <ColumnHead key={k} table={openT} k={k} className={th} />
                  ))}
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/50">
                <NoMatchRow table={openT} colSpan={10} />
                {openT.rows.map((t) => (
                  <Fragment key={t.id}>
                    <tr className={clsx('cursor-pointer hover:bg-ink-850/50', openStory === t.id && 'bg-ink-850/60')} onClick={onRow(toggleOpen(t.id))}>
                      <td className={clsx(td, 'w-6 pr-0')}>
                        <StoryToggle open={openStory === t.id} onClick={toggleOpen(t.id)} />
                      </td>
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
                        <Tooltip content={{ ...H.paper.range, note: rangeNote(t) }}>
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
                    {openStory === t.id && (
                      <tr>
                        <td colSpan={10} className="p-0">
                          <TradeStoryPanel t={t} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          </>
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
              onChange={setLogView}
              options={[
                { value: 'all', label: `All${count(sum?.overall.trades)}`, help: H.paper.logFilter },
                { value: 'win', label: `Winners${count(sum?.overall.wins)}`, help: H.paper.logFilter },
                { value: 'loss', label: `Losers${count(sum?.overall.losses)}`, help: H.paper.logFilter },
              ]}
            />
            <IconButton
              help={H.paper.csv}
              disabled={(!trades.length && !open.data?.length) || csv.isPending}
              onClick={() => csv.mutate()}
              className="btn-ghost py-1 text-xs"
            >
              {csv.isPending ? <InlineSpinner className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />} CSV
            </IconButton>
          </>
        }
      >
        {log.isLoading ? (
          <SkeletonRows rows={4} dense />
        ) : trades.length ? (
          <TradeTable trades={trades} names={names} more={{ hasMore: !!log.hasNextPage, loading: log.isFetchingNextPage, onMore: () => void log.fetchNextPage() }} />
        ) : (
          <EmptyState title={logView === 'all' ? 'No closed paper trades in this period' : logView === 'win' ? 'No winning trades in this period' : 'No losing trades in this period'} />
        )}
      </Panel>
    </div>
  );
}
