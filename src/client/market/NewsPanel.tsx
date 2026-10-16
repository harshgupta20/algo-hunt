'use client';

/** Headlines from Indian business media, tagged with the companies they mention and those stocks' moves today. */
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ExternalLink, Search } from 'lucide-react';
import type { MapStock, NewsCategory, NewsData, NewsItem } from '@/shared/market/types';
import { sectorShort } from '@/shared/market/indices';
import { Tooltip } from '../components/Tooltip';
import { Section, Toggle } from '../components/ui';
import { fmtPct, timeAgo } from './format';
import { M } from './help';
import { Pct, Skeleton } from './parts';

type Cat = 'all' | NewsCategory;
const CATS: Array<{ value: Cat; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'markets', label: 'Markets' },
  { value: 'economy', label: 'Economy' },
  { value: 'companies', label: 'Companies' },
  { value: 'tech', label: 'Tech' },
  { value: 'startups', label: 'Startups' },
];

export function NewsPanel({ data, stocks, watchlist, onPick }: { data: NewsData | undefined; stocks: Map<string, MapStock>; watchlist: string[]; onPick: (s: string) => void }) {
  const [cat, setCat] = useState<Cat>('all');
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [onlyMovers, setOnlyMovers] = useState(false);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(15);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (i) =>
        (cat === 'all' || i.category === cat) &&
        (!onlyWatch || i.symbols.some((s) => watchlist.includes(s))) &&
        (!onlyMovers || i.symbols.some((s) => Math.abs(stocks.get(s)?.pct ?? 0) >= 3)) &&
        (!needle || i.title.toLowerCase().includes(needle) || i.summary.toLowerCase().includes(needle) || i.symbols.some((s) => s.toLowerCase() === needle)),
    );
  }, [data, cat, onlyWatch, onlyMovers, q, watchlist, stocks]);

  return (
    <Section title="News & innovation" help={M.news}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {CATS.map((c) => (
            <Tooltip key={c.value} content={M.newsCat[c.value]} side="bottom">
              <button
                type="button"
                onClick={() => {
                  setCat(c.value);
                  setShown(15);
                }}
                className={clsx('rounded-md px-2 py-1 text-xs', c.value === cat ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400 hover:text-slate-200')}
              >
                {c.label}
              </button>
            </Tooltip>
          ))}
        </div>
        <Toggle checked={onlyWatch} onChange={setOnlyWatch} label="Watchlist" help={M.newsFilter.watch} />
        <Toggle checked={onlyMovers} onChange={setOnlyMovers} label="Today’s movers" help={M.newsFilter.movers} />
        <Tooltip content={M.newsFilter.search} className="ml-auto">
          <label className="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 px-2 py-1">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search news" className="w-36 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600" />
          </label>
        </Tooltip>
      </div>
      {!data ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-500">No headlines match.</p>
      ) : (
        <>
          <ul className="divide-y divide-ink-700/50">
            {items.slice(0, shown).map((i) => (
              <NewsRow key={i.id} item={i} stocks={stocks} onPick={onPick} />
            ))}
          </ul>
          {shown < items.length && (
            <button type="button" onClick={() => setShown((n) => n + 20)} className="btn-ghost mt-2 w-full text-xs">
              Show more ({items.length - shown} more)
            </button>
          )}
        </>
      )}
    </Section>
  );
}

export function NewsRow({ item, stocks, onPick, compact }: { item: NewsItem; stocks?: Map<string, MapStock>; onPick?: (s: string) => void; compact?: boolean }) {
  return (
    <li className="py-2.5">
      <div className="mb-0.5 flex items-center gap-2 text-[10px] text-slate-500">
        <span className="font-medium text-slate-400">{item.source}</span>
        <span>{timeAgo(item.at)}</span>
        {!compact && <span className="rounded bg-ink-800 px-1 capitalize">{item.category}</span>}
      </div>
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="group inline text-[13px] font-medium leading-snug text-slate-200 hover:text-accent-soft">
        {item.title}
        <ExternalLink className="ml-1 inline h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
      </a>
      {!compact && item.summary && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.summary}</p>}
      {(item.symbols.length > 0 || item.sectors.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.symbols.map((s) => {
            const st = stocks?.get(s);
            return (
              <Tooltip key={s} content={{ title: st?.name ?? s, body: st ? `${s} ${fmtPct(st.pct)} today. Click for its panel.` : `${s} — click for its panel.` }}>
                <button type="button" onClick={() => onPick?.(s)} className="inline-flex items-center gap-1 rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10px] font-medium text-slate-300 hover:border-accent/50">
                  {s}
                  {st && <Pct value={st.pct} plain className="text-[10px]" />}
                </button>
              </Tooltip>
            );
          })}
          {item.sectors.slice(0, 3).map((s) => (
            <span key={s} className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-slate-500">
              {sectorShort(s)}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
