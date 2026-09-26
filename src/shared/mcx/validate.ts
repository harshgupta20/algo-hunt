/**
 * Semantic validation of an MCX V2 strategy (after the zod shape check).
 * Shared by the builder (inline errors) and the server (save / enable).
 * Errors block enabling; warnings are shown but allowed.
 */
import { MCX2_INDICATOR, MCX2_PRODUCT_BY_SYMBOL, MCX2_TIMEFRAME, sourceUnit, type ValueUnit } from './catalog';
import type { ExprNode, Leg, McxStrategyDefinition, Operand } from './types';

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationContext {
  /** Products with contracts in the synced master (omit to skip the check). */
  syncedProducts?: string[];
  /** Products with listed options in the synced master (omit to skip the check). */
  optionProducts?: string[];
  /** Destinations configured for each channel (omit to skip the check). */
  channelsConfigured?: { telegram: boolean; email: boolean };
  /** Resolved unit count (futures or strikes) and the cap (omit when the universe can't be resolved now). */
  resolvedTargets?: number;
  universeCap?: number;
  /** Candles fetched per series for warm-up. */
  warmupCandles?: number;
  /** Enabling: missing destinations become errors. */
  forEnable?: boolean;
}

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
      const spec = MCX2_INDICATOR[o.indicator];
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

function validateOperand(o: Operand, path: string, issues: ValidationIssue[], warmup: number): void {
  if (o.kind !== 'INDICATOR') return;
  const spec = MCX2_INDICATOR[o.indicator];
  if (!spec) {
    issues.push({ path, message: `Unknown indicator "${o.indicator}"`, severity: 'error' });
    return;
  }
  for (const p of spec.params) {
    const v = o.params[p.name];
    if (v === undefined) {
      issues.push({ path: `${path}.params.${p.name}`, message: `Missing ${spec.label} ${p.label.toLowerCase()}`, severity: 'error' });
    } else if (v < p.min || v > p.max || (p.integer && !Number.isInteger(v))) {
      issues.push({
        path: `${path}.params.${p.name}`,
        message: `${spec.label} ${p.label.toLowerCase()} must be ${p.integer ? 'a whole number ' : ''}between ${p.min} and ${p.max}`,
        severity: 'error',
      });
    }
  }
  for (const k of Object.keys(o.params)) {
    if (!spec.params.some((p) => p.name === k)) issues.push({ path: `${path}.params.${k}`, message: `${spec.label} has no parameter "${k}"`, severity: 'warning' });
  }
  if (o.source && !spec.sources) issues.push({ path: `${path}.source`, message: `${spec.label} doesn't take a source field`, severity: 'error' });
  if (o.source && spec.sources && !spec.sources.includes(o.source)) {
    issues.push({ path: `${path}.source`, message: `${spec.label} can't use ${o.source} as its source`, severity: 'error' });
  }
  if (spec.outputs && !o.output) issues.push({ path: `${path}.output`, message: `Choose which ${spec.label} output to use`, severity: 'error' });
  if (o.output && !spec.outputs?.some((x) => x.value === o.output)) {
    issues.push({ path: `${path}.output`, message: `${spec.label} has no output "${o.output}"`, severity: 'error' });
  }
  const need = spec.requiredHistory(o.params) * MCX2_TIMEFRAME[o.series.timeframe].factor;
  if (need > warmup) {
    issues.push({
      path,
      message: `${spec.label} needs ~${need} candles of history but only ${warmup} are fetched — values may never be ready`,
      severity: 'warning',
    });
  }
}

interface WalkStats {
  leaves: number;
  timeframes: Set<string>;
  legs: Set<Leg>;
}

function walk(node: ExprNode, path: string, issues: ValidationIssue[], warmup: number, stats: WalkStats): void {
  switch (node.type) {
    case 'AND':
    case 'OR':
      if (node.children.length === 0) issues.push({ path, message: `Empty ${node.type} group`, severity: 'error' });
      node.children.forEach((c, i) => walk(c, `${path}.children[${i}]`, issues, warmup, stats));
      return;
    case 'NOT':
      walk(node.child, `${path}.child`, issues, warmup, stats);
      return;
    case 'PATTERN':
      stats.leaves++;
      stats.timeframes.add(node.series.timeframe);
      stats.legs.add(node.series.leg);
      return;
    case 'CONDITION': {
      stats.leaves++;
      if (node.left.kind === 'CONSTANT') {
        issues.push({ path: `${path}.left`, message: 'The left side must read data (indicator, price, volume or OI), not a constant', severity: 'error' });
      }
      for (const o of [node.left, node.right]) {
        if (o.kind === 'CONSTANT') continue;
        stats.timeframes.add(o.series.timeframe);
        stats.legs.add(o.series.leg);
      }
      validateOperand(node.left, `${path}.left`, issues, warmup);
      validateOperand(node.right, `${path}.right`, issues, warmup);
      const lu = operandUnit(node.left);
      const ru = operandUnit(node.right);
      if (lu && ru && lu !== ru) {
        issues.push({ path, message: `Compares ${UNIT_LABEL[lu]} with ${UNIT_LABEL[ru]} — incompatible values`, severity: 'error' });
      }
      return;
    }
  }
}

export function validateStrategy(d: McxStrategyDefinition, ctx: ValidationContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const warmup = ctx.warmupCandles ?? 300;

  // Universe
  const u = d.universe;
  if (!MCX2_PRODUCT_BY_SYMBOL[u.underlying]) {
    issues.push({ path: 'universe.underlying', message: `Unknown MCX product "${u.underlying}"`, severity: 'error' });
  } else if (ctx.syncedProducts && !ctx.syncedProducts.includes(u.underlying)) {
    issues.push({ path: 'universe.underlying', message: `No ${u.underlying} contracts in MCX V2's instrument list yet — open Instruments → Sync from Kite`, severity: 'error' });
  } else if (u.target.kind === 'OPTION' && ctx.optionProducts && !ctx.optionProducts.includes(u.underlying)) {
    issues.push({ path: 'universe.target', message: `${u.underlying} has no listed options — choose Futures`, severity: 'error' });
  }
  if (u.target.kind === 'OPTION') {
    const s = u.target.strikes;
    if (s.mode === 'RANGE' && s.from > s.to) issues.push({ path: 'universe.target.strikes', message: 'Strike range: "from" must be ≤ "to"', severity: 'error' });
    if (s.mode === 'ATM_OFFSETS' && new Set(s.offsets).size !== s.offsets.length) {
      issues.push({ path: 'universe.target.strikes', message: 'Duplicate ATM offsets', severity: 'warning' });
    }
  }
  if (ctx.resolvedTargets !== undefined && ctx.universeCap !== undefined && ctx.resolvedTargets > ctx.universeCap) {
    issues.push({
      path: 'universe',
      message: `This selects ${ctx.resolvedTargets} ${u.target.kind === 'OPTION' ? 'strikes' : 'futures'} — above the cap of ${ctx.universeCap}. Narrow the strikes or expiries.`,
      severity: 'error',
    });
  }
  if (ctx.resolvedTargets === 0) issues.push({ path: 'universe', message: 'The selection currently matches no contracts', severity: 'error' });

  // Expression
  const stats: WalkStats = { leaves: 0, timeframes: new Set<string>(), legs: new Set<Leg>() };
  walk(d.expression, 'expression', issues, warmup, stats);
  if (stats.leaves === 0) issues.push({ path: 'expression', message: 'The strategy has no conditions', severity: 'error' });
  if (u.target.kind === 'FUTURE' && (stats.legs.has('CE') || stats.legs.has('PE'))) {
    issues.push({ path: 'expression', message: 'CE / PE conditions need Options — switch the strategy to Options or use FUT', severity: 'error' });
  }

  // Evaluation
  if (stats.leaves > 0 && !stats.timeframes.has(d.evaluation.triggerTimeframe)) {
    issues.push({
      path: 'evaluation.triggerTimeframe',
      message: `Evaluated on ${MCX2_TIMEFRAME[d.evaluation.triggerTimeframe].label} candles, but no condition reads that timeframe`,
      severity: 'warning',
    });
  }

  // Alert policy
  const ch = d.alert.channels;
  if (!ch.telegram && !ch.email) {
    issues.push({ path: 'alert.channels', message: 'No channel enabled — signals are recorded but nothing is sent', severity: 'warning' });
  }
  if (ctx.channelsConfigured) {
    for (const c of ['telegram', 'email'] as const) {
      if (ch[c] && !ctx.channelsConfigured[c]) {
        issues.push({
          path: `alert.channels.${c}`,
          message: `${c === 'telegram' ? 'Telegram' : 'Email'} is enabled but not configured (MCX V2 → Settings)`,
          severity: ctx.forEnable ? 'error' : 'warning',
        });
      }
    }
  }
  return issues;
}

export const hasErrors = (issues: ValidationIssue[]) => issues.some((i) => i.severity === 'error');
