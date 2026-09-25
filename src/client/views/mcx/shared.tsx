'use client';

/**
 * Small pieces shared by the MCX tab's views: the product option badge and
 * helpers deciding whether a strategy can run on a futures-only product.
 */
import type { McxProductInfo, StrategyDef, StrategyNode } from '@ash/shared';
import { Badge } from '../../components/ui';
import { Tooltip } from '../../components/Tooltip';
import { HELP } from '../../lib/help';

/** Options (liquid) / Options (thin) / Futures only / Not synced. */
export function ProductBadge({ product }: { product: McxProductInfo | undefined }) {
  if (!product?.available) {
    return (
      <Tooltip content={HELP.mcx.notSynced}>
        <span tabIndex={0} className="cursor-help">
          <Badge tone="warn">not synced</Badge>
        </span>
      </Tooltip>
    );
  }
  if (!product.hasOptions) {
    return (
      <Tooltip content={HELP.mcx.futuresOnly}>
        <span tabIndex={0} className="cursor-help">
          <Badge>futures only</Badge>
        </span>
      </Tooltip>
    );
  }
  return product.optionsLiquid ? (
    <Tooltip content={HELP.mcx.optionsLiquid}>
      <span tabIndex={0} className="cursor-help">
        <Badge tone="accent">options</Badge>
      </span>
    </Tooltip>
  ) : (
    <Tooltip content={HELP.mcx.optionsListed}>
      <span tabIndex={0} className="cursor-help">
        <Badge>options (thin)</Badge>
      </span>
    </Tooltip>
  );
}

function nodeUsesOptions(node: StrategyNode): boolean {
  if (node.type === 'group') return node.children.some(nodeUsesOptions);
  const legs = [node.instrument, node.compareTo ? (node.compareInstrument ?? node.instrument) : undefined];
  return legs.some((l) => l === 'call' || l === 'put');
}

/** Whether a strategy reads the Call or Put leg (the built-in RSI strategy always does). */
export function usesOptionLegs(strategy: string, def: StrategyDef | undefined): boolean {
  if (strategy === 'rsi-sync') return true;
  return def ? nodeUsesOptions(def.root) : false;
}
