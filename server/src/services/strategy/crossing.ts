/**
 * RSI level-interaction primitives.
 *
 * The platform must distinguish a *crossing* (RSI just moved across a level)
 * from *already above/below* (RSI was already on that side). Any transition
 * across the boundary counts — a 0.01 move (59.99 -> 60.01) is a valid cross.
 *
 * `prev === undefined` means we only have one RSI reading (warmup), so no
 * transition can be asserted and every predicate returns false.
 * `prev === level` exactly is treated as "already", not a cross.
 */
import type { RsiReading } from '@ash/shared';

/** RSI moved from strictly below `level` to at-or-above it. */
export function crossAbove(prev: number | undefined, curr: number, level: number): boolean {
  return prev !== undefined && prev < level && curr >= level;
}

/** RSI moved from strictly above `level` to at-or-below it. */
export function crossBelow(prev: number | undefined, curr: number, level: number): boolean {
  return prev !== undefined && prev > level && curr <= level;
}

/** RSI was at-or-above `level` on the previous candle and still is. */
export function alreadyAbove(prev: number | undefined, curr: number, level: number): boolean {
  return prev !== undefined && prev >= level && curr >= level;
}

/** RSI was at-or-below `level` on the previous candle and still is. */
export function alreadyBelow(prev: number | undefined, curr: number, level: number): boolean {
  return prev !== undefined && prev <= level && curr <= level;
}

// Reading-based convenience wrappers ---------------------------------------

export const readingCrossAbove = (r: RsiReading, level: number): boolean =>
  crossAbove(r.prev, r.curr, level);

export const readingCrossBelow = (r: RsiReading, level: number): boolean =>
  crossBelow(r.prev, r.curr, level);

export const readingAlreadyAbove = (r: RsiReading, level: number): boolean =>
  alreadyAbove(r.prev, r.curr, level);
