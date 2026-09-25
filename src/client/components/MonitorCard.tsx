'use client';

/**
 * One active monitor's live card: status dot, contract details and an RSI
 * gauge per leg. Shared by the Dashboard (NSE/BSE) and the MCX tab; legs the
 * monitor doesn't have (futures-only MCX products) are left out.
 */
import clsx from 'clsx';
import { formatDistanceToNowStrict } from 'date-fns';
import type { ConfigRuntimeSnapshot, Leg } from '@ash/shared';
import { isMcx } from '@ash/shared';
import { LEG_ORDER } from '../lib/signals';
import { HELP } from '../lib/help';
import { Card } from './ui';
import { RsiGauge } from './RsiGauge';
import { Tooltip } from './Tooltip';

const TRIGGER_SIDE: Record<Leg, 'above' | 'below'> = { future: 'above', call: 'above', put: 'below' };

export function MonitorCard({ snap }: { snap: ConfigRuntimeSnapshot }) {
  const legs = snap.legs;
  // Snapshots from before contracts were recorded always had all three legs.
  const shown = LEG_ORDER.filter((l) => !snap.contracts || snap.contracts[l]);
  const status = snap.lastError ? 'error' : snap.evaluatedAt ? 'live' : 'waiting';
  const metCount = shown.filter((leg) => {
    const r = legs[leg].rsi;
    return r != null && (TRIGGER_SIDE[leg] === 'above' ? r >= legs[leg].level : r <= legs[leg].level);
  }).length;
  const commodity = isMcx(snap.underlying);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Tooltip content={HELP.monitor[status]}>
              <span
                tabIndex={0}
                aria-label={HELP.monitor[status].title}
                className={clsx(
                  'w-2.5 h-2.5 rounded-full cursor-help',
                  status === 'live' ? 'bg-bull' : status === 'error' ? 'bg-bear' : 'bg-slate-500 animate-pulse',
                )}
              />
            </Tooltip>
            <span className="text-fg font-semibold">{snap.underlying}</span>
            <span className="text-xs text-slate-400">
              {snap.strike ? `${snap.strike} · ` : commodity ? '' : '— · '}
              {snap.timeframe} · exp {snap.expiry || '—'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {snap.evaluatedAt ? `updated ${formatDistanceToNowStrict(snap.evaluatedAt)} ago` : 'awaiting first evaluation'}
            {legs.future.ltp != null && (
              <>
                {' · '}
                <Tooltip content={HELP.monitor.ltp}>
                  <span className="cursor-help">FUT {legs.future.ltp.toFixed(2)}</span>
                </Tooltip>
              </>
            )}
          </div>
          {commodity && snap.contracts && (
            <Tooltip content={HELP.mcx.contract}>
              <div tabIndex={0} className="mt-1 truncate text-[11px] font-mono text-slate-400 cursor-help">
                {shown.map((l) => snap.contracts?.[l]?.tradingSymbol).filter(Boolean).join(' · ')}
              </div>
            </Tooltip>
          )}
        </div>
        <Tooltip content={HELP.monitor.metCount} className="shrink-0">
          <span
            tabIndex={0}
            className={clsx(
              'rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums cursor-help',
              metCount === shown.length ? 'bg-bull/15 text-bull' : 'bg-ink-800 text-slate-400',
            )}
          >
            {metCount}/{shown.length} met
          </span>
        </Tooltip>
      </div>
      {snap.lastError && <div className="text-xs text-bear -mt-2">{snap.lastError}</div>}
      <div className="space-y-3">
        {shown.map((leg) => (
          <RsiGauge
            key={leg}
            leg={leg}
            detail={leg === 'future' ? undefined : `ATM ${snap.strike || '—'}`}
            rsi={legs[leg].rsi}
            level={legs[leg].level}
            triggerSide={TRIGGER_SIDE[leg]}
          />
        ))}
      </div>
    </Card>
  );
}
