'use client';

/** What's coming: results & board meetings, corporate-action ex-dates, and the latest company filings. */
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { FileText } from 'lucide-react';
import type { CalendarData, MapStock } from '@/shared/market/types';
import { Tooltip } from '../components/Tooltip';
import { Section, Toggle } from '../components/ui';
import { dayLabel, timeAgo } from './format';
import { M } from './help';
import { Pct, Skeleton } from './parts';

type Tab = 'events' | 'actions' | 'announcements';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'events', label: 'Results & meetings' },
  { value: 'actions', label: 'Ex-dates' },
  { value: 'announcements', label: 'Filings' },
];

export function CalendarPanel({ data, stocks, watchlist, onPick }: { data: CalendarData | undefined; stocks: Map<string, MapStock>; watchlist: string[]; onPick: (s: string) => void }) {
  const [tab, setTab] = useState<Tab>('events');
  const [only500, setOnly500] = useState(true);
  const { groups, announcements } = useMemo(() => {
    const keep = (symbol: string) => !only500 || stocks.size === 0 || stocks.has(symbol) || watchlist.includes(symbol);
    const by = new Map<string, Array<{ symbol: string; company: string; text: string }>>();
    if (tab === 'events') for (const e of data?.events ?? []) if (keep(e.symbol)) by.set(e.date, [...(by.get(e.date) ?? []), { symbol: e.symbol, company: e.company, text: e.purpose }]);
    if (tab === 'actions') for (const a of data?.actions ?? []) if (keep(a.symbol)) by.set(a.exDate, [...(by.get(a.exDate) ?? []), { symbol: a.symbol, company: a.company, text: a.subject }]);
    return { groups: [...by.entries()], announcements: (data?.announcements ?? []).filter((a) => keep(a.symbol)).slice(0, 60) };
  }, [data, tab, only500, stocks, watchlist]);

  return (
    <Section title="Calendar & filings" help={M.calendar}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Tooltip key={t.value} content={M.calTab[t.value]} side="bottom">
            <button type="button" onClick={() => setTab(t.value)} className={clsx('rounded-md px-2 py-1 text-xs', t.value === tab ? 'bg-accent text-white' : 'bg-ink-800 text-slate-400 hover:text-slate-200')}>
              {t.label}
            </button>
          </Tooltip>
        ))}
        <span className="ml-auto">
          <Toggle checked={only500} onChange={setOnly500} label="Nifty 500 only" help={M.only500} />
        </span>
      </div>
      {!data ? (
        <Skeleton className="h-80" />
      ) : tab === 'announcements' ? (
        announcements.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">No filings.</p>
        ) : (
          <ul className="max-h-[460px] divide-y divide-ink-700/50 overflow-y-auto pr-1">
            {announcements.map((a, i) => (
              <li key={`${a.symbol}-${a.at}-${i}`} className="py-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <button type="button" onClick={() => onPick(a.symbol)} className="font-semibold text-slate-200 hover:text-accent-soft">
                    {a.symbol}
                  </button>
                  {stocks.get(a.symbol) && <Pct value={stocks.get(a.symbol)!.pct} plain className="text-[10px]" />}
                  <span className="ml-auto text-[10px] text-slate-500">{timeAgo(a.at)}</span>
                </div>
                <div className="text-xs text-slate-300">{a.subject}</div>
                {a.text && <p className="line-clamp-2 text-[11px] text-slate-500">{a.text}</p>}
                {a.link && (
                  <a href={a.link} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-accent-soft hover:underline">
                    <FileText className="h-3 w-3" /> Filing (PDF)
                  </a>
                )}
              </li>
            ))}
          </ul>
        )
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-500">Nothing scheduled.</p>
      ) : (
        <div className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
          {groups.map(([date, list]) => (
            <div key={date}>
              <div className="sticky top-0 bg-ink-900 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {dayLabel(date)} · {list.length}
              </div>
              <ul className="space-y-0.5">
                {list.map((e, i) => (
                  <li key={`${e.symbol}-${i}`}>
                    <button type="button" onClick={() => onPick(e.symbol)} className={clsx('grid w-full grid-cols-[96px_1fr] gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-ink-800', watchlist.includes(e.symbol) && 'bg-warn/10')}>
                      <span className="truncate font-medium text-slate-200">{e.symbol}</span>
                      <span className="truncate text-slate-400">{e.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
