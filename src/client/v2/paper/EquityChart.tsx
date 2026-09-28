'use client';

/**
 * Cumulative net P&L after each closed paper trade (one series): a 2px line with a 10 % wash to the
 * zero line, an end dot + end value, recessive gridlines, and a crosshair that snaps to the nearest
 * trade with a tooltip. The trade log below is its table view.
 */
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { istStampIso } from '../format';
import { signedInr } from './money';

const DEFAULT_H = 200;
const PAD = { top: 16, right: 72, bottom: 24, left: 64 };

/** 3–5 round ticks covering [lo, hi]. */
export function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 5) ?? 10 * mag;
  // From the tick at or below `lo` to the tick at or above `hi`, so every value sits inside the axis.
  const out: number[] = [];
  const end = Math.ceil(hi / step - 1e-9) * step;
  for (let v = Math.floor(lo / step + 1e-9) * step; v <= end + step * 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out.length > 1 ? out : [out[0] ?? 0, (out[0] ?? 0) + step];
}

export const compact = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K` : a.toFixed(0);
  return `${n < 0 ? '−' : ''}₹${s}`;
};

export function EquityChart({ points, height = DEFAULT_H }: { points: Array<{ at: string; pnl: number }>; height?: number }) {
  const H = height;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A zero point before the first trade, so the line starts where the account did.
  const series = useMemo(() => [{ at: points[0]?.at ?? '', pnl: 0, trade: 0 }, ...points.map((p, i) => ({ ...p, trade: i + 1 }))], [points]);
  const values = series.map((p) => p.pnl);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (series.length === 1 ? plotW : (i / (series.length - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pnl).toFixed(1)}`).join('');
  const area = `${line}L${x(series.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const last = series.at(-1)!;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = Math.round(((px - PAD.left) / (plotW || 1)) * (series.length - 1));
    setHover(Math.min(series.length - 1, Math.max(0, i)));
  };
  const h = hover !== null ? series[hover]! : null;
  const tipLeft = hover !== null ? Math.min(width - 190, Math.max(0, x(hover) - 95)) : 0;

  return (
    <div ref={box} className="relative w-full select-none">
      <svg
        role="img"
        aria-label={`Cumulative net P&L over ${points.length} closed trades, now ${signedInr(last.pnl)}`}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="block touch-none"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="rgb(var(--ink-700))" strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
              {compact(t)}
            </text>
          </g>
        ))}
        <path d={area} fill="rgb(var(--accent))" fillOpacity={0.1} />
        <path d={line} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(series.length - 1)} cy={y(last.pnl)} r={4} fill="rgb(var(--accent))" stroke="rgb(var(--ink-900))" strokeWidth={2} />
        <text x={x(series.length - 1) + 8} y={y(last.pnl)} dy="0.32em" className="fill-fg text-[11px] font-semibold tabular-nums">
          {compact(last.pnl)}
        </text>
        <text x={PAD.left} y={H - 6} className="fill-slate-500 text-[10px]">
          {points[0] ? istStampIso(points[0].at) : ''}
        </text>
        <text x={width - PAD.right} y={H - 6} textAnchor="end" className="fill-slate-500 text-[10px]">
          {points.length} trade{points.length === 1 ? '' : 's'}
        </text>
        {h && hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="rgb(var(--ink-700))" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.pnl)} r={4} fill="rgb(var(--accent))" stroke="rgb(var(--ink-900))" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-0 z-10 w-[190px] rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs shadow-lg" style={{ left: tipLeft }}>
          {h.trade === 0 ? (
            <p className="text-slate-400">Start · ₹0</p>
          ) : (
            <>
              <p className="text-slate-500">
                Trade {h.trade} · {istStampIso(h.at)}
              </p>
              <p className="mt-0.5 text-slate-300">
                This trade <span className="font-semibold tabular-nums text-fg">{signedInr(h.pnl - series[hover - 1]!.pnl)}</span>
              </p>
              <p className="text-slate-300">
                Total <span className="font-semibold tabular-nums text-fg">{signedInr(h.pnl)}</span>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
