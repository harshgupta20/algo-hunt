import type React from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('card p-4', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'bull' | 'bear' | 'accent' }) {
  const toneClass = tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : tone === 'accent' ? 'text-accent-soft' : 'text-fg';
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <span className={clsx('text-2xl font-semibold tabular-nums', toneClass)}>{value}</span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </Card>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'bull' | 'bear' | 'warn' | 'accent' }) {
  const map: Record<string, string> = {
    default: 'bg-ink-700 text-slate-300',
    bull: 'bg-bull/15 text-bull border border-bull/30',
    bear: 'bg-bear/15 text-bear border border-bear/30',
    warn: 'bg-warn/15 text-warn border border-warn/30',
    accent: 'bg-accent/15 text-accent-soft border border-accent/30',
  };
  return <span className={clsx('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', map[tone])}>{children}</span>;
}

const STRATEGY_STATUS: Record<'active' | 'draft' | 'disabled', { label: string; tone: 'bull' | 'warn' | 'default' }> = {
  active: { label: '● Published', tone: 'bull' },
  draft: { label: '◐ Draft', tone: 'warn' },
  disabled: { label: '○ Disabled', tone: 'default' },
};

/** Published = usable by monitors (green), Draft (amber), Disabled (grey). */
export function StrategyStatusBadge({ status }: { status: 'active' | 'draft' | 'disabled' }) {
  const s = STRATEGY_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const SCENARIO_TITLE: Record<1 | 2, string> = { 1: 'All three crossing', 2: 'Future already above' };

/**
 * Both RSI-sync scenarios are bullish signals, so both are green: S1 (fresh
 * crossing on all legs) is solid, S2 (future already trending above) is outlined.
 */
export function ScenarioBadge({ scenario, compact }: { scenario: 1 | 2; compact?: boolean }) {
  return (
    <span
      title={`Scenario ${scenario} — ${SCENARIO_TITLE[scenario]} (bullish)`}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        scenario === 1 ? 'bg-bull/15 text-bull border border-bull/30' : 'text-bull border border-dashed border-bull/60',
      )}
    >
      ▲ S{scenario}
      {!compact && <span className="font-normal">· {scenario === 1 ? 'All cross' : 'Fut above'}</span>}
    </span>
  );
}

/** Generic trigger label: a built-in scenario or a custom strategy variant. */
export function RuleBadge({ scenario, variant, compact }: { scenario?: 1 | 2; variant?: string; compact?: boolean }) {
  if (scenario) return <ScenarioBadge scenario={scenario} compact={compact} />;
  return <Badge tone="accent">{variant ?? 'Triggered'}</Badge>;
}

/** Segmented control for in-page tabs. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }> }>;
}) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-ink-700 bg-ink-850 p-1 gap-1">
      {items.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          role="tab"
          aria-selected={v === value}
          onClick={() => onChange(v)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            v === value ? 'bg-ink-900 text-fg shadow-sm border border-ink-700' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {Icon && <Icon className="w-4 h-4" />}
          {label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-400 text-sm">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-12 text-slate-500">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
    </div>
  );
}
