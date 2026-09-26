/**
 * New-node factories and example strategies for the MCX V2 editor.
 */
import type { ConditionNode, ExprNode, GroupNode, Leg, McxStrategyDefinition, Operand, PatternNode, SeriesSpec } from '@/shared/mcx';
import { MCX2_INDICATOR } from '@/shared/mcx';

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n${Math.random().toString(36).slice(2)}`);

export const legSeries = (leg: Leg, timeframe: SeriesSpec['timeframe'] = '15m', candle: SeriesSpec['candle'] = { type: 'NORMAL' }): SeriesSpec => ({ leg, timeframe, candle });

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

const cond = (left: Operand, operator: ConditionNode['operator'], right: Operand): ConditionNode => ({ type: 'CONDITION', id: uid(), left, operator, right });
const num = (value: number): Operand => ({ kind: 'CONSTANT', value });
const rsi = (s: SeriesSpec) => indicatorOperand(s, 'RSI');

export function blankStrategy(): McxStrategyDefinition {
  return {
    schemaVersion: 2,
    market: 'MCX',
    name: 'New MCX strategy',
    universe: { underlying: 'GOLD', target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, strikes: { mode: 'ATM_OFFSETS', offsets: [0] } } },
    evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
    expression: newGroup('AND', [newCondition(legSeries('CE', '15m'))]),
    alert: { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION', cooldownMinutes: 30, oncePerCandle: true },
  };
}

/** Ready-made strategies to start from (the two from the V2 specification + a FUT/CE/PE example). */
export function exampleStrategies(): Array<{ key: string; label: string; description: string; definition: McxStrategyDefinition }> {
  const fut15 = legSeries('FUT', '15m');
  const ce15 = legSeries('CE', '15m');
  const pe15 = legSeries('PE', '15m');
  const peHa5 = legSeries('PE', '5m', { type: 'HEIKIN_ASHI' });
  const alert = { channels: { telegram: true, email: false }, trigger: 'ON_TRANSITION' as const, cooldownMinutes: 30, oncePerCandle: true };
  return [
    {
      key: 'gold-legs',
      label: 'GOLD ATM · FUT + CE + PE RSI (15m)',
      description: 'At the ATM strike: FUT RSI(14) crosses above 60, CE RSI(14) crosses above 60 and PE RSI(14) crosses below 40.',
      definition: {
        schemaVersion: 2,
        market: 'MCX',
        name: 'GOLD ATM FUT + CE + PE RSI',
        universe: { underlying: 'GOLD', target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, strikes: { mode: 'ATM_OFFSETS', offsets: [0] } } },
        evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
        expression: newGroup('AND', [cond(rsi(fut15), 'CROSSED_ABOVE', num(60)), cond(rsi(ce15), 'CROSSED_ABOVE', num(60)), cond(rsi(pe15), 'CROSSED_BELOW', num(40))]),
        alert,
      },
    },
    {
      key: 'gold-momentum',
      label: 'GOLD ATM ± 2 · CE momentum (15m)',
      description: 'On each of 5 strikes: CE RSI(14) crosses above 60, CE ADX(14) > 25 and CE close crosses above its SMA(20) — Telegram + Email, 30 min cooldown.',
      definition: {
        schemaVersion: 2,
        market: 'MCX',
        name: 'GOLD ATM±2 CE momentum',
        universe: { underlying: 'GOLD', target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, strikes: { mode: 'ATM_OFFSETS', offsets: [-2, -1, 0, 1, 2] } } },
        evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
        expression: newGroup('AND', [
          cond(rsi(ce15), 'CROSSED_ABOVE', num(60)),
          cond(indicatorOperand(ce15, 'ADX'), 'GT', num(25)),
          cond({ kind: 'FIELD', series: ce15, field: 'close' }, 'CROSSED_ABOVE', indicatorOperand(ce15, 'SMA')),
        ]),
        alert: { ...alert, channels: { telegram: true, email: true } },
      },
    },
    {
      key: 'silver-hammer',
      label: 'SILVER OTM PE · hammer on volume (5m HA)',
      description: 'Two strikes below ATM: PE volume above its 20-candle average and a Hammer, on 5-minute Heikin Ashi candles.',
      definition: {
        schemaVersion: 2,
        market: 'MCX',
        name: 'SILVER OTM PE hammer on volume',
        universe: { underlying: 'SILVER', target: { kind: 'OPTION', expiry: { mode: 'CURRENT' }, strikes: { mode: 'ATM_OFFSETS', offsets: [-1, -2] } } },
        evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '5m' },
        expression: newGroup('AND', [
          cond({ kind: 'FIELD', series: peHa5, field: 'volume' }, 'GT', { ...indicatorOperand(peHa5, 'SMA'), source: 'volume' }),
          { type: 'PATTERN', id: uid(), series: peHa5, pattern: 'HAMMER' },
        ]),
        alert: { ...alert, cooldownMinutes: null },
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
