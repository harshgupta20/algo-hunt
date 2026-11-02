'use client';

/**
 * Options (its own sidebar section, /options): option strategies tested on contracts as they were listed — expired
 * ones included, from Upstox — re-picked at every candle like the live scanner. The strategies are V2's (built in
 * V2 → Strategies); the page is the Backtest page on the Upstox source.
 */
import { useSearchParams } from 'next/navigation';
import { Tooltip } from '../../components/Tooltip';
import { Badge, PageHeader } from '../../components/ui';
import { BacktestTab } from '../backtest/BacktestTab';
import { H } from '../help';

export function OptionsHub() {
  const params = useSearchParams();
  const strategy = params.get('strategy') ?? undefined;
  return (
    <div>
      <PageHeader
        title="Options · backtest on expired contracts"
        subtitle="Test a V2 strategy on option and futures contracts as they were listed — expired ones included — re-picked at every candle the way the live scanner picks them."
        actions={
          <Tooltip content={H.options.page}>
            <Badge tone="warn">beta</Badge>
          </Tooltip>
        }
      />
      <BacktestTab key="upstox" source="upstox" initialStrategyId={strategy} />
    </div>
  );
}
