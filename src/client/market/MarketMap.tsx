'use client';

/**
 * The market map: every stock as a tile grouped by sector — colour = today's move (the % is printed on the tile),
 * size = money traded today (square-root scaled so smaller stocks stay visible) or equal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { BellRing, X } from 'lucide-react';
import { sectorStats, squarify, type SectorStat } from '@/shared/market/analytics';
import { sectorShort } from '@/shared/market/indices';
import type { MapStock, MarketMap as MapData, Universe } from '@/shared/market/types';
import { Tooltip } from '../components/Tooltip';
import { Section, Segmented } from '../components/ui';
import { HoverCard, moveFill, onFillClass, type Hover } from './charts';
import { fmtCompact, fmtPct, fmtPrice, fmtRupees, fmtSigned } from './format';
import { M } from './help';
import { Pct, Skeleton } from './parts';

export type SizeBy = 'value' | 'equal';

const UNIVERSES: Universe[] = ['nifty50', 'nifty100', 'nifty500', 'midcap150', 'smallcap250', 'fno'];
const UNIVERSE_LABEL: Record<Universe, string> = { nifty50: 'Nifty 50', nifty100: 'Nifty 100', nifty500: 'Nifty 500', midcap150: 'Midcap 150', smallcap250: 'Smallcap 250', fno: 'F&O' };
const HEADER = 17;
const KEY_STEPS = [-5, -3, -2, -1, 0, 1, 2, 3, 5];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export function MarketMapPanel({
  map,
  loading,
  error,
  universe,
  onUniverse,
  sectorFilter,
  onClearSector,
  onPick,
}: {
  map: MapData | undefined;
  loading: boolean;
  error: unknown;
  universe: Universe;
  onUniverse: (u: Universe) => void;
  sectorFilter: { sectors: string[]; label: string } | null;
  onClearSector: () => void;
  onPick: (symbol: string) => void;
}) {
  const [sizeBy, setSizeBy] = useState<SizeBy>('value');
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const stocks = useMemo(() => (map?.stocks ?? []).filter((s) => !sectorFilter || sectorFilter.sectors.includes(s.sector)), [map, sectorFilter]);
  const height = width < 700 ? 460 : 620;
  const layout = useMemo(() => layoutMap(stocks, sizeBy, width, height), [stocks, sizeBy, width, height]);
  const up = stocks.filter((s) => s.pct > 0).length;
  const down = stocks.filter((s) => s.pct < 0).length;

  return (
    <Section
      title="Market map"
      help={M.map}
      actions={
        <>
          {sectorFilter && (
            <Tooltip content={M.sectorFilter}>
              <button type="button" onClick={onClearSector} className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-accent-soft">
                {sectorFilter.label} <X className="h-3 w-3" />
              </button>
            </Tooltip>
          )}
          <Segmented<SizeBy>
            label="Tile size"
            value={sizeBy}
            onChange={setSizeBy}
            options={[
              { value: 'value', label: 'Value', help: M.sizeBy.value },
              { value: 'equal', label: 'Equal', help: M.sizeBy.equal },
            ]}
          />
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<Universe> label="Universe" value={universe} onChange={onUniverse} options={UNIVERSES.map((u) => ({ value: u, label: UNIVERSE_LABEL[u], help: M.universe[u] }))} />
        {map && (
          <span className="text-xs tabular-nums text-slate-500">
            {stocks.length} stocks · <span className="text-bull">{up} up</span> · <span className="text-bear">{down} down</span>
          </span>
        )}
        <Tooltip content={M.colourKey}>
          <div className="ml-auto flex items-center gap-[2px]" aria-label="Colour key">
            {KEY_STEPS.map((p) => (
              <span key={p} className={clsx('flex h-4 w-9 items-center justify-center text-[9px] font-medium tabular-nums', onFillClass(p), p === KEY_STEPS[0] && 'rounded-l', p === KEY_STEPS.at(-1) && 'rounded-r')} style={moveFill(p)}>
                {p === 0 ? '0' : fmtPct(p, 0)}
              </span>
            ))}
          </div>
        </Tooltip>
      </div>
      {map?.note && <p className="mb-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-warn">{map.note}</p>}
      <div ref={ref} className="relative w-full overflow-hidden rounded-lg bg-ink-950" style={{ height }} onPointerLeave={() => setHover(null)}>
        {loading && !map ? (
          <Skeleton className="absolute inset-0" />
        ) : error && !map ? (
          <p className="p-10 text-center text-xs text-warn">{error instanceof Error ? error.message : String(error)}</p>
        ) : (
          layout.map((g) => (
            <div key={g.stat.sector}>
              {g.header && (
                <div className="absolute flex items-center gap-1.5 overflow-hidden px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400" style={{ left: g.x + 1, top: g.y, width: g.w - 2, height: HEADER }}>
                  <span className="truncate">{sectorShort(g.stat.sector)}</span>
                  <Pct value={g.stat.avgPct} plain className="shrink-0 font-semibold normal-case tracking-normal" />
                </div>
              )}
              {g.tiles.map(({ s, r }) => {
                if (r.w < 3 || r.h < 3) return null;
                const big = r.w > 120 && r.h > 70;
                return (
                  <button
                    key={s.symbol}
                    type="button"
                    aria-label={`${s.symbol} ${fmtPct(s.pct)}`}
                    onClick={() => onPick(s.symbol)}
                    onPointerMove={(e) => setHover({ x: e.clientX, y: e.clientY, content: <TileCard s={s} /> })}
                    className={clsx('absolute flex flex-col items-center justify-center overflow-hidden rounded-[3px] leading-tight transition-[filter] hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent', onFillClass(s.pct))}
                    style={{ left: r.x + 1, top: r.y + 1, width: r.w - 2, height: r.h - 2, ...moveFill(s.pct) }}
                  >
                    {r.w >= 34 && r.h >= 16 && <span className={clsx('max-w-full truncate px-0.5 font-semibold', big ? 'text-sm' : 'text-[10px]')}>{s.symbol}</span>}
                    {r.w >= 40 && r.h >= 30 && <span className={clsx('tabular-nums opacity-90', big ? 'text-xs' : 'text-[9px]')}>{fmtPct(s.pct)}</span>}
                    {big && <span className="text-[10px] tabular-nums opacity-75">{fmtPrice(s.ltp)}</span>}
                    {s.alerts > 0 && r.w >= 24 && r.h >= 24 && <BellRing className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-warn" aria-label={`${s.alerts} alerts today`} />}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <HoverCard hover={hover} />
    </Section>
  );
}

function TileCard({ s }: { s: MapStock }) {
  return (
    <div className="space-y-1">
      <div>
        <div className="font-semibold text-fg">{s.name}</div>
        <div className="text-[10px] text-slate-500">
          {s.symbol} · {s.sector}
          {s.fno ? ' · F&O' : ''}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold tabular-nums text-fg">{fmtPrice(s.ltp)}</span>
        <Pct value={s.pct} className="font-medium" />
        <span className="text-[10px] tabular-nums text-slate-500">{fmtSigned(s.change)}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 text-[11px] tabular-nums">
        <span>Value <span className="text-fg">{fmtRupees(s.value)}</span></span>
        <span>Volume <span className="text-fg">{fmtCompact(s.volume)}</span></span>
        {s.low !== null && s.high !== null && (
          <span className="col-span-2">
            Range <span className="text-fg">{fmtPrice(s.low)} – {fmtPrice(s.high)}</span>
          </span>
        )}
      </div>
      {s.circuit && <div className="text-[11px] font-medium text-warn">At its {s.circuit} circuit</div>}
      {s.alerts > 0 && <div className="text-[11px] text-warn">{s.alerts} alert{s.alerts === 1 ? '' : 's'} from your strategies today</div>}
      <div className="text-[10px] text-slate-500">Click for news, filings and the chart</div>
    </div>
  );
}

interface Group {
  stat: SectorStat;
  x: number;
  y: number;
  w: number;
  h: number;
  header: boolean;
  tiles: Array<{ s: MapStock; r: { x: number; y: number; w: number; h: number } }>;
}

function layoutMap(stocks: MapStock[], sizeBy: SizeBy, width: number, height: number): Group[] {
  if (!width || !stocks.length) return [];
  const size = (s: MapStock) => (sizeBy === 'equal' ? 1 : Math.sqrt(Math.max(s.value, 1)));
  const stats = sectorStats(stocks);
  const members = new Map<string, MapStock[]>();
  for (const s of stocks) members.set(s.sector, [...(members.get(s.sector) ?? []), s]);
  const totals = stats.map((st) => (members.get(st.sector) ?? []).reduce((a, s) => a + size(s), 0));
  const rects = squarify(totals, { x: 0, y: 0, w: width, h: height });
  return stats.map((stat, i) => {
    const r = rects[i]!;
    const list = [...(members.get(stat.sector) ?? [])].sort((a, b) => size(b) - size(a));
    const header = r.h > 44 && r.w > 60;
    const inner = { x: r.x + 1, y: r.y + (header ? HEADER : 1), w: r.w - 2, h: r.h - (header ? HEADER : 1) - 1 };
    const tiles = squarify(list.map(size), inner).map((tr, j) => ({ s: list[j]!, r: tr }));
    return { stat, ...r, header, tiles };
  });
}
