/**
 * The strategy editor's instrument handling, run the way the editor runs it: a value picks an instrument
 * (`instrumentPicker` — adds a leg in one state update), then the condition is changed to read it (a second update,
 * through `tidyLegs`). Scenario tests, then a seeded random walk of thousands of edits checking the invariants after
 * every step.
 */
import { describe, expect, it } from 'vitest';
import type { ConditionNode, ExprNode, GroupNode, LegDef, LegId, Operand, PaperRule, SeriesSpec, StrategyDefinition, Timeframe } from '../../src/shared/v2';
import { LEG_IDS, MAX_LEGS, clockTimeframe, legKindText, legsReadBy, planLegs, pruneLegs, resolveRules, sameInstrument, strategyDefinitionSchema, tidyLegs, validateStrategy, type Instrument } from '../../src/shared/v2';
import { instrumentPicker } from '../../src/client/v2/strategies/InstrumentPicker';
import { adaptCondition } from '../../src/client/v2/strategies/comparison';

const S = (leg: LegId, timeframe: Timeframe = '15m'): SeriesSpec => ({ leg, timeframe, candle: { type: 'NORMAL' } });
const rsi = (s: SeriesSpec): Operand => ({ kind: 'INDICATOR', series: s, indicator: 'RSI', params: { period: 14 } });
const close = (s: SeriesSpec): Operand => ({ kind: 'FIELD', series: s, field: 'close' });
const sma = (s: SeriesSpec): Operand => ({ kind: 'INDICATOR', series: s, indicator: 'SMA', params: { period: 20 } });
let n = 0;
const cond = (left: Operand, right: Operand = { kind: 'CONSTANT', value: 60 }): ConditionNode => ({ type: 'CONDITION', id: `c${n++}`, left, operator: 'GT', right });
const def = (legs: LegDef[], ...children: ExprNode[]): StrategyDefinition => ({ schemaVersion: 1, name: 't', legs, evaluation: { mode: 'COMPLETED_CANDLE', triggerTimeframe: '15m' }, expression: { type: 'AND', id: 'root', children } });

/** The editor's state, updated the way React applies queued functional updates (as StrategyEditor wires it). */
function editor(start: StrategyDefinition, rules: PaperRule[] = []) {
  let d = start;
  // As the editors start: the saved plan, or the default one resolved once (concrete legs, not re-picked later).
  let plan = resolveRules(start, rules);
  const update = (fn: (x: StrategyDefinition) => StrategyDefinition) => void (d = fn(d));
  // Kept while the conditions change: the plan's legs, including rules of groups that are gone for now.
  const keep = () => new Set([...planLegs(resolveRules(d, plan)), ...planLegs(plan)]);
  const root = () => d.expression as GroupNode;
  const setExpression = (e: ExprNode) => update((x) => tidyLegs({ ...x, expression: e }, keep()));
  // A plan change drops an instrument nothing uses any more.
  const setPlan = (next: PaperRule[]) => {
    plan = next;
    update((x) => pruneLegs(x, [...planLegs(resolveRules(x, plan)), ...planLegs(plan)]));
  };
  return {
    get def() {
      return d;
    },
    get rules() {
      return resolveRules(d, plan);
    },
    get stored() {
      return plan;
    },
    /** A condition's left side picks an instrument (the right side follows when it read the same series). */
    pickLeft(i: number, instr: Instrument): LegId | undefined {
      const c = root().children[i] as ConditionNode;
      const cur = (c.left as Exclude<Operand, { kind: 'CONSTANT' }>).series;
      const id = instrumentPicker(d, update, keep())(instr, cur.leg);
      if (id && id !== cur.leg) {
        const next = adaptCondition(c, 'left', { ...c.left, series: { ...cur, leg: id } } as Operand).cond;
        setExpression({ ...root(), children: root().children.map((x, j) => (j === i ? next : x)) });
      }
      return id;
    },
    setTimeframe(i: number, tf: Timeframe) {
      const c = root().children[i] as ConditionNode;
      const cur = (c.left as Exclude<Operand, { kind: 'CONSTANT' }>).series;
      const next = adaptCondition(c, 'left', { ...c.left, series: { ...cur, timeframe: tf } } as Operand).cond;
      setExpression({ ...root(), children: root().children.map((x, j) => (j === i ? next : x)) });
    },
    setRootType(type: 'AND' | 'OR') {
      setExpression({ ...root(), type });
    },
    add(c: ExprNode) {
      setExpression({ ...root(), children: [...root().children, c] });
    },
    remove(i: number) {
      setExpression({ ...root(), children: root().children.filter((_, j) => j !== i) });
    },
    /** "What to trade" of rule `ri` picks an instrument (null = Don't trade), as PaperRulesEditor does. */
    trade(instr: Instrument | null, ri = 0): LegId | undefined | null {
      const rs = resolveRules(d, plan);
      const r = rs[ri]!;
      const set = (leg: LegId | null) => setPlan(rs.map((x, j) => (j === ri ? { ...x, leg } : x)));
      if (!instr) return void set(null), null;
      const shared = rs.some((x, j) => j !== ri && x.leg !== null && (x.leg === r.leg || legsReadBy(x.stopWhen).has(r.leg!)));
      const id = instrumentPicker(d, update, keep())(instr, r.leg ?? undefined, { onlyPlanUser: !shared });
      if (id) set(id);
      return id;
    },
    setTrailing(rule: ExprNode) {
      setPlan(resolveRules(d, plan).map((r) => ({ ...r, stopWhen: rule })));
    },
    /** What Save sends (an instrument the plan stopped using is dropped). */
    saved() {
      return pruneLegs(d, planLegs(resolveRules(d, plan)));
    },
  };
}

const kinds = (d: StrategyDefinition) => d.legs.map((l) => `${l.id}:${legKindText(l)}`).join(' ');
const tradedKind = (e: ReturnType<typeof editor>, ri = 0) => {
  const l = e.def.legs.find((x) => x.id === e.rules[ri]!.leg);
  return l ? legKindText(l) : null;
};

describe('picking instruments in conditions', () => {
  it('switching the only condition FUT → CE ATM adds the call; the plan keeps trading FUT until the trader changes it', () => {
    const e = editor(def([{ id: 'A', kind: 'FUT' }], cond(rsi(S('A')))));
    expect(tradedKind(e)).toBe('FUT');
    expect(e.pickLeft(0, { kind: 'CE', strikeOffset: 0 })).toBe('B');
    expect(kinds(e.def)).toBe('A:FUT B:CE ATM');
    expect(tradedKind(e)).toBe('FUT');
    // One click ("Trade CE ATM instead") → the FUT leaves the strategy.
    e.trade({ kind: 'CE', strikeOffset: 0 });
    expect(kinds(e.def)).toBe('B:CE ATM');
    expect(tradedKind(e)).toBe('CE ATM');
  });

  it('an index strategy switched to SPOT conditions still trades its FUT (never silently the untradeable spot)', () => {
    const e = editor(def([{ id: 'A', kind: 'FUT' }], cond(rsi(S('A')))));
    e.pickLeft(0, { kind: 'SPOT' });
    expect(kinds(e.def)).toBe('A:FUT B:SPOT');
    expect(tradedKind(e)).toBe('FUT');
  });

  it('“Close > SMA(20)” moves as one: both sides switch to the new instrument', () => {
    const e = editor(def([{ id: 'A', kind: 'FUT' }], cond(close(S('A')), sma(S('A')))), [{ group: null, leg: null, side: 'BUY' }]);
    e.pickLeft(0, { kind: 'PE', strikeOffset: -1 });
    expect(kinds(e.def)).toBe('B:PE ATM−1');
    const c = (e.def.expression as GroupNode).children[0] as ConditionNode;
    expect([c.left, c.right].map((o) => (o as { series: SeriesSpec }).series.leg)).toEqual(['B', 'B']);
  });

  it('a second instrument is added while the first is still read, and dropped when it isn’t', () => {
    const e = editor(def([{ id: 'A', kind: 'FUT' }], cond(rsi(S('A'))), cond(rsi(S('A')))));
    expect(e.pickLeft(1, { kind: 'PE', strikeOffset: 0 })).toBe('B');
    expect(kinds(e.def)).toBe('A:FUT B:PE ATM');
    expect(e.pickLeft(1, { kind: 'FUT' })).toBe('A');
    expect(kinds(e.def)).toBe('A:FUT');
  });

  it('re-picking an instrument the strategy reads changes nothing', () => {
    const start = def([{ id: 'A', kind: 'FUT' }, { id: 'B', kind: 'CE', strikeOffset: 0 }], cond(rsi(S('A'))), cond(rsi(S('B'))));
    const e = editor(start);
    expect(e.pickLeft(0, { kind: 'FUT' })).toBe('A');
    expect(e.def).toBe(start);
  });

  it('a strike change on the traded call: the plan keeps its ATM call until changed', () => {
    const e = editor(def([{ id: 'A', kind: 'FUT' }, { id: 'B', kind: 'CE', strikeOffset: 0 }], cond(rsi(S('A'))), cond(rsi(S('B')))));
    expect(tradedKind(e)).toBe('CE ATM');
    e.pickLeft(1, { kind: 'CE', strikeOffset: 2 });
    expect(kinds(e.def)).toBe('A:FUT B:CE ATM C:CE ATM+2');
    expect(tradedKind(e)).toBe('CE ATM');
  });

  it('with all four letters taken, a value that is its instrument’s only user switches in place', () => {
    const legs: LegDef[] = [{ id: 'A', kind: 'FUT' }, { id: 'B', kind: 'CE', strikeOffset: 0 }, { id: 'C', kind: 'PE', strikeOffset: 0 }, { id: 'D', kind: 'SPOT' }];
    const e = editor(def(legs, cond(rsi(S('A'))), cond(rsi(S('B'))), cond(rsi(S('C'))), cond(rsi(S('D')))), [{ group: null, leg: 'A', side: 'BUY' }]);
    expect(e.pickLeft(3, { kind: 'CE', strikeOffset: 1 })).toBe('D');
    expect(kinds(e.def)).toBe('A:FUT B:CE ATM C:PE ATM D:CE ATM+1');
  });

  it('…but not when something else uses it (another value, or the trade plan) — nothing changes', () => {
    const legs: LegDef[] = [{ id: 'A', kind: 'FUT' }, { id: 'B', kind: 'CE', strikeOffset: 0 }, { id: 'C', kind: 'PE', strikeOffset: 0 }, { id: 'D', kind: 'SPOT' }];
    const twice = editor(def(legs, cond(rsi(S('A'))), cond(rsi(S('B'))), cond(rsi(S('C'))), cond(close(S('D')), sma(S('D')))));
    const before = twice.def;
    expect(twice.pickLeft(3, { kind: 'CE', strikeOffset: 1 })).toBeUndefined();
    expect(twice.def).toBe(before);
    const traded = editor(def(legs, cond(rsi(S('A'))), cond(rsi(S('B'))), cond(rsi(S('C'))), cond(rsi(S('D')))), [{ group: null, leg: 'D', side: 'BUY' }]);
    expect(traded.pickLeft(3, { kind: 'CE', strikeOffset: 1 })).toBeUndefined();
    expect(kinds(traded.def)).toBe('A:FUT B:CE ATM C:PE ATM D:SPOT');
  });

  it('with four in use, the trade picker can still switch an instrument only the plan trades', () => {
    const legs: LegDef[] = [{ id: 'A', kind: 'FUT' }, { id: 'B', kind: 'CE', strikeOffset: 0 }, { id: 'C', kind: 'PE', strikeOffset: 0 }, { id: 'D', kind: 'CE', strikeOffset: 1 }];
    const e = editor(def(legs, cond(rsi(S('A'))), cond(rsi(S('B'))), cond(rsi(S('C')))), [{ group: null, leg: 'D', side: 'BUY' }]);
    expect(e.trade({ kind: 'CE', strikeOffset: 2 })).toBe('D');
    expect(kinds(e.def)).toBe('A:FUT B:CE ATM C:PE ATM D:CE ATM+2');
    // …but never one a condition reads.
    e.trade({ kind: 'FUT' });
    expect(e.trade({ kind: 'PE', strikeOffset: 3 })).toBe('D');
    expect(kinds(e.def)).toBe('A:FUT B:CE ATM C:PE ATM D:PE ATM+3');
  });

  it('the trade plan can trade an instrument no condition reads; it survives condition edits and leaves when the plan stops', () => {
    const e = editor(def([{ id: 'A', kind: 'FUT' }], cond(rsi(S('A')))));
    expect(e.trade({ kind: 'CE', strikeOffset: 0 })).toBe('B');
    e.setTimeframe(0, '5m');
    e.add(cond(rsi(S('A', '1h'))));
    expect(kinds(e.def)).toBe('A:FUT B:CE ATM');
    expect(e.def.evaluation.triggerTimeframe).toBe('5m');
    expect(e.trade({ kind: 'FUT' })).toBe('A');
    expect(kinds(e.def)).toBe('A:FUT');
    expect(e.trade(null)).toBeNull();
    expect(kinds(e.saved())).toBe('A:FUT');
  });

  it('trailing rules keep reading what they read when the conditions switch instrument', () => {
    const e = editor(def([{ id: 'A', kind: 'FUT' }], cond(rsi(S('A')))));
    e.setTrailing({ type: 'OR', id: 't', children: [cond(close(S('A')), sma(S('A')))] });
    e.pickLeft(0, { kind: 'CE', strikeOffset: 0 });
    expect(kinds(e.def)).toBe('A:FUT B:CE ATM');
    expect(tradedKind(e)).toBe('FUT');
    expect([...legsReadBy(e.rules[0]!.stopWhen!)]).toEqual(['A']);
  });

  it('OR → AND → OR: a group’s trade comes back on its own instrument, never on a reused letter', () => {
    const g = (id: string, leg: LegId): ExprNode => ({ type: 'AND', id, children: [cond(rsi(S(leg)))] });
    const start: StrategyDefinition = { ...def([{ id: 'A', kind: 'FUT' }, { id: 'B', kind: 'CE', strikeOffset: 0 }, { id: 'C', kind: 'PE', strikeOffset: 0 }]), expression: { type: 'OR', id: 'root', children: [g('g1', 'A'), g('g2', 'A')] } };
    const e = editor(start, [
      { group: 'g1', leg: 'B', side: 'BUY' },
      { group: 'g2', leg: 'C', side: 'BUY' },
    ]);
    e.setRootType('AND');
    // While the root is AND the groups' rules don't apply — yet their CE / PE stay through condition edits…
    e.add(cond(rsi(S('A', '5m'))));
    expect(kinds(e.def)).toBe('A:FUT B:CE ATM C:PE ATM');
    // …and a new instrument can't take their letters.
    expect(e.pickLeft(2, { kind: 'CE', strikeOffset: 1 })).toBe('D');
    e.setRootType('OR');
    expect(tradedKind(e, 0)).toBe('CE ATM');
    expect(tradedKind(e, 1)).toBe('PE ATM');
  });
});

// ---- random walk -----------------------------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const INSTRUMENTS: Instrument[] = [{ kind: 'SPOT' }, { kind: 'FUT' }, ...[-2, -1, 0, 1, 2].flatMap((o) => [{ kind: 'CE' as const, strikeOffset: o }, { kind: 'PE' as const, strikeOffset: o }])];
const TFS: Timeframe[] = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'];

function checkInvariants(e: ReturnType<typeof editor>, where: string) {
  const d = e.def;
  const ids = d.legs.map((l) => l.id);
  expect(d.legs.length, where).toBeGreaterThanOrEqual(1);
  expect(d.legs.length, where).toBeLessThanOrEqual(MAX_LEGS);
  expect(new Set(ids).size, where).toBe(ids.length);
  ids.forEach((id) => expect(LEG_IDS, where).toContain(id));
  for (let i = 0; i < d.legs.length; i++) for (let j = i + 1; j < d.legs.length; j++) expect(sameInstrument(d.legs[i]!, d.legs[j]!), `${where}: ${kinds(d)}`).toBe(false);
  const read = legsReadBy(d.expression);
  read.forEach((id) => expect(ids, `${where}: reads ${id} — ${kinds(d)}`).toContain(id));
  const rules = e.rules;
  for (const r of rules) {
    if (r.leg) expect(ids, where).toContain(r.leg);
    legsReadBy(r.stopWhen).forEach((id) => expect(ids, `${where}: trailing rule reads ${id}`).toContain(id));
  }
  // No orphans: every leg is read by a condition or used by the plan (or is the one leg kept while nothing is read).
  const used = legsReadBy(d.expression, new Set([...planLegs(rules), ...planLegs(e.stored)]));
  if (used.size) d.legs.forEach((l) => expect(used.has(l.id), `${where}: orphan ${l.id} — ${kinds(d)}`).toBe(true));
  const children = (d.expression as GroupNode).children;
  if (children.length) {
    expect(d.evaluation.triggerTimeframe, where).toBe(clockTimeframe(d.expression));
    expect(validateStrategy(d).filter((i) => i.severity === 'error'), `${where}: ${kinds(d)}`).toEqual([]);
    expect(strategyDefinitionSchema.safeParse(d).success, where).toBe(true);
  }
  const s = e.saved();
  legsReadBy(s.expression).forEach((id) => expect(s.legs.map((l) => l.id), where).toContain(id));
}

describe('random editing never breaks a strategy', () => {
  // FUZZ_SEEDS=300 npx vitest run tests/v2/instrumentEditing.test.ts — a longer sweep.
  const seeds = Array.from({ length: Number(process.env.FUZZ_SEEDS) || 8 }, (_, i) => i + 1);
  it.each(seeds)('seed %i: 600 random edits keep every invariant', (seed) => {
    const r = rng(seed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
    const e = editor(def([{ id: 'A', kind: 'FUT' }], cond(rsi(S('A')))));
    for (let step = 0; step < 600; step++) {
      const children = (e.def.expression as GroupNode).children;
      const op = r();
      const where = `seed ${seed} step ${step}`;
      const tradedBefore = e.rules.map((x) => (x.leg ? legKindText(e.def.legs.find((l) => l.id === x.leg)!) : null));
      let conditionEdit = true;
      if (op < 0.4 && children.length) e.pickLeft(Math.floor(r() * children.length), pick(INSTRUMENTS));
      else if (op < 0.55 && children.length) e.setTimeframe(Math.floor(r() * children.length), pick(TFS));
      else if (op < 0.7 && children.length < 6) {
        // A new condition starts on an instrument the strategy reads (as the editor's dominant series does).
        const leg = pick(e.def.legs).id;
        e.add(r() < 0.5 ? cond(rsi(S(leg, pick(TFS)))) : cond(close(S(leg)), sma(S(leg))));
      } else if (op < 0.8 && children.length > 1) e.remove(Math.floor(r() * children.length));
      else if ((conditionEdit = false) || op < 0.92) e.trade(r() < 0.1 ? null : pick(INSTRUMENTS));
      else if (e.def.legs.length) {
        const leg = pick(e.def.legs).id;
        e.setTrailing({ type: 'OR', id: `t${step}`, children: [cond(close(S(leg)), sma(S(leg)))] });
      }
      checkInvariants(e, where);
      if (conditionEdit) {
        const after = e.rules.map((x) => (x.leg ? legKindText(e.def.legs.find((l) => l.id === x.leg)!) : null));
        expect(after, `${where}: a condition edit changed what the plan trades`).toEqual(tradedBefore);
      }
    }
  });
});
