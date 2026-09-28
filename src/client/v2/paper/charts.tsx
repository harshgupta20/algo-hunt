'use client';

/**
 * Small charts for paper-trading decisions. Profit / loss bars grow up or down from a zero line
 * (position carries the sign, so colour is never the only cue), ≤ 24 px thick with a 4 px rounded end,
 * a per-bar hover tooltip, recessive gridlines. Colours: --chart-up / --chart-down (validated for
 * colour-blind separation on both themes).
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import clsx from 'clsx';
import type { PaperTrade } from '@/shared/v2';
import { compact, niceTicks } from './EquityChart';
import { inr } from './money';

function useWidth(ref: RefObject<HTMLDivElement | null>, min = 240): number {
  const [w, setW] = useState(480);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min]);
  return w;
}

export interface BarItem {
  key: string;
  /** Axis label under the bar. */
  label: string;
  pnl: number;
  /** Tooltip lines. */
  lines: string[];
}

const upDown = (v: number) => (v >= 0 ? 'rgb(var(--chart-up))' : 'rgb(var(--chart-down))');

/** A bar from the zero line to `y`, its far end rounded (4 px), square at the baseline. */
function barPath(x: number, w: number, zeroY: number, y: number): string {
  const h = Math.abs(y - zeroY);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return `M${x},${zeroY - 0.5}h${w}v1h${-w}Z`;
  if (y < zeroY) return `M${x},${zeroY}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${zeroY}Z`;
  return `M${x},${zeroY}V${y - r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y - r}V${zeroY}Z`;
}

/** Profit / loss per bucket (day, hour …). */
export function PnlBars({ items, height = 180, ariaLabel }: { items: BarItem[]; height?: number; ariaLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [hover, setHover] = useState<number | null>(null);
  const PAD = { top: 12, right: 8, bottom: 22, left: 52 };
  const ticks = niceTicks(Math.min(0, ...items.map((i) => i.pnl)), Math.max(0, ...items.map((i) => i.pnl)));
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const band = plotW / Math.max(1, items.length);
  const barW = Math.max(3, Math.min(24, band - 4));
  const every = Math.max(1, Math.ceil(items.length / Math.max(1, Math.floor(plotW / 44))));
  const h = hover !== null ? items[hover] : null;
  const tipLeft = hover !== null ? Math.min(width - 180, Math.max(0, PAD.left + hover * band + band / 2 - 90)) : 0;
  return (
    <div ref={box} className="relative w-full select-none">
      <svg role="img" aria-label={ariaLabel} width={width} height={height} viewBox={`0 0 ${width} ${height}`} onPointerLeave={() => setHover(null)} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="rgb(var(--ink-700))" strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
              {compact(t)}
            </text>
          </g>
        ))}
        {items.map((it, i) => {
          const x = PAD.left + i * band + (band - barW) / 2;
          return (
            <g key={it.key}>
              <path d={barPath(x, barW, y(0), y(it.pnl))} fill={upDown(it.pnl)} opacity={hover === null || hover === i ? 1 : 0.45} />
              {i % every === 0 && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="fill-slate-500 text-[10px] tabular-nums">
                  {it.label}
                </text>
              )}
              {/* Hit target: the whole column, bigger than the bar. */}
              <rect x={PAD.left + i * band} y={PAD.top} width={band} height={plotH} fill="transparent" onPointerEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 z-10 w-[180px] rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs shadow-lg" style={{ left: tipLeft }}>
          <p className="font-semibold text-fg tabular-nums">
            {h.label} · {h.pnl >= 0 ? '+' : '−'}
            {inr(Math.abs(h.pnl))}
          </p>
          {h.lines.map((l) => (
            <p key={l} className="text-slate-400">
              {l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Cumulative net P&L in a cell: a 2 px line in the neutral ink, the end dot shows the sign. */
export function Sparkline({ points, width = 84, height = 26 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="text-[10px] text-slate-600">—</span>;
  const all = [0, ...points];
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const x = (i: number) => 2 + (i / (all.length - 1)) * (width - 6);
  const y = (v: number) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (height - 6);
  const last = all.at(-1)!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block">
      <line x1={2} x2={width - 4} y1={y(0)} y2={y(0)} stroke="rgb(var(--ink-700))" strokeWidth={1} />
      <path d={all.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')} fill="none" stroke="rgb(var(--slate-500))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(all.length - 1)} cy={y(last)} r={3} fill={upDown(last)} stroke="rgb(var(--ink-900))" strokeWidth={1.5} />
    </svg>
  );
}

/** Where the last price sits between stop-loss (left) and target (right); a tick marks the entry. */
export function RangeBar({ t }: { t: PaperTrade }) {
  if (t.lastPrice === null || t.stopPrice === null || t.targetPrice === null) return <span className="text-[10px] text-slate-500">no stop / target</span>;
  const buy = t.side === 'BUY';
  // Progress from the stop (0) to the target (1), whichever side the trade is on.
  const at = (p: number) => Math.min(1, Math.max(0, (p - t.stopPrice!) / (t.targetPrice! - t.stopPrice!)));
  const pos = at(t.lastPrice);
  const entry = at(t.entryPrice);
  const good = buy ? t.lastPrice >= t.entryPrice : t.lastPrice <= t.entryPrice;
  return (
    <div className="w-28">
      <div className="relative h-1.5 rounded-full bg-ink-700">
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-slate-400" style={{ left: `${entry * 100}%` }} />
        <div
          className={clsx('absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[rgb(var(--ink-900))]')}
          style={{ left: `${pos * 100}%`, background: good ? 'rgb(var(--chart-up))' : 'rgb(var(--chart-down))' }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-slate-500 tabular-nums">
        <span>stop</span>
        <span>{Math.round(pos * 100)}%</span>
        <span>target</span>
      </div>
    </div>
  );
}
