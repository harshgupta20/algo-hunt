'use client';

/**
 * Small charts for the market view (SVG / HTML, no chart library): sparkline, range bar, advance / decline bar,
 * diverging bars, rotation quadrant, OI-by-strike, pivot ladder, flow columns, and a hover card. Green / red mean
 * direction only; values are always printed too.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { moveStep } from '@/shared/market/analytics';
import { fmtCompact, fmtPct, fmtPrice } from './format';

// ---- colour ------------------------------------------------------------------------------------------

const ALPHA = [0, 0.2, 0.36, 0.55, 0.75, 0.95];

/** Tile / cell fill for a % move: neutral grey when flat, then deeper green / red by size. */
export function moveFill(pct: number): CSSProperties {
  const step = moveStep(pct);
  if (step === 0) return { background: 'rgb(var(--slate-500) / 0.16)' };
  return { background: `rgb(var(--${pct > 0 ? 'bull' : 'bear'}) / ${ALPHA[step]})` };
}

/** Text colour that stays readable on `moveFill`. */
export const onFillClass = (pct: number) => (moveStep(pct) >= 3 ? 'text-white' : 'text-fg');

// ---- hover card --------------------------------------------------------------------------------------

export interface Hover {
  x: number;
  y: number;
  content: ReactNode;
}

/** A card that follows the pointer (fixed, kept inside the viewport). */
export function HoverCard({ hover }: { hover: Hover | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!hover || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    const pad = 12;
    let left = hover.x + 16;
    let top = hover.y + 16;
    if (left + r.width > window.innerWidth - pad) left = hover.x - r.width - 16;
    if (top + r.height > window.innerHeight - pad) top = hover.y - r.height - 16;
    setPos({ left: Math.max(pad, left), top: Math.max(pad, top) });
  }, [hover]);
  if (!hover || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 60 }}
      className="pointer-events-none max-w-xs rounded-lg border border-ink-600 bg-ink-900/95 px-3 py-2 text-xs text-slate-300 shadow-xl backdrop-blur"
    >
      {hover.content}
    </div>,
    document.body,
  );
}

// ---- sparkline ---------------------------------------------------------------------------------------

/** Today's line; the dotted line is the previous close. Green / red by where it is vs that close. */
export function Sparkline({ points, prevClose, width = 120, height = 36, className }: { points: number[]; prevClose?: number | null; width?: number; height?: number; className?: string }) {
  if (points.length < 2) return <div style={{ width, height }} className={className} />;
  const values = prevClose ? [...points, prevClose] : points;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => (i / (points.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = points.at(-1)!;
  const up = prevClose ? last >= prevClose : last >= points[0]!;
  const color = up ? 'rgb(var(--bull))' : 'rgb(var(--bear))';
  const area = `${d}L${x(points.length - 1).toFixed(1)},${height - pad}L${x(0).toFixed(1)},${height - pad}Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={className} aria-hidden>
      <path d={area} fill={color} opacity={0.1} />
      {prevClose ? <line x1={pad} x2={width - pad} y1={y(prevClose)} y2={y(prevClose)} stroke="rgb(var(--slate-500))" strokeWidth={1} strokeDasharray="2 3" opacity={0.7} vectorEffect="non-scaling-stroke" /> : null}
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(last)} r={2.5} fill={color} stroke="rgb(var(--ink-900))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---- range bar ---------------------------------------------------------------------------------------

/** low ─────●──── high, with the marker at `value`. */
export function RangeBar({ low, high, value, className }: { low: number; high: number; value: number; className?: string }) {
  const span = high - low;
  const p = span > 0 ? Math.min(100, Math.max(0, ((value - low) / span) * 100)) : 50;
  return (
    <div className={clsx('relative h-1.5 rounded-full bg-ink-700', className)}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-accent/35" style={{ width: `${p}%` }} />
      <div className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg ring-2 ring-ink-900" style={{ left: `${p}%` }} />
    </div>
  );
}

// ---- advance / decline ---------------------------------------------------------------------------------

export function AdBar({ advances, declines, unchanged = 0, height = 8 }: { advances: number; declines: number; unchanged?: number; height?: number }) {
  const total = advances + declines + unchanged || 1;
  const seg = (n: number, cls: string, label: string) =>
    n > 0 ? <div className={clsx('h-full first:rounded-l-full last:rounded-r-full', cls)} style={{ width: `${(n / total) * 100}%` }} aria-label={`${n} ${label}`} /> : null;
  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded-full" style={{ height }}>
      {seg(advances, 'bg-bull', 'up')}
      {seg(unchanged, 'bg-slate-500/40', 'unchanged')}
      {seg(declines, 'bg-bear', 'down')}
    </div>
  );
}

// ---- diverging bar ---------------------------------------------------------------------------------------

/** A bar growing right (up, green) or left (down, red) from a centre line; `max` sets the scale. */
export function DivergingBar({ value, max, height = 10 }: { value: number; max: number; height?: number }) {
  const w = max > 0 ? Math.min(50, (Math.abs(value) / max) * 50) : 0;
  return (
    <div className="relative w-full" style={{ height }}>
      <div className="absolute inset-y-[-2px] left-1/2 w-px bg-ink-600" />
      <div
        className={clsx('absolute top-0 h-full', value >= 0 ? 'rounded-r bg-bull/80' : 'rounded-l bg-bear/80')}
        style={value >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
      />
    </div>
  );
}

// ---- rotation quadrant ----------------------------------------------------------------------------------

export interface QuadPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  today: number;
}

/** Relative 1-month (x) vs 1-week (y) strength; quadrants named like a relative-rotation graph. */
export function RotationChart({ points, onPick }: { points: QuadPoint[]; onPick?: (id: string) => void }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const W = 520;
  const H = 360;
  const padL = 34;
  const pad = 24;
  const ext = (vals: number[]) => Math.max(1, ...vals.map((v) => Math.abs(v))) * 1.15;
  const ex = ext(points.map((p) => p.x));
  const ey = ext(points.map((p) => p.y));
  const sx = (v: number) => padL + ((v + ex) / (2 * ex)) * (W - padL - pad);
  const sy = (v: number) => H - pad - ((v + ey) / (2 * ey)) * (H - pad * 2);
  const labels = placeLabels(points.map((p) => ({ id: p.id, label: p.label, cx: sx(p.x), cy: sy(p.y) })), { x0: padL, y0: pad, x1: W - pad, y1: H - pad });
  const q = (x: number, y: number, label: string, anchor: 'start' | 'end') => (
    <text x={x} y={y} textAnchor={anchor} className="fill-slate-500" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }}>
      {label}
    </text>
  );
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Sector rotation: 1-month vs 1-week performance relative to the Nifty 50">
        <rect x={sx(0)} y={pad} width={W - pad - sx(0)} height={sy(0) - pad} fill="rgb(var(--bull) / 0.05)" />
        <rect x={padL} y={sy(0)} width={sx(0) - padL} height={H - pad - sy(0)} fill="rgb(var(--bear) / 0.05)" />
        <line x1={padL} x2={W - pad} y1={sy(0)} y2={sy(0)} stroke="rgb(var(--ink-600))" strokeWidth={1} />
        <line x1={sx(0)} x2={sx(0)} y1={pad} y2={H - pad} stroke="rgb(var(--ink-600))" strokeWidth={1} />
        {q(W - pad - 4, pad + 14, 'LEADING', 'end')}
        {q(W - pad - 4, H - pad - 6, 'WEAKENING', 'end')}
        {q(padL + 4, H - pad - 6, 'LAGGING', 'start')}
        {q(padL + 4, pad + 14, 'IMPROVING', 'start')}
        <text x={(W + padL) / 2} y={H - 5} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 10 }}>
          1 month vs Nifty →
        </text>
        <text x={14} y={H / 2} textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`} className="fill-slate-500" style={{ fontSize: 10 }}>
          1 week vs Nifty →
        </text>
        {points.map((p) => {
          const l = labels.get(p.id);
          return (
            <g
              key={p.id}
              className="cursor-pointer"
              onPointerMove={(e) =>
                setHover({
                  x: e.clientX,
                  y: e.clientY,
                  content: (
                    <div className="space-y-0.5">
                      <div className="font-semibold text-fg">{p.label}</div>
                      <div>1 month vs Nifty: <span className="font-medium text-fg">{fmtPct(p.x)}</span></div>
                      <div>1 week vs Nifty: <span className="font-medium text-fg">{fmtPct(p.y)}</span></div>
                      <div>Today: <span className="font-medium text-fg">{fmtPct(p.today)}</span></div>
                    </div>
                  ),
                })
              }
              onPointerLeave={() => setHover(null)}
              onClick={() => onPick?.(p.id)}
            >
              <circle cx={sx(p.x)} cy={sy(p.y)} r={12} fill="transparent" />
              <circle cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={p.today >= 0 ? 'rgb(var(--bull))' : 'rgb(var(--bear))'} stroke="rgb(var(--ink-900))" strokeWidth={2} />
              {l && (
                <text x={l.x} y={l.y} textAnchor={l.anchor} className="fill-slate-300" style={{ fontSize: 10.5 }}>
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <HoverCard hover={hover} />
    </>
  );
}

/** Greedy label placement: right, left, above, below each dot — skipped when every spot would overlap. */
function placeLabels(points: Array<{ id: string; label: string; cx: number; cy: number }>, frame: { x0: number; y0: number; x1: number; y1: number }) {
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const dots: Box[] = points.map((p) => ({ x0: p.cx - 5, y0: p.cy - 5, x1: p.cx + 5, y1: p.cy + 5 }));
  const taken: Box[] = [];
  const out = new Map<string, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }>();
  // Outliers first: they have the most room and are the most interesting.
  const mx = points.reduce((a, p) => a + p.cx, 0) / (points.length || 1);
  const my = points.reduce((a, p) => a + p.cy, 0) / (points.length || 1);
  for (const p of [...points].sort((a, b) => Math.hypot(b.cx - mx, b.cy - my) - Math.hypot(a.cx - mx, a.cy - my))) {
    const w = p.label.length * 5.6 + 2;
    const options: Array<{ x: number; y: number; anchor: 'start' | 'end' | 'middle'; box: Box }> = [
      { x: p.cx + 7, y: p.cy + 3.5, anchor: 'start', box: { x0: p.cx + 6, y0: p.cy - 6, x1: p.cx + 7 + w, y1: p.cy + 6 } },
      { x: p.cx - 7, y: p.cy + 3.5, anchor: 'end', box: { x0: p.cx - 7 - w, y0: p.cy - 6, x1: p.cx - 6, y1: p.cy + 6 } },
      { x: p.cx, y: p.cy - 8, anchor: 'middle', box: { x0: p.cx - w / 2, y0: p.cy - 18, x1: p.cx + w / 2, y1: p.cy - 6 } },
      { x: p.cx, y: p.cy + 16, anchor: 'middle', box: { x0: p.cx - w / 2, y0: p.cy + 6, x1: p.cx + w / 2, y1: p.cy + 18 } },
    ];
    const ok = options.find((o) => o.box.x0 >= frame.x0 && o.box.x1 <= frame.x1 && o.box.y0 >= frame.y0 && o.box.y1 <= frame.y1 && !taken.some((t) => hit(t, o.box)) && !dots.some((d) => hit(d, o.box)));
    if (ok) {
      taken.push(ok.box);
      out.set(p.id, { x: ok.x, y: ok.y, anchor: ok.anchor });
    }
  }
  return out;
}

// ---- open interest by strike ------------------------------------------------------------------------------

export function OiButterfly({ rows, spot, atm }: { rows: Array<{ strike: number; callOi: number; putOi: number }>; spot: number; atm: number }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const max = Math.max(1, ...rows.flatMap((r) => [r.callOi, r.putOi]));
  return (
    <div className="space-y-[2px]" onPointerLeave={() => setHover(null)}>
      {rows.map((r, i) => {
        const nextAbove = rows[i + 1] && r.strike <= spot && rows[i + 1]!.strike > spot;
        return (
          <div key={r.strike}>
            <div
              className={clsx('grid grid-cols-[1fr_56px_1fr] items-center gap-1.5 text-[10px] tabular-nums', r.strike === atm && 'font-semibold text-fg')}
              onPointerMove={(e) =>
                setHover({
                  x: e.clientX,
                  y: e.clientY,
                  content: (
                    <div className="space-y-0.5">
                      <div className="font-semibold text-fg">Strike {fmtPrice(r.strike, 0)}{r.strike === atm ? ' · ATM' : ''}</div>
                      <div>Call OI: <span className="text-fg">{fmtCompact(r.callOi)}</span></div>
                      <div>Put OI: <span className="text-fg">{fmtCompact(r.putOi)}</span></div>
                    </div>
                  ),
                })
              }
            >
              <div className="flex justify-end">
                <div className="h-2.5 rounded-l bg-leg-ce/80" style={{ width: `${(r.callOi / max) * 100}%` }} />
              </div>
              <div className="text-center text-slate-400">{fmtPrice(r.strike, 0)}</div>
              <div className="h-2.5 rounded-r bg-leg-pe/80" style={{ width: `${(r.putOi / max) * 100}%` }} />
            </div>
            {nextAbove && <div className="my-0.5 border-t border-dashed border-fg/40" aria-label={`spot ${spot}`} />}
          </div>
        );
      })}
      <HoverCard hover={hover} />
    </div>
  );
}

// ---- pivot ladder ------------------------------------------------------------------------------------------

/** S3 … R3 on a line with the CPR shaded and today's level marked. */
export function PivotLadder({ levels, last }: { levels: Array<{ key: string; value: number }>; last: number | null }) {
  const vals = levels.map((l) => l.value);
  const lo = Math.min(...vals, last ?? Infinity);
  const hi = Math.max(...vals, last ?? -Infinity);
  const pos = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const bc = levels.find((l) => l.key === 'BC')?.value;
  const tc = levels.find((l) => l.key === 'TC')?.value;
  return (
    <div className="relative mx-3 mb-3 mt-6 h-1.5 rounded-full bg-ink-700">
      {bc !== undefined && tc !== undefined && <div className="absolute inset-y-[-3px] rounded bg-accent/30" style={{ left: `${pos(bc)}%`, width: `${Math.max(0.6, pos(tc) - pos(bc))}%` }} />}
      {levels
        .filter((l) => l.key !== 'BC' && l.key !== 'TC')
        .map((l) => (
          <div key={l.key} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(l.value)}%` }}>
            <div className={clsx('h-3 w-px', l.key.startsWith('R') ? 'bg-bear/70' : l.key.startsWith('S') ? 'bg-bull/70' : 'bg-accent')} />
          </div>
        ))}
      {last !== null && (
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(last)}%` }}>
          <div className="h-3.5 w-3.5 rounded-full border-2 border-ink-900 bg-fg" />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-fg px-1 text-[9px] font-semibold text-ink-900">{fmtPrice(last, 0)}</div>
        </div>
      )}
    </div>
  );
}

// ---- flow columns ------------------------------------------------------------------------------------------

/** Daily net flows as columns around zero (oldest left). */
export function FlowColumns({ days, label }: { days: Array<{ date: string; net: number }>; label: string }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const max = Math.max(1, ...days.map((d) => Math.abs(d.net)));
  return (
    <div>
      <div className="flex h-16 items-stretch gap-[3px]" onPointerLeave={() => setHover(null)} aria-label={label}>
        {days.map((d) => (
          <div
            key={d.date}
            className="relative flex-1 max-w-[18px]"
            onPointerMove={(e) => setHover({ x: e.clientX, y: e.clientY, content: <span>{d.date}: <span className="font-semibold text-fg">{d.net >= 0 ? '+' : '−'}₹{Math.abs(d.net).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr</span></span> })}
          >
            <div className="absolute inset-x-0 top-1/2 h-px bg-ink-600" />
            <div
              className={clsx('absolute inset-x-0', d.net >= 0 ? 'rounded-t bg-bull/80' : 'rounded-b bg-bear/80')}
              style={d.net >= 0 ? { bottom: '50%', height: `${(d.net / max) * 50}%` } : { top: '50%', height: `${(-d.net / max) * 50}%` }}
            />
          </div>
        ))}
      </div>
      <HoverCard hover={hover} />
    </div>
  );
}
