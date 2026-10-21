/**
 * Random but VALID strategies + backtest requests that cover every input of the builder: all indicators with their
 * sources / outputs, an MA of an indicator, multipliers, days / weeks ago, nested ALL / ANY groups, every operator,
 * both triggers, every exit (target, stop-loss, trailing stop, exit conditions, time), pyramiding, all three sizing
 * modes, capital limits, max stocks held, and the order rules (the app's EQ_ORDER_RULES half the time, every other
 * combination the rest so the engine's other paths stay honest). Only definitions validateDefinition accepts.
 *
 * Profiles: mixed · product (EQ_ORDER_RULES only) · small (short periods, many stocks) · edge (illiquid small caps,
 * heavy pyramiding, tight stops, little capital, few slots) · kite (the stocks fetched from Kite).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EqCondition, EqGroup, EqMaType, EqNode, EqOperand, EqOperator, EqOrderRules, EqStrategyDefinition, PriceField } from '../../src/shared/equity';
import { EQ_ORDER_RULES, hasErrors, validateDefinition } from '../../src/shared/equity';
import { historyFrom } from '../../src/server/equity/EquityService';
import { addDays } from '../../src/server/equity/engine/bars';

export type Profile = 'mixed' | 'product' | 'small' | 'edge' | 'kite';

export interface VerifyCase {
  id: string;
  definition: EqStrategyDefinition;
  symbols: string[];
  dataDir: string;
  from: string;
  to: string;
  capital: number | null;
  maxPositions: number | null;
  endDate: string;
  /** Only candles from this date — the history the app itself fetches (historyFrom); absent = everything. */
  dataFrom?: string;
  rules: EqOrderRules;
}

/** The last day of the downloaded candles (fixed, so runs are reproducible). */
export const DATA_END = '2026-10-16';

export const fileOf = (dataDir: string, symbol: string) => path.join(dataDir, `${symbol.replace(/&/g, '_AND_')}.json`);

export function generateCases(o: { seed: number; count: number; profile: Profile; dataDir: string; universe: string[] }): VerifyCase[] {
  let seed = o.seed >>> 0 || 1;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0; // mulberry32
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const chance = (p: number) => rnd() < p;
  const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
  const edge = o.profile === 'edge';

  const span = new Map<string, [string, string]>();
  for (const s of o.universe) {
    const j = JSON.parse(fs.readFileSync(fileOf(o.dataDir, s), 'utf8')) as { date: string[] };
    if (j.date.length) span.set(s, [j.date[0]!, j.date.at(-1)!]);
  }

  let idc = 0;
  const id = () => `n${++idc}`;
  const MAS: readonly EqMaType[] = ['SMA', 'EMA', 'WMA'];
  const ago = (x: EqOperand): EqOperand => (x.kind !== 'NUMBER' && chance(0.12) ? { ...x, barsAgo: int(1, 3) } : x);
  const mult = (x: EqOperand): EqOperand => (x.kind === 'INDICATOR' && chance(0.12) ? { ...x, multiplier: round(0.9 + rnd() * 0.2, 3) } : x);
  const priceOp = (): EqOperand => ({ kind: 'PRICE', field: pick<PriceField>(['close', 'close', 'close', 'open', 'high', 'low']) });
  const ma = (source?: PriceField): EqOperand => ({ kind: 'INDICATOR', indicator: pick(MAS), params: { period: pick([2, 3, 5, 9, 10, 14, 20, 21, 30, 44, 50, 100, 200]) }, ...(source && source !== 'close' ? { source } : {}) });
  const num = (value: number): EqOperand => ({ kind: 'NUMBER', value });
  const cross = (): EqOperator => pick<EqOperator>(['CROSSES_ABOVE', 'CROSSES_BELOW']);
  const anyOp = (): EqOperator => pick<EqOperator>(['CROSSES_ABOVE', 'CROSSES_BELOW', 'GT', 'GTE', 'LT', 'LTE']);
  const smooth = () => (chance(0.35) ? { ma: { type: pick(MAS), period: int(2, 21) } } : {});

  const families: Array<() => [EqOperand, EqOperator, EqOperand]> = [
    () => [priceOp(), chance(0.7) ? cross() : anyOp(), mult(ma(chance(0.2) ? pick<PriceField>(['open', 'high', 'low']) : undefined))],
    () => [ma(), chance(0.7) ? cross() : anyOp(), mult(ma())],
    () => [{ kind: 'INDICATOR', indicator: 'RSI', params: { period: pick([2, 3, 7, 9, 14, 21]) }, ...(chance(0.2) ? { source: pick<PriceField>(['open', 'high', 'low']) } : {}), ...smooth() }, anyOp(), num(int(20, 80))],
    () => {
      const period = pick([7, 14, 21]);
      return [{ kind: 'INDICATOR', indicator: 'RSI', params: { period } }, cross(), { kind: 'INDICATOR', indicator: 'RSI', params: { period }, ma: { type: pick(MAS), period: pick([5, 9, 14]) } }];
    },
    () => {
      const params = { fast: pick([5, 8, 12]), slow: pick([17, 21, 26, 35]), signal: pick([5, 9]) };
      return chance(0.5)
        ? [{ kind: 'INDICATOR', indicator: 'MACD', params, output: 'line' }, cross(), { kind: 'INDICATOR', indicator: 'MACD', params, output: 'signal' }]
        : [{ kind: 'INDICATOR', indicator: 'MACD', params, output: 'hist' }, anyOp(), num(0)];
    },
    () => {
      const params = { period: pick([10, 20, 30]), stdDev: pick([1.5, 2, 2.5]) };
      const r = rnd();
      if (r < 0.5) return [priceOp(), anyOp(), { kind: 'INDICATOR', indicator: 'BB', params, output: pick(['upper', 'mid', 'lower']) }];
      if (r < 0.8) return [{ kind: 'INDICATOR', indicator: 'BB', params, output: 'percentB' }, anyOp(), num(round(rnd(), 2))];
      return [{ kind: 'INDICATOR', indicator: 'BB', params, output: 'bandwidth' }, anyOp(), num(int(3, 25))];
    },
    () => [{ kind: 'INDICATOR', indicator: 'ATR', params: { period: pick([7, 14, 21]) } }, anyOp(), { kind: 'INDICATOR', indicator: 'ATR', params: { period: pick([7, 14, 21]) }, ma: { type: pick(MAS), period: pick([5, 10, 20]) } }],
    () => {
      const params = { period: pick([7, 10, 14]), multiplier: pick([1.5, 2, 3]) };
      return chance(0.5)
        ? [{ kind: 'INDICATOR', indicator: 'SUPERTREND', params, output: 'direction' }, cross(), num(0)]
        : [priceOp(), anyOp(), { kind: 'INDICATOR', indicator: 'SUPERTREND', params, output: 'value' }];
    },
    () => [{ kind: 'INDICATOR', indicator: 'ADX', params: { period: pick([7, 14]), smoothing: pick([7, 14]) }, ...smooth() }, anyOp(), num(int(15, 40))],
    () => {
      const period = pick([7, 14, 21]);
      return chance(0.6)
        ? [{ kind: 'INDICATOR', indicator: 'DMI', params: { period }, output: 'plus' }, cross(), { kind: 'INDICATOR', indicator: 'DMI', params: { period }, output: 'minus' }]
        : [{ kind: 'INDICATOR', indicator: 'DMI', params: { period }, output: pick(['plus', 'minus']) }, anyOp(), num(int(10, 40))];
    },
    () =>
      chance(0.5)
        ? [{ kind: 'PRICE', field: 'close' }, cross(), { kind: 'INDICATOR', indicator: 'HIGHEST', params: { period: pick([5, 10, 20, 52, 252]) }, ...(chance(0.3) ? { source: 'close' as const } : {}) }]
        : [{ kind: 'PRICE', field: 'close' }, cross(), { kind: 'INDICATOR', indicator: 'LOWEST', params: { period: pick([5, 10, 20, 52]) }, ...(chance(0.3) ? { source: 'close' as const } : {}) }],
    () => [{ kind: 'INDICATOR', indicator: 'ROC', params: { period: pick([1, 5, 10, 20]) }, ...(chance(0.25) ? { source: 'volume' as const } : {}), ...smooth() }, anyOp(), num(int(-8, 8))],
    () => [{ kind: 'PRICE', field: 'volume' }, anyOp(), { kind: 'INDICATOR', indicator: 'SMA', params: { period: pick([10, 20, 50]) }, source: 'volume', multiplier: pick([1, 1.5, 2]) }],
    () => [{ kind: 'PRICE', field: 'close' }, anyOp(), { kind: 'PRICE', field: pick<PriceField>(['close', 'high', 'low', 'open']), barsAgo: int(1, 5) }],
    () => [{ kind: 'INDICATOR', indicator: 'HIGHEST', params: { period: pick([5, 20]) }, source: 'volume' }, anyOp(), { kind: 'INDICATOR', indicator: 'LOWEST', params: { period: pick([5, 20]) }, source: 'volume', multiplier: 3 }],
  ];

  const condition = (): EqCondition => {
    const [left, op, right] = pick(families)();
    return { type: 'CONDITION', id: id(), left: ago(left), op, right: right.kind === 'NUMBER' ? right : ago(right) };
  };
  const group = (depth: number, type: 'AND' | 'OR' = pick(['AND', 'OR'] as const)): EqGroup => {
    const children: EqNode[] = [];
    for (let i = int(1, depth === 0 ? 3 : 2); i > 0; i--) children.push(depth < 2 && chance(0.18) ? group(depth + 1, type === 'AND' ? 'OR' : 'AND') : condition());
    return { type, id: id(), children };
  };
  const definition = (): EqStrategyDefinition => {
    const mode = pick(['AMOUNT', 'QUANTITY', 'PERCENT'] as const);
    return {
      name: 'verify',
      timeframe: chance(0.55) ? '1d' : '1w',
      entry: { when: group(0, chance(0.7) ? 'AND' : 'OR'), trigger: chance(0.7) ? 'WHEN_TRUE' : 'BECOMES_TRUE' },
      exit: {
        targetPct: chance(0.45) ? pick([2, 5, 8, 10, 15, 20, 30, 50, 250]) : null,
        stopLossPct: chance(edge ? 0.7 : 0.45) ? pick([1, 2, 3, 5, 8, 10, 15]) : null,
        trailingStopPct: chance(0.3) ? pick([3, 5, 8, 10, 15, 20]) : null,
        priceBase: chance(0.6) ? 'AVERAGE' : 'FIRST_BUY',
        when: chance(0.6) ? group(0, 'OR') : null,
        maxBars: chance(0.25) ? pick([1, 2, 3, 5, 10, 20, 40]) : null,
      },
      pyramid: { enabled: chance(edge ? 0.75 : 0.4), maType: pick(MAS), maPeriod: pick([2, 5, 10, 20, 50]), maxAdds: chance(0.5) ? null : int(1, 5) },
      sizing: { mode, value: mode === 'AMOUNT' ? pick([1000, 10_000, 25_000, 50_000, 200_000]) : mode === 'QUANTITY' ? pick([1, 5, 10, 100]) : pick([1, 5, 10, 25, 50]) },
    };
  };
  const rules = (): EqOrderRules =>
    o.profile === 'product' || chance(0.5) ? EQ_ORDER_RULES : { fill: chance(0.5) ? 'NEXT_OPEN' : 'CLOSE', stopTrigger: chance(0.5) ? 'TOUCH' : 'CLOSE', charges: chance(0.7), slippagePct: pick([0, 0.05, 0.1, 0.5, 1]) };

  // The edge profile draws from the universe's random sample of mostly small, illiquid stocks (its last 70).
  const pool = edge ? o.universe.slice(-70) : o.universe;
  const cases: VerifyCase[] = [];
  for (let tries = 0; cases.length < o.count && tries < o.count * 50; tries++) {
    const def = definition();
    if (hasErrors(validateDefinition(def))) continue;
    const symbols = [...new Set(Array.from({ length: o.profile === 'small' ? int(5, 15) : int(1, 6) }, () => pick(pool)))];
    const years = o.profile === 'small' ? 0.5 + rnd() : 0.3 + rnd() * 6;
    const fromYear = 2006 + rnd() * (2026.5 - 2006 - Math.min(years, 2));
    const from = new Date(Date.UTC(Math.floor(fromYear), 0, 1) + (fromYear % 1) * 365 * 86_400_000).toISOString().slice(0, 10);
    const to = [addDays(from, Math.round(years * 365)), DATA_END].sort()[0]!;
    const usable = symbols.filter((s) => span.has(s) && span.get(s)![0] < to && span.get(s)![1] >= from);
    if (!usable.length) continue;
    const capital = def.sizing.mode === 'PERCENT' || chance(0.8) ? pick(edge ? [20_000, 50_000, 100_000] : [100_000, 500_000, 1_000_000, 5_000_000]) : null;
    cases.push({
      id: `${o.profile}-${o.seed}-${cases.length}`,
      definition: def,
      symbols: usable,
      dataDir: o.dataDir,
      from,
      to,
      capital,
      maxPositions: chance(edge ? 0.6 : 0.3) ? int(1, 4) : null,
      endDate: to,
      ...(chance(0.5) ? { dataFrom: historyFrom(def, from, to) } : {}),
      rules: rules(),
    });
  }
  return cases;
}
