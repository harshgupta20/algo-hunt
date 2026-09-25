'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { CandlestickChart, LayoutGrid, SlidersHorizontal } from 'lucide-react';
import { PageHeader, Tabs } from '../../components/ui';
import { StrategyAnalyzer } from '../StrategyAnalyzer';
import { HELP } from '../../lib/help';
import { McxOverview } from './McxOverview';
import { McxMonitors } from './McxMonitors';

type Tab = 'overview' | 'monitors' | 'backtest';

const TABS = [
  { value: 'overview' as const, label: 'Overview', icon: LayoutGrid, help: HELP.mcx.overview },
  { value: 'monitors' as const, label: 'Monitors', icon: SlidersHorizontal, help: HELP.mcx.monitors },
  { value: 'backtest' as const, label: 'Backtest', icon: CandlestickChart, help: HELP.mcx.backtest },
];

/**
 * The MCX commodities tab: its own market (products, session, monthly
 * contracts) on top of the shared strategy engine. State lives in the URL:
 *   /mcx · ?tab=monitors · ?tab=backtest[&strategy=…]
 */
export function McxHub() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get('tab');
  const tab: Tab = raw === 'monitors' || raw === 'backtest' ? raw : 'overview';
  const strategy = params.get('strategy') ?? undefined;

  const go = (next: Tab) => router.push(next === 'overview' ? '/mcx' : `/mcx?tab=${next}`);

  return (
    <div>
      <PageHeader
        title="MCX Commodities"
        subtitle="Gold, Silver, Crude Oil, Natural Gas and base metals — futures and options, 09:00–23:30 IST."
      />
      <div className="mb-6">
        <Tabs value={tab} onChange={go} items={TABS} />
      </div>

      {tab === 'overview' && <McxOverview onCreate={() => go('monitors')} />}
      {tab === 'monitors' && <McxMonitors />}
      {tab === 'backtest' && (
        <StrategyAnalyzer
          key={strategy ?? 'manual'}
          segment="MCX"
          strategyId={strategy}
          onEdit={(id) => router.push(`/strategies?tab=builder&id=${id}`)}
        />
      )}
    </div>
  );
}
