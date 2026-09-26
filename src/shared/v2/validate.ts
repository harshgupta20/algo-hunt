/**
 * Semantic validation (after the zod shape check), shared by the editors and
 * the server: strategies on their own, and a strategy connected to a product.
 * Errors block saving / enabling; warnings are shown but allowed.
 */
import { INDICATOR, MAX_LEGS, MAX_STRIKE_OFFSET, TIMEFRAME, sourceUnit, type ValueUnit } from './catalog';
import { legKindText } from './text';
import type { ConnectionConfig, ExprNode, LegId, LegKind, Operand, StrategyDefinition, V2Product } from './types';

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export const hasErrors = (issues: ValidationIssue[]) => issues.some((i) => i.severity === 'error');

/** Unit of an operand's values; null for constants (compatible with anything). */
export function operandUnit(o: Operand): ValueUnit | null {
  switch (o.kind) {
    case 'CONSTANT':
      return null;
    case 'FIELD':
      return sourceUnit(o.field);
    case 'OI_CHANGE':
      return 'oi';
    case 'INDICATOR': {
      const spec = INDICATOR[o.indicator];
      if (!spec) return null;
      const outUnit = spec.outputs?.find((x) => x.value === o.output)?.unit;
      if (outUnit) return outUnit;
      return spec.unit === 'source' ? sourceUnit(o.source ?? 'close') : spec.unit;
    }
  }
}

const UNIT_LABEL: Record<ValueUnit, string> = {
  price: 'a price',
  oscillator: 'an oscillator (0–100)',
  macd: 'a MACD value',
  direction: 'a direction (±1)',
  volume: 'a volume',
  oi: 'an open-interest value',
  ratio: 'a %B ratio',
  percent: 'a percentage',
};

interface Stats {
  leaves: number;
  timeframes: Set<string>;
  legs: Set<LegId>;
}

function validateOperand(o: Operand, path: string, issues: ValidationIssue[], legIds: Set<LegId>, warmup: number): void {
  if (o.kind === 'CONSTANT') return;
  if (!legIds.has(o.series.leg)) issues.push({ path: `${path}.series.leg`, message: `Uses leg ${o.series.leg}, which the strategy doesn't have`, severity: 'error' });
  if (o.kind !== 'INDICATOR') return;
  const spec = INDICATOR[o.indicator];
  if (!spec) {
    issues.push({ path, message: `Unknown indicator "${o.indicator}"`, severity: 'error' });
    return;
  }
  for (const p of spec.params) {
    const v = o.params[p.name];
    if (v === undefined) issues.push({ path: `${path}.params.${p.name}`, message: `Missing ${spec.label} ${p.label.toLowerCase()}`, severity: 'error' });
    else if (v < p.min || v > p.max || (p.integer && !Number.isInteger(v))) {
      issues.push({ path: `${path}.params.${p.name}`, message: `${spec.label} ${p.label.toLowerCase()} must be ${p.integer ? 'a whole number ' : ''}between ${p.min} and ${p.max}`, severity: 'error' });
    }
  }
  if (o.source && !spec.sources) issues.push({ path: `${path}.source`, message: `${spec.label} doesn't take a source field`, severity: 'error' });
  if (o.source && spec.sources && !spec.sources.includes(o.source)) issues.push({ path: `${path}.source`, message: `${spec.label} can't use ${o.source} as its source`, severity: 'error' });
  if (spec.outputs && !o.output) issues.push({ path: `${path}.output`, message: `Choose which ${spec.label} output to use`, severity: 'error' });
  if (o.output && !spec.outputs?.some((x) => x.value === o.output)) issues.push({ path: `${path}.output`, message: `${spec.label} has no output "${o.output}"`, severity: 'error' });
  const need = spec.requiredHistory(o.params) * TIMEFRAME[o.series.timeframe].factor;
  if (need > warmup) issues.push({ path, message: `${spec.label} needs ~${need} candles of history but only ~${warmup} are fetched — values may never be ready`, severity: 'warning' });
}

function walk(node: ExprNode, path: string, issues: ValidationIssue[], legIds: Set<LegId>, warmup: number, stats: Stats): void {
  switch (node.type) {
    case 'AND':
    case 'OR':
      if (node.children.length === 0) issues.push({ path, message: `Empty ${node.type} group`, severity: 'error' });
      node.children.forEach((c, i) => walk(c, `${path}.children[${i}]`, issues, legIds, warmup, stats));
      return;
    case 'NOT':
      walk(node.child, `${path}.child`, issues, legIds, warmup, stats);
      return;
    case 'PATTERN':
      stats.leaves++;
      stats.timeframes.add(node.series.timeframe);
      stats.legs.add(node.series.leg);
      if (!legIds.has(node.series.leg)) issues.push({ path: `${path}.series.leg`, message: `Uses leg ${node.series.leg}, which the strategy doesn't have`, severity: 'error' });
      return;
    case 'CONDITION': {
      stats.leaves++;
      if (node.left.kind === 'CONSTANT') issues.push({ path: `${path}.left`, message: 'The left side must read data (indicator, price, volume or OI), not a number', severity: 'error' });
      for (const o of [node.left, node.right]) {
        if (o.kind === 'CONSTANT') continue;
        stats.timeframes.add(o.series.timeframe);
        stats.legs.add(o.series.leg);
      }
      validateOperand(node.left, `${path}.left`, issues, legIds, warmup);
      validateOperand(node.right, `${path}.right`, issues, legIds, warmup);
      const lu = operandUnit(node.left);
      const ru = operandUnit(node.right);
      if (lu && ru && lu !== ru) issues.push({ path, message: `Compares ${UNIT_LABEL[lu]} with ${UNIT_LABEL[ru]} — incompatible values`, severity: 'error' });
      return;
    }
  }
}

export function validateStrategy(d: StrategyDefinition, opts: { warmupCandles?: number } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const warmup = opts.warmupCandles ?? 300;

  if (d.legs.length === 0) issues.push({ path: 'legs', message: 'Add at least one leg', severity: 'error' });
  if (d.legs.length > MAX_LEGS) issues.push({ path: 'legs', message: `At most ${MAX_LEGS} legs`, severity: 'error' });
  const ids = new Set<LegId>();
  const seen = new Set<string>();
  d.legs.forEach((l, i) => {
    if (ids.has(l.id)) issues.push({ path: `legs[${i}]`, message: `Leg ${l.id} is defined twice`, severity: 'error' });
    ids.add(l.id);
    const isOption = l.kind === 'CE' || l.kind === 'PE';
    if (isOption && Math.abs(l.strikeOffset ?? 0) > MAX_STRIKE_OFFSET) issues.push({ path: `legs[${i}]`, message: `Strike offset must be within ±${MAX_STRIKE_OFFSET}`, severity: 'error' });
    const sig = legKindText(l);
    if (seen.has(sig)) issues.push({ path: `legs[${i}]`, message: `Two legs are both ${sig} — they read the same contract`, severity: 'warning' });
    seen.add(sig);
  });

  const stats: Stats = { leaves: 0, timeframes: new Set(), legs: new Set() };
  walk(d.expression, 'expression', issues, ids, warmup, stats);
  if (stats.leaves === 0) issues.push({ path: 'expression', message: 'The strategy has no conditions', severity: 'error' });
  for (const l of d.legs) {
    if (!stats.legs.has(l.id)) issues.push({ path: 'legs', message: `Leg ${l.id} isn't used by any condition`, severity: 'warning' });
  }
  if (stats.leaves > 0 && !stats.timeframes.has(d.evaluation.triggerTimeframe)) {
    issues.push({ path: 'evaluation.triggerTimeframe', message: `Evaluated on ${TIMEFRAME[d.evaluation.triggerTimeframe].label} candles, but no condition reads that timeframe`, severity: 'warning' });
  }
  return issues;
}

/** Leg kinds a strategy needs from a product. */
export function requiredKinds(d: StrategyDefinition): LegKind[] {
  return [...new Set(d.legs.map((l) => l.kind))];
}

/** Why a strategy can't run on a product (empty = compatible). */
export function incompatibility(d: StrategyDefinition, p: Pick<V2Product, 'hasSpot' | 'hasFutures' | 'hasOptions' | 'symbol'>): string[] {
  const out: string[] = [];
  const kinds = requiredKinds(d);
  if (kinds.includes('SPOT') && !p.hasSpot) out.push(`${p.symbol} has no spot / cash price`);
  if (kinds.includes('FUT') && !p.hasFutures) out.push(`${p.symbol} has no futures`);
  if ((kinds.includes('CE') || kinds.includes('PE')) && !p.hasOptions) out.push(`${p.symbol} has no options`);
  return out;
}

export interface ConnectionContext {
  channelsConfigured?: { telegram: boolean; email: boolean };
  forEnable?: boolean;
}

export function validateConnection(d: StrategyDefinition, p: V2Product | null | undefined, c: ConnectionConfig, ctx: ConnectionContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!p) {
    issues.push({ path: 'productId', message: 'Unknown product — sync products first', severity: 'error' });
    return issues;
  }
  for (const m of incompatibility(d, p)) issues.push({ path: 'productId', message: `${m} — this strategy can't run on it`, severity: 'error' });
  const hasOptions = d.legs.some((l) => l.kind === 'CE' || l.kind === 'PE');
  const expiries = hasOptions ? p.optionExpiries : p.futureExpiries;
  if (c.expiry.mode === 'SPECIFIC' && (hasOptions || d.legs.some((l) => l.kind === 'FUT')) && !expiries.includes(c.expiry.date)) {
    issues.push({ path: 'config.expiry', message: `${p.symbol} has no ${hasOptions ? 'option' : 'futures'} expiry on ${c.expiry.date}`, severity: 'error' });
  }
  if (!hasOptions && c.strikeShifts.some((s) => s !== 0)) issues.push({ path: 'config.strikeShifts', message: 'Strike positions only apply to strategies with CE / PE legs', severity: 'warning' });
  const ch = c.alert.channels;
  if (!ch.telegram && !ch.email) issues.push({ path: 'config.alert.channels', message: 'No channel enabled — alerts are recorded but nothing is sent', severity: 'warning' });
  if (ctx.channelsConfigured) {
    for (const k of ['telegram', 'email'] as const) {
      if (ch[k] && !ctx.channelsConfigured[k]) {
        issues.push({
          path: `config.alert.channels.${k}`,
          message: `${k === 'telegram' ? 'Telegram' : 'Email'} is on but not configured (V2 → Settings)`,
          severity: ctx.forEnable ? 'error' : 'warning',
        });
      }
    }
  }
  return issues;
}
