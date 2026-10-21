'use client';

/** The Equity section (NSE cash stocks): Strategies · Backtest · Screener · Watchlists, chosen by ?tab=. */
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FlaskConical, ListChecks, ScanSearch, Workflow } from 'lucide-react';
import type { EqStrategyDefinition } from '@/shared/equity';
import { Tooltip } from '../components/Tooltip';
import { Badge, PageHeader, Tabs } from '../components/ui';
import { E } from './help';
import { BacktestTab } from './backtest/BacktestTab';
import { ScreenerTab } from './screener/ScreenerTab';
import { StrategiesTab } from './strategies/StrategiesTab';
import { WatchlistsTab } from './watchlists/WatchlistsTab';

const TABS = [
  { value: 'strategies' as const, label: 'Strategies', icon: Workflow, help: E.tabs.strategies },
  { value: 'backtest' as const, label: 'Backtest', icon: FlaskConical, help: E.tabs.backtest },
  { value: 'screener' as const, label: 'Screener', icon: ScanSearch, help: E.tabs.screener },
  { value: 'watchlists' as const, label: 'Watchlists', icon: ListChecks, help: E.tabs.watchlists },
];
type Tab = (typeof TABS)[number]['value'];

export function EquityHub() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.value === raw) ? raw! : 'strategies';
  const strategy = params.get('strategy') ?? undefined;
  // The builder's unsaved strategy, handed to Backtest / Screener ("Backtest without saving").
  const [draft, setDraft] = useState<EqStrategyDefinition | null>(null);
  const go = (t: Tab, opts: { strategyId?: string; draft?: EqStrategyDefinition } = {}) => {
    if (opts.draft) setDraft(opts.draft);
    router.push(`/equity?tab=${t}${opts.strategyId ? `&strategy=${opts.strategyId}` : ''}`);
  };

  return (
    <div>
      <PageHeader
        title="Equity · Stock strategies"
        subtitle="Strategies for NSE cash stocks and indices — separate from F&O. Build one (or start from your trader’s templates), backtest it over years on any stocks or indices (NIFTY, BANKNIFTY, SENSEX…) with your money, and screen today’s signals."
        actions={
          <Tooltip content={E.page}>
            <Badge tone="accent">NSE cash</Badge>
          </Tooltip>
        }
      />
      <div className="mb-6">
        <Tabs value={tab} onChange={(t) => go(t)} items={TABS} />
      </div>
      {tab === 'strategies' && <StrategiesTab key={strategy ?? ''} editId={strategy} onGo={(t, o) => go(t, o)} />}
      {tab === 'backtest' && <BacktestTab key={strategy ?? ''} initialStrategyId={strategy} draft={draft} />}
      {tab === 'screener' && <ScreenerTab key={strategy ?? ''} initialStrategyId={strategy} draft={draft} />}
      {tab === 'watchlists' && <WatchlistsTab />}
    </div>
  );
}
