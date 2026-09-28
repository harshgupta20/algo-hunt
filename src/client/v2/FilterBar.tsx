'use client';

/**
 * The trader's filters, shared by Alerts (active / history / signals) and Paper trading:
 *   row 1  strategy · period (today … custom dates) · product search · more filters · clear
 *   row 2  type · market · timeframe · group (e.g. Bullish / Bearish) · and per screen: candles, delivery,
 *          outcome, side — toggle chips, several per row combine (none = all)
 * Filtering happens on the server; the choice is remembered in this browser per screen.
 */
import { useEffect, useMemo, useState } from 'react';
import { Filter, Search, X } from 'lucide-react';
import clsx from 'clsx';
import type { AlertStatus, EvaluationSource, Market, PaperSide, ProductKind, RecordFilters, SignalOutcome, StrategyDefinition, Timeframe } from '@/shared/v2';
import { ALERT_STATUSES, EVALUATION_SOURCES, MARKETS, PRODUCT_KINDS, SIGNAL_OUTCOMES, TIMEFRAME, TIMEFRAMES, paperGroups } from '@/shared/v2';
import { Tooltip, type TooltipContent } from '../components/Tooltip';
import { Segmented } from './components';
import { OUTCOME_LABEL, daysAgo, istToday } from './format';
import { H } from './help';

export type Period = 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom';

export interface FilterValue {
  strategyId: string;
  period: Period;
  from: string;
  to: string;
  search: string;
  kinds: ProductKind[];
  markets: Market[];
  timeframes: Timeframe[];
  /** Group labels (each maps to the matching group ids of the strategies in scope). */
  groups: string[];
  sources: EvaluationSource[];
  statuses: AlertStatus[];
  outcomes: SignalOutcome[];
  sides: PaperSide[];
}

export type FilterField = 'sources' | 'statuses' | 'outcomes' | 'sides';

export const EMPTY_FILTERS: FilterValue = { strategyId: '', period: 'all', from: '', to: '', search: '', kinds: [], markets: [], timeframes: [], groups: [], sources: [], statuses: [], outcomes: [], sides: [] };

interface StrategyLite {
  id: string;
  name: string;
  definition: StrategyDefinition;
}

/** Remembered per screen in this browser (a convenience — falls back to no filters). */
export function useFilters(key: string, initial?: Partial<FilterValue>): [FilterValue, (v: FilterValue) => void] {
  const storageKey = `algo-hunt.filters.${key}`;
  const [value, setValue] = useState<FilterValue>(() => {
    let stored: Partial<FilterValue> = {};
    try {
      stored = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as Partial<FilterValue>;
    } catch {
      /* private window / blocked storage */
    }
    return { ...EMPTY_FILTERS, ...stored, ...Object.fromEntries(Object.entries(initial ?? {}).filter(([, v]) => v !== undefined)) };
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [storageKey, value]);
  return [value, setValue];
}

/** Group labels → the ids of those groups in the strategies in scope. */
function groupIndex(strategies: StrategyLite[], strategyId: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of strategies) {
    if (strategyId && s.id !== strategyId) continue;
    for (const g of paperGroups(s.definition)) out.set(g.label, [...(out.get(g.label) ?? []), g.id]);
  }
  return out;
}

const dayRange = (v: FilterValue): { from?: string; to?: string } => {
  switch (v.period) {
    case 'today':
      return { from: istToday() };
    case 'yesterday':
      return { from: daysAgo(1), to: daysAgo(1) };
    case '7d':
      return { from: daysAgo(6) };
    case '30d':
      return { from: daysAgo(29) };
    case 'custom':
      return { from: v.from || undefined, to: v.to || undefined };
    default:
      return {};
  }
};

/** The API query for these filters. */
export function toQuery(v: FilterValue, strategies: StrategyLite[]): RecordFilters & { sources?: EvaluationSource[]; statuses?: AlertStatus[]; outcomes?: SignalOutcome[]; sides?: PaperSide[] } {
  const ids = groupIndex(strategies, v.strategyId);
  const groups = v.groups.flatMap((l) => ids.get(l) ?? []);
  return {
    strategyId: v.strategyId || undefined,
    ...dayRange(v),
    search: v.search.trim() || undefined,
    kinds: v.kinds,
    markets: v.markets,
    timeframes: v.timeframes,
    // A chosen label that no strategy in scope has matches nothing.
    groups: v.groups.length ? (groups.length ? groups : ['∅']) : undefined,
    sources: v.sources,
    statuses: v.statuses,
    outcomes: v.outcomes,
    sides: v.sides,
  };
}

/** How many filters (beyond "everything") are on. */
export function activeCount(v: FilterValue, fields: FilterField[]): number {
  return (
    (v.strategyId ? 1 : 0) +
    (v.period !== 'all' ? 1 : 0) +
    (v.search.trim() ? 1 : 0) +
    [v.kinds, v.markets, v.timeframes, v.groups].filter((l) => l.length).length +
    fields.filter((f) => v[f].length).length
  );
}

function Chips<T extends string>({ label, help, options, value, onChange }: { label: string; help: TooltipContent; options: Array<{ value: T; label: string; help: TooltipContent }>; value: T[]; onChange: (v: T[]) => void }) {
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <Tooltip content={help}>
        <span className="mr-0.5 cursor-help text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      </Tooltip>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <Tooltip key={o.value} content={{ ...o.help, note: on ? 'Click to remove this filter.' : 'Click to show only these (several combine).' }}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
              className={clsx(
                'rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors',
                on ? 'border-accent bg-accent text-white' : 'border-ink-700 bg-ink-850 text-slate-400 hover:border-accent/50 hover:text-slate-200',
              )}
            >
              {o.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

const KIND_LABEL: Record<ProductKind, string> = { INDEX: 'Index', STOCK: 'Stock', COMMODITY: 'Commodity' };
const KIND_HELP: Record<ProductKind, TooltipContent> = {
  INDEX: { title: 'Indices', body: 'NIFTY, BANKNIFTY, SENSEX … and their futures / options.' },
  STOCK: { title: 'Stocks', body: 'NSE stocks and their futures / options.' },
  COMMODITY: { title: 'Commodities', body: 'MCX commodities (GOLD, CRUDEOIL, NATURALGAS …) — futures and options.' },
};
const MARKET_LABEL: Record<Market, string> = { NSE: 'NSE / BSE', MCX: 'MCX' };
const SOURCE_LABEL: Record<EvaluationSource, string> = { LIVE_VERIFIED: 'Verified', HISTORICAL: 'Kite candles', LIVE: 'Live candle', LIVE_UNVERIFIED: 'Not verified' };
const SOURCE_HELP: Record<EvaluationSource, TooltipContent> = { LIVE_VERIFIED: H.alerts.sourceVerified, HISTORICAL: H.alerts.sourceHistorical, LIVE: H.alerts.sourceLive, LIVE_UNVERIFIED: H.alerts.sourceUnverified };
const STATUS_LABEL: Record<AlertStatus, string> = { SENT: 'Sent', PARTIAL: 'Partial', FAILED: 'Failed', ACKNOWLEDGED: 'Acknowledged' };

const PERIOD_OPTIONS: Array<{ value: Period; label: string; help: TooltipContent }> = [
  { value: 'today', label: 'Today', help: { title: 'Today', body: 'Today only (IST).' } },
  { value: 'yesterday', label: 'Yesterday', help: { title: 'Yesterday', body: 'The previous calendar day (IST).' } },
  { value: '7d', label: '7 days', help: { title: 'Last 7 days', body: 'The last 7 days, today included.' } },
  { value: '30d', label: '30 days', help: { title: 'Last 30 days', body: 'The last 30 days, today included.' } },
  { value: 'all', label: 'All', help: { title: 'All time', body: 'No date limit.' } },
  { value: 'custom', label: 'Custom', help: { title: 'Custom dates', body: 'Pick the first and last day.' } },
];

export function FilterBar({
  value,
  onChange,
  strategies,
  fields = [],
  shown,
}: {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
  strategies: StrategyLite[];
  /** Screen-specific chip rows (type, market, timeframe and group are always offered). */
  fields?: FilterField[];
  /** "23 alerts" — the result count shown at the right. */
  shown?: string;
}) {
  const [open, setOpen] = useState(true);
  const set = (patch: Partial<FilterValue>) => onChange({ ...value, ...patch });
  const inScope = value.strategyId ? strategies.filter((s) => s.id === value.strategyId) : strategies;
  const timeframes = useMemo(() => TIMEFRAMES.map((t) => t.key).filter((k) => inScope.some((s) => s.definition.evaluation.triggerTimeframe === k)), [inScope]);
  const groups = useMemo(() => [...groupIndex(strategies, value.strategyId).keys()], [strategies, value.strategyId]);
  const n = activeCount(value, fields);
  const chipsOn = [value.kinds, value.markets, value.timeframes, value.groups, ...fields.map((f) => value[f])].filter((l) => l.length).length;

  return (
    <div className="card flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={H.filters.strategy}>
          <select aria-label="Strategy" className="input py-1.5 text-xs max-w-[16rem]" value={value.strategyId} onChange={(e) => set({ strategyId: e.target.value, groups: [] })}>
            <option value="">All strategies</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Tooltip>
        <Segmented label="Period" value={value.period} onChange={(period) => set({ period })} options={PERIOD_OPTIONS} />
        {value.period === 'custom' && (
          <span className="inline-flex items-center gap-1">
            <Tooltip content={H.filters.from}>
              <input aria-label="From date" type="date" className="input py-1 text-xs" value={value.from} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            </Tooltip>
            <span className="text-xs text-slate-500">–</span>
            <Tooltip content={H.filters.to}>
              <input aria-label="To date" type="date" className="input py-1 text-xs" value={value.to} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} />
            </Tooltip>
          </span>
        )}
        <Tooltip content={H.filters.search}>
          <span className="relative inline-flex items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-slate-500" />
            <input aria-label="Product" className="input py-1.5 pl-7 text-xs w-36" placeholder="Product…" value={value.search} onChange={(e) => set({ search: e.target.value })} />
          </span>
        </Tooltip>
        <Tooltip content={H.filters.more}>
          <button type="button" aria-expanded={open} className={clsx('btn-ghost py-1 text-xs', chipsOn && 'text-accent-soft')} onClick={() => setOpen(!open)}>
            <Filter className="w-3.5 h-3.5" /> Filters{chipsOn ? ` (${chipsOn})` : ''}
          </button>
        </Tooltip>
        {n > 0 && (
          <Tooltip content={H.filters.clear}>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => onChange(EMPTY_FILTERS)}>
              <X className="w-3.5 h-3.5" /> Clear {n}
            </button>
          </Tooltip>
        )}
        {shown && (
          <Tooltip content={H.filters.count} className="ml-auto">
            <span className="text-[11px] text-slate-500">{shown}</span>
          </Tooltip>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink-700/60 pt-2">
          <Chips label="Type" help={H.filters.kinds} value={value.kinds} onChange={(kinds) => set({ kinds })} options={PRODUCT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], help: KIND_HELP[k] }))} />
          <Chips label="Market" help={H.filters.markets} value={value.markets} onChange={(markets) => set({ markets })} options={MARKETS.map((m) => ({ value: m, label: MARKET_LABEL[m], help: m === 'NSE' ? H.status.nse : H.status.mcx }))} />
          <Chips
            label="Timeframe"
            help={H.filters.timeframes}
            value={value.timeframes}
            onChange={(timeframes) => set({ timeframes })}
            options={timeframes.map((t) => ({ value: t, label: TIMEFRAME[t].label, help: { title: `${TIMEFRAME[t].label} strategies`, body: `Strategies that decide on ${TIMEFRAME[t].label} candles.` } }))}
          />
          <Chips label="Group" help={H.filters.groups} value={value.groups} onChange={(g) => set({ groups: g })} options={groups.map((g) => ({ value: g, label: g, help: { title: g, body: `Only when the “${g}” group fired.` } }))} />
          {fields.includes('sides') && (
            <Chips
              label="Side"
              help={H.filters.sides}
              value={value.sides}
              onChange={(sides) => set({ sides })}
              options={[
                { value: 'BUY' as const, label: 'Buy', help: H.paper.buy },
                { value: 'SELL' as const, label: 'Sell', help: H.paper.sell },
              ]}
            />
          )}
          {fields.includes('sources') && (
            <Chips label="Candles" help={H.filters.sources} value={value.sources} onChange={(sources) => set({ sources })} options={EVALUATION_SOURCES.map((x) => ({ value: x, label: SOURCE_LABEL[x], help: SOURCE_HELP[x] }))} />
          )}
          {fields.includes('statuses') && (
            <Chips label="Delivery" help={H.filters.statuses} value={value.statuses} onChange={(statuses) => set({ statuses })} options={ALERT_STATUSES.map((x) => ({ value: x, label: STATUS_LABEL[x], help: { ...H.alerts.status, title: STATUS_LABEL[x] } }))} />
          )}
          {fields.includes('outcomes') && (
            <Chips label="Outcome" help={H.filters.outcomes} value={value.outcomes} onChange={(outcomes) => set({ outcomes })} options={SIGNAL_OUTCOMES.map((x) => ({ value: x, label: OUTCOME_LABEL[x], help: { ...H.alerts.outcome, title: OUTCOME_LABEL[x] } }))} />
          )}
        </div>
      )}
    </div>
  );
}
