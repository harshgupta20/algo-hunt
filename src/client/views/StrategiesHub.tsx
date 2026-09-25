'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Blocks, CandlestickChart, Library } from 'lucide-react';
import { PageHeader, Tabs } from '../components/ui';
import { StrategyLibrary } from './StrategyLibrary';
import { StrategyBuilder } from './StrategyBuilder';
import { StrategyAnalyzer } from './StrategyAnalyzer';
import { HELP } from '../lib/help';

type Tab = 'library' | 'builder' | 'backtest';

const TABS = [
  { value: 'library' as const, label: 'Library', icon: Library, help: HELP.strategies.library },
  { value: 'builder' as const, label: 'Builder', icon: Blocks, help: HELP.strategies.builder },
  { value: 'backtest' as const, label: 'Backtest', icon: CandlestickChart, help: HELP.strategies.backtest },
];

/**
 * One place for strategies: browse (Library), create/edit (Builder) and replay
 * on history (Backtest). State lives in the URL so every view is linkable:
 *   /strategies · ?tab=builder[&id=…|&template=rsi] · ?tab=backtest[&strategy=…]
 */
export function StrategiesHub() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get('tab');
  const tab: Tab = raw === 'builder' || raw === 'backtest' ? raw : 'library';
  const id = params.get('id') ?? undefined;
  const strategy = params.get('strategy') ?? undefined;
  const template = params.get('template') === 'rsi';

  const go = (next: Tab, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(next === 'library' ? extra : { tab: next, ...extra });
    router.push(q.size ? `/strategies?${q}` : '/strategies');
  };

  return (
    <div>
      <PageHeader title="Strategies" subtitle="Browse, build and backtest — the same engine runs your live alerts." />
      <div className="mb-6">
        <Tabs value={tab} onChange={(t) => go(t)} items={TABS} />
      </div>

      {tab === 'library' && (
        <StrategyLibrary
          onNew={() => go('builder')}
          onEdit={(sid) => go('builder', { id: sid })}
          onBacktest={(sid, segment) => (segment === 'MCX' ? router.push(`/mcx?tab=backtest&strategy=${sid}`) : go('backtest', { strategy: sid }))}
          onCustomizeBuiltin={() => go('builder', { template: 'rsi' })}
        />
      )}
      {tab === 'builder' && (
        <StrategyBuilder
          key={id ?? (template ? 'template' : 'new')}
          id={id}
          fromTemplate={template}
          onSaved={() => go('library')}
          onCancel={() => go('library')}
        />
      )}
      {tab === 'backtest' && (
        <StrategyAnalyzer key={strategy ?? 'manual'} strategyId={strategy} onEdit={(sid) => go('builder', { id: sid })} />
      )}
    </div>
  );
}
