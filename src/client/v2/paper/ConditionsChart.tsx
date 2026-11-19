'use client';

/**
 * A backtest trade's conditions chart (TradeChart, built by the backtest from the candles it decided on): the
 * candles of an instrument / timeframe the conditions read, around the trade; price lines (averages, bands …) on
 * them; a pane per other kind of value (RSI with its MA, ADX, MACD, volume …) with the numbers they're compared
 * with; where the conditions were met (the signal candle — the trade entered at its close) and where it exited.
 *
 * Colours: candles up / down (--chart-up / --chart-down, direction only); the entry in blue (a strategy's signal,
 * direction-neutral); lines told apart by colour AND dash, named in the legend; levels dashed grey.
 */
import { useRef, useState } from 'react';
import clsx from 'clsx';
import type { ChartLine, PaperExitReason, PaperSide, TradeChart } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { istStamp } from '../format';
import { H } from '../help';
import { useWidth } from './charts';
import { niceTicks } from './EquityChart';

const UP = 'rgb(var(--chart-up))';
const DOWN = 'rgb(var(--chart-down))';
const SIGNAL = 'rgb(var(--accent))';
const MUTED = 'rgb(var(--slate-500))';
const GRID = 'rgb(var(--ink-700))';
/** Line styles in order: colour + dash, so lines differ without colour too. */
const STYLES = [
  { color: 'rgb(var(--accent))', dash: undefined },
  { color: 'rgb(var(--slate-300))', dash: '5 3' },
  { color: 'rgb(var(--accent-soft))', dash: '2 3' },
  { color: 'rgb(var(--slate-500))', dash: '8 3 2 3' },
];

const PRICE_H = 230;
const PANE_H = 96;
const GAP = 14;
const PAD = { top: 16, right: 64, bottom: 22, left: 8 };

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }));

function rangeOf(values: Array<number | null | undefined>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) if (v !== null && v !== undefined && Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}

/** A line as SVG path data, broken where it has no value. */
function linePath(values: Array<number | null>, x: (i: number) => number, y: (v: number) => number): string {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) return void (pen = false);
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Each line of a chart its own style, in order: the lines on the candles first, then the panes'. */
function stylesOf(chart: TradeChart): Map<ChartLine, (typeof STYLES)[number]> {
  const all = [...chart.overlays, ...chart.panes.flatMap((p) => p.lines)];
  return new Map(all.map((l, i) => [l, STYLES[i % STYLES.length]!]));
}

function Legend({ lines, styles }: { lines: ChartLine[]; styles: Map<ChartLine, (typeof STYLES)[number]> }) {
  return (
    <>
      {lines.map((l) => {
        const st = styles.get(l) ?? STYLES[0]!;
        return (
          <span key={l.label} className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={st.color} strokeWidth="2" strokeDasharray={st.dash} />
            </svg>
            {l.label}
          </span>
        );
      })}
    </>
  );
}

const REASON: Partial<Record<PaperExitReason, string>> = {
  TARGET: 'target',
  STOP: 'stop-loss',
  TRAIL: 'trailing stop',
  STOP_RULE: 'trailing rule',
  OPPOSITE: 'other leg / group',
  SQUARE_OFF: 'square-off',
  EXPIRY: 'expiry',
  END: 'end of test',
  MANUAL: 'by hand',
};

function Chart({ chart, side, reason }: { chart: TradeChart; side: PaperSide; reason: PaperExitReason | null }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 300);
  const [hover, setHover] = useState<number | null>(null);
  const { candles, entry, exit } = chart;
  const n = candles.length;
  const plotW = width - PAD.left - PAD.right;
  const band = plotW / Math.max(1, n);
  const x = (i: number) => PAD.left + i * band + band / 2;
  const body = Math.max(1.5, Math.min(9, band * 0.62));
  const height = PAD.top + PRICE_H + chart.panes.length * (PANE_H + GAP) + PAD.bottom;

  // Price pane: candles, price lines, price levels.
  const [plo, phi] = rangeOf([...candles.flatMap((c) => [c[2], c[3]]), ...chart.overlays.flatMap((l) => l.values), ...chart.levels]);
  const pt = niceTicks(plo, phi);
  const py = (v: number) => PAD.top + (1 - (v - pt[0]!) / (pt.at(-1)! - pt[0]! || 1)) * PRICE_H;
  const panes = chart.panes.map((p, k) => {
    const top = PAD.top + PRICE_H + GAP + k * (PANE_H + GAP);
    const [lo, hi] = rangeOf([...p.lines.flatMap((l) => l.values), ...p.levels]);
    const ticks = niceTicks(lo, hi);
    const y = (v: number) => top + (1 - (v - ticks[0]!) / (ticks.at(-1)! - ticks[0]! || 1)) * PANE_H;
    return { ...p, top, ticks, y };
  });
  // Time labels: about one per 80 px, the date where the day changes.
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 80))));
  const day = (s: number) => istStamp(s).slice(0, 6);
  const bottom = height - PAD.bottom;
  const markX = (i: number) => x(i) - band / 2;
  const h = hover !== null ? candles[hover] : null;
  const tipLeft = hover !== null ? Math.min(width - 210, Math.max(0, x(hover) - 105)) : 0;
  const buy = side === 'BUY';
  const styles = stylesOf(chart);

  return (
    <div ref={box} className="relative w-full select-none">
      <svg
        role="img"
        aria-label={`${chart.title}: candles with the conditions' values, where they were met and where the trade exited`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.floor((e.clientX - r.left - PAD.left) / band);
          setHover(i >= 0 && i < n ? i : null);
        }}
      >
        {/* The signal candle and the exit, through every pane. */}
        <rect x={markX(entry)} y={PAD.top - 6} width={band} height={bottom - PAD.top + 6} fill={SIGNAL} opacity={0.12} />
        {exit !== null && <line x1={x(exit)} x2={x(exit)} y1={PAD.top - 6} y2={bottom} stroke={MUTED} strokeDasharray="4 3" />}

        {/* Price grid */}
        {pt.map((v) => (
          <g key={`p${v}`}>
            <line x1={PAD.left} x2={width - PAD.right} y1={py(v)} y2={py(v)} stroke={GRID} strokeWidth={0.6} />
            <text x={width - PAD.right + 6} y={py(v) + 3} fontSize="10" fill={MUTED}>
              {fmt(v)}
            </text>
          </g>
        ))}
        {chart.levels.map((v) => (
          <line key={`pl${v}`} x1={PAD.left} x2={width - PAD.right} y1={py(v)} y2={py(v)} stroke={MUTED} strokeDasharray="6 4" />
        ))}
        {/* Candles */}
        {candles.map(([, o, hi, lo, c], i) => {
          const color = c >= o ? UP : DOWN;
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={py(hi)} y2={py(lo)} stroke={color} strokeWidth={1} />
              <rect x={x(i) - body / 2} y={Math.min(py(o), py(c))} width={body} height={Math.max(1, Math.abs(py(o) - py(c)))} fill={color} />
            </g>
          );
        })}
        {chart.overlays.map((l) => {
          const st = styles.get(l)!;
          return <path key={l.label} d={linePath(l.values, x, py)} fill="none" stroke={st.color} strokeWidth={1.5} strokeDasharray={st.dash} />;
        })}
        {/* Entry marker: under the candle for a buy, over it for a sell. */}
        {(() => {
          const c = candles[entry]!;
          const yy = buy ? py(c[3]) + 10 : py(c[2]) - 10;
          const tri = buy ? `M${x(entry)},${yy - 6}l5,8h-10z` : `M${x(entry)},${yy + 6}l5,-8h-10z`;
          return (
            <g>
              <path d={tri} fill={SIGNAL} />
              <text x={Math.min(x(entry) + 8, width - PAD.right - 4)} y={PAD.top - 4} fontSize="10" fontWeight="600" fill={SIGNAL} textAnchor={x(entry) > width - PAD.right - 120 ? 'end' : 'start'}>
                conditions met · {buy ? 'buy' : 'sell'}
              </text>
            </g>
          );
        })()}
        {exit !== null && (
          <text x={x(exit) + 5} y={PAD.top + 10} fontSize="10" fontWeight="600" fill={MUTED} textAnchor={x(exit) > width - PAD.right - 90 ? 'end' : 'start'}>
            exit{reason && REASON[reason] ? ` · ${REASON[reason]}` : ''}
          </text>
        )}

        {/* Panes */}
        {panes.map((p, k) => (
          <g key={p.title}>
            <line x1={PAD.left} x2={width - PAD.right} y1={p.top - GAP / 2} y2={p.top - GAP / 2} stroke={GRID} />
            {[p.ticks[0]!, p.ticks.at(-1)!].map((v) => (
              <text key={`t${v}`} x={width - PAD.right + 6} y={p.y(v) + 3} fontSize="10" fill={MUTED}>
                {fmt(v)}
              </text>
            ))}
            {p.levels.map((v) => (
              <g key={`l${v}`}>
                <line x1={PAD.left} x2={width - PAD.right} y1={p.y(v)} y2={p.y(v)} stroke={MUTED} strokeDasharray="6 4" />
                <text x={width - PAD.right + 6} y={p.y(v) + 3} fontSize="10" fontWeight="600" fill={MUTED}>
                  {fmt(v)}
                </text>
              </g>
            ))}
            {p.lines.map((l) => {
              const st = styles.get(l)!;
              return <path key={`${k}${l.label}`} d={linePath(l.values, x, p.y)} fill="none" stroke={st.color} strokeWidth={1.5} strokeDasharray={st.dash} />;
            })}
            {/* The values at the signal candle */}
            {p.lines.map((l, i) => {
              const v = l.values[entry];
              return v === null || v === undefined ? null : <circle key={`m${i}`} cx={x(entry)} cy={p.y(v)} r={2.6} fill={SIGNAL} />;
            })}
          </g>
        ))}

        {/* Time axis */}
        {candles.map(([t], i) =>
          i % every === 0 ? (
            <text key={`x${i}`} x={i === 0 ? PAD.left : x(i)} y={height - 6} fontSize="10" fill={MUTED} textAnchor={i === 0 ? 'start' : 'middle'}>
              {i === 0 || day(t) !== day(candles[i - every]?.[0] ?? t) ? istStamp(t) : istStamp(t).slice(7)}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={bottom} stroke={MUTED} strokeWidth={0.6} />}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 z-10 w-[210px] rounded-md border border-ink-700 bg-ink-900/95 px-2.5 py-1.5 text-[11px] shadow-lg" style={{ left: tipLeft }}>
          <p className="font-semibold text-slate-200">
            {istStamp(h[0])}
            {hover === entry ? ' · conditions met' : hover === exit ? ' · exit' : ''}
          </p>
          <p className="tabular-nums text-slate-400">
            O {fmt(h[1])} · H {fmt(h[2])} · L {fmt(h[3])} · C {fmt(h[4])}
          </p>
          {[...chart.overlays, ...chart.panes.flatMap((p) => p.lines)].map((l) => {
            const v = l.values[hover!];
            return (
              <p key={l.label} className="flex justify-between gap-2 tabular-nums text-slate-400">
                <span className="truncate">{l.label}</span>
                <span className="text-slate-200">{v === null || v === undefined ? '—' : fmt(v)}</span>
              </p>
            );
          })}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <Legend lines={chart.overlays} styles={styles} />
        {chart.panes.map((p) => (
          <Legend key={p.title} lines={p.lines} styles={styles} />
        ))}
      </div>
    </div>
  );
}

/** The conditions charts of a backtest trade: one tab per instrument / timeframe its conditions read. */
export function ConditionsCharts({ charts, side, reason }: { charts: TradeChart[]; side: PaperSide; reason: PaperExitReason | null }) {
  const [i, setI] = useState(0);
  const chart = charts[Math.min(i, charts.length - 1)]!;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={H.paper.conditionsChart}>
          <h5 className="cursor-help text-xs font-semibold text-slate-200">Why it entered and exited</h5>
        </Tooltip>
        {charts.length > 1 ? (
          <div role="radiogroup" aria-label="Chart of" className="flex overflow-hidden rounded-md border border-ink-700 text-[11px]">
            {charts.map((c, k) => (
              <Tooltip key={c.title} content={{ ...H.paper.conditionsChartSeries, title: c.title }}>
                <button type="button" role="radio" aria-checked={k === i} onClick={() => setI(k)} className={clsx('px-2 py-1 font-semibold', k === i ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400 hover:text-slate-200')}>
                  {c.title}
                </button>
              </Tooltip>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-slate-400">{chart.title}</span>
        )}
        {chart.exit === null && reason && <span className="text-[11px] text-slate-500">· exited after the candles shown</span>}
      </div>
      <Chart chart={chart} side={side} reason={reason} />
    </div>
  );
}
