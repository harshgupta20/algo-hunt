'use client';

/**
 * Market — the eagle view. Everything a trader checks each day on one page, top to bottom: the indices and their
 * story, breadth, the market map, sectors and rotation, movers, key levels, F&O positioning, money flows, the
 * world, news and the calendar. Each panel has its own data and refresh rhythm (fast while the market is open).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { RefreshCw, Star } from 'lucide-react';
import { inUniverse } from '@/shared/market/analytics';
import { marketStory } from '@/shared/market/story';
import type { MarketSession, SourceState, Universe } from '@/shared/market/types';
import { IconButton } from '../components/ui';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { marketApi } from './api';
import { CalendarPanel } from './CalendarPanel';
import { CompanyDrawer } from './CompanyDrawer';
import { FlowsPanel } from './FlowsPanel';
import { FnoPanel } from './FnoPanel';
import { fmtPct, istTime, timeAgo } from './format';
import { M } from './help';
import { LevelsPanel } from './LevelsPanel';
import { MarketMapPanel } from './MarketMap';
import { MoversPanel } from './MoversPanel';
import { NewsPanel } from './NewsPanel';
import { Pct, useWatchlist } from './parts';
import { BreadthCard, PulseStrip, StoryCard } from './PulsePanel';
import { RotationPanel, SectorBoard } from './SectorPanel';
import { WorldPanel } from './WorldPanel';

const SECTIONS: Array<[string, string]> = [
  ['pulse', 'Pulse'],
  ['map', 'Map'],
  ['sectors', 'Sectors'],
  ['movers', 'Movers'],
  ['fno', 'F&O'],
  ['flows', 'Flows & world'],
  ['news', 'News'],
];
const UNIVERSE_KEY = 'algo-hunt.market.universe';
const UNIVERSE_LABEL: Record<Universe, string> = { nifty50: 'Nifty 50', nifty100: 'Nifty 100', nifty500: 'Nifty 500', midcap150: 'Midcap 150', smallcap250: 'Smallcap 250', fno: 'F&O stocks' };

export function MarketView() {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['market-overview'], queryFn: marketApi.overview, refetchInterval: (q) => (q.state.data?.status.session === 'closed' ? 5 * 60_000 : 30_000) });
  const live = overview.data ? overview.data.status.session !== 'closed' : false;
  const map = useQuery({ queryKey: ['market-map'], queryFn: () => marketApi.map('nifty500'), refetchInterval: live ? 20_000 : 5 * 60_000 });
  const movers = useQuery({ queryKey: ['market-movers'], queryFn: marketApi.movers, refetchInterval: live ? 60_000 : 10 * 60_000 });
  const options = useQuery({ queryKey: ['market-options'], queryFn: marketApi.options, refetchInterval: live ? 60_000 : 10 * 60_000 });
  const world = useQuery({ queryKey: ['market-global'], queryFn: marketApi.global, refetchInterval: 3 * 60_000 });
  const news = useQuery({ queryKey: ['market-news'], queryFn: marketApi.news, refetchInterval: 5 * 60_000 });
  const calendar = useQuery({ queryKey: ['market-calendar'], queryFn: marketApi.calendar, refetchInterval: 15 * 60_000 });

  const [universe, setUniverseState] = useState<Universe>('nifty500');
  useEffect(() => {
    try {
      const u = window.localStorage.getItem(UNIVERSE_KEY) as Universe | null;
      if (u && u in UNIVERSE_LABEL) setUniverseState(u);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const setUniverse = (u: Universe) => {
    setUniverseState(u);
    try {
      window.localStorage.setItem(UNIVERSE_KEY, u);
    } catch {
      /* storage unavailable */
    }
  };
  const [sectorFilter, setSectorFilter] = useState<{ sectors: string[]; label: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const watch = useWatchlist();

  const stocks = useMemo(() => map.data?.stocks ?? [], [map.data]);
  const bySymbol = useMemo(() => new Map(stocks.map((s) => [s.symbol, s])), [stocks]);
  const universeMap = useMemo(() => (map.data ? { ...map.data, stocks: stocks.filter((s) => inUniverse(s, universe)) } : undefined), [map.data, stocks, universe]);
  const story = useMemo(() => marketStory({ overview: overview.data ?? null, global: world.data?.quotes, options: options.data?.chains }), [overview.data, world.data, options.data]);
  const pick = useCallback((s: string) => setPicked(s), []);
  const close = useCallback(() => setPicked(null), []);
  const pickSector = useCallback((sectors: string[], label: string) => {
    setSectorFilter({ sectors, label });
    document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const sources = useMemo(() => {
    const all = [overview.data?.sources, movers.data?.sources, world.data?.sources, news.data?.sources, calendar.data?.sources].flat().filter((s): s is SourceState => !!s);
    const by = new Map<string, SourceState>();
    for (const s of all) by.set(s.id, s);
    if (map.data) by.set('prices', { id: 'prices', label: map.data.source === 'kite' ? 'Kite quotes' : 'NSE sector stocks', ok: true, at: map.data.at });
    return [...by.values()];
  }, [overview.data, movers.data, world.data, news.data, calendar.data, map.data]);

  return (
    <div className="space-y-4 pb-10">
      <Header session={overview.data?.status.session} label={overview.data?.status.label} source={map.data?.source} updatedAt={overview.dataUpdatedAt} onRefresh={() => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('market-') })} />

      <nav className="sticky top-[-24px] z-30 -mx-6 flex flex-wrap items-center gap-1.5 border-b border-ink-700/50 bg-ink-950/90 px-6 py-2 backdrop-blur" aria-label="Sections">
        {SECTIONS.map(([id, label]) => (
          <Tooltip key={id} content={{ ...M.nav, title: `Jump to ${label}` }} side="bottom">
            <button type="button" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="rounded-full bg-ink-800 px-3 py-1 text-xs text-slate-400 hover:bg-ink-700 hover:text-slate-200">
              {label}
            </button>
          </Tooltip>
        ))}
        <WatchStrip list={watch.list} bySymbol={bySymbol} onPick={pick} />
      </nav>

      <div id="pulse" className="scroll-mt-16 space-y-4">
        <PulseStrip data={overview.data} />
        {overview.error && !overview.data && <p className="text-xs text-warn">{(overview.error as Error).message}</p>}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <StoryCard lines={story} loading={!overview.data} />
          </div>
          <BreadthCard data={overview.data} />
        </div>
      </div>

      <div id="map" className="scroll-mt-16">
        <MarketMapPanel map={universeMap} loading={map.isLoading} error={map.error} universe={universe} onUniverse={setUniverse} sectorFilter={sectorFilter} onClearSector={() => setSectorFilter(null)} onPick={pick} />
      </div>

      <div id="sectors" className="grid scroll-mt-16 gap-4 xl:grid-cols-[1.25fr_1fr]">
        <SectorBoard data={overview.data} onPickSector={pickSector} />
        <RotationPanel data={overview.data} onPickSector={pickSector} />
      </div>

      <div id="movers" className="grid scroll-mt-16 gap-4 xl:grid-cols-2">
        <MoversPanel map={universeMap} movers={movers.data} universeLabel={UNIVERSE_LABEL[universe]} onPick={pick} watch={watch} />
        <LevelsPanel pivots={overview.data?.pivots} />
      </div>

      <div id="fno" className="scroll-mt-16">
        <FnoPanel options={options.data} movers={movers.data} participants={overview.data?.participants} futures={overview.data?.futures} onPick={pick} />
      </div>

      <div id="flows" className="grid scroll-mt-16 gap-4 xl:grid-cols-2">
        <FlowsPanel flows={overview.data?.flows} deals={movers.data?.deals} onPick={pick} />
        <WorldPanel data={world.data} />
      </div>

      <div id="news" className="grid scroll-mt-16 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <NewsPanel data={news.data} stocks={bySymbol} watchlist={watch.list} onPick={pick} />
        <CalendarPanel data={calendar.data} stocks={bySymbol} watchlist={watch.list} onPick={pick} />
      </div>

      <SourcesFooter sources={sources} />
      <CompanyDrawer symbol={picked} onClose={close} onPick={pick} watch={watch} />
    </div>
  );
}

// ---- header ----------------------------------------------------------------------------------------

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** "closes in 2h 05m" / "opens 09:15" — by the clock (NSE holidays aren't known here). */
function sessionHint(session: MarketSession | undefined, now: number): string {
  const ist = new Date(now + 330 * 60_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const left = (m: number) => `${Math.floor(m / 60) ? `${Math.floor(m / 60)}h ` : ''}${String(m % 60).padStart(2, '0')}m`;
  if (session === 'open') return `closes 15:30 · in ${left(930 - mins)}`;
  if (session === 'pre-open') return `normal market at 09:15 · in ${left(555 - mins)}`;
  const day = ist.getUTCDay();
  if (day >= 1 && day <= 5 && mins < 540) return `pre-open at 09:00 · in ${left(540 - mins)}`;
  return 'next session 09:15 on the next trading day';
}

function Header({ session, label, source, updatedAt, onRefresh }: { session?: MarketSession; label?: string; source?: 'kite' | 'nse'; updatedAt: number; onRefresh: () => void }) {
  const now = useNow();
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-fg">
          Market <span className="text-sm font-normal text-slate-500">· eagle view</span>
          <InfoTip content={M.page} />
        </h1>
        <p className="mt-1 text-sm text-slate-400">Indices, breadth, sectors, every Nifty 500 stock, movers, F&O, money flows, the world, news and the calendar — at a glance.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={{ ...M.session, title: label || M.session.title }}>
          <div className="flex cursor-help items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5">
            <span className={clsx('h-2 w-2 rounded-full', session === 'open' ? 'animate-pulse bg-bull' : session === 'pre-open' ? 'animate-pulse bg-warn' : 'bg-slate-500')} />
            <span className="text-xs font-medium text-slate-200">{session === 'open' ? 'Market open' : session === 'pre-open' ? 'Pre-open' : session === 'closed' ? 'Market closed' : '…'}</span>
            <span className="text-xs tabular-nums text-slate-400">{istTime(now, true)} IST</span>
            <span className="hidden text-[11px] text-slate-500 md:inline">{sessionHint(session, now)}</span>
          </div>
        </Tooltip>
        {source && (
          <Tooltip content={M.liveSource}>
            <span className={clsx('cursor-help rounded-md px-2 py-1 text-[11px] font-medium', source === 'kite' ? 'bg-bull/15 text-bull' : 'bg-warn/15 text-warn')}>{source === 'kite' ? 'Kite live' : 'NSE (no Kite)'}</span>
          </Tooltip>
        )}
        {updatedAt > 0 && <span className="text-[11px] tabular-nums text-slate-500">updated {istTime(updatedAt, true)}</span>}
        <IconButton help={M.refresh} onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function WatchStrip({ list, bySymbol, onPick }: { list: string[]; bySymbol: Map<string, { pct: number; ltp: number }>; onPick: (s: string) => void }) {
  return (
    <div className="ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto">
      <Tooltip content={M.watchStrip}>
        <span className="flex cursor-help items-center gap-1 text-[11px] text-slate-500">
          <Star className="h-3.5 w-3.5 text-warn" fill="currentColor" />
          {list.length ? '' : 'Pin stocks to watch them here'}
        </span>
      </Tooltip>
      {list.map((s) => {
        const q = bySymbol.get(s);
        return (
          <Tooltip key={s} content={{ title: s, body: q ? `${q.ltp.toLocaleString('en-IN')} · ${fmtPct(q.pct)} today. Click for its panel.` : 'Click for its panel.' }} side="bottom">
            <button type="button" onClick={() => onPick(s)} className="flex shrink-0 items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 px-2 py-0.5 text-[11px] hover:border-accent/50">
              <span className="font-medium text-slate-200">{s}</span>
              {q && <Pct value={q.pct} plain className="text-[10px]" />}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function SourcesFooter({ sources }: { sources: SourceState[] }) {
  return (
    <footer className="flex flex-wrap items-center gap-2 border-t border-ink-700/50 pt-4 text-[11px] text-slate-500">
      <span className="flex items-center gap-1">
        Data <InfoTip content={M.sources} />
      </span>
      {sources.map((s) => (
        <Tooltip key={s.id} content={{ title: s.label, body: s.ok ? `Answering${s.at ? ` — last update ${timeAgo(s.at)}` : ''}.` : `Not answering: ${s.error ?? 'unknown error'}${s.at ? `. Last good data ${timeAgo(s.at)}.` : '.'}` }}>
          <span className="flex cursor-help items-center gap-1 rounded bg-ink-900 px-1.5 py-0.5">
            <span className={clsx('h-1.5 w-1.5 rounded-full', s.ok ? 'bg-bull' : 'bg-bear')} />
            {s.label}
          </span>
        </Tooltip>
      ))}
      <span className="basis-full pt-1 text-[10px] text-slate-600">Prices and data from your Kite session, NSE’s website, Yahoo Finance and news sites — unofficial sources can be late or wrong. Information only, not investment advice.</span>
    </footer>
  );
}
