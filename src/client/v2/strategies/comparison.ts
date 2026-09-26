/**
 * Keeps a condition's two sides meaningful as the trader edits it:
 *   - A price level (Bollinger Upper / Middle / Lower, SMA / EMA of price,
 *     Supertrend line) is compared with the price, not a number — choosing one
 *     while the other side is a number rewrites the condition to read
 *     "Close crossed above Bollinger Upper".
 *   - A reading (%B, Bandwidth, RSI, ADX, MACD, Supertrend direction) is
 *     compared with a number — a sensible default level is filled in.
 */
import type { ConditionNode, Operand } from '@/shared/v2';
import { INDICATOR, operandCore, operandUnit } from '@/shared/v2';

type IndicatorOperand = Extract<Operand, { kind: 'INDICATOR' }>;

/** An indicator whose value is a price (a band, an average, a trailing line). */
export function isPriceLevel(o: Operand): o is IndicatorOperand {
  return o.kind === 'INDICATOR' && operandUnit(o) === 'price';
}

const isPriceField = (o: Operand) => o.kind === 'FIELD' && operandUnit(o) === 'price';

/** A typical level to compare a reading with (undefined = no obvious default). */
export function defaultLevel(o: Operand): number | undefined {
  if (o.kind !== 'INDICATOR') return undefined;
  switch (o.indicator) {
    case 'RSI':
      return 60;
    case 'ADX':
    case 'DMI':
      return 25;
    case 'MACD':
      return 0;
    case 'BB':
      return o.output === 'percentB' ? 1 : o.output === 'bandwidth' ? 2 : undefined;
    case 'SUPERTREND':
      return o.output === 'direction' ? 1 : undefined;
    default:
      return undefined;
  }
}

/** "Bollinger Bands Upper" style name for messages. */
function name(o: Operand): string {
  if (o.kind !== 'INDICATOR') return operandCore(o);
  const spec = INDICATOR[o.indicator];
  const out = spec?.outputs?.find((x) => x.value === o.output)?.label;
  return `${spec?.label ?? o.indicator}${out ? ` ${out}` : ''}`;
}

/** Rewrites "price level vs number" into "Close vs price level". */
export function compareWithClose(cond: ConditionNode): ConditionNode {
  if (!isPriceLevel(cond.left)) return cond;
  return { ...cond, left: { kind: 'FIELD', series: cond.left.series, field: 'close' }, right: cond.left };
}

/**
 * Apply an edit of one side and adapt the other side when the comparison
 * stopped making sense. Returns the new condition and, when something was
 * adapted, a short note explaining it.
 */
export function adaptCondition(cond: ConditionNode, side: 'left' | 'right', next: Operand): { cond: ConditionNode; note?: string } {
  const edited: ConditionNode = { ...cond, [side]: next };

  if (side === 'left') {
    // Price level vs a number → compare the Close with the level (no number needed).
    if (isPriceLevel(next) && cond.right.kind === 'CONSTANT') {
      return { cond: compareWithClose(edited), note: `${name(next)} is a price level, so the condition now compares the Close with it — no number needed.` };
    }
    const unit = operandUnit(next);
    const level = defaultLevel(next);
    // A reading vs a price → compare it with a number instead.
    if (unit && unit !== 'price' && cond.right.kind !== 'CONSTANT' && operandUnit(cond.right) === 'price') {
      return { cond: { ...edited, right: { kind: 'CONSTANT', value: level ?? 0 } }, note: `${name(next)} is a reading, not a price, so it is compared with a number.` };
    }
    // Switched to a different reading (e.g. RSI → ADX, %B → Bandwidth): use its typical level.
    // Changing only its settings (RSI 14 → 21) keeps the level the trader typed.
    const prev = cond.left;
    const otherReading = prev.kind !== 'INDICATOR' || next.kind !== 'INDICATOR' || prev.indicator !== next.indicator || prev.output !== next.output;
    if (cond.right.kind === 'CONSTANT' && level !== undefined && otherReading) {
      return { cond: { ...edited, right: { kind: 'CONSTANT', value: level } } };
    }
    return { cond: edited };
  }

  // Right side became a reading (e.g. the band's output switched to %B) while the left is the price →
  // the reading moves to the left and is compared with a number.
  const unit = operandUnit(next);
  if (next.kind === 'INDICATOR' && unit && unit !== 'price' && isPriceField(cond.left)) {
    return { cond: { ...cond, left: next, right: { kind: 'CONSTANT', value: defaultLevel(next) ?? 0 } }, note: `${name(next)} is a reading, not a price, so it is compared with a number.` };
  }
  return { cond: edited };
}
