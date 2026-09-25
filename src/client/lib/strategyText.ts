import type { BuilderInstrument, CandleType, Condition, Group, IndicatorRef, Operator, StrategyNode, Timeframe } from '@ash/shared';
import { timeframeShort } from '@ash/shared';

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
  detected: 'is detected',
};

/** Candle-pattern names for rule text (mirrors the server catalog; unknown ids fall back to the id). */
const PATTERN_LABEL: Record<string, string> = {
  anyBullish: 'Any Bullish Pattern',
  anyBearish: 'Any Bearish Pattern',
  doji: 'Doji',
  hammer: 'Hammer',
  invertedHammer: 'Inverted Hammer',
  hangingMan: 'Hanging Man',
  shootingStar: 'Shooting Star',
  bullishMarubozu: 'Bullish Marubozu',
  bearishMarubozu: 'Bearish Marubozu',
  bullishEngulfing: 'Bullish Engulfing',
  bearishEngulfing: 'Bearish Engulfing',
  bullishHarami: 'Bullish Harami',
  bearishHarami: 'Bearish Harami',
  piercingLine: 'Piercing Line',
  darkCloudCover: 'Dark Cloud Cover',
  morningStar: 'Morning Star',
  eveningStar: 'Evening Star',
  threeWhiteSoldiers: 'Three White Soldiers',
  threeBlackCrows: 'Three Black Crows',
};

const DMI_FIELD: Record<string, string> = { plus: '+DI', minus: '−DI' };

/** Readable names for outputs whose field id isn't self-explanatory. */
const FIELD_LABEL: Record<string, string> = { percentB: '%B', bandwidth: 'bandwidth %' };

/** "Daily HA " — the timeframe / candle-type prefix of an operand (empty for the run timeframe, normal candles). */
function seriesText(timeframe?: Timeframe, candle?: CandleType): string {
  const parts: string[] = [];
  if (timeframe) parts.push(timeframeShort(timeframe));
  if (candle === 'heikinAshi') parts.push('HA');
  return parts.length ? `${parts.join(' ')} ` : '';
}

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
  if (ref.kind === 'PATTERN') return PATTERN_LABEL[ref.field ?? ''] ?? ref.field ?? 'Pattern';
  const p = ref.params ? Object.values(ref.params).join(',') : '';
  if (ref.kind === 'DMI') return `DMI(${p}) ${DMI_FIELD[ref.field ?? 'plus'] ?? ref.field}`;
  const base = p ? `${ref.kind}(${p})` : ref.kind;
  return ref.field ? `${base} ${FIELD_LABEL[ref.field] ?? ref.field}` : base;
}

export function conditionText(c: Condition): string {
  const lhs = `${instrumentLabel(c.instrument)} ${seriesText(c.timeframe, c.candle)}${indicatorLabel(c.indicator)}`;
  const phrase = OP_PHRASE[c.operator];
  if (c.operator === 'detected') return `${lhs} ${phrase}`;
  const bars = `over ${c.lookback ?? 1} bar${(c.lookback ?? 1) === 1 ? '' : 's'}`;
  if (c.operator === 'rising' || c.operator === 'falling') return `${lhs} ${phrase} ${bars}`;
  if (c.operator === 'between' || c.operator === 'outside') return `${lhs} ${phrase} ${c.value ?? '?'} and ${c.value2 ?? '?'}`;
  if (c.operator === 'increasedByPct' || c.operator === 'decreasedByPct') return `${lhs} ${phrase} ${c.value ?? '?'}% ${bars}`;
  const rhs = c.compareTo
    ? `${instrumentLabel(c.compareInstrument ?? c.instrument)} ${seriesText(c.compareTimeframe ?? c.timeframe, c.candle)}${indicatorLabel(c.compareTo)}`
    : `${c.value ?? '?'}`;
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
