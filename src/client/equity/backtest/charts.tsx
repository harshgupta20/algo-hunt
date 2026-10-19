'use client';

/**
 * Backtest charts.
 *   Account value  the strategy (accent, 2px) against NIFTY 50 bought and held (gray context line) — one ₹ axis,
 *                  legend + end labels; drawdown below as its own chart (red = down). One crosshair drives both.
 *   Monthly grid   diverging green (up) / red (down) around a neutral zero, every cell labelled with its signed
 *                  value (the second channel besides colour).
 * Palette checked with the dataviz validator: accent vs slate passes separation and contrast in both themes
 * (the gray is a deliberate de-emphasised context series).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { EqCurvePoint } from '@/shared/equity';
import { Tooltip } from '../../components/Tooltip';
import { pct, shortDate } from '../format';
import { E } from '../help';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** ₹ in lakh / crore for axes and labels. */
export function compactInr(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2).replace(/\.?0+$/, '')} L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(0)}K`;
  return `${s}₹${a.toFixed(0)}`;
}

/** Clean axis ticks (1 / 2 / 2.5 / 5 × 10^k steps). */
function ticks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

const PAD = { left: 64, right: 84, top: 10, bottom: 22 };

export function CurveCharts({ points, capital }: { points: EqCurvePoint[]; capital: number | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const hasBench = points.some((p) => p.benchmark !== undefined);
  const H1 = 260;
  const H2 = 110;
  const w = Math.max(0, width - PAD.left - PAD.right);

  const geo = useMemo(() => {
    if (!points.length || w <= 0) return null;
    const times = points.map((p) => Date.parse(p.date));
    const t0 = times[0]!;
    const t1 = times.at(-1)! === t0 ? t0 + 86_400_000 : times.at(-1)!;
    const x = (i: number) => PAD.left + ((times[i]! - t0) / (t1 - t0)) * w;
    const vals = points.flatMap((p) => [p.equity, ...(p.benchmark !== undefined ? [p.benchmark] : [])]);
    let lo = Math.min(...vals, capital ?? Infinity);
    let hi = Math.max(...vals, capital ?? -Infinity);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const padV = (hi - lo) * 0.06;
    lo -= padV;
    hi += padV;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H1 - PAD.top - PAD.bottom);
    const ddLo = Math.min(-1, ...points.map((p) => p.drawdownPct)) * 1.08;
    const yd = (v: number) => PAD.top + (v / ddLo) * (H2 - PAD.top - PAD.bottom);
    const line = (get: (p: EqCurvePoint) => number | undefined, yf: (v: number) => number) =>
      points.map((p, i) => ({ v: get(p), i })).filter((q) => q.v !== undefined).map((q, k) => `${k ? 'L' : 'M'}${x(q.i).toFixed(1)},${yf(q.v!).toFixed(1)}`).join('');
    // Year (or month, for short periods) ticks on the x axis.
    const years = new Set(points.map((p) => p.date.slice(0, 4)));
    const xt: Array<{ x: number; label: string }> = [];
    if (years.size >= 2) {
      for (const yr of years) {
        const t = Date.parse(`${yr}-01-01`);
        if (t > t0 && t < t1) xt.push({ x: PAD.left + ((t - t0) / (t1 - t0)) * w, label: yr });
      }
    } else {
      const months = [...new Set(points.map((p) => p.date.slice(0, 7)))];
      const every = Math.max(1, Math.ceil(months.length / 6));
      months.forEach((m, k) => {
        const t = Date.parse(`${m}-01`);
        if (k % every === 0 && t > t0 && t < t1) xt.push({ x: PAD.left + ((t - t0) / (t1 - t0)) * w, label: new Date(t).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }) });
      });
    }
    return {
      x,
      y,
      yd,
      yTicks: ticks(lo, hi),
      dTicks: ticks(ddLo, 0, 3).filter((v) => v <= 0),
      eqPath: line((p) => p.equity, y),
      benchPath: hasBench ? line((p) => p.benchmark, y) : '',
      ddPath: line((p) => p.drawdownPct, yd),
      ddArea: `${line((p) => p.drawdownPct, yd)}L${x(points.length - 1).toFixed(1)},${yd(0).toFixed(1)}L${x(0).toFixed(1)},${yd(0).toFixed(1)}Z`,
      xt,
      times,
      t0,
      t1,
    };
  }, [points, w, capital, hasBench]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = geo.t0 + ((e.clientX - rect.left) / rect.width) * (geo.t1 - geo.t0);
    let best = 0;
    for (let i = 1; i < geo.times.length; i++) if (Math.abs(geo.times[i]! - t) < Math.abs(geo.times[best]! - t)) best = i;
    setHover(best);
  };

  const last = points.at(-1);
  const endLabels = geo && last ? [{ key: 'eq', v: last.equity, cls: 'fill-slate-200', text: compactInr(last.equity) }, ...(last.benchmark !== undefined ? [{ key: 'b', v: last.benchmark, cls: 'fill-slate-400', text: compactInr(last.benchmark) }] : [])] : [];
  const collide = endLabels.length === 2 && geo && Math.abs(geo.y(endLabels[0]!.v) - geo.y(endLabels[1]!.v)) < 14;
  const hp = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="relative w-full select-none">
      <div className="mb-1 flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
        <Tooltip content={E.backtest.curve}>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-accent" /> Strategy
          </span>
        </Tooltip>
        {hasBench && (
          <Tooltip content={E.backtest.benchmark}>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded bg-slate-500" /> NIFTY 50 (bought and held)
            </span>
          </Tooltip>
        )}
      </div>
      {geo && (
        <svg width={width} height={H1 + H2} role="img" aria-label="Account value and drawdown over the backtest">
          {/* account value */}
          {geo.yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD.left} x2={PAD.left + w} y1={geo.y(v)} y2={geo.y(v)} className="stroke-ink-700" strokeWidth={1} />
              <text x={PAD.left - 8} y={geo.y(v)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
                {compactInr(v)}
              </text>
            </g>
          ))}
          {geo.xt.map((t) => (
            <text key={t.label} x={t.x} y={H1 - 6} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {t.label}
            </text>
          ))}
          {geo.benchPath && <path d={geo.benchPath} fill="none" className="stroke-slate-500" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
          <path d={geo.eqPath} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {last && <circle cx={geo.x(points.length - 1)} cy={geo.y(last.equity)} r={4} className="fill-accent stroke-ink-900" strokeWidth={2} />}
          {!collide &&
            endLabels.map((l) => (
              <text key={l.key} x={PAD.left + w + 8} y={geo.y(l.v)} dy="0.32em" className={clsx('text-[11px] font-medium tabular-nums', l.cls)}>
                {l.text}
              </text>
            ))}
          {/* drawdown */}
          <g transform={`translate(0, ${H1})`}>
            {geo.dTicks.map((v) => (
              <g key={`d${v}`}>
                <line x1={PAD.left} x2={PAD.left + w} y1={geo.yd(v)} y2={geo.yd(v)} className="stroke-ink-700" strokeWidth={1} />
                <text x={PAD.left - 8} y={geo.yd(v)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
                  {v === 0 ? '0%' : `${v.toFixed(0)}%`}
                </text>
              </g>
            ))}
            <path d={geo.ddArea} className="fill-bear/10" />
            <path d={geo.ddPath} fill="none" className="stroke-bear" strokeWidth={1.5} strokeLinejoin="round" />
            <text x={PAD.left + w + 8} y={PAD.top + 4} className="fill-slate-500 text-[10px]">
              Drawdown
            </text>
          </g>
          {hp && hover !== null && (
            <g pointerEvents="none">
              <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={H1 + H2 - PAD.bottom} className="stroke-slate-500" strokeWidth={1} />
              <circle cx={geo.x(hover)} cy={geo.y(hp.equity)} r={4} className="fill-accent stroke-ink-900" strokeWidth={2} />
              {hp.benchmark !== undefined && <circle cx={geo.x(hover)} cy={geo.y(hp.benchmark)} r={4} className="fill-slate-500 stroke-ink-900" strokeWidth={2} />}
            </g>
          )}
          <rect x={PAD.left} y={0} width={w} height={H1 + H2} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hp && geo && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(geo.x(hover) + 12, width - 190), top: 24 }}
        >
          <div className="mb-1 text-[11px] text-slate-500">{shortDate(hp.date)}</div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-3 rounded bg-accent" />
            <span className="font-semibold tabular-nums text-slate-100">{compactInr(hp.equity)}</span>
            <span className="text-slate-500">strategy</span>
          </div>
          {hp.benchmark !== undefined && (
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-3 rounded bg-slate-500" />
              <span className="font-semibold tabular-nums text-slate-100">{compactInr(hp.benchmark)}</span>
              <span className="text-slate-500">NIFTY 50</span>
            </div>
          )}
          {capital !== null && (
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-3 rounded bg-bear" />
              <span className="font-semibold tabular-nums text-slate-100">{pct(hp.drawdownPct)}</span>
              <span className="text-slate-500">below the high</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Years × months of returns, diverging green / red around zero, each cell labelled. */
export function MonthlyGrid({ monthly, yearly }: { monthly: Array<{ month: string; returnPct: number }>; yearly: Array<{ year: string; returnPct: number }> }) {
  const byMonth = new Map(monthly.map((m) => [m.month, m.returnPct]));
  const years = [...new Set(monthly.map((m) => m.month.slice(0, 4)))];
  const yearRet = new Map(yearly.map((y) => [y.year, y.returnPct]));
  const maxAbs = Math.max(1, ...monthly.map((m) => Math.abs(m.returnPct)));
  const cell = (v: number | undefined, label: string, wide = false) => {
    if (v === undefined) return <td key={label} className="px-0.5 py-0.5" />;
    const strength = Math.min(1, Math.abs(v) / maxAbs);
    const alpha = Math.abs(v) < 0.05 ? 0 : 0.14 + strength * 0.66;
    const strong = alpha > 0.5;
    return (
      <td key={label} className="px-0.5 py-0.5">
        <Tooltip content={{ title: label, body: `Account return: ${pct(v, 2)}` }} className="block">
          <div
            className={clsx('rounded px-1 py-1 text-center text-[11px] tabular-nums', wide && 'font-semibold', strong ? 'text-white' : 'text-slate-200', alpha === 0 && 'bg-ink-800')}
            style={alpha ? { backgroundColor: `rgb(var(--${v > 0 ? 'bull' : 'bear'}) / ${alpha.toFixed(2)})` } : undefined}
          >
            {pct(v)}
          </div>
        </Tooltip>
      </td>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-slate-500">
            <th className="px-1 py-1 text-left font-medium">Year</th>
            {MONTHS.map((m) => (
              <th key={m} className="px-1 py-1 font-medium">
                {m}
              </th>
            ))}
            <th className="px-1 py-1 font-medium">Year</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y}>
              <td className="px-1 py-0.5 font-medium text-slate-300">{y}</td>
              {MONTHS.map((m, i) => cell(byMonth.get(`${y}-${String(i + 1).padStart(2, '0')}`), `${m} ${y}`))}
              {cell(yearRet.get(y), `${y} (whole year)`, true)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
