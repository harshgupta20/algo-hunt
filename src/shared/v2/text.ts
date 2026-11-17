/**
 * Human-readable text for V2: legs, series, operands, conditions, connections,
 * and the IF/THEN preview of a strategy.
 */
import { CANDLE_TYPES, INDICATOR, OPERATORS, PATTERN, TIMEFRAME } from './catalog';
import { legsReadBy } from './legs';
import type { AlertPolicy, CandleSpec, ConditionNode, ExpirySelector, ExprNode, LegDef, LegId, Operand, SeriesSpec, StrategyDefinition, V2Unit } from './types';

/** "ATM", "ATM+1", "ATM−2". */
export function offsetText(offset: number | undefined): string {
  const o = offset ?? 0;
  return o === 0 ? 'ATM' : `ATM${o > 0 ? '+' : '−'}${Math.abs(o)}`;
}

/** What a leg is, e.g. "CE ATM+1", "FUT", "SPOT". */
export function legKindText(l: Pick<LegDef, 'kind' | 'strikeOffset'>): string {
  return l.kind === 'CE' || l.kind === 'PE' ? `${l.kind} ${offsetText(l.strikeOffset)}` : l.kind;
}

/**
 * Display name of a leg: what it is ("CE ATM+1", "FUT") — or the name given to it in the old legs editor. The
 * letter (A–D) is internal since conditions pick instruments directly (legs.ts).
 */
export function legName(l: LegDef): string {
  return l.label?.trim() || legKindText(l);
}

export function legNameById(id: LegId, legs: LegDef[]): string {
  const l = legs.find((x) => x.id === id);
  return l ? legName(l) : '(removed instrument)';
}

export function candleText(c: CandleSpec): string {
  if (c.type === 'VOLUME') return `Volume candles (${c.volumePerCandle.toLocaleString('en-IN')})`;
  return CANDLE_TYPES.find((x) => x.type === c.type)?.label ?? c.type;
}

export function seriesText(s: SeriesSpec, legs: LegDef[]): string {
  return `[${legNameById(s.leg, legs)}] [${TIMEFRAME[s.timeframe].label}] [${candleText(s.candle)}]`;
}

const FIELD_LABEL: Record<string, string> = { open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume', oi: 'OI' };

export function operandCore(o: Operand): string {
  switch (o.kind) {
    case 'CONSTANT':
      return String(o.value);
    case 'FIELD':
      return FIELD_LABEL[o.field] ?? o.field;
    case 'OI_CHANGE':
      return `OI change (${o.lookback} candle${o.lookback === 1 ? '' : 's'})`;
    case 'INDICATOR': {
      // "Lowest low (3 candles)" reads better than the generic "N-candle low / high(3) Lowest low".
      if (o.indicator === 'RANGE') {
        const n = o.params.period ?? 3;
        return `${o.output === 'high' ? 'Highest high' : 'Lowest low'} (${n} candle${n === 1 ? '' : 's'})`;
      }
      const spec = INDICATOR[o.indicator];
      const params = spec ? spec.params.map((p) => o.params[p.name] ?? p.default).join(',') : Object.values(o.params).join(',');
      const out = o.output ? ` ${spec?.outputs?.find((x) => x.value === o.output)?.label ?? o.output}` : '';
      const src = o.source && o.source !== 'close' ? ` of ${FIELD_LABEL[o.source]?.toLowerCase() ?? o.source}` : '';
      const mult = o.multiplier && o.multiplier !== 1 ? `${o.multiplier} × ` : '';
      // TradingView's "RSI-based MA" reads "SMA(14) of RSI(14)" (as in Equity).
      const ma = o.ma ? `${o.ma.type}(${o.ma.period}) of ` : '';
      return `${mult}${ma}${spec?.label ?? o.indicator}(${params})${out}${src}`;
    }
  }
}

export function operandText(o: Operand, legs: LegDef[]): string {
  return o.kind === 'CONSTANT' ? operandCore(o) : `${seriesText(o.series, legs)} ${operandCore(o)}`;
}

export function operatorText(op: ConditionNode['operator']): string {
  return OPERATORS.find((x) => x.value === op)?.symbol ?? op;
}

export function conditionText(c: ConditionNode, legs: LegDef[]): string {
  const same = c.right.kind !== 'CONSTANT' && c.left.kind !== 'CONSTANT' && JSON.stringify(c.left.series) === JSON.stringify(c.right.series);
  if (same && c.left.kind !== 'CONSTANT') return `${seriesText(c.left.series, legs)} ${operandCore(c.left)} ${operatorText(c.operator)} ${operandCore(c.right)}`;
  return `${operandText(c.left, legs)} ${operatorText(c.operator)} ${operandText(c.right, legs)}`;
}

export function nodeText(n: ExprNode, legs: LegDef[], depth = 0): string {
  switch (n.type) {
    case 'CONDITION':
      return conditionText(n, legs);
    case 'PATTERN':
      return `${seriesText(n.series, legs)} ${PATTERN[n.pattern]?.label ?? n.pattern} detected`;
    case 'NOT':
      return `NOT (${nodeText(n.child, legs, depth + 1)})`;
    default: {
      const parts = n.children.map((c) => nodeText(c, legs, depth + 1));
      const joined = parts.join(`\n${'  '.repeat(depth + 1)}${n.type} `);
      // Nested groups show their name; the top level is named by the strategy itself.
      const name = n.label?.trim() ? `${n.label.trim()}: ` : '';
      return depth === 0 ? joined : `${name}(${joined})`;
    }
  }
}

/** When the strategy is checked, in words: "at every 15 min candle close" / "every minute on forming candles". */
export function clockText(d: Pick<StrategyDefinition, 'evaluation'>): string {
  const tf = TIMEFRAME[d.evaluation.triggerTimeframe].label;
  return d.evaluation.mode === 'COMPLETED_CANDLE' ? `at every ${tf} candle close` : `every minute on forming candles (${tf} clock)`;
}

/**
 * The IF / THEN preview. `planUses`: legs the trade plan uses (what it trades, its trailing rules) — a leg no
 * condition reads is named as the plan's, or (a strategy saved before legs followed the conditions) as unread.
 */
export function strategySummary(d: StrategyDefinition, planUses?: ReadonlySet<LegId>): string {
  const read = legsReadBy(d.expression);
  const notRead = d.legs.filter((l) => !read.has(l.id));
  const planOnly = planUses ? notRead.filter((l) => planUses.has(l.id)) : notRead;
  const unread = planUses ? notRead.filter((l) => !planUses.has(l.id)) : [];
  return [
    `Watches: ${d.legs.filter((l) => read.has(l.id)).map(legName).join(' · ') || '—'}`,
    ...(planOnly.length ? [`Also used by the trade plan: ${planOnly.map(legName).join(' · ')}`] : []),
    ...(unread.length ? [`Not read by anything: ${unread.map(legName).join(' · ')} (dropped on the next change)`] : []),
    `Checked: ${clockText(d)}`,
    '',
    'IF',
    `  ${nodeText(d.expression, d.legs)}`,
    '',
    'THEN alert (on every product this strategy is connected to)',
  ].join('\n');
}

export function expiryText(e: ExpirySelector): string {
  return e.mode === 'SPECIFIC' ? `expiry ${e.date}` : `${e.mode.toLowerCase()} expiry`;
}

export function policyText(p: AlertPolicy): string {
  const channels = [p.channels.telegram && 'Telegram', p.channels.email && 'Email'].filter(Boolean).join(' + ') || 'no channel (record only)';
  return [
    channels,
    p.trigger === 'ON_TRANSITION' ? 'when it becomes true' : 'while true',
    p.cooldownMinutes ? `cooldown ${p.cooldownMinutes} min` : 'no cooldown',
    p.oncePerCandle ? 'once per candle' : 'repeat within a candle',
  ].join(' · ');
}

/** "NIFTY 25000 · exp 2026-10-01" / "GOLD26DECFUT" / "NIFTY 50". */
export function unitText(u: V2Unit, productSymbol: string): string {
  if (u.baseStrike !== null) return `${productSymbol} ${u.baseStrike} · exp ${u.expiry}`;
  const first = Object.values(u.legs).find(Boolean);
  return first?.symbol ?? productSymbol;
}
