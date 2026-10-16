'use client';

/** Top of the page: the headline index tiles, then "the market in 30 seconds" with breadth beside it. */
import clsx from 'clsx';
import { Activity, BarChart3, Gauge, Globe2, Landmark, Layers, Scale, Sigma, TrendingUp, Users } from 'lucide-react';
import { BREADTH_INDICES } from '@/shared/market/indices';
import { vixBand, type StoryLine } from '@/shared/market/story';
import type { HeadlineIndex, MarketOverview } from '@/shared/market/types';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { AdBar, RangeBar, Sparkline } from './charts';
import { arrow, dirClass, fmtPct, fmtPrice, fmtSigned } from './format';
import { M } from './help';
import { Skeleton } from './parts';

export function PulseStrip({ data }: { data: MarketOverview | undefined }) {
  if (!data) return <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[132px]" />)}</div>;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {data.headline.map((q) => (
        <IndexTile key={q.symbol} q={q} />
      ))}
    </div>
  );
}

function IndexTile({ q }: { q: HeadlineIndex }) {
  const vix = q.symbol === 'INDIA VIX';
  const offHigh = q.yearHigh ? ((q.last - q.yearHigh) / q.yearHigh) * 100 : null;
  return (
    <div className="card flex min-w-0 flex-col gap-1 p-3">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-xs font-semibold text-slate-300">{q.name}</span>
        {vix && (
          <Tooltip content={M.vix}>
            <span className="cursor-help rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-slate-400">{vixBand(q.last).split(' — ')[0]}</span>
          </Tooltip>
        )}
      </div>
      <div className="text-lg font-semibold leading-tight tabular-nums text-fg">{fmtPrice(q.last)}</div>
      <div className={clsx('whitespace-nowrap text-[11px] font-medium tabular-nums', dirClass(q.change))}>
        {arrow(q.change)} {fmtSigned(q.change)} <span className="ml-0.5">{fmtPct(q.pct)}</span>
      </div>
      {q.spark ? <Sparkline points={q.spark} prevClose={q.prevClose} width={150} height={32} className="h-8 w-full" /> : <div className="h-8" />}
      {q.low !== null && q.high !== null && q.high > q.low ? (
        <Tooltip className="block" content={{ ...M.dayRange, body: `${M.dayRange.body} Low ${fmtPrice(q.low)} · high ${fmtPrice(q.high)}.` }}>
          <div className="cursor-help">
            <RangeBar low={q.low} high={q.high} value={q.last} />
            <div className="mt-1 flex justify-between text-[9px] tabular-nums text-slate-500">
              <span>{fmtPrice(q.low, 0)}</span>
              <span>{fmtPrice(q.high, 0)}</span>
            </div>
          </div>
        </Tooltip>
      ) : (
        <div className="text-[10px] text-slate-600">Day range n/a</div>
      )}
      {!vix && offHigh !== null && (
        <Tooltip className="block" content={M.yearRange}>
          <div className="cursor-help text-[10px] tabular-nums text-slate-500">{offHigh > -0.05 ? 'At its 52-week high' : `${fmtPct(offHigh, 1)} from 52w high`}</div>
        </Tooltip>
      )}
    </div>
  );
}

// ---- story + breadth ------------------------------------------------------------------------------------

const TOPIC_ICON: Record<StoryLine['topic'], typeof Activity> = {
  index: TrendingUp,
  breadth: Scale,
  caps: Layers,
  sectors: BarChart3,
  volatility: Gauge,
  flows: Landmark,
  positioning: Users,
  options: Sigma,
  world: Globe2,
  extremes: Activity,
};

export function StoryCard({ lines, loading }: { lines: StoryLine[]; loading: boolean }) {
  return (
    <section className="card relative overflow-hidden p-4">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-200">The market in 30 seconds</h3>
        <InfoTip content={M.story} />
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-4" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {lines.map((l, i) => {
            const Icon = TOPIC_ICON[l.topic];
            return (
              <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-slate-300">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ink-800 text-slate-400">
                  <Icon className="h-3 w-3" />
                </span>
                <span className="flex-1">{l.text}</span>
                <span className={clsx('mt-0.5 text-[10px]', l.tone === 'up' ? 'text-bull' : l.tone === 'down' ? 'text-bear' : 'text-slate-600')} aria-hidden>
                  {l.tone === 'up' ? '▲' : l.tone === 'down' ? '▼' : '•'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const BREADTH_NAMES: Record<string, string> = { 'NIFTY 50': 'Nifty 50', 'NIFTY 500': 'Nifty 500', 'NIFTY MIDCAP 150': 'Midcap 150', 'NIFTY SMLCAP 250': 'Smallcap 250' };

export function BreadthCard({ data }: { data: MarketOverview | undefined }) {
  const rows = BREADTH_INDICES.map((s) => data?.indices.find((i) => i.symbol === s)).filter((i) => i && i.advances !== null && i.declines !== null);
  const vix = data?.indices.find((i) => i.symbol === 'INDIA VIX');
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-200">Breadth</h3>
        <InfoTip content={M.breadth} />
      </div>
      {!data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r!.symbol}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="text-slate-300">{BREADTH_NAMES[r!.symbol]}</span>
                <span className="tabular-nums text-slate-500">
                  <span className="text-bull">{r!.advances}</span> up · <span className="text-bear">{r!.declines}</span> down
                </span>
              </div>
              <AdBar advances={r!.advances!} declines={r!.declines!} unchanged={r!.unchanged ?? 0} />
            </div>
          ))}
          {data.highsLows && (
            <Tooltip className="block" content={M.highsLows}>
              <div className="cursor-help border-t border-ink-700/60 pt-3">
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="text-slate-300">52-week highs vs lows</span>
                  <span className="tabular-nums text-slate-500">
                    <span className="text-bull">{data.highsLows.highs}</span> · <span className="text-bear">{data.highsLows.lows}</span>
                  </span>
                </div>
                <AdBar advances={data.highsLows.highs} declines={data.highsLows.lows} />
              </div>
            </Tooltip>
          )}
          {vix && <VixMeter value={vix.last} pct={vix.pct} />}
        </div>
      )}
    </section>
  );
}

const VIX_BANDS: Array<[number, number, string]> = [
  [0, 12, 'very calm'],
  [12, 16, 'calm'],
  [16, 20, 'moderate'],
  [20, 25, 'elevated'],
  [25, 40, 'fearful'],
];

function VixMeter({ value, pct }: { value: number; pct: number }) {
  const max = 40;
  const p = Math.min(100, (value / max) * 100);
  return (
    <Tooltip className="block" content={M.vix}>
      <div className="cursor-help border-t border-ink-700/60 pt-3">
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="text-slate-300">India VIX</span>
          <span className="tabular-nums">
            <span className="font-semibold text-fg">{fmtPrice(value)}</span> <span className={dirClass(pct)}>{fmtPct(pct)}</span>
          </span>
        </div>
        <div className="relative flex h-2 gap-[2px]">
          {VIX_BANDS.map(([lo, hi, name], i) => (
            <div key={name} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${((hi - lo) / max) * 100}%`, background: `rgb(var(--warn) / ${0.12 + i * 0.17})` }} />
          ))}
          <div className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg ring-2 ring-ink-900" style={{ left: `${p}%` }} />
        </div>
        <div className="mt-1 text-[10px] text-slate-500">{vixBand(value)}</div>
      </div>
    </Tooltip>
  );
}
