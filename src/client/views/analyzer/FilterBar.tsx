import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { format, subDays } from 'date-fns';
import type { AnalyzerParams, DateRangePreset, ExpiryType, StrikeSelection, Timeframe } from '@ash/shared';
import { BUILTIN_STRATEGY_NAME } from '@ash/shared';
import { api } from '../../lib/api';
import { Card, Help } from '../../components/ui';
import { FieldLabel } from '../../components/Tooltip';
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

export function FilterBar({
  onAnalyze,
  loading,
  initial,
  autoRun,
}: {
  onAnalyze: (p: AnalyzerParams) => void;
  loading: boolean;
  /** Pre-fill (e.g. from a strategy opened in the library). */
  initial?: Partial<AnalyzerParams>;
  /** Run once on mount with the initial values. */
  autoRun?: boolean;
}) {
  const underlyings = useQuery({ queryKey: ['underlyings'], queryFn: api.underlyings });
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const strategies = useQuery({ queryKey: ['strategies-custom'], queryFn: api.listStrategies });
  const groups = useQuery({ queryKey: ['groups'], queryFn: api.listGroups });

  const [underlying, setUnderlying] = useState(initial?.underlying ?? 'NIFTY');
  const [expiryType, setExpiryType] = useState<ExpiryType>(initial?.expiryType ?? 'current-weekly');
  const [strikeSelection, setStrikeSelection] = useState<StrikeSelection>(initial?.strikeSelection ?? 'ATM');
  const [timeframe, setTimeframe] = useState<Timeframe>(initial?.timeframe ?? '15m');
  const [strategy, setStrategy] = useState(initial?.strategy ?? 'rsi-sync');
  const [preset, setPreset] = useState<DateRangePreset>(initial?.preset ?? 'last-month');

  /** Choosing a custom strategy applies its own underlying / expiry / strike / timeframe. */
  const chooseStrategy = (value: string) => {
    setStrategy(value);
    const def = strategies.data?.find((x) => x.id === value);
    if (def) {
      setUnderlying(def.underlying);
      setExpiryType(def.expiryType);
      setStrikeSelection(def.strikeSelection);
      setTimeframe(def.timeframe);
    }
  };
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const analyze = () => {
    let single = underlying;
    let underlyings: string[] | undefined;
    let groupName: string | undefined;
    if (underlying.startsWith('group:')) {
      const g = groups.data?.find((x) => `group:${x.id}` === underlying);
      if (g) {
        underlyings = g.members;
        groupName = g.name;
        single = g.members[0] ?? underlying;
      }
    }
    onAnalyze({
      underlying: single,
      underlyings,
      groupName,
      expiryType,
      strikeSelection,
      timeframe,
      strategy,
      preset,
      from: preset === 'custom' ? from : undefined,
      to: preset === 'custom' ? to : undefined,
    });
  };

  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoRun || autoRan.current) return;
    autoRan.current = true;
    analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  return (
    <Card className="mb-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
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
        <div>
          <FieldLabel help={HELP.field.strategy}>Strategy</FieldLabel>
          <select className="input w-full" value={strategy} onChange={(e) => chooseStrategy(e.target.value)}>
            <option value="rsi-sync">{BUILTIN_STRATEGY_NAME} (built-in)</option>
            {strategies.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
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
          <Help content={HELP.backtest.analyze} className="w-full">
            <button className="btn-primary w-full justify-center" onClick={analyze} disabled={loading}>
              <Play className="w-4 h-4" /> {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </Help>
        </div>
      </div>
    </Card>
  );
}
