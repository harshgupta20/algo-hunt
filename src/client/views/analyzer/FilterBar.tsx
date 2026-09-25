import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { format, subDays } from 'date-fns';
import type { AnalyzerParams, DateRangePreset, ExpiryType, StrikeSelection, Timeframe } from '@ash/shared';
import { BUILTIN_STRATEGY_NAME, fixedFields, isSpecific, marketOf } from '@ash/shared';
import { api } from '../../lib/api';
import { Card, Help } from '../../components/ui';
import { FieldLabel } from '../../components/Tooltip';
import { CustomStrikeSelect, LockedFields, MarketBadge } from '../../components/market';
import { HELP } from '../../lib/help';

const PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last-week', label: 'Last Week' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'last-3-months', label: 'Last 3 Months' },
  { value: 'last-6-months', label: 'Last 6 Months' },
  { value: 'last-year', label: 'Last Year' },
  { value: 'custom', label: 'Custom Range' },
];

/** What the backtest sends: the strategy, the date range and only the fields the strategy leaves open. */
export type BacktestRequest = Pick<AnalyzerParams, 'strategy' | 'preset' | 'from' | 'to'> & Partial<AnalyzerParams>;

/**
 * Backtest filters, strategy first. Fields the strategy fixes are shown as
 * locked chips (the server applies them); only open fields are editable.
 */
export function FilterBar({
  onAnalyze,
  loading,
  initialStrategy,
  autoRun,
}: {
  onAnalyze: (p: BacktestRequest) => void;
  loading: boolean;
  initialStrategy?: string;
  /** Run once on mount — used when a specific strategy is opened from the library. */
  autoRun?: boolean;
}) {
  const underlyings = useQuery({ queryKey: ['underlyings'], queryFn: api.underlyings });
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const strategies = useQuery({ queryKey: ['strategies-custom'], queryFn: api.listStrategies });
  const groups = useQuery({ queryKey: ['groups'], queryFn: api.listGroups });

  const [strategy, setStrategy] = useState(initialStrategy ?? 'rsi-sync');
  const [preset, setPreset] = useState<DateRangePreset>(autoRun ? 'last-week' : 'last-month');
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [underlying, setUnderlying] = useState('NIFTY');
  const [expiryType, setExpiryType] = useState<ExpiryType>('current-weekly');
  const [strikeSelection, setStrikeSelection] = useState<StrikeSelection>('ATM');
  const [customStrike, setCustomStrike] = useState<number | undefined>(undefined);
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');

  const def = strategies.data?.find((s) => s.id === strategy);
  const market = marketOf(strategy, def);
  const fixed = fixedFields(market);
  // A strike price only makes sense for one underlying (not a user group or a fixed basket).
  const isGroup = (!fixed.underlying && underlying.startsWith('group:')) || (market.underlyings?.length ?? 0) > 1;
  const needsStrikePrice = !fixed.strikeSelection && strikeSelection === 'CUSTOM';

  const analyze = () => {
    const req: BacktestRequest = { strategy, preset, from: preset === 'custom' ? from : undefined, to: preset === 'custom' ? to : undefined };
    if (!fixed.underlying) {
      const g = underlying.startsWith('group:') ? groups.data?.find((x) => `group:${x.id}` === underlying) : undefined;
      if (g) Object.assign(req, { underlying: g.members[0], underlyings: g.members, groupName: g.name });
      else req.underlying = underlying;
    }
    if (!fixed.expiryType) req.expiryType = expiryType;
    if (!fixed.strikeSelection) {
      req.strikeSelection = strikeSelection;
      if (strikeSelection === 'CUSTOM') req.customStrike = customStrike;
    }
    if (!fixed.timeframe) req.timeframe = timeframe;
    onAnalyze(req);
  };

  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoRun || autoRan.current || (strategy !== 'rsi-sync' && !def)) return;
    autoRan.current = true;
    if (isSpecific(market)) analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, def]);

  const blocked = needsStrikePrice && (isGroup || customStrike === undefined);

  return (
    <Card className="mb-6">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 items-end">
        <div className="col-span-2">
          <FieldLabel help={HELP.field.strategy}>Strategy</FieldLabel>
          <select className="input w-full" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="rsi-sync">{BUILTIN_STRATEGY_NAME} (built-in)</option>
            {strategies.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.status === 'draft' ? ' (draft)' : s.status === 'disabled' ? ' (disabled)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel help={HELP.backtest.dateRange}>Date Range</FieldLabel>
          <select className="input w-full" value={preset} onChange={(e) => setPreset(e.target.value as DateRangePreset)}>
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {preset === 'custom' && (
          <>
            <div>
              <FieldLabel help={HELP.backtest.from}>From</FieldLabel>
              <input type="date" className="input w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <FieldLabel help={HELP.backtest.to}>To</FieldLabel>
              <input type="date" className="input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        <div className="col-span-2 md:col-span-1 lg:col-start-6">
          <Help content={blocked ? { ...HELP.backtest.analyze, note: isGroup ? 'A CUSTOM strike needs a single underlying.' : 'Pick the strike price first.' } : HELP.backtest.analyze} className="w-full">
            <button className="btn-primary w-full justify-center" onClick={analyze} disabled={loading || blocked}>
              <Play className="w-4 h-4" /> {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </Help>
        </div>
      </div>

      {/* The strategy's market profile: locked values + the open fields this run must choose. */}
      <div className="mt-4 pt-4 border-t border-ink-700/60">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <MarketBadge market={market} compact />
          <LockedFields market={market} />
          {isSpecific(market) && <span className="text-xs text-slate-500">Runs exactly as the strategy defines — just pick the date range.</span>}
        </div>

        {!isSpecific(market) && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 items-end">
            {!fixed.underlying && (
              <div>
                <FieldLabel help={HELP.backtest.underlyingGroup}>Underlying / Group</FieldLabel>
                <select className="input w-full" value={underlying} onChange={(e) => setUnderlying(e.target.value)}>
                  <optgroup label="Underlyings">
                    {underlyings.data?.map((u) => (
                      <option key={u.symbol} value={u.symbol}>
                        {u.symbol}
                      </option>
                    ))}
                  </optgroup>
                  {(groups.data?.length ?? 0) > 0 && (
                    <optgroup label="Groups">
                      {groups.data?.map((g) => (
                        <option key={g.id} value={`group:${g.id}`}>
                          {g.name} ({g.members.length})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
            {!fixed.expiryType && (
              <div>
                <FieldLabel help={HELP.field.expiry}>Expiry</FieldLabel>
                <select className="input w-full" value={expiryType} onChange={(e) => setExpiryType(e.target.value as ExpiryType)}>
                  {meta.data?.expiryTypes.map((x) => (
                    <option key={x.type} value={x.type}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!fixed.strikeSelection && (
              <div>
                <FieldLabel help={HELP.field.strike}>Strike</FieldLabel>
                <select className="input w-full" value={strikeSelection} onChange={(e) => setStrikeSelection(e.target.value as StrikeSelection)}>
                  {meta.data?.strikeSelections.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {needsStrikePrice && (
              <div>
                <FieldLabel help={HELP.market.customStrike}>Strike Price</FieldLabel>
                {isGroup ? (
                  <div className="text-xs text-warn py-2">Needs a single underlying.</div>
                ) : (
                  <CustomStrikeSelect
                    underlying={fixed.underlying ? (market.underlyings?.[0] ?? underlying) : underlying}
                    expiryType={market.expiryType ?? expiryType}
                    value={customStrike}
                    onChange={setCustomStrike}
                  />
                )}
              </div>
            )}
            {!fixed.timeframe && (
              <div>
                <FieldLabel help={HELP.field.timeframe}>Timeframe</FieldLabel>
                <select className="input w-full" value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)}>
                  {meta.data?.timeframes.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
