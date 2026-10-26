'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { DemoNote, DemoTabs, Reveal, Section, SectionHead, useInView, useReducedMotion } from './kit';
import { steady } from './data';
import { LANDING_HELP } from './help';
import s from './landing.module.css';

type Group = 'idx' | 'stk' | 'mcx';

const SWEEP_S = 6;
const C = 230;
const R = 190;

/** Products on the scope: angle clockwise from the top, distance from the centre. */
const BLIPS: Array<{ sym: string; group: Group; a: number; r: number; fires?: boolean }> = [
  { sym: 'NIFTY', group: 'idx', a: 18, r: 96, fires: true },
  { sym: 'SENSEX', group: 'idx', a: 58, r: 62 },
  { sym: 'BANKNIFTY', group: 'idx', a: 44, r: 152, fires: true },
  { sym: 'FINNIFTY', group: 'idx', a: 84, r: 118 },
  { sym: 'MIDCPNIFTY', group: 'idx', a: 112, r: 128 },
  { sym: 'ICICIBANK', group: 'stk', a: 146, r: 58 },
  { sym: 'RELIANCE', group: 'stk', a: 134, r: 112 },
  { sym: 'HDFCBANK', group: 'stk', a: 166, r: 160, fires: true },
  { sym: 'INFY', group: 'stk', a: 190, r: 88 },
  { sym: 'TCS', group: 'stk', a: 212, r: 140 },
  { sym: 'SBIN', group: 'stk', a: 232, r: 100 },
  { sym: 'CRUDEOIL', group: 'mcx', a: 254, r: 132, fires: true },
  { sym: 'GOLD', group: 'mcx', a: 282, r: 78 },
  { sym: 'SILVER', group: 'mcx', a: 300, r: 162 },
  { sym: 'NATURALGAS', group: 'mcx', a: 326, r: 112, fires: true },
  { sym: 'COPPER', group: 'mcx', a: 348, r: 168 },
];

/** `at`: where the sector's name sits, outside the ring. */
const SECTORS: Array<{ group: Group; from: number; to: number; at: number; label: string }> = [
  { group: 'idx', from: 0, to: 120, at: 28, label: 'NSE · BSE INDICES' },
  { group: 'stk', from: 120, to: 240, at: 180, label: 'NSE STOCKS' },
  { group: 'mcx', from: 240, to: 360, at: 300, label: 'MCX' },
];

const polar = (a: number, r: number) => {
  const t = (a * Math.PI) / 180;
  return { x: steady(C + r * Math.sin(t), 2), y: steady(C - r * Math.cos(t), 2) };
};
const wedge = (from: number, to: number) => {
  const p0 = polar(from, R);
  const p1 = polar(to, R);
  return `M${C},${C} L${p0.x},${p0.y} A${R},${R} 0 0 1 ${p1.x},${p1.y} Z`;
};

function Radar() {
  const [group, setGroup] = useState<'all' | Group>('all');
  const dim = (g: Group) => group !== 'all' && group !== g;
  return (
    <div className={clsx(s.panel, 'flex flex-col p-5 sm:p-7')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-400')}>Connections</span>
        <DemoTabs
          size="sm"
          label="Product type"
          value={group}
          onChange={setGroup}
          options={[
            { value: 'all', label: 'All', help: LANDING_HELP.radarFilter.all },
            { value: 'idx', label: 'Indices', help: LANDING_HELP.radarFilter.idx },
            { value: 'stk', label: 'Stocks', help: LANDING_HELP.radarFilter.stk },
            { value: 'mcx', label: 'MCX', help: LANDING_HELP.radarFilter.mcx },
          ]}
        />
      </div>
      <div className="relative mx-auto mt-4 w-full max-w-[460px]" style={{ ['--sweep' as string]: `${SWEEP_S}s` }}>
        <svg
          viewBox={`0 0 ${C * 2} ${C * 2}`}
          className="relative block h-auto w-full"
          role="img"
          aria-label="Radar sweeping across indices, stocks and commodities; firing products light up"
        >
          <circle cx={C} cy={C} r={R} fill="rgb(var(--accent) / 0.03)" stroke="rgb(var(--accent) / 0.35)" />
          {[R * 0.33, R * 0.66].map((r) => (
            <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="rgb(var(--accent) / 0.16)" strokeDasharray="2 5" />
          ))}
          {SECTORS.map((sec) => {
            const edge = polar(sec.from, R);
            const lab = polar(sec.at, R + 22);
            return (
              <g key={sec.group}>
                <path
                  d={wedge(sec.from, sec.to)}
                  fill={group === sec.group ? 'rgb(var(--accent) / 0.08)' : 'transparent'}
                  style={{ transition: 'fill 300ms' }}
                />
                <line x1={C} y1={C} x2={edge.x} y2={edge.y} stroke="rgb(var(--accent) / 0.2)" />
                <text
                  x={lab.x}
                  y={lab.y + 4}
                  textAnchor="middle"
                  fontSize={10.5}
                  letterSpacing={1.6}
                  fill={dim(sec.group) ? 'rgb(71 85 105)' : 'rgb(148 163 184)'}
                  className={s.mono}
                >
                  {sec.label}
                </text>
              </g>
            );
          })}
          <circle cx={C} cy={C} r={5} fill="rgb(var(--accent))" />
        </svg>
        <div className={clsx(s.sweep, 'pointer-events-none absolute')} style={{ inset: `${((C - R) / (C * 2)) * 100}%` }} />
        <svg viewBox={`0 0 ${C * 2} ${C * 2}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {BLIPS.map((b) => {
            const p = polar(b.a, b.r);
            const delay = `${(b.a / 360) * SWEEP_S - SWEEP_S}s`;
            const off = dim(b.group);
            const right = b.a < 180;
            return (
              <g key={b.sym} opacity={off ? 0.12 : 1} style={{ transition: 'opacity 300ms' }}>
                {b.fires && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={6}
                    fill="none"
                    stroke="rgb(var(--warn))"
                    strokeWidth={1.5}
                    className={s.ping}
                    style={{ animationDelay: delay }}
                  />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={b.fires ? 5 : 3.5}
                  fill={b.fires ? 'rgb(var(--warn))' : 'rgb(191 219 254)'}
                  className={s.blip}
                  style={{ animationDelay: delay }}
                />
                <text
                  x={p.x + (right ? 10 : -10)}
                  y={p.y + 4}
                  textAnchor={right ? 'start' : 'end'}
                  fontSize={11}
                  fill={b.fires ? 'rgb(var(--warn))' : 'rgb(148 163 184)'}
                  className={s.mono}
                >
                  {b.sym}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className={clsx(s.mono, 'mt-2 flex items-center justify-center gap-5 text-[11px] text-slate-500')}>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-warn" /> fired
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-200" /> watching
        </span>
      </div>
    </div>
  );
}

const COMPARE: Array<{ sym: string; type: 'INDEX' | 'STOCK' | 'MCX'; n: [number, number, number] }> = [
  { sym: 'CRUDEOIL', type: 'MCX', n: [6, 11, 24] },
  { sym: 'BANKNIFTY', type: 'INDEX', n: [5, 12, 21] },
  { sym: 'NIFTY', type: 'INDEX', n: [3, 7, 19] },
  { sym: 'NATURALGAS', type: 'MCX', n: [2, 8, 16] },
  { sym: 'HDFCBANK', type: 'STOCK', n: [4, 6, 13] },
  { sym: 'FINNIFTY', type: 'INDEX', n: [2, 4, 11] },
  { sym: 'RELIANCE', type: 'STOCK', n: [1, 5, 9] },
  { sym: 'GOLD', type: 'MCX', n: [0, 3, 8] },
];
const PERIODS = ['d5', 'd10', 'max'] as const;
const ROW_H = 46;

function Compare() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('d5');
  const [auto, setAuto] = useState(true);
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!auto || !inView || reduced) return;
    const id = setInterval(() => setPeriod((p) => PERIODS[(PERIODS.indexOf(p) + 1) % PERIODS.length]!), 3200);
    return () => clearInterval(id);
  }, [auto, inView, reduced]);

  const pi = PERIODS.indexOf(period);
  const ranked = [...COMPARE].sort((a, b) => b.n[pi]! - a.n[pi]! || a.sym.localeCompare(b.sym));
  const max = ranked[0]!.n[pi] || 1;

  return (
    <div ref={ref} className={clsx(s.panel, 'flex flex-col p-5 sm:p-7')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-400')}>Compare</div>
          <div className="mt-1 text-sm text-slate-300">Future leads the call · ranked by alerts</div>
        </div>
        <DemoTabs
          size="sm"
          label="Period"
          value={period}
          onChange={(v) => {
            setAuto(false);
            setPeriod(v);
          }}
          options={[
            { value: 'd5', label: '5 days', help: LANDING_HELP.period.d5 },
            { value: 'd10', label: '10 days', help: LANDING_HELP.period.d10 },
            { value: 'max', label: 'Max', help: LANDING_HELP.period.max },
          ]}
        />
      </div>
      <div className="relative mt-6" style={{ height: ROW_H * COMPARE.length }}>
        {COMPARE.map((row) => {
          const rank = ranked.indexOf(row);
          const n = row.n[pi]!;
          return (
            <div
              key={row.sym}
              className="absolute inset-x-0 flex items-center gap-3"
              style={{ top: rank * ROW_H, height: ROW_H - 8, transition: 'top 700ms cubic-bezier(.2,.8,.2,1)' }}
            >
              <span className={clsx(s.mono, 'w-5 text-right text-xs text-slate-600')}>{rank + 1}</span>
              <span className="w-28 shrink-0 truncate text-sm font-semibold text-fg sm:w-32">{row.sym}</span>
              <span className={clsx(s.mono, 'hidden w-12 text-[10px] tracking-wider text-slate-500 sm:inline')}>{row.type}</span>
              <span className="relative h-7 flex-1 overflow-hidden rounded-lg bg-white/[0.03]">
                <span
                  className="absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r from-accent/40 to-accent"
                  style={{ width: `${Math.max(2, (n / max) * 100)}%`, transition: 'width 700ms cubic-bezier(.2,.8,.2,1)' }}
                />
              </span>
              <span className={clsx(s.mono, 'w-7 text-right text-sm tabular-nums text-fg')}>{n}</span>
              <span
                className={clsx(
                  s.mono,
                  'hidden w-[70px] rounded-md border px-1.5 py-0.5 text-center text-[10px] tracking-wider transition-opacity sm:inline',
                  rank < 3 ? 'border-accent/50 text-accent-soft opacity-100' : 'border-transparent opacity-0',
                )}
              >
                CONNECT
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ConnectRadar() {
  return (
    <Section id="connect">
      <SectionHead
        no="02"
        kicker="Connect"
        title={
          <>
            One strategy.
            <br />
            Every market.
          </>
        }
        sub="NIFTY, BANKNIFTY, SENSEX, ~210 F&O stocks, MCX crude, gold and silver, on the current, next or far expiry. Compare ranks where your edge fires most."
      />
      <div className="mt-14 grid gap-5 lg:grid-cols-2">
        <Reveal>
          <Radar />
        </Reveal>
        <Reveal delay={120}>
          <Compare />
        </Reveal>
      </div>
      <DemoNote>Example products and counts</DemoNote>
    </Section>
  );
}
