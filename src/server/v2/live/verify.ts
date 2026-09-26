/**
 * When a live-built result must be re-checked against Kite's official candles:
 *
 *   TRUE     always (an alert is only sent on Kite's candles)
 *   GAP      the data behind it has an unobserved stretch (startup, socket drop, late trade)
 *   NEAR     a condition sits within a whisker of its threshold AND flipping it could
 *            change the overall result (a near-miss that can't matter is not checked)
 *
 * Everything else — clearly false on clean data — is decided on live candles.
 * "Whisker" per value type: 1 point on 0–100 oscillators, 0.25 % on prices, 3 % on
 * volume / OI, 0.5 points on percentages; candle patterns are always treated as
 * close calls (they depend on exact highs and lows).
 */
import type { ConditionNode, ExprNode, ExprTrace, StrategyDefinition, TriState, UnitEvaluation, ValueUnit } from '@/shared/v2';
import { operandUnit } from '@/shared/v2';
import { and3, not3, or3 } from '../engine/evaluator';

export type CheckReason = 'TRUE' | 'GAP' | 'NEAR';

const MARGIN: Record<ValueUnit, { abs: number; rel: number }> = {
  oscillator: { abs: 1, rel: 0 },
  percent: { abs: 0.5, rel: 0 },
  price: { abs: 0, rel: 0.0025 },
  volume: { abs: 0, rel: 0.03 },
  oi: { abs: 0, rel: 0.03 },
  ratio: { abs: 0.01, rel: 0.01 },
  macd: { abs: 0, rel: 0.05 },
  direction: { abs: 0, rel: 0 },
};

export function isNear(unit: ValueUnit, a: number, b: number): boolean {
  const m = MARGIN[unit];
  return Math.abs(a - b) <= Math.max(m.abs, m.rel * Math.max(Math.abs(a), Math.abs(b)));
}

function conditions(n: ExprNode, out = new Map<string, ConditionNode>()): Map<string, ConditionNode> {
  if (n.type === 'CONDITION') out.set(n.id, n);
  else if (n.type === 'NOT') conditions(n.child, out);
  else if (n.type === 'AND' || n.type === 'OR') n.children.forEach((c) => conditions(c, out));
  return out;
}

function leaves(t: ExprTrace, out: ExprTrace[] = []): ExprTrace[] {
  if (t.condition) out.push(t);
  else t.children?.forEach((c) => leaves(c, out));
  return out;
}

/** Leaves whose result could plausibly differ on Kite's candles. */
export function closeCalls(d: StrategyDefinition, trace: ExprTrace): Set<string> {
  const nodes = conditions(d.expression);
  const out = new Set<string>();
  for (const leaf of leaves(trace)) {
    const c = leaf.condition!;
    if (c.kind === 'PATTERN') {
      out.add(leaf.id);
      continue;
    }
    const node = nodes.get(leaf.id);
    const unit = node ? (operandUnit(node.left) ?? operandUnit(node.right)) : null;
    if (!unit || !c.left || !c.right) continue;
    const pairs: Array<[number | undefined, number | undefined]> = [[c.left.value, c.right.value]];
    if (c.operator === 'CROSSED_ABOVE' || c.operator === 'CROSSED_BELOW') pairs.push([c.left.prev, c.right.prev]);
    if (pairs.some(([a, b]) => a !== undefined && b !== undefined && isNear(unit, a, b))) out.add(leaf.id);
  }
  return out;
}

/** The overall result with the given leaves treated as unknown (three-valued). */
export function resultWithUnknown(t: ExprTrace, unknown: Set<string>): TriState {
  if (t.condition) return unknown.has(t.id) ? 'UNKNOWN' : t.result;
  const kids = (t.children ?? []).map((c) => resultWithUnknown(c, unknown));
  if (t.type === 'NOT') return not3(kids[0] ?? 'UNKNOWN');
  return t.type === 'AND' ? and3(kids) : or3(kids);
}

export function checkReason(d: StrategyDefinition, e: UnitEvaluation, dirty: boolean): CheckReason | null {
  if (e.result === 'TRUE') return 'TRUE';
  if (dirty) return 'GAP';
  if (e.result === 'UNKNOWN') return null; // clean data that can't decide (warm-up, no trades) — Kite's candles are the same
  const near = closeCalls(d, e.trace);
  if (near.size && resultWithUnknown(e.trace, near) !== e.result) return 'NEAR';
  return null;
}
