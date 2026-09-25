'use client';

/**
 * Market-profile UI shared by the builder, library and run forms: the
 * Specific / Universal badge, locked-field chips, and the CUSTOM strike picker.
 */
import { useQuery } from '@tanstack/react-query';
import { Globe, Lock, Target } from 'lucide-react';
import type { ExpiryType, Segment, StrategyMarket } from '@ash/shared';
import { describeFixed, describeOpen, effectiveExpiryType, expiryLabel, fixedUnderlyings, isSpecific, marketSegment, segmentOf } from '@ash/shared';
import { api } from '../lib/api';
import { HELP } from '../lib/help';
import { Tooltip } from './Tooltip';

/** "🎯 Specific · NIFTY · Current weekly · ATM · 15m" or "🌐 Universal · 15m · choose underlying…". */
export function MarketBadge({ market, compact }: { market: StrategyMarket; compact?: boolean }) {
  const specific = isSpecific(market);
  const fixed = describeFixed(market);
  const open = describeOpen(market);
  const pinned = marketSegment(market);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {pinned && <SegmentChip segment={pinned} />}
      <SpecificBadge specific={specific} fixed={fixed} open={open} compact={compact} />
    </span>
  );
}

/** "MCX" / "NSE" chip for strategies pinned to one market. */
export function SegmentChip({ segment }: { segment: Segment }) {
  return (
    <Tooltip content={segment === 'MCX' ? HELP.market.mcxPinned : HELP.market.nsePinned}>
      <span
        tabIndex={0}
        className="inline-flex items-center rounded-md border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300 cursor-help"
      >
        {segment === 'MCX' ? 'MCX' : 'NSE/BSE'}
      </span>
    </Tooltip>
  );
}

function SpecificBadge({ specific, fixed, open, compact }: { specific: boolean; fixed: string; open: string; compact?: boolean }) {
  return (
    <Tooltip
      content={{
        ...(specific ? HELP.market.specific : HELP.market.universal),
        note: specific ? `Runs on ${fixed}.` : `Fixed: ${fixed || 'nothing'} · Chosen per run: ${open}.`,
      }}
    >
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
        <span
          className={
            specific
              ? 'inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-semibold text-accent-soft'
              : 'inline-flex items-center gap-1 rounded-md border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-semibold text-slate-300'
          }
        >
          {specific ? <Target className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
          {specific ? 'Specific' : 'Universal'}
        </span>
        {!compact && <span className="text-slate-400">{fixed || 'any underlying, expiry, strike & timeframe'}</span>}
      </span>
    </Tooltip>
  );
}

/**
 * Read-only chips for the fields a strategy fixes (shown in run forms instead
 * of inputs). On MCX a fixed weekly expiry shows the month it runs as.
 */
export function LockedFields({ market, segment = 'NSE' }: { market: StrategyMarket; segment?: Segment }) {
  const u = fixedUnderlyings(market);
  const chips: Array<{ label: string; value: string; mapped?: boolean }> = [];
  if (u.length) chips.push({ label: u.length > 1 ? 'Basket' : 'Underlying', value: u.join(', ') });
  if (market.expiryType) {
    const eff = effectiveExpiryType(market.expiryType, segment);
    chips.push(
      eff === market.expiryType
        ? { label: 'Expiry', value: expiryLabel(eff) }
        : { label: 'Expiry', value: `${expiryLabel(eff)} (from ${expiryLabel(market.expiryType)})`, mapped: true },
    );
  }
  if (market.strikeSelection) chips.push({ label: 'Strike', value: market.strikeSelection });
  if (market.timeframe) chips.push({ label: 'Timeframe', value: market.timeframe });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <Tooltip
          key={c.label}
          content={
            c.label === 'Basket'
              ? { ...HELP.market.basket, note: HELP.market.locked.note }
              : c.mapped
                ? { ...HELP.market.mappedExpiry, note: HELP.market.locked.note }
                : HELP.market.locked
          }
        >
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1 text-xs cursor-help" tabIndex={0}>
            <Lock className="w-3 h-3 text-slate-500" />
            <span className="text-slate-500">{c.label}</span>
            <span className="font-medium text-slate-200">{c.value}</span>
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

/** Strike-price picker for CUSTOM strikes, listing the strikes Kite has for that expiry. */
export function CustomStrikeSelect({
  underlying,
  expiryType,
  value,
  onChange,
}: {
  underlying: string;
  expiryType: ExpiryType;
  value: number | undefined;
  onChange: (strike: number) => void;
}) {
  const expiries = useQuery({ queryKey: ['expiries', underlying], queryFn: () => api.expiries(underlying), enabled: Boolean(underlying) });
  const wanted = effectiveExpiryType(expiryType, segmentOf(underlying));
  const date = expiries.data?.find((e) => e.type === wanted)?.date;
  const strikes = useQuery({
    queryKey: ['strikes', underlying, date],
    queryFn: () => api.strikes(underlying, date!),
    enabled: Boolean(date),
  });
  if (!date) return <div className="text-xs text-slate-500 py-2">{expiries.isLoading ? 'Loading expiries…' : 'No expiry found — is Kite connected?'}</div>;
  return (
    <select className="input w-full" aria-label="Strike price" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))}>
      <option value="" disabled>
        {strikes.isLoading ? 'Loading strikes…' : 'Pick a strike…'}
      </option>
      {strikes.data?.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}
