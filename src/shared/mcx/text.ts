/**
 * Human-readable text for MCX V2 strategies: universe, series, operands,
 * conditions, alert policy, and the full preview shown before enabling.
 */
import {
  MCX2_ATM_PRESETS,
  MCX2_CANDLE_TYPES,
  MCX2_INDICATOR,
  MCX2_OPERATORS,
  MCX2_PATTERN,
  MCX2_TIMEFRAME,
} from './catalog';
import type {
  AlertPolicy,
  CandleSpec,
  ConditionNode,
  Evaluation,
  ExpirySelector,
  ExprNode,
  Leg,
  McxStrategyDefinition,
  McxUnit,
  Operand,
  SeriesSpec,
  StrikeSelector,
  Universe,
} from './types';

export function expiryText(e: ExpirySelector): string {
  switch (e.mode) {
    case 'CURRENT':
      return 'Current expiry';
    case 'NEXT':
      return 'Next expiry';
    case 'FAR':
      return 'Far expiry';
    case 'ALL':
      return 'All expiries';
    case 'SPECIFIC':
      return `Expiry ${e.date}`;
  }
}

export function strikeText(s: StrikeSelector): string {
  switch (s.mode) {
    case 'ATM_OFFSETS': {
      const sorted = [...new Set(s.offsets)].sort((a, b) => a - b);
      const preset = MCX2_ATM_PRESETS.find((p) => p.offsets.length === sorted.length && [...p.offsets].sort((a, b) => a - b).every((o, i) => o === sorted[i]));
      if (preset) return preset.label;
      if (sorted.length === 1) return `ATM ${sorted[0]! > 0 ? '+' : '−'} ${Math.abs(sorted[0]!)}`;
      return `ATM offsets ${sorted.map((o) => (o > 0 ? `+${o}` : `${o}`)).join(', ')}`;
    }
    case 'SPECIFIC':
      return `Strikes ${s.strikes.join(', ')}`;
    case 'RANGE':
      return `Strikes ${s.from}–${s.to}`;
    case 'ALL':
      return 'All strikes';
  }
}

export function universeText(u: Universe): string {
  const t = u.target;
  if (t.kind === 'FUTURE') return `${u.underlying} — Futures — ${expiryText(t.expiry)}`;
  return `${u.underlying} — Options — ${expiryText(t.expiry)} — ${strikeText(t.strikes)} (FUT · CE · PE per strike)`;
}

/** A unit in words: the future's symbol, or "GOLD 75000 · exp 2026-10-26" for a strike. */
export function unitText(u: McxUnit): string {
  if (u.strike === null) return u.fut?.symbol ?? u.key;
  return `${u.underlying} ${u.strike} · exp ${u.expiry}`;
}

/** Short label of a leg, e.g. "GOLD FUT", "GOLD CE". */
export function legText(leg: Leg, u?: Universe): string {
  return u ? `${u.underlying} ${leg}` : leg;
}

export function candleText(c: CandleSpec): string {
  if (c.type === 'VOLUME') return `Volume candles (${c.volumePerCandle.toLocaleString('en-IN')})`;
  return MCX2_CANDLE_TYPES.find((x) => x.type === c.type)?.label ?? c.type;
}

export function seriesText(s: SeriesSpec, u?: Universe): string {
  return `[${legText(s.leg, u)}] [${MCX2_TIMEFRAME[s.timeframe].label}] [${candleText(s.candle)}]`;
}

const FIELD_LABEL: Record<string, string> = { open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume', oi: 'OI' };

/** The operand without its series, e.g. "RSI(14)", "2 × SMA(20) of volume", "Close". */
export function operandCore(o: Operand): string {
  switch (o.kind) {
    case 'CONSTANT':
      return String(o.value);
    case 'FIELD':
      return FIELD_LABEL[o.field] ?? o.field;
    case 'OI_CHANGE':
      return `OI change (${o.lookback} candle${o.lookback === 1 ? '' : 's'})`;
    case 'INDICATOR': {
      const spec = MCX2_INDICATOR[o.indicator];
      const params = spec ? spec.params.map((p) => o.params[p.name] ?? p.default).join(',') : Object.values(o.params).join(',');
      const out = o.output ? ` ${spec?.outputs?.find((x) => x.value === o.output)?.label ?? o.output}` : '';
      const src = o.source && o.source !== 'close' ? ` of ${FIELD_LABEL[o.source]?.toLowerCase() ?? o.source}` : '';
      const mult = o.multiplier && o.multiplier !== 1 ? `${o.multiplier} × ` : '';
      return `${mult}${spec?.label ?? o.indicator}(${params})${out}${src}`;
    }
  }
}

export function operandText(o: Operand, u?: Universe): string {
  return o.kind === 'CONSTANT' ? operandCore(o) : `${seriesText(o.series, u)} ${operandCore(o)}`;
}

export function operatorText(op: ConditionNode['operator']): string {
  return MCX2_OPERATORS.find((x) => x.value === op)?.symbol ?? op;
}

export function conditionText(c: ConditionNode, u?: Universe): string {
  // When both sides read the same series, show it once.
  const same = c.right.kind !== 'CONSTANT' && c.left.kind !== 'CONSTANT' && JSON.stringify(c.left.series) === JSON.stringify(c.right.series);
  if (same && c.left.kind !== 'CONSTANT') return `${seriesText(c.left.series, u)} ${operandCore(c.left)} ${operatorText(c.operator)} ${operandCore(c.right)}`;
  return `${operandText(c.left, u)} ${operatorText(c.operator)} ${operandText(c.right, u)}`;
}

export function nodeText(n: ExprNode, u?: Universe, depth = 0): string {
  switch (n.type) {
    case 'CONDITION':
      return conditionText(n, u);
    case 'PATTERN':
      return `${seriesText(n.series, u)} ${MCX2_PATTERN[n.pattern]?.label ?? n.pattern} detected`;
    case 'NOT':
      return `NOT (${nodeText(n.child, u, depth + 1)})`;
    default: {
      const parts = n.children.map((c) => nodeText(c, u, depth + 1));
      const joined = parts.join(`\n${'  '.repeat(depth + 1)}${n.type} `);
      return depth === 0 ? joined : `(${joined})`;
    }
  }
}

export function evaluationText(e: Evaluation): string {
  return `${e.mode === 'COMPLETED_CANDLE' ? 'Completed' : 'Live (forming)'} ${MCX2_TIMEFRAME[e.triggerTimeframe].label} candles`;
}

export function policyText(p: AlertPolicy): string {
  const channels = [p.channels.telegram && 'Telegram', p.channels.email && 'Email'].filter(Boolean).join(' + ') || 'no channel (record only)';
  return [
    `Send ${channels}`,
    p.trigger === 'ON_TRANSITION' ? 'on first transition to true' : 'while true (repeat)',
    p.cooldownMinutes ? `cooldown ${p.cooldownMinutes} min` : 'no cooldown',
    p.oncePerCandle ? 'once per candle' : 'may repeat within a candle',
  ].join(' · ');
}

/** The preview shown before enabling a strategy. */
export function strategySummary(d: McxStrategyDefinition): string {
  return [
    universeText(d.universe),
    `Evaluation: ${evaluationText(d.evaluation)}`,
    '',
    'IF',
    `  ${nodeText(d.expression, d.universe)}`,
    '',
    'THEN',
    `  ${policyText(d.alert)}`,
  ].join('\n');
}
