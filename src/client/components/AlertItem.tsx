import type { Alert, Leg } from '@ash/shared';
import { BUILTIN_STRATEGY_NAME } from '@ash/shared';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import { Card, RuleBadge } from './ui';
import { Tooltip } from './Tooltip';
import { HELP } from '../lib/help';

/** Alerts younger than this get a "New" marker. */
const FRESH_MS = 10 * 60_000;
import { LegTag, RsiValue } from './signal';
import { fmtRelative, fmtRsi, fmtTime } from '../lib/format';
import { TONE_TEXT, isLeg, moveTone, withoutLegName } from '../lib/signals';

/** One leg's RSI move: arrow colored by direction, value colored by zone. */
function RsiCell({ leg, prev, curr }: { leg: Leg; prev?: number; curr: number }) {
  const dir = moveTone(prev, curr);
  const Icon = dir === 'bull' ? ArrowUpRight : dir === 'bear' ? ArrowDownRight : ArrowRight;
  return (
    <div className="flex flex-col gap-0.5">
      <LegTag leg={leg} />
      <span className="flex items-center gap-1 text-sm">
        {prev != null && <span className="text-slate-500 tabular-nums">{fmtRsi(prev)}</span>}
        <Tooltip
          content={{
            title: dir === 'bull' ? 'RSI rising' : dir === 'bear' ? 'RSI falling' : 'RSI unchanged',
            body: `Previous closed candle ${prev != null ? fmtRsi(prev) : '—'} → trigger candle ${fmtRsi(curr)}. Green arrow = up, red = down.`,
          }}
        >
          <Icon className={clsx('w-3.5 h-3.5', TONE_TEXT[dir])} />
        </Tooltip>
        <RsiValue value={curr} className="font-semibold" />
      </span>
    </div>
  );
}

export function AlertItem({ alert }: { alert: Alert }) {
  const { snapshot: s } = alert;
  const isCustom = Boolean(alert.conditions?.length);
  return (
    <Card className="flex flex-col gap-3 border-l-4 border-l-bull/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {Date.now() - Date.parse(alert.triggeredAt) < FRESH_MS && (
              <Tooltip content={HELP.alertsPage.fresh}>
                <span className="rounded bg-accent px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white animate-pulse">New</span>
              </Tooltip>
            )}
            <RuleBadge scenario={alert.scenario} variant={alert.variant} />
            <span className="text-sm font-semibold text-fg">{alert.underlying}</span>
            {alert.strike ? <span className="text-xs text-slate-400 tabular-nums">{alert.strike}</span> : null}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {alert.strategyName ?? BUILTIN_STRATEGY_NAME} · {alert.timeframe} · exp {alert.expiry || '—'}
            {alert.groupName ? ` · ${alert.groupName}` : ''}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-slate-300">{fmtRelative(alert.triggeredAt)}</div>
          <div className="text-[10px] text-slate-500">{fmtTime(alert.triggeredAt)}</div>
        </div>
      </div>

      {isCustom ? (
        <div className="border-t border-ink-700/60 pt-3 space-y-1.5">
          {alert.conditions!.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-bull shrink-0" />
              {isLeg(c.instrument) && <LegTag leg={c.instrument} />}
              <span className="text-slate-400">{isLeg(c.instrument) ? withoutLegName(c.label, c.instrument) : c.label}</span>
              <span className="text-slate-300 font-mono ml-auto">{c.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 border-t border-ink-700/60 pt-3">
          <RsiCell leg="future" prev={s.futurePrevRsi} curr={s.futureRsi} />
          <RsiCell leg="call" prev={s.callPrevRsi} curr={s.callRsi} />
          <RsiCell leg="put" prev={s.putPrevRsi} curr={s.putRsi} />
        </div>
      )}
    </Card>
  );
}
