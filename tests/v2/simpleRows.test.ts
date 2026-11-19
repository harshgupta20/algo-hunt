/**
 * The simple conditions view (one line per leg): what a line can show, and how an edit moves the other side — run
 * the way SimpleConditions + RulesEditor run them (instrumentPicker, then the condition through tidyLegs). Scenario
 * tests, then a seeded random walk of edits checking that every step stays a valid, line-shaped strategy.
 */
import { describe, expect, it } from 'vitest';
import type { ConditionNode, ExprNode, GroupNode, LegId, Operand, SeriesSpec, StrategyDefinition, Timeframe } from '../../src/shared/v2';
import { LEG_KINDS, MAX_LEGS, OPERATORS, TIMEFRAMES, operandUnit, paperGroupWord, paperGroups, strategyDefinitionSchema, tidyLegs, validateStrategy } from '../../src/shared/v2';
import { blankStrategy, exampleStrategies, newCondition } from '../../src/client/v2/strategies/defaults';
import { instrumentPicker } from '../../src/client/v2/strategies/InstrumentPicker';
import {
  VALUE_PICKS,
  defaultRight,
  operandOf,
  pickOf,
  toLegs,
  fromLegs,
  legsText,
  copyLeg,
  removeLeg,
  type Join,
  type SimpleLegs,
  simpleIssue,
  withLeft,
  withRight,
  withRightKind,
  withSeries,
  type SeriesOperand,
  type ValuePick,
} from '../../src/client/v2/strategies/simpleRows';

const S = (leg: LegId, timeframe: Timeframe = '15m'): SeriesSpec => ({
  leg,
  timeframe,
  candle: { type: 'NORMAL' },
});
const rsi = (s: SeriesSpec): SeriesOperand => ({
  kind: 'INDICATOR',
  series: s,
  indicator: 'RSI',
  params: { period: 14 },
});
const close = (s: SeriesSpec): SeriesOperand => ({
  kind: 'FIELD',
  series: s,
  field: 'close',
});
const sma = (s: SeriesSpec, period = 20): SeriesOperand => ({
  kind: 'INDICATOR',
  series: s,
  indicator: 'SMA',
  params: { period },
});
const num = (value: number): Operand => ({ kind: 'CONSTANT', value });
const cond = (left: Operand, right: Operand = num(60), operator: ConditionNode['operator'] = 'GT'): ConditionNode => ({
  type: 'CONDITION',
  id: `c${Math.random()}`,
  left,
  operator,
  right,
});

describe('pickOf — the dropdown entry of a value', () => {
  it('fields, OI change and indicators', () => {
    expect(pickOf(close(S('A')))).toBe('close');
    expect(pickOf({ kind: 'FIELD', series: S('A'), field: 'volume' })).toBe('volume');
    expect(pickOf({ kind: 'OI_CHANGE', series: S('A'), lookback: 3 })).toBe('OI_CHANGE');
    expect(pickOf(sma(S('A')))).toBe('SMA');
    expect(pickOf(num(5))).toBeNull();
  });
  it('RSI-based MA / EMA are RSI with an SMA / EMA of itself; a WMA or a multiplier has no line', () => {
    expect(pickOf(rsi(S('A')))).toBe('RSI');
    expect(pickOf({ ...rsi(S('A')), ma: { type: 'SMA', period: 14 } } as Operand)).toBe('RSI_MA');
    expect(pickOf({ ...rsi(S('A')), ma: { type: 'EMA', period: 9 } } as Operand)).toBe('RSI_EMA');
    expect(pickOf({ ...rsi(S('A')), ma: { type: 'WMA', period: 9 } } as Operand)).toBeNull();
    expect(pickOf({ ...sma(S('A')), multiplier: 1.5 } as Operand)).toBeNull();
    expect(
      pickOf({
        kind: 'INDICATOR',
        series: S('A'),
        indicator: 'ADX',
        params: { period: 14, smoothing: 14 },
        ma: { type: 'SMA', period: 5 },
      }),
    ).toBeNull();
  });
  it('every dropdown entry builds a value that reads back as itself', () => {
    for (const p of VALUE_PICKS) expect(pickOf(operandOf(p.value, S('A')))).toBe(p.value);
  });
});

describe('operandOf — switching the dropdown keeps what it can', () => {
  it('RSI → RSI-based MA → RSI-based EMA keeps the RSI length and the average length', () => {
    const r21 = { ...rsi(S('A')), params: { period: 21 } } as SeriesOperand;
    const ma = operandOf('RSI_MA', S('A'), r21);
    expect(ma).toMatchObject({
      indicator: 'RSI',
      params: { period: 21 },
      ma: { type: 'SMA', period: 14 },
    });
    const ema = operandOf('RSI_EMA', S('A'), {
      ...ma,
      ma: { type: 'SMA', period: 9 },
    } as Operand);
    expect(ema).toMatchObject({
      params: { period: 21 },
      ma: { type: 'EMA', period: 9 },
    });
    expect(operandOf('RSI', S('A'), ema)).toEqual({
      kind: 'INDICATOR',
      series: S('A'),
      indicator: 'RSI',
      params: { period: 21 },
    });
  });
  it('another indicator starts from its defaults (with its first line)', () => {
    expect(operandOf('BB', S('A'), sma(S('A'), 50))).toMatchObject({
      indicator: 'BB',
      params: { period: 20, stdDev: 2 },
      output: 'upper',
    });
    expect(operandOf('MACD', S('A'))).toMatchObject({
      params: { fast: 12, slow: 26, signal: 9 },
      output: 'line',
    });
  });
});

describe('editing a leg', () => {
  it('another reading starts at its usual level; new settings keep the typed number', () => {
    const c = cond(rsi(S('A')), num(70));
    expect(withLeft(c, operandOf('ADX', S('A'))).right).toEqual(num(25));
    expect(withLeft(c, { ...rsi(S('A')), params: { period: 21 } } as SeriesOperand).right).toEqual(num(70));
    // A price has no usual level: the number stays.
    expect(withLeft(cond(close(S('A')), num(24000)), operandOf('high', S('A'))).right).toEqual(num(24000));
  });
  it('a value switched between a reading and a price takes a partner it can be compared with', () => {
    const c = cond(close(S('A')), sma(S('A')));
    const r = withLeft(c, rsi(S('A')));
    expect(r.right).toMatchObject({
      indicator: 'RSI',
      ma: { type: 'SMA', period: 14 },
    });
    const back = withLeft(r, close(S('A')));
    expect(back.right).toMatchObject({ indicator: 'SMA' });
    // No partner for %B: a number.
    const pctB = {
      ...operandOf('BB', S('A')),
      output: 'percentB',
    } as SeriesOperand;
    expect(withLeft(c, pctB).right).toEqual(num(1));
  });
  it('Volume / OI compared with an average: the average is of the volume / OI', () => {
    const vol: SeriesOperand = {
      kind: 'FIELD',
      series: S('A'),
      field: 'volume',
    };
    const c = withRightKind(cond(vol, num(0)), 'INDICATOR');
    expect(c.right).toMatchObject({ indicator: 'SMA', source: 'volume' });
    expect(operandUnit(c.right)).toBe('volume');
    const ema = withRight(c, operandOf('EMA', S('A'), c.right));
    expect(ema.right).toMatchObject({ indicator: 'EMA', source: 'volume' });
    // Back to Close: the average is of the close again.
    const px = withLeft(ema, close(S('A')));
    expect(px.right).toMatchObject({ indicator: 'EMA' });
    expect((px.right as { source?: string }).source).toBeUndefined();
    expect(simpleIssue({ type: 'AND', id: 'r', children: [c, ema, px] })).toBeNull();
  });
  it('the compared side moves with the instrument and timeframe', () => {
    const c = cond(close(S('A')), sma(S('A')), 'CROSSED_ABOVE');
    const moved = withSeries(c, S('B', '5m'));
    expect((moved.left as SeriesOperand).series).toEqual(S('B', '5m'));
    expect((moved.right as SeriesOperand).series).toEqual(S('B', '5m'));
    expect(withSeries(cond(rsi(S('A'))), S('C')).right).toEqual(num(60));
  });
  it('number ⇄ indicator', () => {
    const c = cond(rsi(S('A')), num(55));
    const ind = withRightKind(c, 'INDICATOR');
    expect(ind.right).toMatchObject({ indicator: 'RSI', ma: { type: 'SMA' } });
    expect(withRightKind(ind, 'NUMBER').right).toEqual(num(60));
    expect(withRightKind(c, 'NUMBER')).toBe(c);
    expect(defaultRight(close(S('A')))).toMatchObject({ indicator: 'SMA' });
    expect(defaultRight(sma(S('A')))).toMatchObject({ indicator: 'EMA' });
    expect(defaultRight({ ...operandOf('MACD', S('A')) })).toMatchObject({
      indicator: 'MACD',
      output: 'signal',
    });
    expect(defaultRight({ ...operandOf('DMI', S('A')) })).toMatchObject({
      indicator: 'DMI',
      output: 'minus',
    });
  });
});

describe('simpleIssue — what opens in Advanced', () => {
  const byKey = Object.fromEntries(exampleStrategies().map((e) => [e.key, e.definition]));
  it('a new strategy, and plain one-line conditions, are simple', () => {
    expect(simpleIssue(blankStrategy().expression)).toBeNull();
    expect(simpleIssue(byKey['call-vs-put']!.expression)).toBeNull();
    expect(simpleIssue(cond(rsi(S('A'))))).toBeNull();
  });
  it('groups, patterns, NOT, another instrument on the compared side, a multiplier, other candles', () => {
    // An OR of AND blocks of plain conditions is what the per-gap AND / OR makes: simple.
    expect(simpleIssue(byKey['rsi-bb-bull-bear']!.expression)).toBeNull();
    const nested: ExprNode = { type: 'AND', id: 'r', children: [cond(rsi(S('A'))), { type: 'OR', id: 'o', children: [cond(rsi(S('A'))), cond(rsi(S('A')))] }] };
    expect(simpleIssue(nested)).toBe('Leg 2 uses a group inside the conditions');
    const deep: ExprNode = { type: 'OR', id: 'r', children: [cond(rsi(S('A'))), { type: 'AND', id: 'a', children: [cond(rsi(S('A'))), { type: 'OR', id: 'o', children: [cond(rsi(S('A')))] }] }] };
    expect(simpleIssue(deep)).toBe('Leg 3 uses a group inside the conditions');
    expect(simpleIssue({ type: 'OR', id: 'r', children: [cond(rsi(S('A'))), { type: 'AND', id: 'a', children: [] }] })).toBe('Leg 2 uses an empty group');
    expect(simpleIssue(byKey['fut-leads-call']!.expression)).toMatch(/Leg 1 uses the compared side on another instrument/);
    expect(simpleIssue(byKey['four-legs']!.expression)).toMatch(/Leg 4 uses a multiplier/);
    const g = (c: ExprNode): GroupNode => ({
      type: 'AND',
      id: 'r',
      children: [cond(rsi(S('A'))), c],
    });
    expect(simpleIssue(g({ type: 'PATTERN', id: 'p', series: S('A'), pattern: 'HAMMER' }))).toBe('Leg 2 uses a candle pattern');
    expect(simpleIssue(g({ type: 'NOT', id: 'n', child: cond(rsi(S('A'))) }))).toBe('Leg 2 uses NOT');
    expect(
      simpleIssue(
        g(
          cond({
            ...rsi(S('A')),
            series: { ...S('A'), candle: { type: 'HEIKIN_ASHI' } },
          }),
        ),
      ),
    ).toMatch(/Heikin Ashi/);
    expect(simpleIssue(g(cond(close(S('A')), sma(S('A', '1h')))))).toMatch(/another instrument, timeframe/);
    expect(simpleIssue(g(cond({ ...sma(S('A')), source: 'high' } as Operand)))).toMatch(/indicator of volume/);
    expect(simpleIssue(g(cond(num(1), num(2))))).toMatch(/a number as the value/);
  });
  it('a lone condition is one leg', () => {
    const c = cond(rsi(S('A')));
    expect(toLegs(c)).toEqual({ legs: [c], joins: [], mode: 'AND' });
  });
});

describe('the AND / OR between legs (AND joins first)', () => {
  const [l1, l2, l3, l4] = [1, 2, 3, 4].map((i) => ({ ...cond(rsi(S('A'))), id: `l${i}` }));
  const root = { type: 'AND' as const, id: 'root', label: 'Mine', children: [l1!] };
  it('Leg 1 AND Leg 2 OR Leg 3 AND Leg 4 = an OR of two AND blocks, and back', () => {
    const e = fromLegs({ legs: [l1!, l2!, l3!, l4!], joins: ['AND', 'OR', 'AND'], mode: 'AND' }, root);
    expect(e).toMatchObject({
      type: 'OR',
      id: 'root',
      label: 'Mine',
      children: [
        { type: 'AND', children: [l1, l2] },
        { type: 'AND', children: [l3, l4] },
      ],
    });
    expect(toLegs(e)).toEqual({ legs: [l1, l2, l3, l4], joins: ['AND', 'OR', 'AND'], mode: 'OR' });
    expect(legsText(toLegs(e))).toBe('(Leg 1 AND Leg 2) OR (Leg 3 AND Leg 4)');
    expect(simpleIssue(e)).toBeNull();
    // A block of one leg is the condition itself.
    const f = fromLegs({ legs: [l1!, l2!, l3!], joins: ['OR', 'AND'], mode: 'AND' }, e);
    expect(f).toMatchObject({ type: 'OR', children: [l1, { type: 'AND', children: [l2, l3] }] });
    expect(legsText(toLegs(f))).toBe('Leg 1 OR (Leg 2 AND Leg 3)');
    // All AND / all OR.
    expect(fromLegs({ legs: [l1!, l2!], joins: ['AND'], mode: 'OR' }, e)).toMatchObject({ type: 'AND', children: [l1, l2] });
    expect(fromLegs({ legs: [l1!, l2!], joins: ['OR'], mode: 'AND' }, e)).toMatchObject({ type: 'OR', children: [l1, l2] });
    expect(legsText({ legs: [l1!, l2!, l3!], joins: ['AND', 'AND'] })).toBe('Leg 1 AND Leg 2 AND Leg 3');
    // One leg keeps the root's AND / OR (the next leg's join).
    expect(fromLegs({ legs: [l1!], joins: [], mode: 'OR' }, e)).toMatchObject({ type: 'OR', children: [l1] });
  });
  it('an AND block keeps its id and name (What to trade keys its rules by them)', () => {
    const named: ExprNode = {
      type: 'OR',
      id: 'r',
      children: [
        { type: 'AND', id: 'bull', label: 'Bullish', children: [l1!, l2!] },
        { type: 'AND', id: 'bear', label: 'Bearish', children: [l3!, l4!] },
      ],
    };
    const m = toLegs(named);
    // Leg 2 copied into the bullish block: same block id and name.
    const copied = fromLegs(copyLeg(m, 1, 'l2b'), named);
    expect(copied).toMatchObject({
      children: [
        { id: 'bull', label: 'Bullish', children: [l1, l2, { id: 'l2b' }] },
        { id: 'bear', label: 'Bearish' },
      ],
    });
  });
  it('copy lands right below with the join next to it; remove keeps the other blocks', () => {
    const m = { legs: [l1!, l2!, l3!], joins: ['AND', 'OR'] as Array<'AND' | 'OR'>, mode: 'OR' as const };
    expect(copyLeg(m, 0, 'x')).toMatchObject({ legs: [l1, { id: 'x' }, l2, l3], joins: ['AND', 'AND', 'OR'] });
    expect(copyLeg(m, 2, 'x')).toMatchObject({ legs: [l1, l2, l3, { id: 'x' }], joins: ['AND', 'OR', 'OR'] });
    // (1 AND 2) OR 3: removing 2 → 1 OR 3; removing 3 → 1 AND 2; removing 1 → 2 OR 3.
    expect(removeLeg(m, 1)).toMatchObject({ legs: [l1, l3], joins: ['OR'] });
    expect(removeLeg(m, 2)).toMatchObject({ legs: [l1, l2], joins: ['AND'] });
    expect(removeLeg(m, 0)).toMatchObject({ legs: [l2, l3], joins: ['OR'] });
    // 1 OR (2 AND 3): removing 2 → 1 OR 3.
    expect(removeLeg({ ...m, joins: ['OR', 'AND'] }, 1)).toMatchObject({ legs: [l1, l3], joins: ['OR'] });
    expect(removeLeg({ legs: [l1!], joins: [], mode: 'AND' }, 0)).toMatchObject({ legs: [], joins: [] });
  });
});

describe('What to trade: numbered like the legs', () => {
  it('labels single conditions Leg n, AND blocks Legs a–b, other groups Group n', () => {
    const d = blankStrategy();
    const [l1, l2, l3] = [1, 2, 3].map(() => cond(rsi(S('A'))));
    const blocks: StrategyDefinition = { ...d, expression: { type: 'OR', id: 'r', children: [{ type: 'AND', id: 'b', children: [l1!, l2!] }, l3!] } };
    expect(paperGroups(blocks).map((g) => g.label)).toEqual(['Legs 1–2', 'Leg 3']);
    expect(paperGroupWord(blocks)).toBe('leg');
    const withPattern: StrategyDefinition = {
      ...d,
      expression: { type: 'OR', id: 'r', children: [l1!, { type: 'AND', id: 'p', children: [{ type: 'PATTERN', id: 'x', series: S('A'), pattern: 'HAMMER' }] }] },
    };
    expect(paperGroups(withPattern).map((g) => g.label)).toEqual(['Leg 1', 'Group 2']);
    expect(paperGroupWord(withPattern)).toBe('group');
  });
  it('labels single conditions Leg n, nested groups Group n', () => {
    const d = blankStrategy();
    const or: StrategyDefinition = {
      ...d,
      expression: {
        type: 'OR',
        id: 'r',
        children: [cond(rsi(S('A'))), { type: 'AND', id: 'g', children: [cond(rsi(S('A')))] }],
      },
    };
    expect(paperGroups(or).map((g) => g.label)).toEqual(['Leg 1', 'Leg 2']); // an AND of one condition is a block of one leg
  });
});

// ---- the editor, driven at random ---------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** SimpleConditions + RulesEditor's wiring: legs and joins over the conditions; a pick adds a leg in one update, the conditions go through tidyLegs. */
function editor(start: StrategyDefinition) {
  let d = start;
  const update = (fn: (x: StrategyDefinition) => StrategyDefinition) => void (d = fn(d));
  const keep = new Set<LegId>();
  const model = () => toLegs(d.expression);
  const set = (m: SimpleLegs) => update((x) => tidyLegs({ ...x, expression: fromLegs(m, x.expression) }, keep));
  const rows = () => model().legs;
  const setRow = (i: number, c: ConditionNode) => set({ ...model(), legs: model().legs.map((x, j) => (j === i ? c : x)) });
  return {
    get def() {
      return d;
    },
    model,
    set,
    rows,
    setRow,
    pick: (i: number, kind: (typeof LEG_KINDS)[number]['kind'], strikeOffset: number) => {
      const c = rows()[i]!;
      const s = (c.left as SeriesOperand).series;
      const id = instrumentPicker(d, update, keep)({ kind, strikeOffset }, s.leg);
      if (id && id !== s.leg) setRow(i, withSeries(rows()[i]!, { ...s, leg: id }));
      return id;
    },
  };
}

describe('random walk of simple edits', () => {
  it('every step is a valid strategy the simple view can show, with both sides read from one series and the joins kept', () => {
    const picks = VALUE_PICKS.map((p) => p.value);
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const any = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
      const e = editor(blankStrategy());
      for (let step = 0; step < 150; step++) {
        const m = e.model();
        const n = m.legs.length;
        const i = Math.floor(r() * Math.max(1, n));
        const c = m.legs[i];
        // At most 6 legs (copies and adds stop there), like a real strategy.
        const action = n === 0 ? 0 : Math.floor(r() * 11);
        if ((action === 0 || action === 9) && n >= 6) continue;
        const left = c?.left as SeriesOperand | undefined;
        let want: SimpleLegs | null = null;
        switch (action) {
          case 0:
            want = { ...m, legs: [...m.legs, newCondition(left?.series ?? S(e.def.legs[0]?.id ?? 'A'))], joins: n ? [...m.joins, m.joins[m.joins.length - 1] ?? m.mode] : [] };
            e.set(want);
            break;
          case 1:
            if (n > 1) e.set((want = removeLeg(m, i)));
            break;
          case 2:
            e.pick(i, any(LEG_KINDS).kind, Math.floor(r() * 5) - 2);
            break;
          case 3:
            e.setRow(i, withSeries(c!, { ...left!.series, timeframe: any(TIMEFRAMES).key }));
            break;
          case 4:
            e.setRow(i, withLeft(c!, operandOf(any(picks) as ValuePick, left!.series, left)));
            break;
          case 5:
            e.setRow(i, { ...c!, operator: any(OPERATORS).value });
            break;
          case 6:
            e.setRow(i, withRightKind(c!, r() < 0.5 ? 'NUMBER' : 'INDICATOR'));
            break;
          case 7:
            if (c!.right.kind !== 'CONSTANT') e.setRow(i, withRight(c!, operandOf(any(picks) as ValuePick, left!.series, c!.right)));
            else e.setRow(i, { ...c!, right: num(Math.round(r() * 100)) });
            break;
          case 8: {
            const j: Join = r() < 0.5 ? 'AND' : 'OR';
            e.set((want = { ...m, joins: m.joins.map(() => j), mode: j }));
            break;
          }
          case 9:
            e.set((want = copyLeg(m, i, `copy${seed}-${step}`)));
            break;
          case 10:
            // Switch one gap.
            if (n > 1) {
              const g = Math.floor(r() * (n - 1));
              e.set((want = { ...m, joins: m.joins.map((j, k) => (k === g ? (j === 'AND' ? 'OR' : 'AND') : j)) }));
            }
            break;
        }
        const d = e.def;
        expect(strategyDefinitionSchema.safeParse(d).success).toBe(true);
        expect(simpleIssue(d.expression)).toBeNull();
        expect(d.legs.length).toBeLessThanOrEqual(MAX_LEGS);
        const now = e.model();
        // The legs and joins read back exactly as set (same order, same AND / OR in every gap).
        if (want) {
          expect(now.legs.map((l) => l.id)).toEqual(want.legs.map((l) => l.id));
          expect(now.joins).toEqual(want.joins);
        }
        expect(now.joins).toHaveLength(Math.max(0, now.legs.length - 1));
        // What to trade: one rule per block when there are 2+ blocks, named as the legs read.
        const blocks = now.joins.filter((j) => j === 'OR').length + 1;
        expect(paperGroups(d)).toHaveLength(blocks > 1 ? blocks : 0);
        for (const row of now.legs) {
          expect(d.legs.some((l) => l.id === (row.left as SeriesOperand).series.leg)).toBe(true);
          if (row.right.kind !== 'CONSTANT') expect(row.right.series).toEqual((row.left as SeriesOperand).series);
        }
        // Only the trader's own pick of the compared indicator can leave values that can't be compared.
        const errors = validateStrategy(d).filter((x) => x.severity === 'error' && !/incompatible values/.test(x.message));
        expect(errors).toEqual([]);
        // A changed value never leaves an incompatible comparison behind.
        if (action === 4) {
          const row = now.legs[i]!;
          const lu = operandUnit(row.left);
          const ru = operandUnit(row.right);
          expect(ru === null || ru === lu).toBe(true);
        }
      }
    }
  }, 60_000);
});
