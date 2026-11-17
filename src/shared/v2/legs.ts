/**
 * The strategy's legs and clock follow its conditions — the trader never sets them (2026-11-16):
 *
 *   - Each condition picks the instrument it reads: SPOT, FUT, or a CE / PE at a strike from ATM. The legs (A–D,
 *     at most MAX_LEGS different instruments) are the instruments the conditions — and the trade plan: what it
 *     trades, its trailing rules — read. The engine, connections, paper trading and backtests still work on legs.
 *     Editing the conditions never changes what the plan trades or reads: a leg the plan uses is kept as it is.
 *   - The clock (`evaluation.triggerTimeframe`) is the shortest timeframe the conditions read — 15 min + 1 hour →
 *     15 min, Daily only → Daily. The engine reads each alert's prices and waits for late data on the clock's own
 *     candles, so the clock is always one a condition reads (10 min + 15 min → 10 min: a 15-min close falls between
 *     two checks now and then and is picked up at the next one — `clockLags`).
 */
import { LEG_IDS, TIMEFRAME, timeframeRank } from './catalog';
import type { ExprNode, LegDef, LegId, LegKind, SeriesSpec, StrategyDefinition, Timeframe } from './types';

/** What a leg is, without its letter: SPOT, FUT, or CE / PE at a strike from ATM. */
export type Instrument = Pick<LegDef, 'kind' | 'strikeOffset'>;

export const isOptionKind = (k: LegKind) => k === 'CE' || k === 'PE';

/** The instrument in its stored form (strike offset only on options, 0 = ATM). */
export function instrumentOf(i: Instrument): Instrument {
  return isOptionKind(i.kind) ? { kind: i.kind, strikeOffset: i.strikeOffset ?? 0 } : { kind: i.kind };
}

export function sameInstrument(a: Instrument, b: Instrument): boolean {
  return a.kind === b.kind && (!isOptionKind(a.kind) || (a.strikeOffset ?? 0) === (b.strikeOffset ?? 0));
}

/** The strategy's leg for an instrument, if it has one. */
export function legFor(legs: LegDef[], i: Instrument): LegDef | undefined {
  return legs.find((l) => sameInstrument(l, i));
}

/** The first leg letter not taken (A–D), or undefined when the strategy already reads MAX_LEGS instruments. */
export function freeLegId(legs: LegDef[]): LegId | undefined {
  return LEG_IDS.find((id) => !legs.some((l) => l.id === id));
}

/** Every series an expression reads (condition sides and patterns). */
export function forEachSeries(root: ExprNode, fn: (s: SeriesSpec) => void): void {
  switch (root.type) {
    case 'AND':
    case 'OR':
      return root.children.forEach((c) => forEachSeries(c, fn));
    case 'NOT':
      return forEachSeries(root.child, fn);
    case 'PATTERN':
      return fn(root.series);
    case 'CONDITION':
      for (const o of [root.left, root.right]) if (o.kind !== 'CONSTANT') fn(o.series);
  }
}

/** The same expression with every series passed through `fn`. */
export function mapSeries(root: ExprNode, fn: (s: SeriesSpec) => SeriesSpec): ExprNode {
  switch (root.type) {
    case 'AND':
    case 'OR':
      return { ...root, children: root.children.map((c) => mapSeries(c, fn)) };
    case 'NOT':
      return { ...root, child: mapSeries(root.child, fn) };
    case 'PATTERN':
      return { ...root, series: fn(root.series) };
    case 'CONDITION':
      return {
        ...root,
        left: root.left.kind === 'CONSTANT' ? root.left : { ...root.left, series: fn(root.left.series) },
        right: root.right.kind === 'CONSTANT' ? root.right : { ...root.right, series: fn(root.right.series) },
      };
  }
}

/** Legs an expression reads. */
export function legsReadBy(root: ExprNode | null | undefined, out = new Set<LegId>()): Set<LegId> {
  if (root) forEachSeries(root, (s) => out.add(s.leg));
  return out;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The timeframes an expression reads, shortest first. */
function timeframesOf(root: ExprNode): Timeframe[] {
  const used = new Set<Timeframe>();
  forEachSeries(root, (s) => used.add(s.timeframe));
  return [...used].sort((a, b) => timeframeRank(a) - timeframeRank(b));
}

/** The clock the conditions call for: the shortest timeframe they read (null = they read no candles yet). */
export function clockTimeframe(root: ExprNode): Timeframe | null {
  return timeframesOf(root)[0] ?? null;
}

/**
 * Timeframes whose candles don't all close on the clock (10 min + 15 min: the 9:30 close of a 15-min candle is
 * checked at 9:35), with the longest wait. Daily / weekly candles close with the session's last candle.
 */
export function clockLags(root: ExprNode): Array<{ timeframe: Timeframe; upToMinutes: number }> {
  const [clock, ...rest] = timeframesOf(root);
  const c = clock ? TIMEFRAME[clock].minutes : 0;
  if (!c) return [];
  return rest.flatMap((tf) => {
    const m = TIMEFRAME[tf].minutes;
    return m && m % c ? [{ timeframe: tf, upToMinutes: c - gcd(m, c) }] : [];
  });
}

/** The definition with its clock set from its conditions (unchanged when they read no candles yet). */
export function withDerivedClock(d: StrategyDefinition): StrategyDefinition {
  const tf = clockTimeframe(d.expression);
  return !tf || tf === d.evaluation.triggerTimeframe ? d : { ...d, evaluation: { ...d.evaluation, triggerTimeframe: tf } };
}

/**
 * Drops legs nothing reads — neither the conditions nor `keep` (the trade plan's legs) — keeping at least one so
 * the definition stays valid while the trader rebuilds the conditions.
 */
export function pruneLegs(d: StrategyDefinition, keep: Iterable<LegId> = []): StrategyDefinition {
  const used = legsReadBy(d.expression, new Set(keep));
  const legs = d.legs.filter((l) => used.has(l.id));
  const next = legs.length ? legs : d.legs.slice(0, 1);
  return next.length === d.legs.length ? d : { ...d, legs: next };
}

/**
 * After an edit of the conditions: legs nothing reads any more are dropped, and the clock follows the conditions'
 * timeframes. `keep` = legs the trade plan uses (what it trades, its trailing rules — also rules of groups that
 * are gone for now): they stay exactly as they are, so editing the conditions never changes what the plan trades,
 * and their letters are never handed to another instrument. (A strategy may trade an instrument no condition reads,
 * e.g. FUT conditions → buy CE ATM.)
 */
export function tidyLegs(next: StrategyDefinition, keep: Iterable<LegId> = []): StrategyDefinition {
  return withDerivedClock(pruneLegs(next, keep));
}
