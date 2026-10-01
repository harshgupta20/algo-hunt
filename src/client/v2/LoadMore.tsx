'use client';

/**
 * Infinite scroll for long lists: when this row comes into view the next page loads by itself; the button is
 * there for keyboards and in case scrolling doesn't reach it. At the end it says everything is shown.
 */
import { useEffect, useRef } from 'react';
import { Tooltip, type TooltipContent } from '../components/Tooltip';
import { InlineSpinner } from '../components/loaders';
import { H } from './help';

export function LoadMore({ hasMore, loading, onMore, shown, noun, help }: { hasMore: boolean; loading: boolean; onMore: () => void; shown: number; noun: string; help?: TooltipContent }) {
  const ref = useRef<HTMLDivElement>(null);
  const more = useRef(onMore);
  more.current = onMore;
  const busy = useRef(loading);
  busy.current = loading;
  useEffect(() => {
    const el = ref.current;
    if (!hasMore || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && !busy.current && more.current(), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, shown]);

  if (!hasMore) {
    if (shown < 20) return null;
    return (
      <Tooltip content={H.lists.end} className="flex justify-center">
        <p className="cursor-help py-3 text-center text-[11px] text-slate-500" tabIndex={0}>
          All {shown.toLocaleString('en-IN')} {noun} shown
        </p>
      </Tooltip>
    );
  }
  return (
    <div ref={ref} className="flex justify-center p-3">
      {loading ? (
        <span className="inline-flex items-center gap-2 text-xs text-slate-500">
          <InlineSpinner className="w-3.5 h-3.5" /> Loading more {noun}…
        </span>
      ) : (
        <Tooltip content={help ?? H.lists.more}>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={onMore}>
            Load more · {shown.toLocaleString('en-IN')} shown
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/** Rows of all loaded pages, each once (a row can move to the next page while new ones arrive). */
export function flatPages<T extends { id: string }>(pages: T[][] | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages ?? []) {
    for (const r of page) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}
