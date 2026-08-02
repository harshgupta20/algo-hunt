/**
 * Deterministic price-close generators used by the "Simulate Trigger" feature.
 * They produce close sequences whose RSI ends on a specific transition, so the
 * REAL RSI + strategy engine can be exercised on demand (e.g. for demos and the
 * worker integration test) rather than faking an alert.
 */
import type { RsiSyncParams } from '@ash/shared';
import { computeRsiSeries } from '../indicator/rsi.js';

/** Alternating +1/-1 warmup that settles RSI toward ~50. */
function settle(start: number, period: number): number[] {
  const closes = [start];
  let p = start;
  for (let i = 0; i < period * 2; i++) {
    p += i % 2 === 0 ? 1 : -1;
    closes.push(p);
  }
  return closes;
}

/** Closes ending exactly on an RSI crossing above `level`. */
export function crossAboveSeries(level: number, period: number): number[] {
  const closes = settle(100, period);
  let p = closes[closes.length - 1]!;
  for (let i = 0; i < 40; i++) {
    p += 2; // consecutive gains push RSI up
    closes.push(p);
    const rsi = computeRsiSeries(closes, period);
    const curr = rsi[rsi.length - 1];
    const prev = rsi[rsi.length - 2];
    if (prev !== undefined && curr !== undefined && prev < level && curr >= level) {
      return closes;
    }
  }
  return closes;
}

/** Closes ending exactly on an RSI crossing below `level`. */
export function crossBelowSeries(level: number, period: number): number[] {
  const closes = settle(100, period);
  let p = closes[closes.length - 1]!;
  for (let i = 0; i < 40; i++) {
    p -= 2; // consecutive losses push RSI down
    closes.push(p);
    const rsi = computeRsiSeries(closes, period);
    const curr = rsi[rsi.length - 1];
    const prev = rsi[rsi.length - 2];
    if (prev !== undefined && curr !== undefined && prev > level && curr <= level) {
      return closes;
    }
  }
  return closes;
}

/** Strictly rising closes whose RSI is already pinned above `level` (=> 100). */
export function alreadyAboveSeries(_level: number, period: number): number[] {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < period + 4; i++) {
    p += 1;
    closes.push(p);
  }
  return closes;
}

export interface ScenarioSeries {
  future: number[];
  call: number[];
  put: number[];
}

/**
 * Build the three close series that make the RSI-sync strategy fire the given
 * scenario: both scenarios need Call crossing up and Put crossing down; Scenario
 * 1 needs the Future crossing up, Scenario 2 needs it already above.
 */
export function buildScenarioSeries(scenario: 1 | 2, params: RsiSyncParams): ScenarioSeries {
  return {
    future:
      scenario === 1
        ? crossAboveSeries(params.futureLevel, params.rsiPeriod)
        : alreadyAboveSeries(params.futureLevel, params.rsiPeriod),
    call: crossAboveSeries(params.callLevel, params.rsiPeriod),
    put: crossBelowSeries(params.putLevel, params.rsiPeriod),
  };
}
