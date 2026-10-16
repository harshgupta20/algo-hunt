'use client';

/** World markets, commodities, currencies, rates and crypto — the overnight cues. */
import type { GlobalData, GlobalGroup } from '@/shared/market/types';
import { Section } from '../components/ui';
import { Sparkline } from './charts';
import { fmtPrice } from './format';
import { M } from './help';
import { Pct, Skeleton } from './parts';

const GROUPS: GlobalGroup[] = ['US', 'Europe', 'Asia', 'Commodities', 'Currency & rates', 'Crypto'];

export function WorldPanel({ data }: { data: GlobalData | undefined }) {
  return (
    <Section title="World" help={M.world}>
      {!data ? (
        <Skeleton className="h-72" />
      ) : !data.quotes.length ? (
        <p className="py-8 text-center text-xs text-slate-500">World data isn’t available right now (Yahoo Finance).</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {GROUPS.map((g) => {
            const list = data.quotes.filter((q) => q.group === g);
            if (!list.length) return null;
            return (
              <div key={g}>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{g}</div>
                <ul className="space-y-1">
                  {list.map((q) => (
                    <li key={q.symbol} className="grid grid-cols-[1fr_auto_64px_56px] items-center gap-2 text-xs">
                      <span className="truncate text-slate-300">{q.name}</span>
                      <span className="tabular-nums text-slate-200">
                        {q.unit === '$' || q.unit.startsWith('$/') ? '$' : q.unit === '₹' ? '₹' : ''}
                        {fmtPrice(q.last, q.last > 1000 ? 0 : 2)}
                        {q.unit === '%' ? '%' : ''}
                      </span>
                      <Pct value={q.pct} className="text-right" plain />
                      <Sparkline points={q.spark} prevClose={q.prevClose} width={56} height={18} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
