/**
 * Series addressing: which concrete instrument a SeriesSpec reads for a unit,
 * stable keys for sharing series within a cycle, and the list of series a
 * strategy needs (for fetch planning).
 */
import type { ExprNode, InstrumentRef, McxInstrument, McxStrategyDefinition, Operand, ResolvedUnit, SeriesSpec } from '@/shared/mcx';

export function candleKey(s: SeriesSpec): string {
  return s.candle.type === 'VOLUME' ? `VOLUME:${s.candle.volumePerCandle}` : s.candle.type;
}

/** Key of a series independent of the instrument role (role resolved separately). */
export function seriesShapeKey(s: SeriesSpec): string {
  return `${s.timeframe}|${candleKey(s)}`;
}

export function seriesKey(instrument: McxInstrument, s: SeriesSpec): string {
  return `${instrument.token}|${seriesShapeKey(s)}`;
}

export function resolveRef(ref: InstrumentRef, unit: ResolvedUnit, fixed: Map<string, McxInstrument>): McxInstrument | null {
  switch (ref.role) {
    case 'TARGET':
      return unit.target;
    case 'UNDERLYING':
      return unit.reference;
    case 'FIXED':
      return fixed.get(ref.instrumentId) ?? null;
  }
}

function operandSeries(o: Operand): SeriesSpec | null {
  return o.kind === 'CONSTANT' ? null : o.series;
}

export function forEachLeaf(node: ExprNode, fn: (leaf: Extract<ExprNode, { type: 'CONDITION' | 'PATTERN' }>) => void): void {
  switch (node.type) {
    case 'AND':
    case 'OR':
      node.children.forEach((c) => forEachLeaf(c, fn));
      return;
    case 'NOT':
      forEachLeaf(node.child, fn);
      return;
    default:
      fn(node);
  }
}

/** Distinct series a strategy reads (by role + shape). */
export function seriesOf(d: McxStrategyDefinition): SeriesSpec[] {
  const out = new Map<string, SeriesSpec>();
  const add = (s: SeriesSpec | null) => {
    if (!s) return;
    const role = s.instrument.role === 'FIXED' ? `FIXED:${s.instrument.instrumentId}` : s.instrument.role;
    out.set(`${role}|${seriesShapeKey(s)}`, s);
  };
  forEachLeaf(d.expression, (leaf) => {
    if (leaf.type === 'PATTERN') add(leaf.series);
    else {
      add(operandSeries(leaf.left));
      add(operandSeries(leaf.right));
    }
  });
  return [...out.values()];
}

/** FIXED instrument ids referenced by a strategy. */
export function fixedIdsOf(d: McxStrategyDefinition): string[] {
  return [...new Set(seriesOf(d).flatMap((s) => (s.instrument.role === 'FIXED' ? [s.instrument.instrumentId] : [])))];
}

export function leafCount(d: McxStrategyDefinition): number {
  let n = 0;
  forEachLeaf(d.expression, () => n++);
  return n;
}
