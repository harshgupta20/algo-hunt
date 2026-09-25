/**
 * New-node factories and example strategies for the MCX V2 editor.
 */
import type { ConditionNode, ExprNode, GroupNode, McxStrategyDefinition, Operand, PatternNode, SeriesSpec } from '@/shared/mcx';
import { MCX2_INDICATOR } from '@/shared/mcx';

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n${Math.random().toString(36).slice(2)}`);

export const targetSeries = (timeframe: SeriesSpec['timeframe'] = '15m'): SeriesSpec => ({ instrument: { role: 'TARGET' }, timeframe, candle: { type: 'NORMAL' } });

export function indicatorOperand(series: SeriesSpec, id = 'RSI'): Extract<Operand, { kind: 'INDICATOR' }> {
  const spec = MCX2_INDICATOR[id]!;
  return {
    kind: 'INDICATOR',
    series,
    indicator: id,
    params: Object.fromEntries(spec.params.map((p) => [p.name, p.default])),
    ...(spec.outputs ? { output: spec.outputs[0]!.value } : {}),
  };
}

export function newCondition(series: SeriesSpec): ConditionNode {
  return { type: 'CONDITION', id: uid(), left: indicatorOperand(series, 'RSI'), operator: 'CROSSED_ABOVE', right: { kind: 'CONSTANT', value: 60 } };
}

export function newPattern(series: SeriesSpec): PatternNode {
  return { type: 'PATTERN', id: uid(), series, pattern: 'HAMMER' };
}

export function newGroup(type: 'AND' | 'OR' = 'AND', children: ExprNode[] = []): GroupNode {
  return { type, id: uid(), children };
}

export function wrapNot(child: ExprNode): ExprNode {
  return { type: 'NOT', id: uid(), child };
}

export function blankStrategy(): McxStrategyDefinition {
  const s = targetSeries('15m');
  return {
    schemaVersion: 1,
    market: 'MCX',
    name: 'New MCX strategy',
    universe: {
      underlying: 'GOLD',
      reference: { expiry: { mode: 'MATCH_TARGET' } },
      target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, optionTypes: ['CE'], strikes: { mode: 'ATM_OFFSETS', offsets: [0] } },
    },
    evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
    expression: newGroup('AND', [newCondition(s)]),
    alert: { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION', cooldownMinutes: 30, oncePerCandle: true },
  };
}

/** The two reference strategies from the V2 specification. */
export function exampleStrategies(): Array<{ key: string; label: string; description: string; definition: McxStrategyDefinition }> {
  const t15 = targetSeries('15m');
  const ha5: SeriesSpec = { instrument: { role: 'TARGET' }, timeframe: '5m', candle: { type: 'HEIKIN_ASHI' } };
  return [
    {
      key: 'gold-momentum',
      label: 'GOLD ATM ± 2 CE momentum (15m)',
      description: 'RSI(14) crosses above 60, ADX(14) > 25 and close crosses above SMA(20) on each call — Telegram + Email, 30 min cooldown.',
      definition: {
        schemaVersion: 1,
        market: 'MCX',
        name: 'GOLD ATM±2 CE momentum',
        universe: {
          underlying: 'GOLD',
          reference: { expiry: { mode: 'MATCH_TARGET' } },
          target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, optionTypes: ['CE'], strikes: { mode: 'ATM_OFFSETS', offsets: [-2, -1, 0, 1, 2] } },
        },
        evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
        expression: newGroup('AND', [
          { type: 'CONDITION', id: uid(), left: indicatorOperand(t15, 'RSI'), operator: 'CROSSED_ABOVE', right: { kind: 'CONSTANT', value: 60 } },
          { type: 'CONDITION', id: uid(), left: indicatorOperand(t15, 'ADX'), operator: 'GT', right: { kind: 'CONSTANT', value: 25 } },
          { type: 'CONDITION', id: uid(), left: { kind: 'FIELD', series: t15, field: 'close' }, operator: 'CROSSED_ABOVE', right: indicatorOperand(t15, 'SMA') },
        ]),
        alert: { channels: { telegram: true, email: true }, trigger: 'ON_TRANSITION', cooldownMinutes: 30, oncePerCandle: true },
      },
    },
    {
      key: 'silver-hammer',
      label: 'SILVER OTM PE hammer on volume (5m Heikin Ashi)',
      description: 'Volume above its 20-candle average and a Hammer, on 5-minute Heikin Ashi candles of two OTM puts.',
      definition: {
        schemaVersion: 1,
        market: 'MCX',
        name: 'SILVER OTM PE hammer on volume',
        universe: {
          underlying: 'SILVER',
          reference: { expiry: { mode: 'MATCH_TARGET' } },
          target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, optionTypes: ['PE'], strikes: { mode: 'OTM', count: 2 } },
        },
        evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '5m' },
        expression: newGroup('AND', [
          { type: 'CONDITION', id: uid(), left: { kind: 'FIELD', series: ha5, field: 'volume' }, operator: 'GT', right: { ...indicatorOperand(ha5, 'SMA'), source: 'volume' } as Operand },
          { type: 'PATTERN', id: uid(), series: ha5, pattern: 'HAMMER' },
        ]),
        alert: { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION', cooldownMinutes: null, oncePerCandle: true },
      },
    },
  ];
}

/** Replace the node with `id` anywhere in the tree (null removes it). */
export function replaceNode(root: ExprNode, id: string, next: ExprNode | null): ExprNode | null {
  if (root.id === id) return next;
  if (root.type === 'AND' || root.type === 'OR') {
    const children = root.children.map((c) => replaceNode(c, id, next)).filter((c): c is ExprNode => c !== null);
    return { ...root, children };
  }
  if (root.type === 'NOT') {
    const child = replaceNode(root.child, id, next);
    return child ? { ...root, child } : null;
  }
  return root;
}

/** The series most conditions in a tree use (new conditions default to it). */
export function dominantSeries(root: ExprNode, fallback: SeriesSpec): SeriesSpec {
  const counts = new Map<string, { s: SeriesSpec; n: number }>();
  const visit = (n: ExprNode) => {
    if (n.type === 'AND' || n.type === 'OR') n.children.forEach(visit);
    else if (n.type === 'NOT') visit(n.child);
    else if (n.type === 'PATTERN' || n.type === 'CONDITION') {
      const s = n.type === 'PATTERN' ? n.series : n.left.kind === 'CONSTANT' ? null : n.left.series;
      if (s) {
        const k = JSON.stringify(s);
        counts.set(k, { s, n: (counts.get(k)?.n ?? 0) + 1 });
      }
    }
  };
  visit(root);
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.s ?? fallback;
}
