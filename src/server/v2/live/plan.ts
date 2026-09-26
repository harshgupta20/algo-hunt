/**
 * Which contracts the live worker streams. Per switched-on connection:
 *   needed  every leg contract of every strike position (at the current ATM),
 *           plus the ATM reference (spot, or the future on MCX);
 *   buffer  the same option legs `buffer` strikes further out on each side, so
 *           when ATM moves the next strike is already streaming and warmed up.
 * Kite allows 3 sockets × 3000 contracts per API key: connections whose needed
 * contracts don't fit are left "uncovered" (the cron scanner handles them) and
 * buffers are dropped before any needed contract.
 */
import type { StrategyDefinition, V2Connection, V2Instrument, V2Product, V2Strategy } from '@/shared/v2';
import { TIMEFRAME } from '@/shared/v2';
import type { NativeInterval } from '../data/DataProvider';
import { seriesOf } from '../engine/series';
import { atmReference, resolveUnits } from '../universe/resolve';

export const KITE_SOCKETS = 3;
export const KITE_TOKENS_PER_SOCKET = 3000;
export const LIVE_CAPACITY = KITE_SOCKETS * KITE_TOKENS_PER_SOCKET;
/** Strikes streamed beyond those in use, on each side. */
export const BUFFER_STRIKES = 2;

export interface PlanConnection {
  connection: V2Connection;
  strategy: V2Strategy;
  product: V2Product;
  /** All of the product's live contracts. */
  instruments: V2Instrument[];
}

export interface PlannedInstrument {
  instrument: V2Instrument;
  /** Native candle intervals the conditions read on it (empty for a pure ATM reference). */
  intervals: Set<NativeInterval>;
  needed: boolean;
}

export interface SubscriptionPlan {
  instruments: Map<number, PlannedInstrument>;
  /** ATM reference per connection (option strategies). */
  references: Map<string, V2Instrument>;
  covered: string[];
  uncovered: string[];
  /** Contracts that didn't fit (needed ones of uncovered connections + dropped buffer strikes). */
  overCapacity: number;
  /** Connections waiting for a first price to place their option legs. */
  waitingForPrice: string[];
  needed: number;
  buffer: number;
}

function legIntervals(d: StrategyDefinition): Map<string, Set<NativeInterval>> {
  const out = new Map<string, Set<NativeInterval>>();
  for (const s of seriesOf(d)) {
    const set = out.get(s.leg) ?? new Set<NativeInterval>();
    set.add(TIMEFRAME[s.timeframe].native);
    out.set(s.leg, set);
  }
  return out;
}

export function planSubscriptions(
  list: PlanConnection[],
  price: (token: number) => number | undefined,
  today: string,
  opts: { buffer?: number; capacity?: number } = {},
): SubscriptionPlan {
  const buffer = opts.buffer ?? BUFFER_STRIKES;
  const capacity = opts.capacity ?? LIVE_CAPACITY;
  const instruments = new Map<number, PlannedInstrument>();
  const references = new Map<string, V2Instrument>();
  const covered: string[] = [];
  const uncovered: string[] = [];
  const waitingForPrice: string[] = [];
  const buffers: Array<{ instrument: V2Instrument; intervals: Set<NativeInterval> }> = [];
  let dropped = 0;

  const add = (target: Map<number, PlannedInstrument>, i: V2Instrument, intervals: Iterable<NativeInterval>, needed: boolean) => {
    const cur = target.get(i.token) ?? { instrument: i, intervals: new Set<NativeInterval>(), needed };
    for (const x of intervals) cur.intervals.add(x);
    cur.needed ||= needed;
    target.set(i.token, cur);
  };

  for (const pc of list) {
    const d = pc.strategy.definition;
    const byLeg = legIntervals(d);
    const ref = atmReference(d, pc.instruments, pc.connection.config, today);
    const px = ref ? price(ref.token) : undefined;
    const mine = new Map<number, PlannedInstrument>();
    if (ref) {
      references.set(pc.connection.id, ref);
      add(mine, ref, [], true);
    }
    const res = resolveUnits(d, pc.product.id, pc.instruments, pc.connection.config, px, today);
    for (const u of res.units) for (const l of d.legs) if (u.legs[l.id]) add(mine, u.legs[l.id]!, byLeg.get(l.id) ?? [], true);
    if (ref && px === undefined) waitingForPrice.push(pc.connection.id);

    const fresh = [...mine.values()].filter((p) => !instruments.get(p.instrument.token)?.needed).length;
    if (countNeeded(instruments) + fresh > capacity) {
      uncovered.push(pc.connection.id);
      dropped += fresh;
      continue;
    }
    for (const p of mine.values()) add(instruments, p.instrument, p.intervals, true);
    covered.push(pc.connection.id);

    // Buffer strikes: the same legs at strike positions just beyond those in use.
    if (ref && px !== undefined && buffer > 0 && d.legs.some((l) => l.kind === 'CE' || l.kind === 'PE')) {
      const shifts = pc.connection.config.strikeShifts;
      const lo = Math.min(...shifts) - buffer;
      const hi = Math.max(...shifts) + buffer;
      const wide = resolveUnits(d, pc.product.id, pc.instruments, { ...pc.connection.config, strikeShifts: Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) }, px, today);
      for (const u of wide.units) {
        for (const l of d.legs) {
          const i = u.legs[l.id];
          if (i && (l.kind === 'CE' || l.kind === 'PE') && !mine.has(i.token)) buffers.push({ instrument: i, intervals: byLeg.get(l.id) ?? new Set() });
        }
      }
    }
  }

  for (const b of buffers) {
    if (instruments.has(b.instrument.token)) {
      add(instruments, b.instrument, b.intervals, false);
      continue;
    }
    if (instruments.size >= capacity) {
      dropped++;
      continue;
    }
    add(instruments, b.instrument, b.intervals, false);
  }
  const needed = countNeeded(instruments);
  return { instruments, references, covered, uncovered, waitingForPrice, needed, buffer: instruments.size - needed, overCapacity: dropped };
}

function countNeeded(m: Map<number, PlannedInstrument>): number {
  let n = 0;
  for (const p of m.values()) if (p.needed) n++;
  return n;
}
