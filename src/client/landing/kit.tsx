'use client';

/** Building blocks shared by the landing page's sections. */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import clsx from 'clsx';
import { Tooltip, type TooltipContent } from '@/client/components/Tooltip';
import s from './landing.module.css';

/** True once (or while, with `once: false`) the element is on screen. */
export function useInView<T extends Element>(opts: { once?: boolean; margin?: string } = {}): [RefObject<T | null>, boolean] {
  const { once = false, margin = '0px 0px -10% 0px' } = opts;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const on = !!entry?.isIntersecting;
        setInView(on);
        if (on && once) io.disconnect();
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, margin]);
  return [ref, inView];
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * Seconds of play time while `active` (paused, not reset, while inactive), wrapping at
 * `period`; re-renders about every `stepMs`. `restart()` goes back to 0.
 */
export function useClock(active: boolean, period?: number, stepMs = 50): [number, () => void] {
  const [t, setT] = useState(0);
  const acc = useRef(0);
  const restart = useCallback(() => {
    acc.current = 0;
    setT(0);
  }, []);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    let shown = acc.current;
    const loop = (now: number) => {
      acc.current += Math.min(0.1, (now - last) / 1000);
      last = now;
      if (period && acc.current >= period) acc.current %= period;
      if (Math.abs(acc.current - shown) * 1000 >= stepMs) {
        shown = acc.current;
        setT(acc.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, period, stepMs]);
  return [t, restart];
}

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });
  return (
    <div ref={ref} data-in={inView} className={clsx(s.reveal, className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function Section({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={clsx('relative scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28', className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHead({ no, kicker, title, sub }: { no: string; kicker: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <Reveal className="max-w-4xl">
      <div className={clsx(s.mono, 'flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-accent-soft')}>
        <span className="text-slate-500">{no}</span>
        <span className="h-px w-10 bg-accent/60" />
        {kicker}
      </div>
      <h2 className={clsx(s.display, 'mt-5 text-[clamp(2.3rem,5.6vw,4.6rem)] text-fg')}>{title}</h2>
      {sub && <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-slate-400">{sub}</p>}
    </Reveal>
  );
}

/** A small capability chip; hovering explains it. */
export function FeatureChip({ icon, label, help }: { icon?: ReactNode; label: string; help: TooltipContent }) {
  return (
    <Tooltip content={help}>
      <span
        tabIndex={0}
        className="inline-flex cursor-help items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[13px] text-slate-300 outline-none transition-colors hover:border-accent/50 hover:text-fg focus-visible:border-accent"
      >
        {icon && <span className="text-accent-soft [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
        {label}
      </span>
    </Tooltip>
  );
}

/** Segmented buttons for the demos (every option explains itself on hover). */
export function DemoTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; help: TooltipContent }>;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1">
      {options.map((o) => (
        <Tooltip key={o.value} content={o.help} side="bottom">
          <button
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={clsx(
              'rounded-xl font-medium transition-all',
              size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-[13px]',
              o.value === value
                ? 'bg-accent text-white shadow-[0_6px_24px_-6px_rgb(var(--accent)/0.8)]'
                : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100',
            )}
          >
            {o.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** Caption under a demo, saying the figures are an example. */
export function DemoNote({ children }: { children: ReactNode }) {
  return <p className={clsx(s.mono, 'mt-4 text-[11px] uppercase tracking-[0.18em] text-slate-600')}>{children}</p>;
}

export const inr = (v: number, digits = 0) => `₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
export const signedInr = (v: number) => `${v >= 0 ? '+' : '−'}${inr(v)}`;
export const pct = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(digits)}%`;
export const num = (v: number, digits = 2) => v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** Leg identity colours (CSS colour strings), as in the app. */
export const LEG_COLOR = {
  SPOT: 'rgb(var(--fg))',
  FUT: 'rgb(var(--leg-fut))',
  CE: 'rgb(var(--leg-ce))',
  PE: 'rgb(var(--leg-pe))',
} as const;
export type LegKind = keyof typeof LEG_COLOR;
