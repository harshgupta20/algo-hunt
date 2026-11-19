/**
 * The simple conditions view — one line per condition, numbered "Leg 1, Leg 2 …" (the trader's ask, 2026-11-19,
 * Chartink-style):
 *
 *   Leg 1  [instrument (+ strike)] [timeframe] [indicator (settings)] [comparison] [Number | Indicator] [60 | indicator (settings)]
 *
 * All legs (AND) or any leg (OR). The compared side always reads the value's instrument and candles. Pure logic
 * here (what a row can show, how an edit moves the other side); the rows themselves are SimpleConditions.tsx.
 *
 * What a row can't show lives in the Advanced view (the full editor): candle patterns, NOT, groups inside the
 * conditions, Heikin Ashi / volume candles, an indicator of volume / open / high / low, a multiplier, the compared
 * side on another instrument or timeframe, RSI with a WMA, an average of ADX.
 */
import type { ConditionNode, ExprNode, GroupNode, Operand, SeriesSpec, SourceField } from '@/shared/v2';
import { INDICATOR, RSI_MA_DEFAULT, operandUnit } from '@/shared/v2';
import { defaultLevel, isPriceLevel } from './comparison';
import { indicatorOperand, newGroup } from './defaults';

type IndicatorOperand = Extract<Operand, { kind: 'INDICATOR' }>;
/** A value that reads candles (anything but a number). */
export type SeriesOperand = Exclude<Operand, { kind: 'CONSTANT' }>;

/** One entry of the indicator dropdown. RSI_MA / RSI_EMA = RSI with an SMA / EMA of itself (TradingView's RSI-based MA). */
export type ValuePick = 'close' | 'open' | 'high' | 'low' | 'volume' | 'oi' | 'OI_CHANGE' | 'RSI' | 'RSI_MA' | 'RSI_EMA' | 'SMA' | 'EMA' | 'BB' | 'SUPERTREND' | 'ADX' | 'DMI' | 'MACD' | 'RANGE';

export const VALUE_PICKS: Array<{
  value: ValuePick;
  label: string;
  group: 'Price' | 'Indicators';
  body: string;
}> = [
  {
    value: 'close',
    label: 'Close',
    group: 'Price',
    body: 'The candle’s closing price.',
  },
  {
    value: 'open',
    label: 'Open',
    group: 'Price',
    body: 'The candle’s opening price.',
  },
  {
    value: 'high',
    label: 'High',
    group: 'Price',
    body: 'The candle’s highest price.',
  },
  {
    value: 'low',
    label: 'Low',
    group: 'Price',
    body: 'The candle’s lowest price.',
  },
  {
    value: 'volume',
    label: 'Volume',
    group: 'Price',
    body: 'Units traded in the candle. Compared with an SMA / EMA, that average is of the volume too.',
  },
  {
    value: 'oi',
    label: 'OI',
    group: 'Price',
    body: 'Open interest at the candle’s close (futures and options). Compared with an SMA / EMA, that average is of the OI too.',
  },
  {
    value: 'OI_CHANGE',
    label: 'OI change',
    group: 'Price',
    body: 'OI now minus the OI a number of candles back (the number in brackets).',
  },
  {
    value: 'RSI',
    label: 'RSI',
    group: 'Indicators',
    body: 'Relative Strength Index (Wilder, as Kite / TradingView), 0–100.',
  },
  {
    value: 'RSI_MA',
    label: 'RSI-based MA',
    group: 'Indicators',
    body: 'TradingView’s RSI-based MA: a simple moving average of the RSI. Brackets: RSI length, average length.',
  },
  {
    value: 'RSI_EMA',
    label: 'RSI-based EMA',
    group: 'Indicators',
    body: 'An exponential moving average of the RSI. Brackets: RSI length, average length.',
  },
  {
    value: 'SMA',
    label: 'SMA',
    group: 'Indicators',
    body: 'Simple moving average of the close (of the volume / OI when compared with Volume / OI).',
  },
  {
    value: 'EMA',
    label: 'EMA',
    group: 'Indicators',
    body: 'Exponential moving average of the close (of the volume / OI when compared with Volume / OI).',
  },
  {
    value: 'BB',
    label: 'Bollinger Bands',
    group: 'Indicators',
    body: 'Middle = SMA; bands = middle ± std dev × σ. Pick Upper / Middle / Lower (compare with a price), or %B / Bandwidth (compare with a number).',
  },
  {
    value: 'SUPERTREND',
    label: 'Supertrend',
    group: 'Indicators',
    body: 'ATR-based trailing line (compare with a price), or its direction +1 / −1 (compare with a number).',
  },
  {
    value: 'ADX',
    label: 'ADX',
    group: 'Indicators',
    body: 'Average Directional Index: trend strength 0–100 (25+ = trending).',
  },
  {
    value: 'DMI',
    label: 'DMI',
    group: 'Indicators',
    body: 'Directional Movement: +DI (up pressure) or −DI (down pressure), 0–100.',
  },
  {
    value: 'MACD',
    label: 'MACD',
    group: 'Indicators',
    body: 'MACD line, signal or histogram (fast, slow, signal).',
  },
  {
    value: 'RANGE',
    label: 'N-candle low / high',
    group: 'Indicators',
    body: 'Lowest low / highest high of the previous N candles — “Close crossed above Highest high (20)” is a 20-candle breakout.',
  },
];

const FIELD_PICKS = new Set<string>(['close', 'open', 'high', 'low', 'volume', 'oi']);
const PICK_IDS = new Set<string>(VALUE_PICKS.map((p) => p.value));
const AVERAGES = new Set(['SMA', 'EMA']);

const sameSeries = (a: SeriesSpec, b: SeriesSpec) => JSON.stringify(a) === JSON.stringify(b);

/** The dropdown entry a value is, or null when a row can't show it. */
export function pickOf(o: Operand): ValuePick | null {
  switch (o.kind) {
    case 'CONSTANT':
      return null;
    case 'FIELD':
      return o.field;
    case 'OI_CHANGE':
      return 'OI_CHANGE';
    case 'INDICATOR': {
      if (o.multiplier !== undefined && o.multiplier !== 1) return null;
      if (o.indicator === 'RSI') return !o.ma ? 'RSI' : o.ma.type === 'SMA' ? 'RSI_MA' : o.ma.type === 'EMA' ? 'RSI_EMA' : null;
      if (o.ma || !INDICATOR[o.indicator] || !PICK_IDS.has(o.indicator)) return null;
      return o.indicator as ValuePick;
    }
  }
}

/** The source an average on the compared side takes: Volume / OI compared with an SMA / EMA → the average of it. */
export function autoSource(left: Operand, indicator: string): SourceField | undefined {
  return left.kind === 'FIELD' && (left.field === 'volume' || left.field === 'oi') && AVERAGES.has(indicator) ? left.field : undefined;
}

const sourceOf = (o: Operand) => (o.kind === 'INDICATOR' && o.source && o.source !== 'close' ? o.source : undefined);

/** The value for a dropdown entry on `series`, keeping `prev`'s settings where it is the same indicator. */
export function operandOf(pick: ValuePick, series: SeriesSpec, prev?: Operand): SeriesOperand {
  if (FIELD_PICKS.has(pick)) return { kind: 'FIELD', series, field: pick as SourceField };
  if (pick === 'OI_CHANGE')
    return {
      kind: 'OI_CHANGE',
      series,
      lookback: prev?.kind === 'OI_CHANGE' ? prev.lookback : 1,
    };
  const before = prev?.kind === 'INDICATOR' ? prev : undefined;
  if (pick === 'RSI' || pick === 'RSI_MA' || pick === 'RSI_EMA') {
    const rsi = before?.indicator === 'RSI' ? before : indicatorOperand(series, 'RSI');
    const period = rsi.ma?.period ?? RSI_MA_DEFAULT.period;
    const ma =
      pick === 'RSI'
        ? undefined
        : {
            type: pick === 'RSI_MA' ? ('SMA' as const) : ('EMA' as const),
            period,
          };
    return {
      kind: 'INDICATOR',
      series,
      indicator: 'RSI',
      params: { ...rsi.params },
      ...(ma ? { ma } : {}),
    };
  }
  if (before?.indicator === pick && !before.ma) {
    const { multiplier: _m, source: _s, ...rest } = before;
    return { ...rest, series };
  }
  return indicatorOperand(series, pick);
}

/** The compared side when "Indicator" is picked: what the value is usually compared with. */
export function defaultRight(left: SeriesOperand): SeriesOperand {
  const s = left.series;
  const pick = pickOf(left);
  if (pick === 'RSI') return operandOf('RSI_MA', s, left);
  if (pick === 'RSI_MA' || pick === 'RSI_EMA') return operandOf('RSI', s, left);
  if (left.kind === 'INDICATOR' && left.indicator === 'MACD')
    return {
      ...operandOf('MACD', s, left),
      output: left.output === 'signal' ? 'line' : 'signal',
    } as SeriesOperand;
  if (left.kind === 'INDICATOR' && left.indicator === 'DMI')
    return {
      ...operandOf('DMI', s, left),
      output: left.output === 'minus' ? 'plus' : 'minus',
    } as SeriesOperand;
  if (left.kind === 'INDICATOR' && left.indicator === 'ADX') return { ...indicatorOperand(s, 'DMI'), output: 'plus' };
  if (left.kind === 'FIELD' && (left.field === 'volume' || left.field === 'oi')) return { ...indicatorOperand(s, 'SMA'), source: left.field };
  if (pick === 'SMA') return indicatorOperand(s, 'EMA');
  if (isPriceLevel(left)) return { kind: 'FIELD', series: s, field: 'close' };
  return indicatorOperand(s, 'SMA');
}

/** A number for the compared side: the value's usual level (RSI 60, ADX 25 …), else 0. */
export function defaultNumber(left: Operand): number {
  return defaultLevel(left) ?? 0;
}

/** The compared side made to read the value's series (and an average of Volume / OI to be of it). */
function follow(right: Operand, left: SeriesOperand): Operand {
  if (right.kind === 'CONSTANT') return right;
  const moved = { ...right, series: left.series } as SeriesOperand;
  if (moved.kind !== 'INDICATOR') return moved;
  const { source: _s, ...rest } = moved;
  const src = autoSource(left, moved.indicator);
  return src ? { ...rest, source: src } : rest;
}

/** The value changed: the compared side moves with it, and stays something it can be compared with. */
export function withLeft(c: ConditionNode, left: SeriesOperand): ConditionNode {
  const prev = c.left;
  if (c.right.kind === 'CONSTANT') {
    // Another reading (RSI → ADX, %B → Bandwidth) starts at its usual level; new settings (RSI 14 → 21) keep the number.
    const other = prev.kind !== left.kind || pickOf(prev) !== pickOf(left) || (prev.kind === 'INDICATOR' && left.kind === 'INDICATOR' && prev.output !== left.output);
    const level = defaultLevel(left);
    return {
      ...c,
      left,
      right: other && level !== undefined ? { kind: 'CONSTANT', value: level } : c.right,
    };
  }
  const right = follow(c.right, left);
  if (operandUnit(right) === operandUnit(left)) return { ...c, left, right };
  // A reading compared with a price (or the other way round) can't be compared: switch to the usual partner, or a
  // number when there is none (Bollinger %B, Supertrend direction, OI change).
  const partner = defaultRight(left);
  return {
    ...c,
    left,
    right: operandUnit(partner) === operandUnit(left) ? partner : { kind: 'CONSTANT', value: defaultNumber(left) },
  };
}

/** The value's instrument or timeframe changed: both sides read the new one. */
export function withSeries(c: ConditionNode, series: SeriesSpec): ConditionNode {
  if (c.left.kind === 'CONSTANT') return c;
  const left = { ...c.left, series } as SeriesOperand;
  return { ...c, left, right: follow(c.right, left) };
}

/** The compared side switched between a number and an indicator. */
export function withRightKind(c: ConditionNode, kind: 'NUMBER' | 'INDICATOR'): ConditionNode {
  if (c.left.kind === 'CONSTANT') return c;
  if (kind === 'NUMBER') return c.right.kind === 'CONSTANT' ? c : { ...c, right: { kind: 'CONSTANT', value: defaultNumber(c.left) } };
  return c.right.kind !== 'CONSTANT' ? c : { ...c, right: defaultRight(c.left) };
}

/** The compared side picked from the dropdown (or its settings changed). */
export function withRight(c: ConditionNode, right: SeriesOperand): ConditionNode {
  if (c.left.kind === 'CONSTANT') return c;
  return { ...c, right: follow(right, c.left) };
}

// ---- what the simple view can show ------------------------------------------------------------------

/** Why a value can't sit in a row (null = it can). */
function operandIssue(o: Operand, left?: Operand): string | null {
  if (o.kind === 'CONSTANT') return left ? null : 'a number as the value';
  if (o.series.candle.type !== 'NORMAL') return 'Heikin Ashi or volume candles';
  if (o.kind === 'INDICATOR') {
    if (o.multiplier !== undefined && o.multiplier !== 1) return 'a multiplier (e.g. 1.5 × SMA)';
    if (sourceOf(o) !== (left ? autoSource(left, o.indicator) : undefined)) return 'an indicator of volume, OI, open, high or low';
  }
  if (!pickOf(o)) return o.kind === 'INDICATOR' && o.indicator === 'RSI' ? 'RSI with a WMA' : 'a moving average of this indicator';
  if (left && left.kind !== 'CONSTANT' && !sameSeries(o.series, left.series)) return 'the compared side on another instrument, timeframe or candle type';
  return null;
}

/** Why a condition can't be a row (null = it can). */
export function rowIssue(n: ExprNode): string | null {
  switch (n.type) {
    case 'PATTERN':
      return 'a candle pattern';
    case 'NOT':
      return 'NOT';
    case 'AND':
    case 'OR':
      return 'a group inside the conditions';
    case 'CONDITION':
      return operandIssue(n.left) ?? operandIssue(n.right, n.left);
  }
}

/** The AND / OR between two legs. */
export type Join = 'AND' | 'OR';

/**
 * The conditions as the simple view shows them: legs in order, and the AND / OR in each gap between two legs. AND
 * joins first, so `Leg 1 AND Leg 2 OR Leg 3` = (Leg 1 AND Leg 2) OR Leg 3 — stored as an OR of the AND blocks (a
 * block of one leg is the condition itself). `mode` = how a single leg's root reads (the next leg's join).
 */
export interface SimpleLegs {
  legs: ConditionNode[];
  joins: Join[];
  mode: Join;
}

/** The conditions as legs and joins (call only when `simpleIssue` is null). */
export function toLegs(root: ExprNode): SimpleLegs {
  if (root.type === 'CONDITION') return { legs: [root], joins: [], mode: 'AND' };
  if (root.type !== 'AND' && root.type !== 'OR') return { legs: [], joins: [], mode: 'AND' };
  const legs: ConditionNode[] = [];
  const joins: Join[] = [];
  for (const c of root.children) {
    const block = root.type === 'OR' && c.type === 'AND' ? c.children : [c];
    block.forEach((l, j) => {
      if (legs.length) joins.push(root.type === 'AND' || j > 0 ? 'AND' : 'OR');
      legs.push(l as ConditionNode);
    });
  }
  return { legs, joins, mode: root.type };
}

/**
 * Legs and joins back to conditions: one AND block → an AND group; more → an OR of the blocks. The root keeps its id
 * and name, an AND block the id and name of the block it came from (What to trade keys its rules by them).
 */
export function fromLegs({ legs, joins, mode }: SimpleLegs, prev: ExprNode): ExprNode {
  const blocks: ConditionNode[][] = [];
  legs.forEach((l, i) => (i === 0 || joins[i - 1] === 'OR' ? blocks.push([l]) : blocks[blocks.length - 1]!.push(l)));
  const prevRoot = prev.type === 'AND' || prev.type === 'OR' ? prev : null;
  const base = { id: prevRoot?.id ?? newGroup().id, ...(prevRoot?.label ? { label: prevRoot.label } : {}) };
  if (blocks.length <= 1) return { type: legs.length > 1 ? 'AND' : mode, ...base, children: blocks[0] ?? [] };
  const old = prevRoot?.type === 'OR' ? prevRoot.children.filter((c): c is GroupNode => c.type === 'AND') : [];
  const used = new Set<string>();
  const children = blocks.map((b): ExprNode => {
    if (b.length === 1) return b[0]!;
    const g = old.find((o) => !used.has(o.id) && o.children.some((c) => b.some((l) => l.id === c.id)));
    if (!g) return newGroup('AND', b);
    used.add(g.id);
    return { ...g, children: b };
  });
  return { type: 'OR', ...base, children };
}

/** "(Leg 1 AND Leg 2) OR Leg 3" — how the legs combine (AND joins first). */
export function legsText({ legs, joins }: Pick<SimpleLegs, 'legs' | 'joins'>): string {
  const blocks: number[][] = [];
  legs.forEach((_, i) => (i === 0 || joins[i - 1] === 'OR' ? blocks.push([i + 1]) : blocks[blocks.length - 1]!.push(i + 1)));
  const one = blocks.length === 1;
  return blocks.map((b) => (b.length === 1 || one ? b.map((n) => `Leg ${n}`).join(' AND ') : `(${b.map((n) => `Leg ${n}`).join(' AND ')})`)).join(' OR ');
}

/** The join a new gap gets: the one before it, else the one after it, else the root's. */
export function nearJoin(joins: Join[], gap: number, mode: Join): Join {
  return joins[gap - 1] ?? joins[gap] ?? mode;
}

/**
 * A copy of leg `i` (with `id`) right below it, in the same block: AND when the leg sits in a block of several legs;
 * a leg on its own takes the join next to it (an OR: a new alternative).
 */
export function copyLeg(m: SimpleLegs, i: number, id: string): SimpleLegs {
  const inBlock = m.joins[i - 1] === 'AND' || m.joins[i] === 'AND';
  const join: Join = inBlock ? 'AND' : (m.joins[i] ?? m.joins[i - 1] ?? m.mode);
  const legs = [...m.legs.slice(0, i + 1), { ...m.legs[i]!, id }, ...m.legs.slice(i + 1)];
  const joins = [...m.joins.slice(0, i), join, ...m.joins.slice(i)];
  return { ...m, legs, joins };
}

/**
 * Leg `i` removed with one of its joins: the AND before it (it sat inside a block), else the one after it (it
 * started a block), else the one before — so the other blocks stay as they were.
 */
export function removeLeg(m: SimpleLegs, i: number): SimpleLegs {
  const legs = m.legs.filter((_, j) => j !== i);
  const before = i - 1;
  const drop = m.joins[before] === 'AND' || i >= m.joins.length ? before : i;
  return { ...m, legs, joins: m.joins.filter((_, j) => j !== drop) };
}

/** Why the simple view can't show these conditions — "Leg 2 uses a candle pattern" — or null when it can. */
export function simpleIssue(root: ExprNode): string | null {
  let n = 0;
  const leg = (c: ExprNode) => {
    n += 1;
    const why = rowIssue(c);
    return why ? `Leg ${n} uses ${why}` : null;
  };
  if (root.type !== 'AND' && root.type !== 'OR') return leg(root);
  for (const c of root.children) {
    // An OR of AND blocks of conditions is what the per-gap AND / OR makes.
    if (root.type === 'OR' && c.type === 'AND') {
      if (!c.children.length) return `Leg ${n + 1} uses an empty group`;
      for (const x of c.children) {
        const why = leg(x);
        if (why) return why;
      }
      continue;
    }
    const why = leg(c);
    if (why) return why;
  }
  return null;
}
