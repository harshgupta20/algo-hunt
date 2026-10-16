'use client';

/** One stock in depth, in a panel from the right: move, ranges, today's line, news, filings, upcoming events. */
import { useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellRing, CalendarDays, ExternalLink, FileText, LineChart, Workflow, X } from 'lucide-react';
import { sectorShort } from '@/shared/market/indices';
import type { StockGroup } from '@/shared/market/types';
import { IconButton } from '../components/ui';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { marketApi } from './api';
import { RangeBar, Sparkline } from './charts';
import { arrow, dayLabel, dirClass, fmtCompact, fmtPct, fmtPrice, fmtRupees, fmtSigned, timeAgo } from './format';
import { M } from './help';
import { NewsRow } from './NewsPanel';
import { Skeleton, StarButton, type useWatchlist } from './parts';

const GROUP_LABEL: Record<StockGroup, string> = { N50: 'Nifty 50', NN50: 'Next 50', MID150: 'Midcap 150', SML250: 'Smallcap 250' };

export function CompanyDrawer({ symbol, onClose, onPick, watch }: { symbol: string | null; onClose: () => void; onPick: (s: string) => void; watch: ReturnType<typeof useWatchlist> }) {
  const q = useQuery({ queryKey: ['market-company', symbol], queryFn: () => marketApi.company(symbol!), enabled: !!symbol, refetchInterval: 2 * 60_000 });
  useEffect(() => {
    if (!symbol) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [symbol, onClose]);
  if (!symbol) return null;
  const d = q.data;
  const s = d?.quote;
  const ltp = s?.ltp ?? d?.spark.at(-1) ?? null;
  const prev = s?.prevClose ?? d?.sparkPrev ?? null;
  const pct = s?.pct ?? (ltp !== null && prev ? ((ltp - prev) / prev) * 100 : null);
  const change = s?.change ?? (ltp !== null && prev !== null ? ltp - prev : null);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${symbol} details`}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[520px] flex-col overflow-y-auto border-l border-ink-700 bg-ink-900 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-ink-700/70 bg-ink-900/95 p-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-fg">{d?.name ?? symbol}</h2>
              <StarButton symbol={symbol} watch={watch} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-mono text-slate-400">NSE: {symbol}</span>
              {d?.sector && <span className="rounded bg-ink-800 px-1.5 py-0.5 text-slate-400">{sectorShort(d.sector)}</span>}
              {d?.groups.map((g) => (
                <span key={g} className="rounded bg-ink-800 px-1.5 py-0.5 text-slate-400">
                  {GROUP_LABEL[g]}
                </span>
              ))}
              {d?.fno && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent-soft">F&O</span>}
            </div>
          </div>
          <InfoTip content={M.company} />
          <IconButton help={M.close} onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="space-y-5 p-4">
          {!d && q.isLoading ? (
            <Skeleton className="h-48" />
          ) : q.error && !d ? (
            <p className="text-sm text-warn">{q.error instanceof Error ? q.error.message : 'Couldn’t load this stock.'}</p>
          ) : d ? (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-3xl font-semibold tabular-nums text-fg">{fmtPrice(ltp)}</div>
                  <div className={clsx('text-sm font-medium tabular-nums', dirClass(change))}>
                    {arrow(change)} {fmtSigned(change)} ({fmtPct(pct)}) <span className="text-xs font-normal text-slate-500">today</span>
                  </div>
                </div>
                {s?.alerts ? (
                  <Tooltip content={M.alertBadge}>
                    <span className="inline-flex cursor-help items-center gap-1 rounded-md bg-warn/15 px-2 py-1 text-xs text-warn">
                      <BellRing className="h-3.5 w-3.5" /> {s.alerts} alert{s.alerts === 1 ? '' : 's'} today
                    </span>
                  </Tooltip>
                ) : null}
              </div>
              {d.spark.length > 1 && <Sparkline points={d.spark} prevClose={d.sparkPrev} width={488} height={110} className="w-full" />}
              <div className="space-y-3">
                {s && s.low !== null && s.high !== null && s.high > s.low && (
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                      <span>Day low {fmtPrice(s.low)}</span>
                      <span>Day high {fmtPrice(s.high)}</span>
                    </div>
                    <RangeBar low={s.low} high={s.high} value={s.ltp} />
                  </div>
                )}
                {d.range52 && ltp !== null && (
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                      <span>52w low {fmtPrice(d.range52.low)}</span>
                      <span>{fmtPct(((ltp - d.range52.high) / d.range52.high) * 100, 1)} from the 52w high</span>
                      <span>52w high {fmtPrice(d.range52.high)}</span>
                    </div>
                    <RangeBar low={d.range52.low} high={d.range52.high} value={ltp} />
                  </div>
                )}
              </div>
              {s && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    ['Open', fmtPrice(s.open)],
                    ['Prev close', fmtPrice(s.prevClose)],
                    ['Value', fmtRupees(s.value)],
                    ['Volume', fmtCompact(s.volume)],
                    ['High', fmtPrice(s.high)],
                    ['Low', fmtPrice(s.low)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-ink-850 px-2.5 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
                      <div className="tabular-nums text-slate-200">{v}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Tooltip content={M.external.chart}>
                  <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`NSE:${symbol}`)}`} target="_blank" rel="noopener noreferrer" className="btn-ghost inline-flex items-center gap-1.5 text-xs">
                    <LineChart className="h-3.5 w-3.5" /> Chart
                  </a>
                </Tooltip>
                <Tooltip content={M.external.nse}>
                  <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer" className="btn-ghost inline-flex items-center gap-1.5 text-xs">
                    <ExternalLink className="h-3.5 w-3.5" /> NSE
                  </a>
                </Tooltip>
                {d.productId && (
                  <Tooltip content={M.openV2}>
                    <Link href="/v2?tab=products" className="btn-ghost inline-flex items-center gap-1.5 text-xs">
                      <Workflow className="h-3.5 w-3.5" /> Use in a strategy
                    </Link>
                  </Tooltip>
                )}
              </div>

              {(d.events.length > 0 || d.actions.length > 0) && (
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <CalendarDays className="h-3.5 w-3.5" /> Coming up
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {d.events.map((e, i) => (
                      <li key={`e${i}`} className="flex gap-2">
                        <span className="w-20 shrink-0 text-slate-500">{dayLabel(e.date)}</span>
                        <span className="text-slate-300">{e.purpose}</span>
                      </li>
                    ))}
                    {d.actions.map((a, i) => (
                      <li key={`a${i}`} className="flex gap-2">
                        <span className="w-20 shrink-0 text-slate-500">Ex {dayLabel(a.exDate)}</span>
                        <span className="text-slate-300">{a.subject}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-300">News · last 7 days</h3>
                {d.news.length === 0 ? (
                  <p className="text-xs text-slate-500">No recent news found.</p>
                ) : (
                  <ul className="divide-y divide-ink-700/50">
                    {d.news.slice(0, 12).map((n) => (
                      <NewsRow key={n.id} item={{ ...n, symbols: n.symbols.filter((x) => x !== symbol) }} onPick={onPick} compact />
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-300">Filings to NSE · last 30 days</h3>
                {d.announcements.length === 0 ? (
                  <p className="text-xs text-slate-500">No filings.</p>
                ) : (
                  <ul className="space-y-2">
                    {d.announcements.map((a, i) => (
                      <li key={i} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-300">{a.subject}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-slate-500">{timeAgo(a.at)}</span>
                        </div>
                        {a.text && <p className="line-clamp-2 text-[11px] text-slate-500">{a.text}</p>}
                        {a.link && (
                          <a href={a.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-accent-soft hover:underline">
                            <FileText className="h-3 w-3" /> Filing (PDF)
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
