'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight, Play } from 'lucide-react';
import { Tooltip } from '@/client/components/Tooltip';
import { heroBars, rng, sma, type Bar } from './data';
import { LANDING_HELP } from './help';
import { num, useInView, useReducedMotion } from './kit';
import s from './landing.module.css';

// ---------------------------------------------------------------------------
// Background chart with a TradingView-style crosshair that follows the mouse.

const W = 1200;
const H = 520;
const PLOT_W = 1130;
const BARS = 75; // 09:15 → 15:30 in 5-minute candles

const clock = (i: number) => {
  const m = 9 * 60 + 15 + i * 5;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function HeroChart({ host }: { host: RefObject<HTMLElement | null> }) {
  const base = useMemo(() => heroBars(BARS), []);
  const [last, setLast] = useState<Bar>(base[BARS - 1]!);
  // x / y in chart units; px / py in pixels from the chart's top-left (for the readout).
  const [cross, setCross] = useState<{ x: number; y: number; px: number; py: number; flip: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();

  // The last candle keeps ticking.
  useEffect(() => {
    if (reduced || !inView) return;
    const r = rng(99);
    const open = base[BARS - 1]!;
    const id = setInterval(() => {
      setLast((b) => {
        const c = Math.max(open.o * 0.997, Math.min(open.o * 1.003, b.c * (1 + (r() - 0.5) * 0.0012)));
        return { o: b.o, c, h: Math.max(b.h, c), l: Math.min(b.l, c) };
      });
    }, 420);
    return () => clearInterval(id);
  }, [base, reduced, inView]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ctm = svgRef.current?.getScreenCTM();
        if (!ctm) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
        const box = ref.current?.getBoundingClientRect();
        if (!box || p.x < 0 || p.x > PLOT_W || p.y < 0 || p.y > H || e.clientY < box.top) return setCross(null);
        const px = e.clientX - box.left;
        setCross({ x: p.x, y: p.y, px, py: e.clientY - box.top, flip: px > box.width - 360 });
      });
    };
    const leave = () => setCross(null);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [host, ref]);

  const bars = useMemo(() => [...base.slice(0, -1), last], [base, last]);
  const lo = Math.min(...base.map((b) => b.l)) * 0.9994;
  const hi = Math.max(...base.map((b) => b.h)) * 1.0006;
  const y = (v: number) => 24 + ((hi - v) / (hi - lo)) * (H - 48);
  const priceAt = (py: number) => hi - ((py - 24) / (H - 48)) * (hi - lo);
  const step = PLOT_W / BARS;
  const ma = useMemo(
    () =>
      sma(
        bars.map((b) => b.c),
        20,
      ),
    [bars],
  );
  const maPath = ma
    .map((v, i) => (v === null ? null : `${(i + 0.5) * step},${y(v)}`))
    .filter(Boolean)
    .join(' ');
  const hover = cross ? Math.min(BARS - 1, Math.max(0, Math.floor(cross.x / step))) : null;
  const shown = bars[hover ?? BARS - 1]!;
  const change = shown.c / bars[0]!.o - 1;

  return (
    <div ref={ref} className={clsx('pointer-events-none absolute inset-x-0 bottom-0 top-[28%]', s.fadeY)}>
      {cross && (
        <div
          className={clsx(
            s.mono,
            'absolute z-10 flex gap-3 whitespace-nowrap rounded-lg border border-white/10 bg-[#05070d]/85 px-3 py-2 text-[11px] text-slate-500 backdrop-blur',
          )}
          style={{ left: cross.px, top: cross.py, transform: cross.flip ? 'translate(calc(-100% - 16px), 16px)' : 'translate(16px, 16px)' }}
        >
          <span className="text-slate-300">SAMPLE · 5m</span>
          {(['o', 'h', 'l', 'c'] as const).map((k) => (
            <span key={k}>
              {k.toUpperCase()} <span className={shown.c >= shown.o ? 'text-bull' : 'text-bear'}>{num(shown[k], 1)}</span>
            </span>
          ))}
          <span className={change >= 0 ? 'text-bull' : 'text-bear'}>
            {change >= 0 ? '+' : '−'}
            {Math.abs(change * 100).toFixed(2)}%
          </span>
          {hover !== null && <span className="text-slate-400">{clock(hover)}</span>}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1={0} x2={PLOT_W} y1={24 + (i * (H - 48)) / 8} y2={24 + (i * (H - 48)) / 8} stroke="rgb(255 255 255 / 0.04)" />
        ))}
        {bars.map((b, i) => {
          const up = b.c >= b.o;
          const cx = (i + 0.5) * step;
          const lit = hover === i;
          return (
            <g key={i} opacity={lit ? 1 : 0.42}>
              <line x1={cx} x2={cx} y1={y(b.h)} y2={y(b.l)} stroke={up ? 'rgb(var(--bull))' : 'rgb(var(--bear))'} strokeWidth={1.2} />
              <rect
                x={cx - step * 0.32}
                width={step * 0.64}
                y={y(Math.max(b.o, b.c))}
                height={Math.max(1.2, Math.abs(y(b.o) - y(b.c)))}
                rx={1}
                fill={up ? 'rgb(var(--bull))' : 'rgb(var(--bear))'}
              />
            </g>
          );
        })}
        <polyline points={maPath} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} opacity={0.75} />
        {/* last price */}
        <line x1={0} x2={PLOT_W} y1={y(last.c)} y2={y(last.c)} stroke="rgb(var(--accent-soft))" strokeDasharray="3 5" opacity={0.5} />
        <rect x={PLOT_W + 4} y={y(last.c) - 11} width={66} height={22} rx={4} fill="rgb(var(--accent))" />
        <text x={PLOT_W + 37} y={y(last.c) + 4} textAnchor="middle" className={s.mono} fontSize={11} fill="white">
          {num(last.c, 1)}
        </text>
        {cross && (
          <g>
            <line x1={cross.x} x2={cross.x} y1={0} y2={H} stroke="rgb(255 255 255 / 0.35)" strokeDasharray="4 4" />
            <line x1={0} x2={PLOT_W} y1={cross.y} y2={cross.y} stroke="rgb(255 255 255 / 0.35)" strokeDasharray="4 4" />
            <rect x={PLOT_W + 4} y={cross.y - 11} width={66} height={22} rx={4} fill="rgb(51 65 85)" />
            <text x={PLOT_W + 37} y={cross.y + 4} textAnchor="middle" className={s.mono} fontSize={11} fill="white">
              {num(priceAt(cross.y), 1)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split-flap alert board.

const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function Flap({ text, len, delay = 0 }: { text: string; len: number; delay?: number }) {
  const target = text.toUpperCase().padEnd(len, ' ').slice(0, len);
  const [shown, setShown] = useState(target);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      setShown(target);
      return;
    }
    let step = 0;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      id = setInterval(() => {
        step += 1;
        setShown(
          [...target].map((ch, i) => (/[^A-Z0-9]/.test(ch) || step > 3 + i * 0.7 ? ch : FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)])).join(''),
        );
        if (step > 4 + len * 0.7) clearInterval(id);
      }, 55);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(id);
    };
  }, [target, delay, len, reduced]);
  return (
    <span className="inline-flex gap-[0.12em]">
      {[...shown].map((ch, i) => (
        <span key={i} className={s.tile}>
          <span key={ch} className={s.flip}>
            {ch === ' ' ? ' ' : ch}
          </span>
        </span>
      ))}
    </span>
  );
}

interface BoardRow {
  strategy: string;
  product: string;
  up: boolean;
  leg: string;
  took: number;
}

const BOARD: BoardRow[] = [
  { strategy: 'FUT LEADS CE', product: 'NIFTY', up: true, leg: 'CE ATM', took: 2.1 },
  { strategy: 'RSI CROSS 60', product: 'BANKNIFTY', up: true, leg: 'FUT', took: 1.8 },
  { strategy: 'BB SQUEEZE', product: 'CRUDEOIL', up: false, leg: 'PE ATM', took: 2.4 },
  { strategy: '20-BAR HIGH', product: 'RELIANCE', up: true, leg: 'SPOT', took: 2.0 },
  { strategy: 'CALL UP PUT DN', product: 'GOLD', up: true, leg: 'CE ATM+1', took: 2.6 },
  { strategy: 'SUPERTREND', product: 'SENSEX', up: false, leg: 'PE ATM', took: 1.9 },
  { strategy: 'RSI > RSI MA', product: 'HDFCBANK', up: true, leg: 'FUT', took: 2.2 },
  { strategy: '3-CANDLE LOW', product: 'NATURALGAS', up: false, leg: 'FUT', took: 2.3 },
];

const rowTime = (n: number, took: number) => {
  const m = 9 * 60 + 20 + (n % 74) * 5;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(Math.floor(took)).padStart(2, '0')}`;
};

function AlertBoard() {
  const [head, setHead] = useState(3);
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!inView || reduced) return;
    const id = setInterval(() => setHead((h) => h + 1), 3600);
    return () => clearInterval(id);
  }, [inView, reduced]);

  const rows = [0, 1, 2, 3].map((slot) => {
    const n = head - slot;
    return { n, slot, ...BOARD[n % BOARD.length]! };
  });
  const th = (label: string, cls?: string) => <div className={clsx(s.mono, 'pb-1 text-[10px] uppercase tracking-[0.2em] text-slate-500', cls)}>{label}</div>;

  return (
    <div ref={ref} className={clsx(s.panel, 'mt-14 overflow-hidden p-4 sm:p-6')}>
      <div className="mb-4 flex items-center justify-between">
        <Tooltip content={LANDING_HELP.board}>
          <span tabIndex={0} className={clsx(s.mono, 'inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400 outline-none')}>
            <span className={clsx(s.pulse, 'h-1.5 w-1.5 rounded-full bg-warn')} />
            Alert board <span className="text-slate-600">· example</span>
          </span>
        </Tooltip>
        <span className={clsx(s.mono, 'hidden text-[11px] text-slate-600 sm:inline')}>Telegram · Email · Desktop</span>
      </div>
      <div
        className={clsx(
          s.mono,
          'grid grid-cols-[auto_auto_auto_1fr] items-center gap-x-[0.9em] gap-y-[0.45em] text-[clamp(9px,1.12vw,15px)] md:grid-cols-[auto_auto_auto_auto_auto_1fr]',
        )}
      >
        {th('Time')}
        {th('Strategy', 'hidden md:block')}
        {th('Product')}
        {th('')}
        {th('Leg', 'hidden md:block')}
        {th('Checked', 'text-right')}
        {rows.map((r) => (
          <BoardLine key={r.slot} row={r} />
        ))}
      </div>
    </div>
  );
}

function BoardLine({ row }: { row: BoardRow & { n: number; slot: number } }) {
  const delay = row.slot * 110;
  return (
    <>
      <Flap text={rowTime(row.n, row.took)} len={8} delay={delay} />
      <span className="hidden md:inline-flex">
        <Flap text={row.strategy} len={14} delay={delay + 40} />
      </span>
      <Flap text={row.product} len={10} delay={delay + 80} />
      <span className={clsx(s.tile, row.up ? 'text-bull' : 'text-bear')}>
        <span key={row.n} className={s.flip}>
          {row.up ? '▲' : '▼'}
        </span>
      </span>
      <span className="hidden md:inline-flex">
        <Flap text={row.leg} len={8} delay={delay + 120} />
      </span>
      <span key={row.n} className="flex items-center justify-end gap-2 text-[0.85em]">
        <span className="hidden rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-accent-soft sm:inline">✓ VERIFIED</span>
        <span className="text-slate-400">{row.took.toFixed(1)}s</span>
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Hero() {
  const host = useRef<HTMLElement>(null);
  return (
    <section ref={host} id="top" className="relative overflow-hidden px-4 pb-20 pt-28 sm:px-6 sm:pt-36">
      <div className={clsx(s.grid, 'pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top,#000_30%,transparent_75%)]')} />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[620px] w-[1100px] -translate-x-1/2 rounded-full bg-accent/20 blur-[140px]" />
      <HeroChart host={host} />

      <div className="relative mx-auto max-w-6xl">
        <Tooltip content={LANDING_HELP.liveData} side="bottom">
          <span
            tabIndex={0}
            className={clsx(
              s.mono,
              'inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[11px] uppercase tracking-[0.2em] text-slate-300 outline-none backdrop-blur',
            )}
          >
            <span className="relative flex h-2 w-2">
              <span className={clsx(s.halo, 'absolute inset-0 rounded-full bg-accent')} />
              <span className="relative h-2 w-2 rounded-full bg-accent" />
            </span>
            Zerodha Kite · NSE F&amp;O · BSE · MCX
          </span>
        </Tooltip>

        <div className="mt-8">
          <h1 className={clsx(s.display, 'text-[clamp(2.6rem,6.5vw,5.75rem)] text-fg')}>
            Strategy <span className="text-accent">+</span> Product
            <br />
            <span className="text-accent">=</span> <span className={s.alertText}>Alert.</span>
          </h1>
          <div className="mt-9 flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-lg text-[17px] leading-relaxed text-slate-300 sm:text-lg">
              Multi-leg strategies on spot, futures and ATM options. Run them on any index, F&amp;O stock or MCX contract. Kite-verified signals seconds after
              the candle closes.
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <Tooltip content={LANDING_HELP.openApp}>
                <Link
                  href="/login"
                  className="group inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white shadow-[0_10px_40px_-8px_rgb(var(--accent)/0.9)] transition-transform hover:scale-[1.03]"
                >
                  Open Algo Hunt
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Tooltip>
              <Tooltip content={LANDING_HELP.seeItWork}>
                <a
                  href="#build"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-5 py-3 text-[15px] font-medium text-slate-200 backdrop-blur transition-colors hover:border-white/30"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  See it work
                </a>
              </Tooltip>
            </div>
          </div>
        </div>

        <AlertBoard />
      </div>
    </section>
  );
}
