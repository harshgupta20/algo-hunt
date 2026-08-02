import type { BuilderInstrument, Condition, Group, IndicatorRef, Operator, StrategyNode } from '@ash/shared';

const OP_PHRASE: Record<Operator, string> = {
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  eq: '=',
  neq: '≠',
  crossAbove: 'crosses above',
  crossBelow: 'crosses below',
  rising: 'is rising',
  falling: 'is falling',
  above: 'is above',
  below: 'is below',
  between: 'between',
  outside: 'outside',
  increasedByPct: 'increased by',
  decreasedByPct: 'decreased by',
};

export function instrumentLabel(i: BuilderInstrument): string {
  switch (i) {
    case 'future':
      return 'Future';
    case 'call':
      return 'Call';
    case 'put':
      return 'Put';
    default:
      return i.charAt(0).toUpperCase() + i.slice(1);
  }
}

export function indicatorLabel(ref: IndicatorRef): string {
  const p = ref.params ? Object.values(ref.params).join(',') : '';
  const base = p ? `${ref.kind}(${p})` : ref.kind;
  return ref.field ? `${base} ${ref.field}` : base;
}

export function conditionText(c: Condition): string {
  const lhs = `${instrumentLabel(c.instrument)} ${indicatorLabel(c.indicator)}`;
  const phrase = OP_PHRASE[c.operator];
  if (c.operator === 'rising' || c.operator === 'falling') return `${lhs} ${phrase}`;
  if (c.operator === 'between' || c.operator === 'outside') return `${lhs} ${phrase} ${c.value ?? '?'} and ${c.value2 ?? '?'}`;
  if (c.operator === 'increasedByPct' || c.operator === 'decreasedByPct') return `${lhs} ${phrase} ${c.value ?? '?'}%`;
  const rhs = c.compareTo ? `${instrumentLabel(c.compareInstrument ?? c.instrument)} ${indicatorLabel(c.compareTo)}` : `${c.value ?? '?'}`;
  return `${lhs} ${phrase} ${rhs}`;
}

export function nodeText(node: StrategyNode, depth = 0): string {
  if (node.type === 'condition') return conditionText(node);
  return groupText(node, depth);
}

export function groupText(group: Group, depth = 0): string {
  if (group.children.length === 0) return '(empty)';
  const parts = group.children.map((c) => nodeText(c, depth + 1));
  const joined = parts.join(`\n${'  '.repeat(depth)}${group.logic} `);
  return depth === 0 ? joined : `( ${joined} )`;
}
