'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { BarChart3, Bell, Boxes, CandlestickChart, Clock3, GitBranch, History, Shuffle } from 'lucide-react';
import { steady } from './data';
import { LANDING_HELP } from './help';
import { DemoTabs, FeatureChip, LEG_COLOR, Reveal, Section, SectionHead, useClock, useInView, type LegKind } from './kit';
import s from './landing.module.css';

type LegId = 'A' | 'B' | 'C' | 'D';

interface DemoLeg {
  id: LegId;
  kind: LegKind;
  label: string;
  /** Reading at candle k (RSI, or price for SPOT). */
  value: (k: number) => number;
  /** The level a SPOT breakout compares with (highest high of the candles before k). */
  level?: (k: number) => number;
}

interface DemoCond {
  a: LegId;
  field: string;
  op: '>' | '<' | 'crossed above';
  b: LegId | number | 'LEVEL';
  bField?: string;
}

interface Preset {
  key: 'lead' | 'callPut' | 'four' | 'spot';
  name: string;
  legs: DemoLeg[];
  conds: DemoCond[];
}

const CYCLE = 16;
const CANDLE_S = 0.62;
const wave = (k: number, phase: number, mid = 50) => steady(mid - 15 * Math.cos((2 * Math.PI * (k + phase)) / CYCLE));
const cyc = (k: number) => ((k % CYCLE) + CYCLE) % CYCLE;

const SPOT_CLOSE = [101.0, 100.6, 100.9, 100.4, 100.8, 100.5, 102.3, 103.1, 102.6, 103.3, 103.0, 102.2, 101.8, 102.4, 101.6, 100.9];
const SPOT_HIGH = SPOT_CLOSE.map((c) => c + 0.35);
const spotLevel = (k: number) => {
  const i = cyc(k);
  return i === 0 ? SPOT_HIGH[CYCLE - 1]! + 1 : Math.max(...SPOT_HIGH.slice(Math.max(0, i - 20), i));
};

const FUT: DemoLeg = { id: 'A', kind: 'FUT', label: 'FUT', value: (k) => wave(k, 1.5, 52) };
const CE = (id: LegId): DemoLeg => ({ id, kind: 'CE', label: 'CE ATM', value: (k) => wave(k, 0) });
const PE = (id: LegId): DemoLeg => ({ id, kind: 'PE', label: 'PE ATM', value: (k) => steady(50 + 15 * Math.cos((2 * Math.PI * (k + 1)) / CYCLE)) });

const PRESETS: Preset[] = [
  {
    key: 'lead',
    name: 'Future leads the call',
    legs: [FUT, CE('B')],
    conds: [
      { a: 'A', field: 'RSI(14)', op: '>', b: 'B', bField: 'RSI(14)' },
      { a: 'B', field: 'RSI(14)', op: 'crossed above', b: 60 },
    ],
  },
  {
    key: 'callPut',
    name: 'Call up, put down',
    legs: [CE('A'), PE('B')],
    conds: [
      { a: 'A', field: 'RSI(14)', op: 'crossed above', b: 60 },
      { a: 'B', field: 'RSI(14)', op: '<', b: 40 },
    ],
  },
  {
    key: 'four',
    name: 'Future + 3 options',
    legs: [FUT, CE('B'), PE('C'), { id: 'D', kind: 'CE', label: 'CE ATM+1', value: (k) => wave(k, 0.5) }],
    conds: [
      { a: 'A', field: 'RSI(14)', op: '>', b: 60 },
      { a: 'B', field: 'RSI(14)', op: 'crossed above', b: 60 },
      { a: 'C', field: 'RSI(14)', op: '<', b: 40 },
      { a: 'D', field: 'RSI(14)', op: '>', b: 55 },
    ],
  },
  {
    key: 'spot',
    name: 'Spot breakout',
    legs: [{ id: 'A', kind: 'SPOT', label: 'SPOT', value: (k) => SPOT_CLOSE[cyc(k)]!, level: spotLevel }],
    conds: [{ a: 'A', field: 'Close', op: 'crossed above', b: 'LEVEL', bField: '20-candle high' }],
  },
];

function legOf(p: Preset, id: LegId) {
  return p.legs.find((l) => l.id === id)!;
}
function bValue(p: Preset, c: DemoCond, k: number) {
  if (typeof c.b === 'number') return c.b;
  if (c.b === 'LEVEL') return legOf(p, c.a).level!(k);
  return legOf(p, c.b).value(k);
}
function holds(p: Preset, c: DemoCond, k: number) {
  const a = legOf(p, c.a).value(k);
  const b = bValue(p, c, k);
  if (c.op === '>') return a > b;
  if (c.op === '<') return a < b;
  return a > b && legOf(p, c.a).value(k - 1) <= bValue(p, c, k - 1);
}
const allHold = (p: Preset, k: number) => p.conds.every((c) => holds(p, c, k));
const fires = (p: Preset, k: number) => allHold(p, k) && !allHold(p, k - 1);

const closeTime = (k: number) => {
  const m = 9 * 60 + 30 + cyc(k) * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const fmt = (leg: DemoLeg, v: number) => (leg.kind === 'SPOT' ? v.toFixed(2) : v.toFixed(1));

// Circuit geometry (SVG units).
const VB_W = 1000;
const ROW_GAP = 104;
const LEG = { x: 24, w: 236, h: 86, gap: ROW_GAP };
const COND = { x: 356, w: 366, h: 68, gap: 94 };
const GATE = { x: 780, w: 60 };
const BELL = { cx: 920, r: 42 };
/** The circuit's height fits its busiest column. */
const heightFor = (p: Preset) => Math.max(250, Math.max(p.legs.length, p.conds.length) * ROW_GAP + 70);
const ys = (n: number, gap: number, mid: number) => Array.from({ length: n }, (_, i) => mid + (i - (n - 1) / 2) * gap);

function LegNode({ leg, k, y }: { leg: DemoLeg; k: number; y: number }) {
  const color = LEG_COLOR[leg.kind];
  const top = y - LEG.h / 2;
  const pts = Array.from({ length: 12 }, (_, j) => leg.value(k - 11 + j));
  const isSpot = leg.kind === 'SPOT';
  const lo = isSpot ? Math.min(...SPOT_CLOSE) - 0.6 : 20;
  const hi = isSpot ? Math.max(...SPOT_HIGH) + 0.4 : 80;
  const sx = (j: number) => LEG.x + 16 + (j * (LEG.w - 32)) / 11;
  const sy = (v: number) => top + 78 - ((v - lo) / (hi - lo)) * 36;
  const guides = isSpot ? [leg.level!(k)] : [60, 40];
  return (
    <g>
      <rect x={LEG.x} y={top} width={LEG.w} height={LEG.h} rx={16} fill="rgb(255 255 255 / 0.03)" stroke={color} strokeOpacity={0.35} />
      <circle cx={LEG.x + 24} cy={top + 24} r={12} fill={color} fillOpacity={0.18} stroke={color} />
      <text x={LEG.x + 24} y={top + 28.5} textAnchor="middle" fontSize={12} fontWeight={700} fill={color} className={s.mono}>
        {leg.id}
      </text>
      <text x={LEG.x + 44} y={top + 29} fontSize={14} fontWeight={600} fill="rgb(var(--fg))">
        {leg.label}
      </text>
      <text x={LEG.x + LEG.w - 16} y={top + 29} textAnchor="end" fontSize={13} fill={color} className={s.mono}>
        {isSpot ? '' : 'RSI '}
        {fmt(leg, leg.value(k))}
      </text>
      {guides.map((g) => (
        <line key={g} x1={LEG.x + 16} x2={LEG.x + LEG.w - 16} y1={sy(g)} y2={sy(g)} stroke="rgb(255 255 255 / 0.18)" strokeDasharray="3 4" />
      ))}
      <polyline points={pts.map((v, j) => `${sx(j)},${sy(v)}`).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={sx(11)} cy={sy(pts[11]!)} r={3.5} fill={color} />
    </g>
  );
}

function condParts(p: Preset, c: DemoCond) {
  const a = legOf(p, c.a);
  const b = typeof c.b === 'string' && c.b !== 'LEVEL' ? legOf(p, c.b) : null;
  return { a, b };
}

function CondNode({ p, c, k, y }: { p: Preset; c: DemoCond; k: number; y: number }) {
  const ok = holds(p, c, k);
  const { a, b } = condParts(p, c);
  const top = y - COND.h / 2;
  const av = a.value(k);
  const bv = bValue(p, c, k);
  const values =
    c.op === 'crossed above'
      ? `${fmt(a, a.value(k - 1))} → ${fmt(a, av)}  vs  ${typeof c.b === 'number' ? c.b : fmt(a, bv)}`
      : `${fmt(a, av)}  vs  ${typeof c.b === 'number' ? c.b : fmt(a, bv)}`;
  return (
    <g>
      <rect
        x={COND.x}
        y={top}
        width={COND.w}
        height={COND.h}
        rx={14}
        fill={ok ? 'rgb(var(--accent) / 0.1)' : 'rgb(255 255 255 / 0.025)'}
        stroke={ok ? 'rgb(var(--accent))' : 'rgb(255 255 255 / 0.1)'}
        style={{ transition: 'all 200ms' }}
      />
      <text x={COND.x + 16} y={top + 28} fontSize={12} className={s.mono}>
        <tspan fill={LEG_COLOR[a.kind]} fontWeight={700}>
          {a.id} · {a.label}
        </tspan>
        <tspan fill="rgb(203 213 225)"> {c.field} </tspan>
        <tspan fill="rgb(var(--fg))" fontWeight={700}>
          {c.op}
        </tspan>
        {b ? (
          <>
            <tspan fill={LEG_COLOR[b.kind]} fontWeight={700}>
              {' '}
              {b.id} · {b.label}
            </tspan>
            <tspan fill="rgb(203 213 225)"> {c.bField}</tspan>
          </>
        ) : (
          <tspan fill="rgb(203 213 225)"> {typeof c.b === 'number' ? c.b : c.bField}</tspan>
        )}
      </text>
      <text x={COND.x + 16} y={top + 50} fontSize={11.5} fill="rgb(100 116 139)" className={s.mono}>
        {values}
      </text>
      <circle
        cx={COND.x + COND.w - 22}
        cy={y}
        r={9}
        fill={ok ? 'rgb(var(--accent))' : 'none'}
        stroke={ok ? 'rgb(var(--accent))' : 'rgb(255 255 255 / 0.2)'}
        strokeWidth={1.5}
      />
      {ok && <path d={`M${COND.x + COND.w - 26},${y} l3,3 l6,-6`} stroke="white" strokeWidth={2} fill="none" strokeLinecap="round" />}
    </g>
  );
}

function Circuit({ p, k }: { p: Preset; k: number }) {
  const VB_H = heightFor(p);
  const MID = VB_H / 2 - 10;
  const legY = ys(p.legs.length, LEG.gap, MID);
  const condY = ys(p.conds.length, COND.gap, MID);
  const all = allHold(p, k);
  let firedAt: number | null = null;
  for (let j = 0; j <= 3; j++) if (fires(p, k - j)) firedAt = k - j;
  const lit = firedAt !== null;
  const legIndex = (id: LegId) => p.legs.findIndex((l) => l.id === id);

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`${p.name}: legs wired to conditions, an AND gate and the alert bell`}
    >
      {/* wires: legs → conditions */}
      {p.conds.map((c, ci) => {
        const ids = [c.a, ...(typeof c.b === 'string' && c.b !== 'LEVEL' ? [c.b] : [])];
        const ok = holds(p, c, k);
        return ids.map((id) => {
          const leg = legOf(p, id);
          const ly = legY[legIndex(id)];
          const cy = condY[ci];
          const d = `M${LEG.x + LEG.w},${ly} C${LEG.x + LEG.w + 58},${ly} ${COND.x - 58},${cy} ${COND.x},${cy}`;
          return (
            <g key={`${ci}-${id}`}>
              <path d={d} fill="none" stroke={LEG_COLOR[leg.kind]} strokeOpacity={ok ? 0.55 : 0.16} strokeWidth={1.6} />
              {ok && <path d={d} pathLength={100} fill="none" stroke={LEG_COLOR[leg.kind]} strokeWidth={3} strokeLinecap="round" className={s.flow} />}
            </g>
          );
        });
      })}
      {/* wires: conditions → gate */}
      {p.conds.map((c, ci) => {
        const cy = condY[ci];
        const ok = holds(p, c, k);
        const d = `M${COND.x + COND.w},${cy} C${COND.x + COND.w + 40},${cy} ${GATE.x - 30},${MID} ${GATE.x},${MID}`;
        return (
          <g key={ci}>
            <path d={d} fill="none" stroke={ok ? 'rgb(var(--accent))' : 'rgb(255 255 255 / 0.12)'} strokeWidth={1.6} />
            {ok && <path d={d} pathLength={100} fill="none" stroke="rgb(var(--accent-soft))" strokeWidth={3} strokeLinecap="round" className={s.flow} />}
          </g>
        );
      })}
      {/* gate → bell */}
      <line x1={GATE.x + GATE.w} x2={BELL.cx - BELL.r} y1={MID} y2={MID} stroke={all ? 'rgb(var(--warn))' : 'rgb(255 255 255 / 0.12)'} strokeWidth={1.6} />

      {p.legs.map((l, i) => (
        <LegNode key={l.id} leg={l} k={k} y={legY[i]!} />
      ))}
      {p.conds.map((c, i) => (
        <CondNode key={i} p={p} c={c} k={k} y={condY[i]!} />
      ))}

      {/* AND gate */}
      <path
        d={`M${GATE.x},${MID - 30} h${GATE.w / 2} a30,30 0 0 1 0,60 h-${GATE.w / 2} z`}
        fill={all ? 'rgb(var(--accent))' : 'rgb(255 255 255 / 0.04)'}
        stroke={all ? 'rgb(var(--accent))' : 'rgb(255 255 255 / 0.18)'}
        style={{ transition: 'fill 200ms' }}
      />
      <text x={GATE.x + 28} y={MID + 4.5} textAnchor="middle" fontSize={12} fontWeight={700} fill={all ? 'white' : 'rgb(148 163 184)'} className={s.mono}>
        AND
      </text>

      {/* bell */}
      {lit && <circle cx={BELL.cx} cy={MID} r={BELL.r} fill="rgb(var(--warn) / 0.35)" className={s.halo} />}
      <circle
        cx={BELL.cx}
        cy={MID}
        r={BELL.r}
        fill={lit ? 'rgb(var(--warn) / 0.2)' : 'rgb(255 255 255 / 0.03)'}
        stroke={lit ? 'rgb(var(--warn))' : 'rgb(255 255 255 / 0.15)'}
        strokeWidth={1.6}
      />
      <g className={lit ? s.ring : undefined}>
        <Bell x={BELL.cx - 16} y={MID - 16} width={32} height={32} color={lit ? 'rgb(var(--warn))' : 'rgb(100 116 139)'} strokeWidth={1.8} />
      </g>
      <text
        x={BELL.cx}
        y={MID + BELL.r + 26}
        textAnchor="middle"
        fontSize={12}
        letterSpacing={2}
        fill={lit ? 'rgb(var(--warn))' : 'rgb(100 116 139)'}
        className={s.mono}
      >
        {lit ? `ALERT · ${closeTime(firedAt!)}` : 'WAITING'}
      </text>
    </svg>
  );
}

/** Phones: the same circuit as a list. */
function CircuitList({ p, k }: { p: Preset; k: number }) {
  let firedAt: number | null = null;
  for (let j = 0; j <= 3; j++) if (fires(p, k - j)) firedAt = k - j;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {p.legs.map((l) => (
          <div
            key={l.id}
            className="rounded-xl border bg-white/[0.03] px-3 py-2.5"
            style={{ borderColor: `color-mix(in srgb, ${LEG_COLOR[l.kind]} 40%, transparent)` }}
          >
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold" style={{ color: LEG_COLOR[l.kind] }}>
                {l.id} · {l.label}
              </span>
              <span className={clsx(s.mono, 'text-xs text-slate-300')}>{fmt(l, l.value(k))}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {p.conds.map((c, i) => {
          const ok = holds(p, c, k);
          const { a, b } = condParts(p, c);
          return (
            <div
              key={i}
              className={clsx(
                'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5',
                ok ? 'border-accent bg-accent/10' : 'border-white/10 bg-white/[0.02]',
              )}
            >
              <span className={clsx(s.mono, 'text-[12px] text-slate-300')}>
                <span style={{ color: LEG_COLOR[a.kind] }}>{a.id}</span> {c.field} {c.op}{' '}
                {b ? <span style={{ color: LEG_COLOR[b.kind] }}>{b.id}</span> : typeof c.b === 'number' ? c.b : c.bField}
              </span>
              <span className={clsx('h-3 w-3 shrink-0 rounded-full border', ok ? 'border-accent bg-accent' : 'border-white/25')} />
            </div>
          );
        })}
      </div>
      <div
        className={clsx(
          'flex items-center gap-3 rounded-xl border px-4 py-3',
          firedAt !== null ? 'border-warn bg-warn/15 text-warn' : 'border-white/10 text-slate-500',
        )}
      >
        <Bell className={clsx('h-5 w-5', firedAt !== null && s.ring)} />
        <span className={clsx(s.mono, 'text-xs tracking-widest')}>{firedAt !== null ? `ALERT · ${closeTime(firedAt)} candle` : 'WAITING FOR A CLOSE'}</span>
      </div>
    </div>
  );
}

export function BuildCircuit() {
  const [key, setKey] = useState<Preset['key']>('lead');
  const p = PRESETS.find((x) => x.key === key)!;
  const [ref, inView] = useInView<HTMLDivElement>();
  const [t, restart] = useClock(inView, CYCLE * CANDLE_S, 60);
  const k = Math.floor(t / CANDLE_S);

  return (
    <Section id="build">
      <SectionHead
        no="01"
        kicker="Build"
        title={
          <>
            Your strategy
            <br />
            is a circuit.
          </>
        }
        sub="1–4 legs: spot, futures, calls and puts at ATM ±3. RSI, MACD, Supertrend, Bollinger, ADX and 17 candle patterns, from 1 min to weekly. No product needed yet."
      />
      <Reveal className="mt-14">
        <div ref={ref} className={clsx(s.panel, 'p-4 sm:p-7')}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <DemoTabs
              label="Example strategy"
              value={key}
              onChange={(v) => {
                setKey(v);
                restart();
              }}
              options={PRESETS.map((x) => ({ value: x.key, label: x.name, help: LANDING_HELP.presets[x.key] }))}
            />
            <div className={clsx(s.mono, 'flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-500')}>
              <Clock3 className="h-3.5 w-3.5" />
              every closed 15-min candle
              <span className="text-slate-200">{closeTime(k)}</span>
            </div>
          </div>
          <div className="mt-5 flex gap-[3px]" aria-hidden>
            {Array.from({ length: CYCLE }, (_, i) => (
              <span
                key={i}
                className={clsx(
                  'h-1 flex-1 rounded-full transition-colors',
                  fires(p, i) && i <= k ? 'bg-warn' : i < k ? 'bg-white/25' : i === k ? 'bg-accent' : 'bg-white/[0.06]',
                )}
              />
            ))}
          </div>
          <div className="mt-6 hidden md:block">
            <Circuit p={p} k={k} />
          </div>
          <div className="mt-6 md:hidden">
            <CircuitList p={p} k={k} />
          </div>
        </div>
      </Reveal>
      <Reveal className="mt-8 flex flex-wrap gap-2.5" delay={100}>
        <FeatureChip icon={<Shuffle />} label="Any leg vs any leg" help={LANDING_HELP.anyLeg} />
        <FeatureChip icon={<GitBranch />} label="AND / OR / NOT" help={LANDING_HELP.groups} />
        <FeatureChip icon={<Clock3 />} label="Timeframe per value" help={LANDING_HELP.timeframes} />
        <FeatureChip icon={<Boxes />} label="Heikin Ashi · Volume candles" help={LANDING_HELP.candles} />
        <FeatureChip icon={<CandlestickChart />} label="17 candle patterns" help={LANDING_HELP.patterns} />
        <FeatureChip icon={<BarChart3 />} label="OI as a value" help={LANDING_HELP.oiValue} />
        <FeatureChip icon={<History />} label="Every save is a version" help={LANDING_HELP.versions} />
      </Reveal>
    </Section>
  );
}
