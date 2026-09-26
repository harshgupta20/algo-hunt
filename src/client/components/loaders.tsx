'use client';

/**
 * Loaders, one visual language:
 *   BrandLoader   the logo line drawing itself (pages, long operations)
 *   Skeleton*     shimmering placeholders shaped like the content (cards, tables, lists)
 *   InlineSpinner currentColor arc for buttons
 *   ActivityBar   thin accent bar under the header while pages load or saves run
 * (The inline gradient-ring `Spinner` with a label lives in ui.tsx.)
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import clsx from 'clsx';

// The logo's stroke: up the left leg, over the peak, down to the valley, up to the signal dot.
const PATH = 'M10 62 L35 16 Q40 7 45 16 L64 50 Q69 59 75 51 L98 20';
const CANDLES = [
  { x: 29, top: 46, bottom: 60, delay: '0s' },
  { x: 38, top: 40, bottom: 56, delay: '0.15s' },
  { x: 47, top: 34, bottom: 50, delay: '0.3s' },
];

export function BrandLoader({ size = 'md', label, className }: { size?: 'sm' | 'md' | 'lg'; label?: string; className?: string }) {
  const id = `bl${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const width = { sm: 56, md: 96, lg: 150 }[size];
  const text = label ?? 'Loading…';
  return (
    <div role="status" aria-live="polite" className={clsx('flex flex-col items-center justify-center gap-3', className)}>
      <svg width={width} height={Math.round(width * 0.65)} viewBox="0 -6 120 78" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#1157f1" />
            <stop offset="45%" stopColor="#267ef7" />
            <stop offset="72%" stopColor="#259ecc" />
            <stop offset="100%" stopColor="#42da9b" />
          </linearGradient>
        </defs>
        <path d={PATH} pathLength={100} fill="none" stroke={`url(#${id})`} strokeOpacity={0.14} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
        <path className="loader-draw" d={PATH} pathLength={100} fill="none" stroke={`url(#${id})`} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
        {CANDLES.map((c) => (
          <g key={c.x} className="loader-candle" style={{ animationDelay: c.delay }}>
            <line x1={c.x} x2={c.x} y1={c.top - 4} y2={c.bottom + 4} stroke="#29c9a2" strokeWidth={1.6} strokeLinecap="round" />
            <rect x={c.x - 3} y={c.top} width={6} height={c.bottom - c.top} rx={1.5} fill="#29c9a2" />
          </g>
        ))}
        <circle className="loader-dot" cx={102} cy={16} r={6} fill="#42da9b" />
        <g className="loader-ray" stroke="#17e2a2" strokeWidth={2.2} strokeLinecap="round">
          <line x1={102} y1={3} x2={102} y2={-2} />
          <line x1={110} y1={8} x2={114} y2={4} />
          <line x1={112} y1={17} x2={117} y2={17} />
        </g>
      </svg>
      {text && <p className="max-w-sm text-center text-xs font-medium text-slate-500">{text}</p>}
    </div>
  );
}

/** Centered brand loader for a whole page or panel. */
export function PageLoader({ label }: { label?: string }) {
  return <BrandLoader size="lg" label={label} className="min-h-[50vh]" />;
}

export function InlineSpinner({ className }: { className?: string }) {
  return <span aria-hidden className={clsx('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent', className ?? 'w-4 h-4')} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={clsx('skeleton block', className)} />;
}

function Busy({ label = 'Loading…', className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

const WIDTHS = ['w-3/4', 'w-1/2', 'w-5/6', 'w-2/3', 'w-3/5', 'w-4/5'];

/** List / table rows: a leading chip, two text bars and a trailing value. */
export function SkeletonRows({ rows = 6, dense = false, className }: { rows?: number; dense?: boolean; className?: string }) {
  return (
    <Busy className={clsx('divide-y divide-ink-700/40', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={clsx('flex items-center gap-3', dense ? 'px-3 py-2' : 'px-4 py-3')}>
          <Skeleton className={clsx('rounded-md', dense ? 'h-3.5 w-3.5' : 'h-8 w-8')} />
          <div className="flex-1 space-y-1.5">
            <Skeleton className={clsx('h-3', WIDTHS[i % WIDTHS.length])} />
            {!dense && <Skeleton className={clsx('h-2.5', WIDTHS[(i + 3) % WIDTHS.length], 'opacity-70')} />}
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </Busy>
  );
}

/** Grid of stat cards (label, big value, hint). */
export function SkeletonStatGrid({ count = 6 }: { count?: number }) {
  return (
    <Busy className="grid grid-cols-2 lg:grid-cols-6 gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card p-4 space-y-3">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-2.5 w-28 opacity-70" />
        </div>
      ))}
    </Busy>
  );
}

/** Stacked cards with a title and a few lines (lists of strategies, connections, settings blocks). */
export function SkeletonCards({ count = 3, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <Busy className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-12 rounded-full" />
            <Skeleton className="ml-auto h-7 w-20 rounded-lg" />
          </div>
          {Array.from({ length: lines }, (_, j) => (
            <Skeleton key={j} className={clsx('h-3', WIDTHS[(i + j) % WIDTHS.length])} />
          ))}
        </div>
      ))}
    </Busy>
  );
}

/** Shows while data loads for the first time or a save runs (background refreshes don't flash it). */
export function ActivityBar() {
  const loading = useIsFetching({ predicate: (q) => q.state.status === 'pending' });
  const saving = useIsMutating();
  const active = loading + saving > 0;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(t);
  }, [active]);
  return <div aria-hidden className={clsx('activity-bar absolute inset-x-0 top-0 z-30', show && 'is-active')} />;
}
