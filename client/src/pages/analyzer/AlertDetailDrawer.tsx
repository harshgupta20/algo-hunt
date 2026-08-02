import { CheckCircle2, X, XCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import type { BacktestAlert, ConditionTrace, CrossCondition, LegExplanation } from '@ash/shared';
import { RuleBadge } from '../../components/ui';
import { fmtRsi } from '../../lib/format';

const CONDITION_STYLE: Record<CrossCondition, { text: string; label: string }> = {
  'crossed-above': { text: 'text-bull', label: 'Crossed Above' },
  'crossed-below': { text: 'text-bear', label: 'Crossed Below' },
  'already-above': { text: 'text-warn', label: 'Already Above' },
  none: { text: 'text-slate-500', label: 'No Interaction' },
};

function CondRow({ c }: { c: ConditionTrace }) {
  const Icon = c.passed ? CheckCircle2 : XCircle;
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-850 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">{c.label}</span>
        <Icon className={clsx('w-4 h-4', c.passed ? 'text-bull' : 'text-bear')} />
      </div>
      <div className="mt-1.5 font-mono text-sm text-slate-300">{c.text}</div>
    </div>
  );
}

function LegRow({ e }: { e: LegExplanation }) {
  const s = CONDITION_STYLE[e.condition];
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-850 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">{e.label}</span>
        <span className={clsx('text-xs font-semibold', s.text)}>{s.label} {e.level}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 font-mono text-sm">
        <span className="text-slate-400">{fmtRsi(e.prev)}</span>
        <span className="text-slate-600">→</span>
        <span className={clsx('font-semibold', s.text)}>{fmtRsi(e.curr)}</span>
      </div>
    </div>
  );
}

export function AlertDetailDrawer({ alert, onClose }: { alert: BacktestAlert | null; onClose: () => void }) {
  if (!alert) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative w-full max-w-md h-full bg-ink-900 border-l border-ink-700 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-ink-900/95 backdrop-blur border-b border-ink-700/60 p-4 flex items-center justify-between">
          <div>
            <div className="text-white font-semibold">{alert.underlying} Strategy Triggered</div>
            <div className="text-xs text-slate-400">{format(parseISO(alert.timestamp), 'dd MMM yyyy · HH:mm:ss')}</div>
          </div>
          <button className="btn-ghost p-2" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <RuleBadge scenario={alert.scenario} variant={alert.variant} />
            <span className="rounded-md bg-ink-800 px-2 py-0.5 text-slate-300">{alert.underlying} · {alert.strike}</span>
            <span className="rounded-md bg-ink-800 px-2 py-0.5 text-slate-300">{alert.timeframe}</span>
            <span className="rounded-md bg-ink-800 px-2 py-0.5 text-slate-300">exp {alert.expiry}</span>
            <span className="rounded-md bg-ink-800 px-2 py-0.5 text-slate-300">{alert.strategy}</span>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Why it fired</h3>
            <div className="space-y-2">
              {alert.conditions
                ? alert.conditions.map((c, i) => <CondRow key={i} c={c} />)
                : alert.explanation?.map((e) => <LegRow key={e.leg} e={e} />)}
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            This is the exact same evaluation the live engine performs — the alert reflects a synchronized RSI
            transition on this closed candle.
          </p>
        </div>
      </aside>
    </div>
  );
}
