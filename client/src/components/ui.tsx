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
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'bull' | 'bear' | 'accent' }) {
  const toneClass = tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : tone === 'accent' ? 'text-accent-soft' : 'text-white';
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

export function ScenarioBadge({ scenario }: { scenario: 1 | 2 }) {
  return <Badge tone={scenario === 1 ? 'accent' : 'warn'}>Scenario {scenario}</Badge>;
}

/** Generic trigger label: a built-in scenario or a custom strategy variant. */
export function RuleBadge({ scenario, variant }: { scenario?: 1 | 2; variant?: string }) {
  if (scenario) return <ScenarioBadge scenario={scenario} />;
  return <Badge tone="accent">{variant ?? 'Triggered'}</Badge>;
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
