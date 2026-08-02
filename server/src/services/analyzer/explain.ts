/**
 * Builds the per-leg "why it fired" explanation for a match. Reuses the exact
 * crossing predicates the strategy uses — no threshold logic is duplicated.
 */
import type { LegExplanation, LegReadings, RsiSyncParams } from '@ash/shared';
import { alreadyAbove, crossAbove, crossBelow } from '../strategy/crossing.js';

const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(2));

function line(label: string, prev: number | undefined, curr: number, level: number, condition: LegExplanation['condition']): LegExplanation {
  const phrase =
    condition === 'crossed-above'
      ? `crossed above ${level}`
      : condition === 'crossed-below'
        ? `crossed below ${level}`
        : condition === 'already-above'
          ? `already above ${level}`
          : `no interaction with ${level}`;
  return { leg: label === 'Future RSI' ? 'future' : label === 'Call RSI' ? 'call' : 'put', label, prev, curr, level, condition, text: `${fmt(prev)} → ${fmt(curr)} · ${phrase}` };
}

export function explainMatch(readings: LegReadings, params: RsiSyncParams): LegExplanation[] {
  const { future, call, put } = readings;

  const futureCondition = crossAbove(future.prev, future.curr, params.futureLevel)
    ? 'crossed-above'
    : alreadyAbove(future.prev, future.curr, params.futureLevel)
      ? 'already-above'
      : 'none';

  const callCondition = crossAbove(call.prev, call.curr, params.callLevel) ? 'crossed-above' : 'none';
  const putCondition = crossBelow(put.prev, put.curr, params.putLevel) ? 'crossed-below' : 'none';

  return [
    line('Future RSI', future.prev, future.curr, params.futureLevel, futureCondition),
    line('Call RSI', call.prev, call.curr, params.callLevel, callCondition),
    line('Put RSI', put.prev, put.curr, params.putLevel, putCondition),
  ];
}
