/**
 * Pure operator + group evaluation for the generic strategy engine. Reads
 * indicator values through a `resolve` closure (supplied by the runtime) and
 * produces a per-condition trace used for the "why it fired" explanation.
 */
import type { Condition, ConditionTrace, Group, IndicatorRef, Operator } from '@ash/shared';
import { indicatorLabel } from '../indicator/registry.js';

export type Resolve = (instrument: string, ref: IndicatorRef, back: number) => number | undefined;

const OP_PHRASE: Record<Operator, string> = {
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  eq: '=',
  neq: '≠',
  crossAbove: 'cross above',
  crossBelow: 'cross below',
  rising: 'rising',
  falling: 'falling',
  above: 'above',
  below: 'below',
  between: 'between',
  outside: 'outside',
  increasedByPct: 'increased by',
  decreasedByPct: 'decreased by',
};

const TREND_OPS = new Set<Operator>(['rising', 'falling', 'increasedByPct', 'decreasedByPct']);
const CROSS_OPS = new Set<Operator>(['crossAbove', 'crossBelow']);

function legLabel(instrument: string): string {
  switch (instrument) {
    case 'future':
      return 'Future';
    case 'call':
      return 'Call';
    case 'put':
      return 'Put';
    default:
      return instrument.charAt(0).toUpperCase() + instrument.slice(1);
  }
}

const fmt = (n: number | undefined): string => (n === undefined || Number.isNaN(n) ? '—' : n.toFixed(2));

function applyOp(cond: Condition, curr: number, prev1: number | undefined, lookN: number | undefined, rhs: number | undefined): boolean {
  const r = rhs;
  switch (cond.operator) {
    case 'gt':
      return r !== undefined && curr > r;
    case 'lt':
      return r !== undefined && curr < r;
    case 'gte':
      return r !== undefined && curr >= r;
    case 'lte':
      return r !== undefined && curr <= r;
    case 'eq':
      return r !== undefined && curr === r;
    case 'neq':
      return r !== undefined && curr !== r;
    case 'above':
      return r !== undefined && curr >= r;
    case 'below':
      return r !== undefined && curr <= r;
    case 'crossAbove':
      return r !== undefined && prev1 !== undefined && prev1 < r && curr >= r;
    case 'crossBelow':
      return r !== undefined && prev1 !== undefined && prev1 > r && curr <= r;
    case 'rising':
      return lookN !== undefined && curr > lookN;
    case 'falling':
      return lookN !== undefined && curr < lookN;
    case 'between':
      return cond.value !== undefined && cond.value2 !== undefined && curr >= cond.value && curr <= cond.value2;
    case 'outside':
      return cond.value !== undefined && cond.value2 !== undefined && (curr < cond.value || curr > cond.value2);
    case 'increasedByPct':
      return lookN !== undefined && lookN !== 0 && cond.value !== undefined && ((curr - lookN) / Math.abs(lookN)) * 100 >= cond.value;
    case 'decreasedByPct':
      return lookN !== undefined && lookN !== 0 && cond.value !== undefined && ((lookN - curr) / Math.abs(lookN)) * 100 >= cond.value;
    default:
      return false;
  }
}

function buildText(cond: Condition, curr: number | undefined, prev1: number | undefined, lookN: number | undefined, rhs: number | undefined, passed: boolean): string {
  const phrase = OP_PHRASE[cond.operator];
  const mark = passed ? '✓' : '✗';
  if (CROSS_OPS.has(cond.operator)) return `${fmt(prev1)} → ${fmt(curr)} · ${phrase} ${fmt(rhs)} ${mark}`;
  if (cond.operator === 'rising' || cond.operator === 'falling') return `${fmt(lookN)} → ${fmt(curr)} · ${phrase} ${mark}`;
  if (cond.operator === 'between' || cond.operator === 'outside')
    return `${fmt(curr)} ${phrase} [${fmt(cond.value)}, ${fmt(cond.value2)}] ${mark}`;
  if (cond.operator === 'increasedByPct' || cond.operator === 'decreasedByPct')
    return `${fmt(lookN)} → ${fmt(curr)} · ${phrase} ${fmt(cond.value)}% ${mark}`;
  return `${fmt(curr)} ${phrase} ${fmt(rhs)} ${mark}`;
}

export function evaluateCondition(cond: Condition, resolve: Resolve): ConditionTrace {
  const curr = resolve(cond.instrument, cond.indicator, 0);
  const prev1 = resolve(cond.instrument, cond.indicator, 1);
  const lookN = resolve(cond.instrument, cond.indicator, cond.lookback ?? 1);
  const rhs = cond.compareTo ? resolve(cond.compareInstrument ?? cond.instrument, cond.compareTo, 0) : cond.value;

  const passed = curr !== undefined && applyOp(cond, curr, prev1, lookN, rhs);

  return {
    label: `${legLabel(cond.instrument)} ${indicatorLabel(cond.indicator)}`,
    instrument: cond.instrument,
    operator: cond.operator,
    prev: TREND_OPS.has(cond.operator) ? lookN : prev1,
    curr: curr ?? NaN,
    rhs,
    passed,
    text: buildText(cond, curr, prev1, lookN, rhs, passed),
  };
}

export interface GroupResult {
  passed: boolean;
  traces: ConditionTrace[];
}

/** Recursively evaluate a group, flattening condition traces for explanation. */
export function evaluateGroup(group: Group, resolve: Resolve): GroupResult {
  const traces: ConditionTrace[] = [];
  const results: boolean[] = [];
  for (const child of group.children) {
    if (child.type === 'condition') {
      const t = evaluateCondition(child, resolve);
      traces.push(t);
      results.push(t.passed);
    } else {
      const g = evaluateGroup(child, resolve);
      traces.push(...g.traces);
      results.push(g.passed);
    }
  }
  let passed = group.children.length === 0 ? false : group.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
  if (group.not) passed = !passed;
  return { passed, traces };
}
