'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { CandlestickChart, Layers, Moon, Pyramid, TrendingUp, Zap } from 'lucide-react';
import { LANDING_HELP } from './help';
import { FeatureChip, Reveal, useInView, useReducedMotion } from './kit';
import s from './landing.module.css';

/** The engine's specs, read like an exchange tape. */
const SPECS: Array<[string, string]> = [
  ['LEGS', 'SPOT · FUT · CE · PE'],
  ['STRIKES', 'ATM ±3'],
  ['EXPIRY', 'Current · Next · Far'],
  ['TIMEFRAMES', '1m → Weekly'],
  ['CANDLES', 'Normal · Heikin Ashi · Volume'],
  ['INDICATORS', 'RSI · MACD · Supertrend · ADX · BB'],
  ['PATTERNS', '17 candlestick'],
  ['STREAM', '9,000 contracts'],
  ['CLOSE → SIGNAL', '~2 s'],
  ['F&O STOCKS', '~210'],
  ['INDICES', '212'],
  ['PAPER', '₹10,000 / trade'],
  ['SL / TGT', '−10 % / +20 %'],
  ['SQUARE-OFF', '15:20 · 23:20'],
  ['ORDERS PLACED', '0'],
];

type Tone = 'bull' | 'bear' | 'ce' | 'pe' | 'key';
const TONE: Record<Tone, string> = {
  bull: 'rgb(var(--bull))',
  bear: 'rgb(var(--bear))',
  ce: 'rgb(var(--leg-ce))',
  pe: 'rgb(var(--leg-pe))',
  key: 'rgb(var(--fg))',
};

/** What a trader scans for. Inside the scanner each takes the app's colours: green / red = direction, violet / pink = calls / puts. */
const TERMS: Array<[string, Tone]> = [
  ['LONG BUILD-UP', 'bull'],
  ['PCR', 'key'],
  ['SHORT COVERING', 'bull'],
  ['CALL WALL', 'ce'],
  ['RSI CROSS 60', 'key'],
  ['SHORT BUILD-UP', 'bear'],
  ['MAX PAIN', 'key'],
  ['PUT WALL', 'pe'],
  ['GOLDEN CROSS', 'bull'],
  ['SUPERTREND', 'key'],
  ['LONG UNWINDING', 'bear'],
  ['BOLLINGER SQUEEZE', 'key'],
  ['52-WEEK BREAKOUT', 'bull'],
  ['CPR', 'key'],
  ['THREE BLACK CROWS', 'bear'],
  ['ATM STRADDLE', 'key'],
  ['MORNING STAR', 'bull'],
  ['PYRAMIDING', 'key'],
  ['GAP DOWN', 'bear'],
  ['TRAILING SL', 'key'],
  ['FII / DII', 'key'],
  ['INDIA VIX', 'key'],
];

/** Indices, F&O stocks and MCX contracts, commodities mixed in. */
const PRODUCTS: Array<[string, string]> = [
  ['CRUDEOIL', 'MCX'],
  ['NIFTY', 'NSE IDX'],
  ['GOLD', 'MCX'],
  ['BANKNIFTY', 'NSE IDX'],
  ['SILVER', 'MCX'],
  ['RELIANCE', 'NSE F&O'],
  ['NATURALGAS', 'MCX'],
  ['SENSEX', 'BSE IDX'],
  ['COPPER', 'MCX'],
  ['HDFCBANK', 'NSE F&O'],
  ['ZINC', 'MCX'],
  ['FINNIFTY', 'NSE IDX'],
  ['ICICIBANK', 'NSE F&O'],
  ['MIDCPNIFTY', 'NSE IDX'],
  ['INFY', 'NSE F&O'],
  ['BANKEX', 'BSE IDX'],
  ['TCS', 'NSE F&O'],
  ['SBIN', 'NSE F&O'],
  ['TATASTEEL', 'NSE F&O'],
  ['LT', 'NSE F&O'],
  ['ITC', 'NSE F&O'],
  ['AXISBANK', 'NSE F&O'],
  ['BHARTIARTL', 'NSE F&O'],
];

const EDGE_FADE = '[mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]';
const STEP_MS = 1300;
const SHIFT = 'transform 480ms cubic-bezier(0.7, 0, 0.2, 1)';

/** One shared beat: every row shifts by one item on it (on screen, tab visible, not hovered). */
function useBeat(active: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => document.visibilityState === 'visible' && setStep((n) => n + 1), STEP_MS);
    return () => clearInterval(id);
  }, [active]);
  return step;
}

/**
 * A row that shifts one item per beat (right to left, or left to right with `reverse`) and stops with the
 * current item centred. The items are laid out three times so it loops without a visible jump: after a
 * shift leaves the middle copy, it snaps back to the same item there with no transition.
 */
function StepTrack<T>({
  items,
  step,
  reverse = false,
  smooth = true,
  render,
  onActiveWidth,
  className,
}: {
  items: T[];
  step: number;
  reverse?: boolean;
  smooth?: boolean;
  render: (item: T, active: boolean) => ReactNode;
  onActiveWidth?: (px: number) => void;
  className?: string;
}) {
  const n = items.length;
  const host = useRef<HTMLDivElement>(null);
  const cells = useRef<Array<HTMLDivElement | null>>([]);
  const [pos, setPos] = useState(n);
  const [animate, setAnimate] = useState(true);
  const [geo, setGeo] = useState<{ x: number[]; w: number[]; width: number } | null>(null);
  const seen = useRef(step);

  useEffect(() => {
    const d = step - seen.current;
    seen.current = step;
    if (!d) return;
    setAnimate(smooth);
    setPos((p) => {
      const home = p >= 2 * n ? p - n : p < n ? p + n : p; // a shift whose transition never ended
      return home + (reverse ? -d : d);
    });
  }, [step, reverse, smooth, n]);

  useEffect(() => {
    const measure = () => {
      if (!host.current) return;
      setGeo({ x: cells.current.map((c) => c?.offsetLeft ?? 0), w: cells.current.map((c) => c?.offsetWidth ?? 0), width: host.current.clientWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (host.current) ro.observe(host.current);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, []);

  const width = geo?.w[pos] ?? 0;
  useEffect(() => {
    if (width) onActiveWidth?.(width);
  }, [width, onActiveWidth]);

  const settle = () => {
    if (pos >= 2 * n || pos < n) {
      setAnimate(false);
      setPos(pos >= 2 * n ? pos - n : pos + n);
    }
  };
  const offset = geo ? geo.width / 2 - (geo.x[pos]! + geo.w[pos]! / 2) : 0;

  return (
    <div ref={host} className={clsx('overflow-hidden', className)}>
      <div
        // A snap back to the middle copy swaps which copy is lit: no fade, so it looks like nothing happened.
        className={clsx('flex w-max items-center', !animate && '[&_*]:!transition-none')}
        style={{ transform: `translateX(${offset}px)`, transition: animate && geo ? SHIFT : 'none', opacity: geo ? 1 : 0 }}
        onTransitionEnd={(e) => e.target === e.currentTarget && e.propertyName === 'transform' && settle()}
      >
        {[0, 1, 2].flatMap((copy) =>
          items.map((item, i) => {
            const g = copy * n + i;
            return (
              <div
                key={g}
                ref={(el) => {
                  cells.current[g] = el;
                }}
                className="shrink-0"
                aria-hidden={copy !== 1 || undefined}
              >
                {render(item, g === pos)}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

/**
 * The scanner: a trading term and a product step into the lens together, from opposite sides, and stay
 * long enough to read. Lit inside the lens (terms in their colour, products in the accent), outlined outside.
 */
function Scanner({ step, smooth }: { step: number; smooth: boolean }) {
  const [termW, setTermW] = useState(0);
  const [productW, setProductW] = useState(0);
  const lensW = Math.max(termW, productW);

  return (
    <div className={clsx('relative py-3', EDGE_FADE)}>
      <StepTrack
        items={TERMS}
        step={step}
        smooth={smooth}
        className="py-3"
        onActiveWidth={setTermW}
        render={([term, tone], on) => (
          <span
            className={clsx(s.display, s.word, on && s.wordOn, 'block whitespace-nowrap px-5 text-[clamp(1.6rem,5vw,4rem)] sm:px-7')}
            // White words glow blue: a white glow reads as a box behind the word.
            style={{ ['--word' as string]: TONE[tone], ['--glow' as string]: tone === 'key' ? 'rgb(var(--accent))' : undefined }}
          >
            {term}
          </span>
        )}
      />
      <StepTrack
        className="-mt-3 py-3"
        items={PRODUCTS}
        step={step}
        reverse
        smooth={smooth}
        onActiveWidth={setProductW}
        render={([sym, seg], on) => (
          <span className="flex items-center gap-3 px-5 sm:px-7">
            <span
              className={clsx(s.display, s.word, on && s.wordOn, 'whitespace-nowrap text-[clamp(1.45rem,4.2vw,3.4rem)]')}
              style={{ ['--word' as string]: 'rgb(var(--accent))' }}
            >
              {sym}
            </span>
            <span
              className={clsx(
                s.mono,
                'whitespace-nowrap rounded border px-1.5 py-0.5 text-[9px] tracking-[0.18em] transition-colors duration-300',
                on ? 'border-accent/60 text-accent-soft' : 'border-white/10 text-slate-600',
              )}
            >
              {seg}
            </span>
          </span>
        )}
      />
      <div
        className="pointer-events-none absolute inset-y-2 left-1/2 -translate-x-1/2"
        style={{ width: lensW ? lensW + 16 : '26%', transition: 'width 480ms cubic-bezier(0.7, 0, 0.2, 1)' }}
        aria-hidden
      >
        {[
          'left-0 top-0 border-l-2 border-t-2',
          'right-0 top-0 border-r-2 border-t-2',
          'bottom-0 left-0 border-b-2 border-l-2',
          'bottom-0 right-0 border-b-2 border-r-2',
        ].map((c) => (
          <span key={c} className={clsx('absolute h-4 w-4 border-accent', c)} />
        ))}
        <span className={clsx(s.mono, 'absolute -top-0.5 left-6 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.25em] text-accent-soft')}>
          <span className={clsx(s.pulse, 'h-1 w-1 rounded-full bg-accent')} />
          scanning
        </span>
      </div>
    </div>
  );
}

export function TickerTape() {
  const [ref, inView] = useInView<HTMLElement>();
  const [hover, setHover] = useState(false);
  const reduced = useReducedMotion();
  const step = useBeat(inView && !hover);
  return (
    <section
      ref={ref}
      id="traders"
      aria-label="Built for super traders"
      className="relative scroll-mt-16 border-y border-white/[0.06] bg-white/[0.015]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-14 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <Reveal className="lg:col-span-6">
            <div className={clsx(s.mono, 'flex items-center gap-2.5 text-[11px] uppercase tracking-[0.28em] text-accent-soft')}>
              <span className={clsx(s.pulse, 'h-1.5 w-1.5 rounded-full bg-accent')} />
              Who it’s for
            </div>
            <h2 className={clsx(s.display, 'mt-4 text-[clamp(2.2rem,4.6vw,3.6rem)] text-fg')}>
              Built for
              <br />
              <span className="text-accent">super traders.</span>
            </h2>
            <p className="mt-4 max-w-md text-[16px] leading-relaxed text-slate-400">
              Scalpers, option writers, F&amp;O desks and MCX night traders. One engine, every edge, from the first tick to the last square-off.
            </p>
          </Reveal>
          <Reveal className="flex flex-wrap gap-2.5 lg:col-span-6 lg:justify-end" delay={100}>
            <FeatureChip icon={<Zap />} label="Index option scalpers" help={LANDING_HELP.personas.scalpers} />
            <FeatureChip icon={<Layers />} label="Option buyers & writers" help={LANDING_HELP.personas.options} />
            <FeatureChip icon={<CandlestickChart />} label="F&O stock traders" help={LANDING_HELP.personas.stocks} />
            <FeatureChip icon={<Moon />} label="MCX night desk" help={LANDING_HELP.personas.mcx} />
            <FeatureChip icon={<TrendingUp />} label="Swing & positional" help={LANDING_HELP.personas.swing} />
            <FeatureChip icon={<Pyramid />} label="Trend pyramiders" help={LANDING_HELP.personas.pyramid} />
          </Reveal>
        </div>
      </div>

      <StepTrack
        className={clsx('border-y border-white/[0.06] bg-black/20', EDGE_FADE)}
        items={SPECS}
        step={step}
        smooth={!reduced}
        render={([k, v], on) => (
          <span className={clsx('flex items-baseline gap-3 border-r border-white/[0.06] px-6 py-3.5 transition-colors duration-300', on && 'bg-white/[0.04]')}>
            <span className={clsx(s.mono, 'text-[10px] tracking-[0.22em] transition-colors duration-300', on ? 'text-accent-soft' : 'text-slate-600')}>
              {k}
            </span>
            <span className={clsx(s.mono, 'whitespace-nowrap text-[14px] font-semibold transition-colors duration-300', on ? 'text-fg' : 'text-slate-500')}>
              {v}
            </span>
          </span>
        )}
      />

      <Scanner step={step} smooth={!reduced} />
    </section>
  );
}
