/**
 * Series addressing: which contract a SeriesSpec's leg reads for a unit, stable
 * keys for sharing series within a cycle, and the series a strategy needs.
 */
import type { ExprNode, Leg, McxInstrument, McxStrategyDefinition, McxUnit, Operand, SeriesSpec } from '@/shared/mcx';

export function candleKey(s: SeriesSpec): string {
  return s.candle.type === 'VOLUME' ? `VOLUME:${s.candle.volumePerCandle}` : s.candle.type;
}

/** Key of a series independent of the contract (leg resolved separately). */
export function seriesShapeKey(s: SeriesSpec): string {
  return `${s.timeframe}|${candleKey(s)}`;
}

export function seriesKey(instrument: McxInstrument, s: SeriesSpec): string {
  return `${instrument.token}|${seriesShapeKey(s)}`;
}

export function legInstrument(leg: Leg, unit: McxUnit): McxInstrument | null {
  return leg === 'FUT' ? unit.fut : leg === 'CE' ? unit.ce : unit.pe;
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

/** Distinct series a strategy reads (by leg + shape). */
export function seriesOf(d: McxStrategyDefinition): SeriesSpec[] {
  const out = new Map<string, SeriesSpec>();
  const add = (s: SeriesSpec | null) => {
    if (s) out.set(`${s.leg}|${seriesShapeKey(s)}`, s);
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

/** Legs a strategy reads. */
export function legsOf(d: McxStrategyDefinition): Leg[] {
  return [...new Set(seriesOf(d).map((s) => s.leg))];
}

export function leafCount(d: McxStrategyDefinition): number {
  let n = 0;
  forEachLeaf(d.expression, () => n++);
  return n;
}
