'use client';

import { useEffect, useReducer } from 'react';
import clsx from 'clsx';
import { FileText, ShieldOff } from 'lucide-react';
import { Tooltip } from '@/client/components/Tooltip';
import { rng } from './data';
import { DemoNote, Reveal, Section, SectionHead, inr, signedInr, useInView, useReducedMotion } from './kit';
import s from './landing.module.css';

const CASH = 10_000;
const TARGET = 20;
const STOP = -10;

interface Trade {
  id: number;
  contract: string;
  strategy: string;
  time: string;
  entry: number;
  pct: number;
  closed?: 'TARGET' | 'STOP';
  closedFor?: number;
}

const CATALOG = [
  { contract: 'NIFTY 25400 CE', strategy: 'Future leads the call', entry: 186.4 },
  { contract: 'BANKNIFTY 57000 PE', strategy: 'Call up, put down', entry: 412.15 },
  { contract: 'CRUDEOIL 5800 CE', strategy: 'BB squeeze', entry: 128.7 },
  { contract: 'HDFCBANK 1000 CE', strategy: 'RSI > RSI MA', entry: 21.35 },
  { contract: 'SENSEX 83000 CE', strategy: 'Supertrend', entry: 264.9 },
  { contract: 'NATURALGAS 300 PE', strategy: '3-candle low', entry: 11.6 },
];

const START: Trade[] = [
  { id: 0, ...CATALOG[0]!, time: '10:15', pct: 6.2 },
  { id: 1, ...CATALOG[1]!, time: '10:30', pct: -3.4 },
  { id: 2, ...CATALOG[2]!, time: '10:45', pct: 11.8 },
];

const minutesToClock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

interface Desk {
  tick: number;
  open: Trade[];
  closed: Array<{ id: number; contract: string; pnl: number; reason: 'TARGET' | 'STOP' }>;
  curve: number[];
  next: number;
  lastSpawn: number;
  clock: number;
}

const DESK: Desk = { tick: 0, open: START, closed: [], curve: [0], next: 3, lastSpawn: 0, clock: 11 * 60 };

/** One 260 ms step: prices move, trades at their target or stop close, a new alert opens a trade. Pure. */
function step(d: Desk): Desk {
  const tick = d.tick + 1;
  const r = rng(2026 + tick);
  const done: Trade[] = [];
  let open = d.open
    .filter((t) => !(t.closed && tick - (t.closedFor ?? 0) > 6))
    .map((t) => {
      if (t.closed) return t;
      const pct = Math.max(STOP, Math.min(TARGET, t.pct + (r() + r() + r() - 1.5) * 2.6));
      if (pct < TARGET && pct > STOP) return { ...t, pct };
      const c: Trade = { ...t, pct, closed: pct >= TARGET ? 'TARGET' : 'STOP', closedFor: tick };
      done.push(c);
      return c;
    });
  let { next, lastSpawn, clock } = d;
  if (open.filter((t) => !t.closed).length < 3 && tick - lastSpawn > 7) {
    clock += 15;
    open = [...open, { id: next, ...CATALOG[next % CATALOG.length]!, time: minutesToClock(clock), pct: 0 }];
    next += 1;
    lastSpawn = tick;
  }
  let curve = d.curve;
  for (const t of done) curve = [...curve, (curve.at(-1) ?? 0) + (CASH * t.pct) / 100];
  const closed = [...done.map((t) => ({ id: t.id, contract: t.contract, pnl: (CASH * t.pct) / 100, reason: t.closed! })), ...d.closed].slice(0, 4);
  return { tick, open, closed, curve: curve.slice(-24), next, lastSpawn, clock };
}

function useDesk(active: boolean): Desk {
  const [desk, advance] = useReducer(step, DESK);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(advance, 260);
    return () => clearInterval(id);
  }, [active]);
  return desk;
}

function TradeCard({ t }: { t: Trade }) {
  const pnl = (CASH * t.pct) / 100;
  const pos = ((t.pct - STOP) / (TARGET - STOP)) * 100;
  const now = t.entry * (1 + t.pct / 100);
  return (
    <div
      className={clsx(
        'rounded-2xl border p-4 transition-all duration-500',
        t.closed === 'TARGET' ? 'border-bull/60 bg-bull/10' : t.closed === 'STOP' ? 'border-bear/60 bg-bear/10' : 'border-white/[0.08] bg-white/[0.025]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={clsx(s.mono, 'rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-slate-200')}>BUY</span>
            <span className="truncate text-[15px] font-semibold text-fg">{t.contract}</span>
          </div>
          <div className={clsx(s.mono, 'mt-1 truncate text-[11px] text-slate-500')}>
            alert · {t.strategy} · {t.time}
          </div>
        </div>
        <div className="text-right">
          <div className={clsx(s.mono, 'text-[17px] font-semibold tabular-nums', pnl >= 0 ? 'text-bull' : 'text-bear')}>{signedInr(pnl)}</div>
          <div className={clsx(s.mono, 'text-[11px] tabular-nums', t.closed ? (t.closed === 'TARGET' ? 'text-bull' : 'text-bear') : 'text-slate-500')}>
            {t.closed ? (t.closed === 'TARGET' ? 'TARGET HIT' : 'STOP-LOSS') : `${t.pct >= 0 ? '+' : '−'}${Math.abs(t.pct).toFixed(1)}%`}
          </div>
        </div>
      </div>
      <div className="relative mt-4 h-2 rounded-full bg-gradient-to-r from-bear/35 via-white/10 to-bull/35">
        <span className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-white/50" style={{ left: `${((0 - STOP) / (TARGET - STOP)) * 100}%` }} />
        <span
          className={clsx(
            'absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#05070d] shadow',
            t.pct >= 0 ? 'bg-bull' : 'bg-bear',
          )}
          style={{ left: `${pos}%`, transition: 'left 260ms linear' }}
        />
      </div>
      <div className={clsx(s.mono, 'mt-2 flex justify-between text-[10px] text-slate-500')}>
        <span>SL {(t.entry * 0.9).toFixed(2)}</span>
        <span className="text-slate-400">now {now.toFixed(2)}</span>
        <span>TGT {(t.entry * 1.2).toFixed(2)}</span>
      </div>
    </div>
  );
}

export function PaperDesk() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  const { open, closed, curve } = useDesk(inView && !reduced);
  const total = curve.at(-1) ?? 0;
  const wins = closed.filter((c) => c.reason === 'TARGET').length;
  const lo = Math.min(-1500, ...curve);
  const hi = Math.max(1500, ...curve);
  const pts = curve.map((v, i) => `${(i / Math.max(1, curve.length - 1)) * 300},${70 - ((v - lo) / (hi - lo)) * 60}`).join(' ');

  return (
    <Section id="paper">
      <SectionHead
        no="04"
        kicker="Paper trading"
        title={
          <>
            Every alert
            <br />
            becomes a trade.
          </>
        }
        sub="Every signal opens a paper position: ₹10,000 a trade, +20 % target, −10 % SL, square-off at 15:20 (NSE) and 23:20 (MCX), slippage and charges in."
      />
      <Reveal className="mt-14">
        <div ref={ref} className={clsx(s.panel, 'grid gap-6 p-5 sm:p-8 lg:grid-cols-12')}>
          <div className="space-y-3 lg:col-span-7">
            {open.slice(-4).map((t) => (
              <TradeCard key={t.id} t={t} />
            ))}
          </div>
          <div className="flex flex-col gap-5 lg:col-span-5">
            <Tooltip
              content={{
                title: 'Paper settings',
                body: 'Defaults for every connection: ₹10,000 per trade, target +20 %, stop-loss −10 %, square-off 15:20 (NSE / BSE) and 23:20 (MCX), charges and 0.5 % slippage on.',
                note: 'Change them for a whole strategy, or give one connection its own values.',
              }}
            >
              <span
                tabIndex={0}
                className={clsx(
                  s.mono,
                  'inline-flex items-center gap-2 self-start rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 outline-none',
                )}
              >
                <FileText className="h-3.5 w-3.5 text-accent-soft" /> {inr(CASH)} · +20/−10%
              </span>
            </Tooltip>
            <div>
              <div className={clsx(s.mono, 'text-[11px] uppercase tracking-[0.2em] text-slate-500')}>Paper P&amp;L · closed</div>
              <div className={clsx(s.display, 'mt-2 tabular-nums text-[clamp(2.4rem,5vw,3.6rem)]', total >= 0 ? 'text-bull' : 'text-bear')}>
                {signedInr(total)}
              </div>
              <div className={clsx(s.mono, 'mt-1 text-xs text-slate-500')}>
                {wins} target · {closed.length - wins} stop <span className="text-slate-700">(last {closed.length})</span>
              </div>
            </div>
            <svg viewBox="0 0 300 76" className="h-20 w-full" aria-hidden preserveAspectRatio="none">
              <line
                x1={0}
                x2={300}
                y1={70 - ((0 - lo) / (hi - lo)) * 60}
                y2={70 - ((0 - lo) / (hi - lo)) * 60}
                stroke="rgb(255 255 255 / 0.12)"
                strokeDasharray="3 4"
              />
              <polyline
                points={pts}
                fill="none"
                stroke={total >= 0 ? 'rgb(var(--bull))' : 'rgb(var(--bear))'}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <ul className="space-y-1.5">
              {closed.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 text-[13px]">
                  <span className="truncate text-slate-300">{c.contract}</span>
                  <span className={clsx(s.mono, 'tabular-nums', c.pnl >= 0 ? 'text-bull' : 'text-bear')}>{signedInr(c.pnl)}</span>
                </li>
              ))}
              {!closed.length && <li className={clsx(s.mono, 'text-xs text-slate-600')}>Closed trades land here…</li>}
            </ul>
            <div className="mt-auto flex items-center gap-2 text-[13px] text-slate-400">
              <ShieldOff className="h-4 w-4 text-slate-500" /> Nothing is ever sent to your broker.
            </div>
          </div>
        </div>
      </Reveal>
      <DemoNote>Simulated prices · a random walk, so targets and stops both happen</DemoNote>
    </Section>
  );
}
