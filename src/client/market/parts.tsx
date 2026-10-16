'use client';

/** Small pieces shared by the market view's panels: % change, stock chip, watchlist star, panel skeleton. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Star } from 'lucide-react';
import { Tooltip } from '../components/Tooltip';
import { arrow, dirClass, fmtPct } from './format';
import { M } from './help';

/** "▲ +1.23%" in the direction colour. */
export function Pct({ value, className, digits = 2, plain }: { value: number | null | undefined; className?: string; digits?: number; plain?: boolean }) {
  return (
    <span className={clsx('tabular-nums', dirClass(value), className)}>
      {!plain && <span className="mr-0.5 text-[0.8em]">{arrow(value)}</span>}
      {fmtPct(value, digits)}
    </span>
  );
}

// ---- watchlist (this computer) ------------------------------------------------------------------

const KEY = 'algo-hunt.market.watchlist';
const EVENT = 'algo-hunt-watchlist';

function readWatchlist(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 60) : [];
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    setList(readWatchlist());
    const sync = () => setList(readWatchlist());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const toggle = useCallback((symbol: string) => {
    const now = readWatchlist();
    const next = now.includes(symbol) ? now.filter((s) => s !== symbol) : [...now, symbol];
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: keep it for this visit only */
    }
    setList(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { list, has: (s: string) => list.includes(s), toggle };
}

export function StarButton({ symbol, watch, className }: { symbol: string; watch: ReturnType<typeof useWatchlist>; className?: string }) {
  const on = watch.has(symbol);
  return (
    <Tooltip content={{ ...M.watch, title: on ? `Unpin ${symbol}` : `Pin ${symbol} to the watchlist` }}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? `Unpin ${symbol}` : `Pin ${symbol}`}
        onClick={(e) => {
          e.stopPropagation();
          watch.toggle(symbol);
        }}
        className={clsx('rounded p-0.5 transition-colors', on ? 'text-warn' : 'text-slate-600 hover:text-slate-300', className)}
      >
        <Star className="h-3.5 w-3.5" fill={on ? 'currentColor' : 'none'} />
      </button>
    </Tooltip>
  );
}

/** Loading placeholder sized like the panel it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-ink-800/70', className)} />;
}

/** A small line under a panel when its data couldn't be loaded. */
export function PanelError({ error, children }: { error: unknown; children?: ReactNode }) {
  if (!error) return null;
  return <p className="py-6 text-center text-xs text-warn">{children ?? (error instanceof Error ? error.message : String(error))}</p>;
}
