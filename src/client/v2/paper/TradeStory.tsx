'use client';

/**
 * A trade's story, opened from any trade row (paper trading and both backtests): the price path with the entry, the
 * target and the stop as it moved (the fixed stop-loss, then the trailing stop), and a timeline in words — when it
 * opened, when the target started trailing, each time the trailing stop rose, why it closed, its best and worst price
 * and what the price did after. Backtest trades carry their path; a paper trade's path is read from Kite.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, LogIn, LogOut, ShieldAlert, Target } from 'lucide-react';
import clsx from 'clsx';
import type { PaperTrade, TradePath, TradeStory as Story } from '@/shared/v2';
import { nodeText, tradeStory, trailsPastTarget } from '@/shared/v2';
import { Tooltip, type TooltipContent } from '../../components/Tooltip';
import { InlineSpinner } from '../../components/loaders';
import { v2Api } from '../api';
import { istClock, istStampMs } from '../format';
import { H } from '../help';
import { useWidth } from './charts';
import { niceTicks } from './EquityChart';
import { inr, signedInr } from './money';

const price = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const minutes = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const isBacktest = (t: PaperTrade) => t.connectionId.startsWith('backtest:');

// ---- the chart ---------------------------------------------------------------------------------

const UP = 'rgb(var(--chart-up))';
const DOWN = 'rgb(var(--chart-down))';
const STOP = 'rgb(var(--warn))';
const LEVEL = 'rgb(var(--slate-500))';

/** Labels on the right edge, pushed apart so they never overlap. */
function spread(labels: Array<{ key: string; y: number; text: string; color: string }>, top: number, bottom: number) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) sorted[i]!.y = Math.max(sorted[i]!.y, sorted[i - 1]!.y + 12);
  const over = (sorted.at(-1)?.y ?? 0) - bottom;
  if (over > 0) for (const l of sorted) l.y = Math.max(top, l.y - over);
  return sorted;
}

function PathChart({ t, story }: { t: PaperTrade; story: Story }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 280);
  const [hover, setHover] = useState<number | null>(null);
  const height = 230;
  const PAD = { top: 10, right: 92, bottom: 22, left: 52 };
  const { bars } = story;
  const held = bars.filter((b) => !b.after).length;
  const stops = bars.slice(0, held).flatMap((b) => (b.stop ? [b.stop.price] : []));
  const values = [...bars.flatMap((b) => [b.low, b.high]), t.entryPrice, ...stops, ...(t.targetPrice !== null ? [t.targetPrice] : []), ...(t.exitPrice !== null ? [t.exitPrice] : [])];
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, bars.length);
  const x = (i: number) => PAD.left + i * band;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const body = Math.max(1.5, Math.min(10, band * 0.62));

  // The stop as a step line over the bars the trade was held.
  let stopPath = '';
  let pen = false;
  bars.slice(0, held).forEach((b, i) => {
    if (!b.stop) {
      pen = false;
      return;
    }
    stopPath += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.stop.price).toFixed(1)}H${x(i + 1).toFixed(1)}`;
    pen = true;
  });
  const lastStop = bars[held - 1]?.stop ?? null;
  const labels = spread(
    [
      {
        key: 'entry',
        y: y(t.entryPrice),
        text: `entry ${price(t.entryPrice)}`,
        color: LEVEL,
      },
      ...(t.targetPrice !== null
        ? [
            {
              key: 'target',
              y: y(t.targetPrice),
              text: `target ${price(t.targetPrice)}`,
              color: LEVEL,
            },
          ]
        : []),
      ...(lastStop
        ? [
            {
              key: 'stop',
              y: y(lastStop.price),
              text: `${lastStop.reason === 'TRAIL' ? 'trail' : 'stop'} ${price(lastStop.price)}`,
              color: STOP,
            },
          ]
        : []),
    ],
    PAD.top + 4,
    height - PAD.bottom,
  );
  // Time labels: about one every 70 px, with the date where the day changes.
  const every = Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor(plotW / 70))));
  const day = (ms: number) => istStampMs(ms).slice(0, 6);
  const h = hover !== null ? bars[hover] : null;
  const tipLeft = hover !== null ? Math.min(width - 190, Math.max(0, x(hover) + band / 2 - 95)) : 0;
  const exitX = x(held);

  return (
    <div ref={box} className="relative w-full select-none">
      <svg
        role="img"
        aria-label={`Price of ${t.instrument.symbol} while the trade was held, with its stop and target`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerLeave={() => setHover(null)}
        className="block"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="rgb(var(--ink-700))" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
              {price(v)}
            </text>
          </g>
        ))}
        {bars.length > held && (
          <g>
            <rect x={exitX} y={PAD.top} width={width - PAD.right - exitX} height={plotH} fill="rgb(var(--ink-850))" opacity={0.6} />
            <line x1={exitX} x2={exitX} y1={PAD.top} y2={PAD.top + plotH} stroke={LEVEL} strokeDasharray="2 3" />
            <text x={exitX + 4} y={PAD.top + 10} className="fill-slate-500 text-[10px]">
              after the exit
            </text>
          </g>
        )}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(t.entryPrice)} y2={y(t.entryPrice)} stroke={LEVEL} strokeDasharray="4 3" />
        {t.targetPrice !== null && <line x1={PAD.left} x2={width - PAD.right} y1={y(t.targetPrice)} y2={y(t.targetPrice)} stroke={LEVEL} strokeDasharray="1 3" strokeWidth={1.5} />}
        {bars.map((b, i) => {
          const cx = x(i) + band / 2;
          const color = b.close >= b.open ? UP : DOWN;
          const top = y(Math.max(b.open, b.close));
          return (
            <g key={b.at} opacity={b.after ? 0.4 : hover === null || hover === i ? 1 : 0.7}>
              <line x1={cx} x2={cx} y1={y(b.high)} y2={y(b.low)} stroke={color} strokeWidth={1} />
              <rect x={cx - body / 2} y={top} width={body} height={Math.max(1, y(Math.min(b.open, b.close)) - top)} fill={color} />
            </g>
          );
        })}
        {stopPath && <path d={stopPath} fill="none" stroke={STOP} strokeWidth={2} strokeLinejoin="round" />}
        {story.trailingFrom && t.targetPrice !== null && (
          <path d={`M${x(story.trailingFrom.bar) + band / 2},${y(t.targetPrice) - 7}l5,7l-5,7l-5,-7Z`} fill={STOP} stroke="rgb(var(--ink-900))" strokeWidth={1} />
        )}
        <circle cx={x(0)} cy={y(t.entryPrice)} r={4} fill="rgb(var(--slate-300))" stroke="rgb(var(--ink-900))" strokeWidth={1.5} />
        {t.exitPrice !== null && <circle cx={exitX} cy={y(t.exitPrice)} r={4.5} fill={(t.netPnl ?? 0) >= 0 ? UP : DOWN} stroke="rgb(var(--ink-900))" strokeWidth={1.5} />}
        {labels.map((l) => (
          <text key={l.key} x={width - PAD.right + 6} y={l.y} dy="0.32em" className="text-[10px] tabular-nums" fill={l.color}>
            {l.text}
          </text>
        ))}
        {bars.map((b, i) =>
          i % every === 0 ? (
            <text key={`t${b.at}`} x={x(i) + band / 2} y={height - 6} textAnchor="middle" className="fill-slate-500 text-[10px] tabular-nums">
              {i === 0 || day(b.at) !== day(bars[i - every]!.at) ? `${day(b.at)} ${istClock(b.at / 1000)}` : istClock(b.at / 1000)}
            </text>
          ) : null,
        )}
        {bars.map((b, i) => (
          <rect key={`h${b.at}`} x={x(i)} y={PAD.top} width={band} height={plotH} fill="transparent" onPointerEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 z-10 w-[190px] rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs shadow-lg" style={{ left: tipLeft }}>
          <p className="font-semibold text-fg tabular-nums">
            {istStampMs(h.at)}
            {h.after ? ' · after the exit' : ''}
          </p>
          <p className="text-slate-400 tabular-nums">
            O {price(h.open)} · H {price(h.high)}
          </p>
          <p className="text-slate-400 tabular-nums">
            L {price(h.low)} · C {price(h.close)}
          </p>
          {!h.after && <p className="text-warn tabular-nums">{h.stop ? `${h.stop.reason === 'TRAIL' ? 'Trailing stop' : 'Stop-loss'} ${inr(h.stop.price)}` : 'No stop'}</p>}
        </div>
      )}
    </div>
  );
}

// ---- the timeline ------------------------------------------------------------------------------

type Item = {
  key: string;
  at: number;
  icon: ReactNode;
  title: string;
  detail?: string;
  tone?: string;
};

const ICON = 'h-3.5 w-3.5';

/** Why it closed, in words. */
function exitText(t: PaperTrade, story: Story | null): string {
  const buy = t.side === 'BUY';
  switch (t.exitReason) {
    case 'TARGET':
      return `Reached the target ${inr(t.targetPrice ?? t.exitPrice!)} — no trailing was set, so the target closed it.`;
    case 'STOP':
      return `The price ${buy ? 'fell' : 'rose'} to the stop-loss ${inr(t.stopPrice ?? t.exitPrice!)}.`;
    case 'TRAIL': {
      const stop = story?.finalStop?.price ?? t.exitPrice!;
      return `The price came back to the trailing stop ${inr(stop)} — ${t.terms.trailPct}% from the best ${inr(t.peakPrice ?? t.entryPrice)}.`;
    }
    case 'STOP_RULE':
      return t.conditions?.stopWhen ? `A trailing rule came true at the candle close: ${nodeText(t.conditions.stopWhen, t.conditions.legDefs)}.` : 'A trailing rule came true at the candle close.';
    default:
      return t.exitReason ? H.paper.reasons[t.exitReason].body : '';
  }
}

function timeline(t: PaperTrade, story: Story | null): Item[] {
  const buy = t.side === 'BUY';
  const qty = t.lotSize > 1 ? `${t.lots} × ${t.lotSize}` : `${t.quantity}`;
  const trails = trailsPastTarget(t);
  const levels = [
    t.stopPrice !== null ? `stop-loss ${inr(t.stopPrice)} (${t.terms.stopPct}%)` : 'no stop-loss',
    t.targetPrice !== null ? `target ${inr(t.targetPrice)} (${t.terms.targetPct}%)${trails ? ' — starts trailing' : ''}` : 'no target',
    t.terms.trailPct != null ? `trailing ${t.terms.trailPct}%${t.targetPrice !== null ? ' from the target' : ''}` : null,
    t.conditions?.stopWhen ? `trailing rules: ${nodeText(t.conditions.stopWhen, t.conditions.legDefs)}` : null,
  ].filter(Boolean);
  const items: Item[] = [
    {
      key: 'open',
      at: Date.parse(t.entryAt),
      icon: <LogIn className={ICON} />,
      title: `${buy ? 'Bought' : 'Sold'} ${qty} at ${inr(t.entryPrice)}`,
      detail: `${t.entryRef !== t.entryPrice ? `Alert price ${inr(t.entryRef)} + ${t.terms.slippagePct}% slippage. ` : ''}${levels.join(' · ')}.`,
    },
  ];
  const from = story?.trailingFrom?.at ?? (t.trailingAt ? Date.parse(t.trailingAt) : null);
  if (from !== null && t.targetPrice !== null)
    items.push({
      key: 'trail-on',
      at: from,
      icon: <Target className={ICON} />,
      title: `Reached the target ${inr(t.targetPrice)} — trailing started`,
      detail: `The trade kept running: from here the ${t.terms.trailPct != null ? `${t.terms.trailPct}% trailing stop${t.conditions?.stopWhen ? ' and the trailing rules' : ''}` : 'trailing rules'} close it — the stop-loss and target no longer apply.`,
      tone: 'text-warn',
    });
  for (const m of story?.moves ?? []) {
    const takeover = m.to.reason === 'TRAIL' && m.from?.reason === 'STOP';
    items.push({
      key: `move${m.bar}`,
      at: m.at,
      icon: <ShieldAlert className={ICON} />,
      title: takeover
        ? `Trailing stop took over: ${inr(m.to.price)}`
        : m.to.reason === 'TRAIL' && m.from?.reason === 'TRAIL'
          ? `Trailing stop raised to ${inr(m.to.price)}`
          : `Stop now ${inr(m.to.price)}`,
      detail: `Best price ${inr(m.best)}${takeover && m.from ? ` — replaces the stop-loss ${inr(m.from.price)}` : m.from ? ` (was ${inr(m.from.price)})` : ''}`,
    });
  }
  if (t.exitAt && t.exitPrice !== null)
    items.push({
      key: 'close',
      at: Date.parse(t.exitAt),
      icon: <LogOut className={ICON} />,
      title: `Closed at ${inr(t.exitPrice)} · ${t.exitReason ? H.paper.reasons[t.exitReason].title : ''}`,
      detail: `${exitText(t, story)} Net P&L ${signedInr(t.netPnl ?? 0)} after ${inr(t.charges ?? 0)} charges.`,
      tone: (t.netPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear',
    });
  if (story?.after && t.exitAt)
    items.push({
      key: 'after',
      at: Date.parse(t.exitAt) + 1,
      icon: <Eye className={ICON} />,
      title: `The next ${minutes(story.after.minutes)} after the exit`,
      detail: `High ${inr(story.after.high)}, low ${inr(story.after.low)}, last ${inr(story.after.close)} — for context only.`,
    });
  // The target before a stop move at the same moment (it is what started the trailing).
  return items.sort((a, b) => a.at - b.at || (a.key === 'trail-on' ? -1 : b.key === 'trail-on' ? 1 : 0));
}

/** Long runs of trailing-stop raises: the first and last two, the rest behind a button. */
function Timeline({ items }: { items: Item[] }) {
  const [all, setAll] = useState(false);
  const moves = items.filter((i) => i.key.startsWith('move'));
  const hidden = !all && moves.length > 5 ? new Set(moves.slice(2, -2).map((m) => m.key)) : new Set<string>();
  let shown = false;
  return (
    <ol className="flex flex-col gap-2.5">
      {items.map((it) => {
        if (hidden.has(it.key)) {
          if (shown) return null;
          shown = true;
          return (
            <li key="more" className="pl-6">
              <Tooltip content={H.paper.storyMore}>
                <button type="button" className="btn-ghost py-0.5 text-[11px]" onClick={() => setAll(true)}>
                  {hidden.size} more trailing stop raises…
                </button>
              </Tooltip>
            </li>
          );
        }
        return (
          <li key={it.key} className="flex gap-2">
            <span className={clsx('mt-0.5 shrink-0 text-slate-500', it.tone)}>{it.icon}</span>
            <div className="min-w-0">
              <p className="text-xs">
                <span className="tabular-nums text-slate-500">{istStampMs(it.at)}</span> <span className={clsx('font-medium text-slate-200', it.tone)}>{it.title}</span>
              </p>
              {it.detail && <p className="text-[11px] text-slate-400">{it.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Fact({ label, value, tone, help }: { label: string; value: string; tone?: string; help: TooltipContent }) {
  return (
    <Tooltip content={help}>
      <span tabIndex={0} className="inline-flex flex-col rounded-md border border-ink-700 bg-ink-950/40 px-2.5 py-1 outline-none">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
        <span className={clsx('text-xs font-semibold tabular-nums text-slate-200', tone)}>{value}</span>
      </span>
    </Tooltip>
  );
}

// ---- the panel ---------------------------------------------------------------------------------

/** The story of one trade: its path (from the trade, or from Kite for a paper trade) and the timeline. */
export function TradeStoryPanel({ t }: { t: PaperTrade }) {
  const own = isBacktest(t) || !!t.path;
  const kite = useQuery({
    // An open trade's path grows: read again once a minute (Kite's 1-minute candles), not on every price.
    queryKey: ['v2-paper-path', t.id, t.status],
    queryFn: () => v2Api.paperTradePath(t.id),
    enabled: !own,
    staleTime: t.status === 'OPEN' ? 60_000 : Infinity,
    refetchInterval: t.status === 'OPEN' ? 60_000 : false,
    retry: false,
  });
  const path: TradePath | null | undefined = own ? (t.path ?? null) : kite.data;
  const story = path ? tradeStory(t, path) : null;
  const items = timeline(t, story);
  const gross = t.status === 'CLOSED' ? (t.grossPnl ?? 0) : null;

  return (
    <div className="flex flex-col gap-3 bg-ink-950/40 px-4 py-3">
      {story && (
        <div className="flex flex-wrap gap-2">
          {story.best && <Fact label="Best price" value={`${inr(story.best.price)} (${signedInr(story.best.pnl)})`} help={H.paper.storyBest} />}
          {story.worst && <Fact label="Worst price" value={`${inr(story.worst.price)} (${signedInr(story.worst.pnl)})`} help={H.paper.storyWorst} />}
          {story.best && story.best.pnl > 0 && gross !== null && <Fact label="Given back" value={inr(Math.max(0, story.best.pnl - gross))} help={H.paper.storyGiven} />}
          {story.finalStop && (
            <Fact
              label={t.status === 'OPEN' ? 'Stop now' : 'Stop at the exit'}
              value={`${inr(story.finalStop.price)} · ${story.finalStop.reason === 'TRAIL' ? 'trailing' : 'stop-loss'}`}
              tone="text-warn"
              help={H.paper.storyStop}
            />
          )}
          <Fact label="Each bar" value={minutes(path!.step)} help={H.paper.storyBars} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {story ? (
            <PathChart t={t} story={story} />
          ) : kite.isLoading ? (
            <p className="flex items-center gap-2 py-8 text-xs text-slate-400">
              <InlineSpinner /> Reading {t.instrument.symbol}’s 1-minute candles from Kite…
            </p>
          ) : (
            <p className="py-8 text-xs text-slate-500">
              {kite.error
                ? (kite.error as Error).message
                : own
                  ? 'No 1-minute candles were recorded for this trade.'
                  : `Kite has no 1-minute candles for ${t.instrument.symbol} — it doesn’t keep expired contracts. The timeline is from the trade itself.`}
            </p>
          )}
        </div>
        <Timeline items={items} />
      </div>
    </div>
  );
}
