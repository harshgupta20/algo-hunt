/**
 * Strategies saved before the single timeframe: a value could read its own daily / weekly candles ("Weekly close
 * crosses above weekly SMA(20)" on a Daily strategy), and fills / stop trigger / charges / slippage were set per
 * strategy. Both are gone — every value reads the strategy's candles and orders follow EQ_ORDER_RULES.
 *
 * Upgrading keeps the ENTRY as written: when every entry value read one timeframe, the strategy takes it (so that
 * example becomes a Weekly strategy, and its exits and pyramiding MA turn weekly too). Mixed entries keep the
 * strategy's timeframe. Already-current definitions come back unchanged.
 */
import { leavesOf } from './text';
import type { EqGroup, EqNode, EqOperand, EqStrategyDefinition, EqTimeframe } from './types';

type Legacy = EqStrategyDefinition & { execution?: unknown; costs?: unknown };

const ownTimeframe = (o: EqOperand): EqTimeframe | undefined => (o as { timeframe?: EqTimeframe }).timeframe;

function bare(o: EqOperand): EqOperand {
  if (ownTimeframe(o) === undefined) return o;
  const copy = { ...o } as EqOperand & { timeframe?: EqTimeframe };
  delete copy.timeframe;
  return copy;
}

function bareNode(n: EqNode): EqNode {
  return n.type === 'CONDITION' ? { ...n, left: bare(n.left), right: bare(n.right) } : bareGroup(n);
}

const bareGroup = (g: EqGroup): EqGroup => ({ ...g, children: g.children.map(bareNode) });

export function normalizeDefinition(d: EqStrategyDefinition): EqStrategyDefinition {
  const read = new Set<EqTimeframe>();
  for (const c of leavesOf(d.entry.when)) for (const o of [c.left, c.right]) if (o.kind !== 'NUMBER') read.add(ownTimeframe(o) ?? d.timeframe);
  const rest: Legacy = { ...d };
  delete rest.execution;
  delete rest.costs;
  return {
    ...rest,
    timeframe: read.size === 1 ? [...read][0]! : d.timeframe,
    entry: { ...d.entry, when: bareGroup(d.entry.when) },
    exit: { ...d.exit, when: d.exit.when ? bareGroup(d.exit.when) : null },
  };
}
