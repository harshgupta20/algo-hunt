/**
 * The compact strategy format the AI reads and writes — a fraction of the tokens of the builder's JSON (Groq's free
 * plan allows 8,000 tokens a minute), and close to how a trader says it:
 *
 *   { "name": "Weekly breakout", "timeframe": "1w",
 *     "entry": { "all": [["close", "crosses_above", { "ind": "SMA", "period": 20 }], [{ "ind": "RSI", "period": 14 }, ">", 60]] },
 *     "trigger": "when_true",
 *     "exit": { "when": ["close", "crosses_below", { "ind": "SMA", "period": 50 }], "target": 20, "stop": 8 },
 *     "pyramid": { "ma": "SMA", "period": 20, "max_adds": null },
 *     "size": { "amount": 50000 } }
 *
 * Values can also be written short, as people (and models) write them: "SMA(20)", "RSI(14)", "SMA(20,volume)",
 * "MACD(12,26,9).signal", "BB(20,2).upper", "HIGHEST(252,high)", "close[1]" (1 candle ago), "1.5*SMA(20,volume)".
 * Operators are forgiving too ("crosses above", "crossover", "gt", "≥").
 *
 * toDefinition() turns it into the builder's EqStrategyDefinition (ids generated) and says exactly what's wrong when
 * it can't; the result is then checked by the same validator as the builder. fromDefinition() is the way back.
 */
import type { EqCondition, EqGroup, EqIndicatorId, EqMaType, EqNode, EqOperand, EqOperator, EqStrategyDefinition, PriceField } from '@/shared/equity';
import { EQ_INDICATOR } from '@/shared/equity';

export type CompactValue = number | PriceField | { price: PriceField; ago?: number } | ({ ind: EqIndicatorId; src?: PriceField; out?: string; ma?: { type: EqMaType; period: number }; x?: number; ago?: number } & Record<string, unknown>);
export type CompactCondition = [CompactValue, string, CompactValue];
export type CompactNode = CompactCondition | { all: CompactNode[] } | { any: CompactNode[] };

export interface CompactStrategy {
  name: string;
  timeframe: '1d' | '1w';
  entry: CompactNode;
  trigger?: 'when_true' | 'becomes_true';
  exit?: { when?: CompactNode | null; target?: number | null; stop?: number | null; trail?: number | null; base?: 'average' | 'first_buy'; max_bars?: number | null };
  pyramid?: { ma?: EqMaType; period: number; max_adds?: number | null } | null;
  size?: { amount: number } | { shares: number } | { percent: number };
}

export class CompactError extends Error {}

const OPS: Record<string, EqOperator> = {
  crosses_above: 'CROSSES_ABOVE',
  crosses_below: 'CROSSES_BELOW',
  '>': 'GT',
  '>=': 'GTE',
  '<': 'LT',
  '<=': 'LTE',
};
const OP_TEXT = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k])) as Record<EqOperator, string>;
const OP_ALIASES: Record<string, EqOperator> = {
  ...OPS,
  cross_above: 'CROSSES_ABOVE',
  crosses_over: 'CROSSES_ABOVE',
  crossover: 'CROSSES_ABOVE',
  cross_over: 'CROSSES_ABOVE',
  crossesabove: 'CROSSES_ABOVE',
  cross_below: 'CROSSES_BELOW',
  crosses_under: 'CROSSES_BELOW',
  crossunder: 'CROSSES_BELOW',
  cross_under: 'CROSSES_BELOW',
  crossesbelow: 'CROSSES_BELOW',
  gt: 'GT',
  above: 'GT',
  greater_than: 'GT',
  gte: 'GTE',
  '≥': 'GTE',
  '=>': 'GTE',
  lt: 'LT',
  below: 'LT',
  less_than: 'LT',
  lte: 'LTE',
  '≤': 'LTE',
  '=<': 'LTE',
};

/** An operator as written ("crosses above", " > ", "gt") → the builder's. */
function opOf(v: unknown): EqOperator | undefined {
  const k = String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return OP_ALIASES[k];
}

/** "SMA(20)", "RSI(14)", "SMA(20,volume)", "MACD(12,26,9).signal", "HIGHEST(252,high)", "close[1]", "1.5*SMA(20,volume)";
 *  an average of an indicator: "SMA(9) of RSI(14)" (the builder's words) or "SMA(RSI(14),9)". */
function shorthand(v: string, where: string): Record<string, unknown> | null {
  const of = /^\s*(SMA|EMA|WMA)\s*\(\s*(\d+)\s*\)\s+of\s+(.+)$/i.exec(v) ?? (/^\s*(SMA|EMA|WMA)\s*\(\s*([A-Za-z]+\s*\([^)]*\)(?:\.\w+)?)\s*,\s*(\d+)\s*\)\s*$/i.exec(v) as RegExpExecArray | null);
  if (of) {
    const [type, period, inner] = /^\d+$/.test(of[2]!) ? [of[1]!, Number(of[2]), of[3]!] : [of[1]!, Number(of[3]), of[2]!];
    const base = shorthand(inner, where);
    if (!base || !('ind' in base)) throw new CompactError(`${where}: "${v}" — an average goes on an indicator, e.g. "SMA(9) of RSI(14)"`);
    return { ...base, ma: { type: type.toUpperCase(), period } };
  }
  const m = /^\s*(?:([\d.]+)\s*[*×x]\s*)?([A-Za-z]+)\s*(?:\(([^)]*)\))?\s*(?:\.\s*(\w+))?\s*(?:\[\s*(\d+)\s*\])?\s*$/.exec(v);
  if (!m) return null;
  const [, mult, name, args, out, back] = m;
  const field = name!.toLowerCase() as PriceField;
  if (FIELDS.includes(field) && args === undefined && !out) return { price: field, ...(back ? { ago: Number(back) } : {}), ...(mult ? { __x: Number(mult) } : {}) };
  const spec = EQ_INDICATOR[name!.toUpperCase() as EqIndicatorId];
  if (!spec) return null;
  const o: Record<string, unknown> = { ind: spec.id };
  const parts = (args ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  let k = 0;
  for (const a of parts) {
    const n = Number(a);
    if (Number.isFinite(n)) {
      const p = spec.params[k++];
      if (!p) throw new CompactError(`${where}: ${spec.id} takes ${spec.params.length} number(s) — ${spec.params.map((x) => x.name).join(', ')}`);
      o[p.name] = n;
    } else o.src = a.toLowerCase();
  }
  if (out) o.out = out;
  if (back) o.ago = Number(back);
  if (mult) o.x = Number(mult);
  return o;
}
const FIELDS: PriceField[] = ['open', 'high', 'low', 'close', 'volume'];
const MA_TYPES: EqMaType[] = ['SMA', 'EMA', 'WMA'];
/** Keys of an indicator value that aren't its parameters. */
const VALUE_KEYS = new Set(['ind', 'src', 'out', 'ma', 'x', 'ago']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const say = (v: unknown) => JSON.stringify(v)?.slice(0, 120) ?? String(v);

function ago(v: unknown, where: string): number | undefined {
  if (v === undefined || v === null || v === 0) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 500) throw new CompactError(`${where}: "ago" must be a whole number of candles 0–500`);
  return v;
}

function operand(v: unknown, where: string): EqOperand {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new CompactError(`${where}: not a finite number`);
    return { kind: 'NUMBER', value: v };
  }
  if (typeof v === 'string') {
    const f = v.toLowerCase() as PriceField;
    if (FIELDS.includes(f)) return { kind: 'PRICE', field: f };
    const n = Number(v);
    if (v.trim() !== '' && Number.isFinite(n)) return { kind: 'NUMBER', value: n };
    const short = shorthand(v, where);
    if (short && '__x' in short) throw new CompactError(`${where}: a multiplier goes on an indicator ("1.5*SMA(20,volume)"), not on a price`);
    if (short) return operand(short, where);
    throw new CompactError(`${where}: unknown value "${v}" — a number, a price (close, open, high, low, volume), "SMA(20)", "RSI(14)", "MACD(12,26,9).signal" or {"ind": …}`);
  }
  if (!isObj(v)) throw new CompactError(`${where}: unknown value ${say(v)}`);
  if ('price' in v) {
    const f = String(v.price).toLowerCase() as PriceField;
    if (!FIELDS.includes(f)) throw new CompactError(`${where}: price must be one of ${FIELDS.join(', ')}`);
    const a = ago(v.ago, where);
    return { kind: 'PRICE', field: f, ...(a ? { barsAgo: a } : {}) };
  }
  const id = String(v.ind ?? '').toUpperCase() as EqIndicatorId;
  const spec = EQ_INDICATOR[id];
  if (!spec) throw new CompactError(`${where}: unknown indicator ${say(v.ind)} — one of ${Object.keys(EQ_INDICATOR).join(', ')}`);
  const params: Record<string, number> = {};
  for (const p of spec.params) {
    const given = v[p.name];
    if (given === undefined) params[p.name] = p.default;
    else if (typeof given === 'number' && Number.isFinite(given)) params[p.name] = given;
    else throw new CompactError(`${where}: ${id} ${p.name} must be a number`);
  }
  const unknown = Object.keys(v).filter((k) => !VALUE_KEYS.has(k) && !spec.params.some((p) => p.name === k));
  if (unknown.length) throw new CompactError(`${where}: ${id} has no ${unknown.join(', ')} — its parameters are ${spec.params.map((p) => p.name).join(', ')}`);
  const out: EqOperand = { kind: 'INDICATOR', indicator: id, params };
  if (v.src !== undefined) {
    const s = String(v.src).toLowerCase() as PriceField;
    if (!spec.sources?.includes(s)) throw new CompactError(`${where}: ${id} can't read ${say(v.src)}${spec.sources ? ` — ${spec.sources.join(', ')}` : ' (it uses the whole candle)'}`);
    if (s !== spec.defaultSource) out.source = s;
  }
  if (v.out !== undefined) {
    if (!spec.outputs?.some((o) => o.value === v.out)) throw new CompactError(`${where}: ${id} has no output ${say(v.out)}${spec.outputs ? ` — ${spec.outputs.map((o) => o.value).join(', ')}` : ''}`);
    out.output = String(v.out);
  } else if (spec.outputs) out.output = spec.outputs[0]!.value;
  if (v.ma !== undefined) {
    const m = v.ma;
    if (!isObj(m) || !MA_TYPES.includes(String(m.type).toUpperCase() as EqMaType) || typeof m.period !== 'number') throw new CompactError(`${where}: "ma" is {"type": "SMA" | "EMA" | "WMA", "period": n}`);
    out.ma = { type: String(m.type).toUpperCase() as EqMaType, period: m.period };
  }
  if (v.x !== undefined && v.x !== 1) {
    if (typeof v.x !== 'number' || !(v.x > 0)) throw new CompactError(`${where}: "x" (multiplier) must be a positive number`);
    out.multiplier = v.x;
  }
  const a = ago(v.ago, where);
  if (a) out.barsAgo = a;
  return out;
}

function nodeOf(n: unknown, where: string, ids: { next: (p: string) => string }, prefix: string): EqNode {
  if (Array.isArray(n)) {
    if (n.length !== 3) throw new CompactError(`${where}: a condition is exactly [left, op, right], e.g. ["RSI(14)", ">", 55] — got ${say(n)}`);
    const op = opOf(n[1]);
    if (!op) throw new CompactError(`${where}: unknown operator ${say(n[1])} — one of ${Object.keys(OPS).join(', ')}`);
    return { type: 'CONDITION', id: ids.next(prefix), left: operand(n[0], `${where} left`), op, right: operand(n[2], `${where} right`) } satisfies EqCondition;
  }
  // "close crosses_above SMA(20)" as one string.
  if (typeof n === 'string') {
    const m = /^\s*(.+?)\s+(crosses[ _-]?above|crosses[ _-]?below|>=|<=|>|<|≥|≤)\s+(.+?)\s*$/i.exec(n);
    if (m) return nodeOf([m[1], m[2], m[3]], where, ids, prefix);
  }
  if (isObj(n) && (Array.isArray(n.all) || Array.isArray(n.any))) {
    const kids = (n.all ?? n.any) as unknown[];
    if (!kids.length) throw new CompactError(`${where}: an empty group`);
    return { type: n.all ? 'AND' : 'OR', id: ids.next(`${prefix}g`), children: kids.map((k, i) => nodeOf(k, `${where}[${i + 1}]`, ids, prefix)) } satisfies EqGroup;
  }
  throw new CompactError(`${where}: expected a condition [left, op, right] or a group {"all": […]} / {"any": […]} — got ${say(n)}`);
}

/** The top of entry / exit is always a group (the builder's shape). */
function groupOf(n: unknown, where: string, ids: { next: (p: string) => string }, prefix: string): EqGroup {
  const node = nodeOf(n, where, ids, prefix);
  return node.type === 'CONDITION' ? { type: 'AND', id: ids.next(`${prefix}g`), children: [node] } : node;
}

const pctOrNull = (v: unknown, name: string): number | null => {
  if (v === undefined || v === null || v === 0) return null;
  if (typeof v !== 'number' || !(v > 0)) throw new CompactError(`exit.${name} must be a positive % (or null)`);
  return v;
};

export function toDefinition(c: unknown): EqStrategyDefinition {
  if (!isObj(c)) throw new CompactError('The strategy must be an object — see the strategy format');
  let n = 0;
  const ids = { next: (p: string) => `${p}${++n}` };
  const name = String(c.name ?? '').trim();
  if (!name) throw new CompactError('Give the strategy a "name"');
  const tf = c.timeframe === '1w' || c.timeframe === 'weekly' ? '1w' : c.timeframe === '1d' || c.timeframe === 'daily' || c.timeframe === undefined ? '1d' : null;
  if (!tf) throw new CompactError('"timeframe" is "1d" (daily) or "1w" (weekly)');
  if (c.entry === undefined) throw new CompactError('"entry" is required');
  const exit = isObj(c.exit) ? c.exit : {};
  const pyr = isObj(c.pyramid) ? c.pyramid : null;
  const size = isObj(c.size) ? c.size : { amount: 50_000 };
  const sizing: EqStrategyDefinition['sizing'] =
    typeof size.amount === 'number' ? { mode: 'AMOUNT', value: size.amount } : typeof size.shares === 'number' ? { mode: 'QUANTITY', value: size.shares } : typeof size.percent === 'number' ? { mode: 'PERCENT', value: size.percent } : (() => {
      throw new CompactError('"size" is {"amount": ₹} | {"shares": n} | {"percent": % of the account}');
    })();
  const maxBars = exit.max_bars;
  if (maxBars !== undefined && maxBars !== null && (typeof maxBars !== 'number' || !Number.isInteger(maxBars) || maxBars < 1)) throw new CompactError('exit.max_bars must be a whole number of candles');
  if (pyr && (typeof pyr.period !== 'number' || (pyr.ma !== undefined && !MA_TYPES.includes(String(pyr.ma).toUpperCase() as EqMaType)))) throw new CompactError('"pyramid" is {"ma": "SMA" | "EMA" | "WMA", "period": n, "max_adds": n | null} or null');
  return {
    name,
    ...(typeof c.description === 'string' && c.description.trim() ? { description: c.description.trim().slice(0, 2000) } : {}),
    timeframe: tf,
    entry: { when: groupOf(c.entry, 'entry', ids, 'e'), trigger: c.trigger === 'becomes_true' ? 'BECOMES_TRUE' : 'WHEN_TRUE' },
    exit: {
      targetPct: pctOrNull(exit.target, 'target'),
      stopLossPct: pctOrNull(exit.stop, 'stop'),
      trailingStopPct: pctOrNull(exit.trail, 'trail'),
      priceBase: exit.base === 'first_buy' ? 'FIRST_BUY' : 'AVERAGE',
      when: exit.when === undefined || exit.when === null ? null : groupOf(exit.when, 'exit.when', ids, 'x'),
      maxBars: typeof maxBars === 'number' ? maxBars : null,
    },
    pyramid: pyr
      ? { enabled: true, maType: (String(pyr.ma ?? 'SMA').toUpperCase() as EqMaType) ?? 'SMA', maPeriod: pyr.period as number, maxAdds: typeof pyr.max_adds === 'number' ? pyr.max_adds : null }
      : { enabled: false, maType: 'SMA', maPeriod: 20, maxAdds: null },
    sizing,
  };
}

// ---- back to compact ------------------------------------------------------------------------------------

function valueOf(o: EqOperand): CompactValue {
  if (o.kind === 'NUMBER') return o.value;
  if (o.kind === 'PRICE') return o.barsAgo ? { price: o.field, ago: o.barsAgo } : o.field;
  const spec = EQ_INDICATOR[o.indicator];
  const v: Record<string, unknown> = { ind: o.indicator, ...o.params };
  if (o.source && o.source !== spec?.defaultSource) v.src = o.source;
  if (o.output && spec?.outputs && o.output !== spec.outputs[0]!.value) v.out = o.output;
  if (o.ma) v.ma = o.ma;
  if (o.multiplier !== undefined && o.multiplier !== 1) v.x = o.multiplier;
  if (o.barsAgo) v.ago = o.barsAgo;
  return v as CompactValue;
}

function compactNode(n: EqNode): CompactNode {
  if (n.type === 'CONDITION') return [valueOf(n.left), OP_TEXT[n.op], valueOf(n.right)];
  const kids = n.children.map(compactNode);
  return n.type === 'AND' ? { all: kids } : { any: kids };
}

/** A one-condition group reads as the condition. */
const top = (g: EqGroup): CompactNode => (g.children.length === 1 && g.children[0]!.type === 'CONDITION' ? compactNode(g.children[0]!) : compactNode(g));

export function fromDefinition(d: EqStrategyDefinition): CompactStrategy {
  const x = d.exit;
  const exit: NonNullable<CompactStrategy['exit']> = {};
  if (x.when && x.when.children.length) exit.when = top(x.when);
  if (x.targetPct !== null) exit.target = x.targetPct;
  if (x.stopLossPct !== null) exit.stop = x.stopLossPct;
  if (x.trailingStopPct !== null) exit.trail = x.trailingStopPct;
  if (x.priceBase === 'FIRST_BUY') exit.base = 'first_buy';
  if (x.maxBars !== null) exit.max_bars = x.maxBars;
  return {
    name: d.name,
    timeframe: d.timeframe,
    entry: top(d.entry.when),
    ...(d.entry.trigger === 'BECOMES_TRUE' ? { trigger: 'becomes_true' as const } : {}),
    exit,
    pyramid: d.pyramid.enabled ? { ma: d.pyramid.maType, period: d.pyramid.maPeriod, max_adds: d.pyramid.maxAdds } : null,
    size: d.sizing.mode === 'AMOUNT' ? { amount: d.sizing.value } : d.sizing.mode === 'QUANTITY' ? { shares: d.sizing.value } : { percent: d.sizing.value },
  };
}
