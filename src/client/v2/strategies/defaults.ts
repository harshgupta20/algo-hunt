/**
 * New-node factories and example strategies for the V2 editor.
 */
import type { ConditionNode, ExprNode, GroupNode, LegDef, LegId, Operand, PatternNode, SeriesSpec, StrategyDefinition } from '@/shared/v2';
import { INDICATOR, LEG_IDS } from '@/shared/v2';

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n${Math.random().toString(36).slice(2)}`);

export const legSeries = (leg: LegId, timeframe: SeriesSpec['timeframe'] = '15m', candle: SeriesSpec['candle'] = { type: 'NORMAL' }): SeriesSpec => ({ leg, timeframe, candle });

export function indicatorOperand(series: SeriesSpec, id = 'RSI'): Extract<Operand, { kind: 'INDICATOR' }> {
  const spec = INDICATOR[id]!;
  return { kind: 'INDICATOR', series, indicator: id, params: Object.fromEntries(spec.params.map((p) => [p.name, p.default])), ...(spec.outputs ? { output: spec.outputs[0]!.value } : {}) };
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

/** The first leg id not used yet (A–D). */
export function nextLegId(legs: LegDef[]): LegId | undefined {
  return LEG_IDS.find((id) => !legs.some((l) => l.id === id));
}

const cond = (left: Operand, operator: ConditionNode['operator'], right: Operand): ConditionNode => ({ type: 'CONDITION', id: uid(), left, operator, right });
const num = (value: number): Operand => ({ kind: 'CONSTANT', value });
const rsi = (s: SeriesSpec) => indicatorOperand(s, 'RSI');
const close = (s: SeriesSpec): Operand => ({ kind: 'FIELD', series: s, field: 'close' });
const volume = (s: SeriesSpec): Operand => ({ kind: 'FIELD', series: s, field: 'volume' });

export function blankStrategy(): StrategyDefinition {
  return {
    schemaVersion: 1,
    name: 'New strategy',
    legs: [{ id: 'A', kind: 'FUT' }],
    evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
    expression: newGroup('AND', [newCondition(legSeries('A'))]),
  };
}

export function exampleStrategies(): Array<{ key: string; label: string; description: string; definition: StrategyDefinition }> {
  const A = legSeries('A');
  const B = legSeries('B');
  const C = legSeries('C');
  const D = legSeries('D');
  return [
    {
      key: 'fut-leads-call',
      label: 'Future leads the call (2 legs)',
      description: 'A · FUT and B · CE ATM on 15-minute candles: the future’s RSI(14) is above the call’s, and the call’s RSI(14) crosses above 60.',
      definition: {
        schemaVersion: 1,
        name: 'Future leads the call',
        legs: [
          { id: 'A', kind: 'FUT' },
          { id: 'B', kind: 'CE', strikeOffset: 0 },
        ],
        evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
        expression: newGroup('AND', [cond(rsi(A), 'GT', rsi(B)), cond(rsi(B), 'CROSSED_ABOVE', num(60))]),
      },
    },
    {
      key: 'call-vs-put',
      label: 'Call up, put down (2 legs)',
      description: 'B · CE ATM RSI crosses above 60 while C · PE ATM RSI crosses below 40, and the call closes above its SMA(20).',
      definition: {
        schemaVersion: 1,
        name: 'Call up, put down',
        legs: [
          { id: 'B', kind: 'CE', strikeOffset: 0 },
          { id: 'C', kind: 'PE', strikeOffset: 0 },
        ],
        evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
        expression: newGroup('AND', [cond(rsi(B), 'CROSSED_ABOVE', num(60)), cond(rsi(C), 'CROSSED_BELOW', num(40)), cond(close(B), 'GT', indicatorOperand(B, 'SMA'))]),
      },
    },
    {
      key: 'four-legs',
      label: 'Future + 3 options (4 legs)',
      description: 'FUT RSI above 60, the ATM call crossing above 60, the ATM put below 40, and a volume spike on the call two strikes above ATM.',
      definition: {
        schemaVersion: 1,
        name: 'Future + 3 options confirmation',
        legs: [
          { id: 'A', kind: 'FUT' },
          { id: 'B', kind: 'CE', strikeOffset: 0 },
          { id: 'C', kind: 'PE', strikeOffset: 0 },
          { id: 'D', kind: 'CE', strikeOffset: 2 },
        ],
        evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
        expression: newGroup('AND', [
          cond(rsi(A), 'GT', num(60)),
          cond(rsi(B), 'CROSSED_ABOVE', num(60)),
          cond(rsi(C), 'LT', num(40)),
          cond(volume(D), 'GT', { ...indicatorOperand(D, 'SMA'), source: 'volume', multiplier: 1.5 }),
        ]),
      },
    },
    {
      key: 'spot-breakout',
      label: 'Spot breakout (1 leg — stocks too)',
      description: 'A · SPOT closes above its upper Bollinger band with volume 1.5× its 20-candle average. Works on cash stocks.',
      definition: {
        schemaVersion: 1,
        name: 'Spot breakout',
        legs: [{ id: 'A', kind: 'SPOT' }],
        evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' },
        expression: newGroup('AND', [cond(close(A), 'CROSSED_ABOVE', { ...indicatorOperand(A, 'BB'), output: 'upper' }), cond(volume(A), 'GT', { ...indicatorOperand(A, 'SMA'), source: 'volume', multiplier: 1.5 })]),
      },
    },
  ];
}

/** The series most conditions use (new conditions default to it). */
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

/** Legs referenced by the expression. */
export function usedLegs(root: ExprNode): Set<LegId> {
  const out = new Set<LegId>();
  const add = (o: Operand) => o.kind !== 'CONSTANT' && out.add(o.series.leg);
  const visit = (n: ExprNode) => {
    if (n.type === 'AND' || n.type === 'OR') n.children.forEach(visit);
    else if (n.type === 'NOT') visit(n.child);
    else if (n.type === 'PATTERN') out.add(n.series.leg);
    else if (n.type === 'CONDITION') {
      add(n.left);
      add(n.right);
    }
  };
  visit(root);
  return out;
}
