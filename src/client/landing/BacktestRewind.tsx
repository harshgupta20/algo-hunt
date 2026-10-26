'use client';

import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import clsx from 'clsx';
import { CalendarRange, FileSpreadsheet, History, ListChecks, Pause, Play, Scale } from 'lucide-react';
import { Tooltip } from '@/client/components/Tooltip';
import { backtestSample, monthlyReturns, statsAt } from './data';
import { LANDING_HELP } from './help';
import { DemoNote, FeatureChip, Reveal, Section, SectionHead, inr, pct, useClock, useInView } from './kit';
import s from './landing.module.css';

const B = backtestSample();
const N = B.bars.length;
const MONTHS = monthlyReturns(B);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const START_IDX = 24;
const PLAY_S = 10;

const W = 1000;
const PRICE = { top: 12, bottom: 290 };
const EQ = { top: 318, bottom: 424 };
const H = 450;
const step = W / N;
const x = (i: number) => (i + 0.5) * step;
const pLo = Math.min(...B.bars.map((b) => b.l));
const pHi = Math.max(...B.bars.map((b) => b.h));
const py = (v: number) => PRICE.top + ((pHi - v) / (pHi - pLo)) * (PRICE.bottom - PRICE.top);
const eLo = Math.min(...B.equity, ...B.hold) * 0.97;
const eHi = Math.max(...B.equity, ...B.hold) * 1.02;
const ey = (v: number) => EQ.top + ((eHi - v) / (eHi - eLo)) * (EQ.bottom - EQ.top);
const line = (vals: Array<number | null>, y: (v: number) => number) =>
  vals
    .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
const dateOf = (i: number) =>
  `${MONTH_NAMES[Math.min(11, Math.floor(((i % B.barsPerYear) / B.barsPerYear) * 12))]} ${B.firstYear + Math.floor(i / B.barsPerYear)}`;

function Chart({ upTo }: { upTo: number }) {
  const statics = useMemo(
    () => (
      <>
        {B.trades.map((t, i) => (
          <rect
            key={i}
            x={x(t.entryIdx)}
            width={x(t.exitIdx) - x(t.entryIdx)}
            y={PRICE.top}
            height={PRICE.bottom - PRICE.top}
            fill="rgb(var(--accent) / 0.07)"
          />
        ))}
        {B.bars.map((b, i) => {
          const up = b.c >= b.o;
          const col = up ? 'rgb(var(--bull))' : 'rgb(var(--bear))';
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={py(b.h)} y2={py(b.l)} stroke={col} strokeWidth={0.8} />
              <rect x={x(i) - step * 0.32} width={step * 0.64} y={py(Math.max(b.o, b.c))} height={Math.max(0.8, Math.abs(py(b.o) - py(b.c)))} fill={col} />
            </g>
          );
        })}
        <polyline points={line(B.fast, py)} fill="none" stroke="rgb(var(--accent-soft))" strokeWidth={1.6} />
        <polyline points={line(B.slow, py)} fill="none" stroke="rgb(var(--warn))" strokeOpacity={0.8} strokeWidth={1.6} />
        {B.trades.map((t, i) => (
          <g key={i}>
            <path d={`M${x(t.entryIdx)},${py(B.bars[t.entryIdx]!.l) + 6} l-5,9 h10 z`} fill="rgb(var(--bull))" />
            {t.exitIdx < N - 1 && <path d={`M${x(t.exitIdx)},${py(B.bars[t.exitIdx]!.h) - 6} l-5,-9 h10 z`} fill="rgb(var(--bear))" />}
          </g>
        ))}
        <defs>
          <linearGradient id="bt-eq" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgb(var(--accent))" stopOpacity={0.45} />
            <stop offset="1" stopColor="rgb(var(--accent))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={`${x(0)},${EQ.bottom} ${line(B.equity, ey)} ${x(N - 1)},${EQ.bottom}`} fill="url(#bt-eq)" />
        <polyline points={line(B.equity, ey)} fill="none" stroke="rgb(var(--accent-soft))" strokeWidth={2} />
        <polyline points={line(B.hold, ey)} fill="none" stroke="rgb(148 163 184)" strokeWidth={1.2} strokeDasharray="4 4" />
        {Array.from({ length: B.years }, (_, yr) => (
          <g key={yr}>
            <line x1={x(yr * B.barsPerYear)} x2={x(yr * B.barsPerYear)} y1={PRICE.top} y2={EQ.bottom} stroke="rgb(255 255 255 / 0.05)" />
            <text x={x(yr * B.barsPerYear) + 4} y={H - 6} fontSize={11} fill="rgb(100 116 139)" className={s.mono}>
              {B.firstYear + yr}
            </text>
          </g>
        ))}
        <text x={6} y={EQ.top - 6} fontSize={10.5} fill="rgb(100 116 139)" className={s.mono} letterSpacing={1.4}>
          ACCOUNT VALUE · - - BUY &amp; HOLD
        </text>
      </>
    ),
    [],
  );
  const sx = x(upTo);
  return (
    <>
      {statics}
      <rect x={sx} y={0} width={W - sx} height={H - 18} fill="#05070d" fillOpacity={0.72} />
      <line x1={sx} x2={sx} y1={0} y2={H - 18} stroke="white" strokeOpacity={0.85} strokeWidth={1.2} />
      <circle cx={sx} cy={ey(B.equity[upTo]!)} r={5} fill="rgb(var(--accent-soft))" stroke="#05070d" strokeWidth={2} />
      <circle cx={sx} cy={py(B.bars[upTo]!.c)} r={4} fill="white" stroke="#05070d" strokeWidth={2} />
    </>
  );
}

export function BacktestRewind() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [manual, setManual] = useState<number | null>(null);
  const [t, restart] = useClock(inView && manual === null, PLAY_S + 2.5, 50);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const upTo = manual ?? Math.round(START_IDX + (N - 1 - START_IDX) * Math.min(1, t / PLAY_S));
  const st = statsAt(B, upTo);
  const hold = B.hold[upTo]! / B.capital - 1;

  const seek = useCallback((clientX: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(clientX, 0).matrixTransform(ctm.inverse());
    setManual(Math.max(1, Math.min(N - 1, Math.floor(p.x / step))));
  }, []);
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(e.clientX);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => dragging.current && seek(e.clientX);
  const onUp = () => {
    dragging.current = false;
  };
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'PageUp' ? 13 : e.key === 'PageDown' ? -13 : 0;
    if (!d) return;
    e.preventDefault();
    setManual(Math.max(1, Math.min(N - 1, upTo + d)));
  };

  const tiles: Array<[string, string, string?]> = [
    ['Account value', inr(st.value), st.value >= B.capital ? 'text-bull' : 'text-bear'],
    ['Return', pct(st.ret), st.ret >= 0 ? 'text-bull' : 'text-bear'],
    ['Buy & hold', pct(hold), 'text-slate-300'],
    ['Win rate', st.winRate === null ? '—' : `${Math.round(st.winRate * 100)}%`],
    ['Profit factor', st.profitFactor === null ? '—' : Number.isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : '∞'],
    ['Max drawdown', `−${(st.maxDrawdown * 100).toFixed(1)}%`, 'text-bear'],
  ];

  return (
    <Section id="backtest">
      <SectionHead
        no="05"
        kicker="Backtest"
        title={
          <>
            Rewind
            <br />
            the market.
          </>
        }
        sub="Your strategy, your capital, years of Kite candles. Win rate, profit factor, max drawdown and every trade with its reason. Runs in the background, no caps."
      />
      <Reveal className="mt-14">
        <div ref={ref} className={clsx(s.panel, 'grid gap-6 p-4 sm:p-7 lg:grid-cols-12')}>
          <div className="lg:col-span-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className={clsx(s.mono, 'flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500')}>
                <span className="text-slate-300">SAMPLE · weekly</span>
                <span>
                  <span className="text-accent-soft">━</span> SMA 8
                </span>
                <span>
                  <span className="text-warn">━</span> SMA 21
                </span>
                <span>{inr(B.capital)} capital</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={clsx(s.mono, 'rounded-md bg-white/[0.06] px-2 py-1 text-xs tabular-nums text-fg')}>{dateOf(upTo)}</span>
                <Tooltip
                  content={
                    manual === null
                      ? { title: 'Pause', body: 'Stops the replay here; drag the chart to move through time.' }
                      : { title: 'Play', body: 'Replays the backtest from the start.' }
                  }
                >
                  <button
                    type="button"
                    aria-label={manual === null ? 'Pause' : 'Play'}
                    onClick={() => {
                      if (manual === null) setManual(upTo);
                      else {
                        setManual(null);
                        restart();
                      }
                    }}
                    className="rounded-full border border-white/10 p-2 text-slate-400 transition-colors hover:border-white/30 hover:text-fg"
                  >
                    {manual === null ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                </Tooltip>
              </div>
            </div>
            <Tooltip content={LANDING_HELP.scrub} className="block">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${W} ${H}`}
                className="block h-auto w-full cursor-ew-resize touch-none select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                role="slider"
                tabIndex={0}
                aria-label="Backtest date"
                aria-valuemin={1}
                aria-valuemax={N - 1}
                aria-valuenow={upTo}
                aria-valuetext={dateOf(upTo)}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onKeyDown={onKey}
              >
                <Chart upTo={upTo} />
              </svg>
            </Tooltip>
          </div>

          <div className="flex flex-col gap-5 lg:col-span-4">
            <div className="grid grid-cols-2 gap-2.5">
              {tiles.map(([label, value, cls]) => (
                <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
                  <div className={clsx(s.mono, 'text-[10px] uppercase tracking-[0.16em] text-slate-500')}>{label}</div>
                  <div className={clsx(s.mono, 'mt-1 text-[17px] font-semibold tabular-nums', cls ?? 'text-fg')}>{value}</div>
                </div>
              ))}
            </div>
            <div>
              <div className={clsx(s.mono, 'mb-2 flex justify-between text-[10px] uppercase tracking-[0.16em] text-slate-500')}>
                <span>Monthly returns</span>
                <span>{st.trades} trades</span>
              </div>
              <div className="space-y-1">
                {Array.from({ length: B.years }, (_, yr) => (
                  <div key={yr} className="flex items-center gap-1">
                    <span className={clsx(s.mono, 'w-9 text-[10px] text-slate-600')}>{B.firstYear + yr}</span>
                    {MONTHS.slice(yr * 12, yr * 12 + 12).map((m, mi) => {
                      const shown = m.end <= upTo;
                      const a = Math.min(1, Math.abs(m.ret) / 0.08);
                      const flat = Math.abs(m.ret) < 0.001;
                      return (
                        <span
                          key={mi}
                          className="h-4 flex-1 rounded-[3px] transition-colors duration-300"
                          style={{
                            background: !shown
                              ? 'rgb(255 255 255 / 0.03)'
                              : flat
                                ? 'rgb(255 255 255 / 0.1)'
                                : `rgb(var(${m.ret > 0 ? '--bull' : '--bear'}) / ${0.25 + a * 0.75})`,
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Reveal>
      <Reveal className="mt-8 flex flex-wrap gap-2.5" delay={100}>
        <FeatureChip icon={<ListChecks />} label="Every order and why" help={LANDING_HELP.btOrders} />
        <FeatureChip icon={<Scale />} label="vs NIFTY 50 buy & hold" help={LANDING_HELP.btBenchmark} />
        <FeatureChip icon={<CalendarRange />} label="Any period, any products" help={LANDING_HELP.btNoCaps} />
        <FeatureChip icon={<History />} label="History: open any run again" help={LANDING_HELP.btHistory} />
        <FeatureChip icon={<FileSpreadsheet />} label="CSV of every trade" help={LANDING_HELP.btCsv} />
      </Reveal>
      <DemoNote>Synthetic prices · the figures are computed from them, live</DemoNote>
    </Section>
  );
}
