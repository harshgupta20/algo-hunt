import type { Alert } from '@ash/shared';
import { ArrowDownRight, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { Card, RuleBadge } from './ui';
import { fmtRelative, fmtRsi, fmtTime } from '../lib/format';

function RsiCell({ label, prev, curr, dir }: { label: string; prev?: number; curr: number; dir: 'up' | 'down' }) {
  const Icon = dir === 'up' ? ArrowUpRight : ArrowDownRight;
  const color = dir === 'up' ? 'text-bull' : 'text-bear';
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className="flex items-center gap-1 text-sm tabular-nums text-slate-200">
        {prev != null && <span className="text-slate-500">{fmtRsi(prev)}</span>}
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className={color}>{fmtRsi(curr)}</span>
      </span>
    </div>
  );
}

export function AlertItem({ alert }: { alert: Alert }) {
  const { snapshot: s } = alert;
  const isCustom = Boolean(alert.conditions?.length);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <RuleBadge scenario={alert.scenario} variant={alert.variant} />
          <div>
            <div className="text-sm font-semibold text-white">{alert.title}</div>
            <div className="text-xs text-slate-400">
              {alert.underlying} · {alert.strike} · {alert.timeframe} · exp {alert.expiry || '—'}
              {alert.groupName ? ` · ${alert.groupName}` : ''}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-300">{fmtRelative(alert.triggeredAt)}</div>
          <div className="text-[10px] text-slate-500">{fmtTime(alert.triggeredAt)}</div>
        </div>
      </div>

      {isCustom ? (
        <div className="border-t border-ink-700/60 pt-3 space-y-1">
          {alert.conditions!.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-bull shrink-0" />
              <span className="text-slate-400">{c.label}</span>
              <span className="text-slate-300 font-mono ml-auto">{c.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 border-t border-ink-700/60 pt-3">
          <RsiCell label="Future RSI" prev={s.futurePrevRsi} curr={s.futureRsi} dir="up" />
          <RsiCell label="Call RSI" prev={s.callPrevRsi} curr={s.callRsi} dir="up" />
          <RsiCell label="Put RSI" prev={s.putPrevRsi} curr={s.putRsi} dir="down" />
        </div>
      )}
    </Card>
  );
}
