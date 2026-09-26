/**
 * Series addressing: which contract a series' leg reads in a unit, stable keys
 * for sharing series within a cycle, and the series a strategy needs.
 */
import type { ExprNode, LegId, Operand, SeriesSpec, StrategyDefinition, V2Instrument, V2Unit } from '@/shared/v2';

export function candleKey(s: SeriesSpec): string {
  return s.candle.type === 'VOLUME' ? `VOLUME:${s.candle.volumePerCandle}` : s.candle.type;
}

export function seriesShapeKey(s: SeriesSpec): string {
  return `${s.timeframe}|${candleKey(s)}`;
}

export function seriesKey(instrument: V2Instrument, s: SeriesSpec): string {
  return `${instrument.token}|${seriesShapeKey(s)}`;
}

export function legInstrument(leg: LegId, unit: V2Unit): V2Instrument | null {
  return unit.legs[leg] ?? null;
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
export function seriesOf(d: StrategyDefinition): SeriesSpec[] {
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

export function leafCount(d: StrategyDefinition): number {
  let n = 0;
  forEachLeaf(d.expression, () => n++);
  return n;
}
