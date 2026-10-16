'use client';

/** Sector / theme / style indices ranked by their move, and the sector rotation quadrant. */
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { SECTOR_OF_INDEX } from '@/shared/market/indices';
import type { IndexQuote, MarketOverview } from '@/shared/market/types';
import { Tooltip } from '../components/Tooltip';
import { Section, Segmented } from '../components/ui';
import { AdBar, DivergingBar, RotationChart } from './charts';
import { fmtPct, fmtPrice } from './format';
import { M } from './help';
import { Pct, Skeleton } from './parts';

type Kind = 'sector' | 'theme' | 'style';
type Period = '1d' | '1w' | '1m' | '1y';

const value = (q: IndexQuote, p: Period) => (p === '1d' ? q.pct : p === '1w' ? q.pct1w : p === '1m' ? q.pct1m : q.pct1y);

export function SectorBoard({ data, onPickSector }: { data: MarketOverview | undefined; onPickSector: (sectors: string[], label: string) => void }) {
  const [kind, setKind] = useState<Kind>('sector');
  const [period, setPeriod] = useState<Period>('1d');
  const rows = useMemo(
    () =>
      (data?.indices ?? [])
        .filter((i) => i.group === kind && value(i, period) !== null)
        .sort((a, b) => (value(b, period) ?? 0) - (value(a, period) ?? 0)),
    [data, kind, period],
  );
  const max = Math.max(0.5, ...rows.map((r) => Math.abs(value(r, period) ?? 0)));
  return (
    <Section
      title="Sectors, themes & styles"
      help={M.sectors}
      actions={
        <>
          <Segmented<Kind>
            label="Index type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'sector', label: 'Sectors', help: M.sectorKind.sectors },
              { value: 'theme', label: 'Themes', help: M.sectorKind.themes },
              { value: 'style', label: 'Styles', help: M.sectorKind.styles },
            ]}
          />
          <Segmented<Period>
            label="Period"
            value={period}
            onChange={setPeriod}
            options={(['1d', '1w', '1m', '1y'] as const).map((p) => ({ value: p, label: p.toUpperCase(), help: M.period[p] }))}
          />
        </>
      }
    >
      {!data ? (
        <Skeleton className="h-[420px]" />
      ) : (
        <div className="max-h-[440px] overflow-y-auto pr-1">
          <div className="grid grid-cols-[minmax(110px,1.1fr)_minmax(120px,2fr)_64px_minmax(60px,0.8fr)_44px] items-center gap-x-3 border-b border-ink-700/60 pb-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            <span>Index</span>
            <span className="text-center">{period === '1d' ? 'Today' : period.toUpperCase()}</span>
            <span className="text-right">Move</span>
            <span>Breadth</span>
            <span className="text-right">P/E</span>
          </div>
          {rows.map((r) => {
            const v = value(r, period)!;
            const sectors = SECTOR_OF_INDEX[r.symbol];
            return (
              <Tooltip
                key={r.symbol}
                side="left"
                className="block"
                content={{
                  title: `${r.name} (${r.symbol})`,
                  body: (
                    <span className="tabular-nums">
                      {fmtPrice(r.last)} · today {fmtPct(r.pct)} · 1W {fmtPct(r.pct1w)} · 1M {fmtPct(r.pct1m)} · 1Y {fmtPct(r.pct1y)}
                      {r.yearHigh ? ` · ${fmtPct(((r.last - r.yearHigh) / r.yearHigh) * 100, 1)} vs 52w high` : ''}
                    </span>
                  ),
                  note: sectors ? 'Click to show its stocks on the market map.' : undefined,
                }}
              >
                <button
                  type="button"
                  onClick={() => sectors && onPickSector(sectors, r.name)}
                  className={clsx('grid w-full grid-cols-[minmax(110px,1.1fr)_minmax(120px,2fr)_64px_minmax(60px,0.8fr)_44px] items-center gap-x-3 rounded-md py-1.5 text-left text-xs hover:bg-ink-800/60', !sectors && 'cursor-default')}
                >
                  <span className="truncate text-slate-200">{r.name}</span>
                  <DivergingBar value={v} max={max} />
                  <Pct value={v} className="text-right font-medium" plain />
                  {r.advances !== null && r.declines !== null && r.advances + r.declines > 0 ? <AdBar advances={r.advances} declines={r.declines} unchanged={r.unchanged ?? 0} height={6} /> : <span className="text-slate-600">—</span>}
                  <span className="text-right tabular-nums text-slate-500">{r.pe ? r.pe.toFixed(1) : '—'}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export function RotationPanel({ data, onPickSector }: { data: MarketOverview | undefined; onPickSector: (sectors: string[], label: string) => void }) {
  const nifty = data?.indices.find((i) => i.symbol === 'NIFTY 50');
  const points = useMemo(
    () =>
      (data?.indices ?? [])
        .filter((i) => i.group === 'sector' && i.pct1m !== null && i.pct1w !== null && i.symbol !== 'NIFTY FIN SERVICE')
        .map((i) => ({ id: i.symbol, label: i.name, x: (i.pct1m ?? 0) - (nifty?.pct1m ?? 0), y: (i.pct1w ?? 0) - (nifty?.pct1w ?? 0), today: i.pct })),
    [data, nifty],
  );
  return (
    <Section title="Sector rotation" help={M.rotation}>
      {!data ? (
        <Skeleton className="h-[360px]" />
      ) : points.length ? (
        <RotationChart
          points={points}
          onPick={(id) => {
            const s = SECTOR_OF_INDEX[id];
            const label = data.indices.find((i) => i.symbol === id)?.name ?? id;
            if (s) onPickSector(s, label);
          }}
        />
      ) : (
        <p className="py-10 text-center text-xs text-slate-500">No 1-week / 1-month data from NSE right now.</p>
      )}
    </Section>
  );
}
