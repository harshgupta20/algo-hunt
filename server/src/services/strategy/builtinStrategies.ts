/**
 * The built-in RSI Multi Confirmation strategy expressed as builder JSON. This
 * is the same logic as the class-based RsiSyncStrategy, but interpreted by the
 * generic engine — used to prove equivalence and seeded into the library as a
 * read-only reference users can duplicate.
 */
import type { Condition, IndicatorRef, Operator, StrategyDef } from '@ash/shared';
import { DEFAULT_RSI_SYNC_PARAMS, type RsiSyncParams } from '@ash/shared';

export const BUILTIN_RSI_SYNC_ID = 'builtin-rsi-sync';

export function rsiSyncStrategyDef(params: RsiSyncParams = DEFAULT_RSI_SYNC_PARAMS, now = new Date().toISOString()): StrategyDef {
  const rsi: IndicatorRef = { kind: 'RSI', params: { period: params.rsiPeriod } };
  const cond = (id: string, instrument: Condition['instrument'], operator: Operator, value: number): Condition => ({
    type: 'condition',
    id,
    instrument,
    indicator: rsi,
    operator,
    value,
  });

  return {
    id: BUILTIN_RSI_SYNC_ID,
    name: 'RSI Multi Confirmation',
    description: 'Synchronized RSI across Future, ATM Call and ATM Put — the platform reference strategy.',
    category: 'Momentum',
    status: 'active',
    version: 1,
    builtin: true,
    scope: 'options',
    underlying: 'NIFTY',
    expiryType: 'current-weekly',
    strikeSelection: 'ATM',
    timeframe: '15m',
    root: {
      type: 'group',
      id: 'root',
      logic: 'OR',
      children: [
        {
          type: 'group',
          id: 's1',
          logic: 'AND',
          label: 'Scenario 1',
          children: [
            cond('s1-f', 'future', 'crossAbove', params.futureLevel),
            cond('s1-c', 'call', 'crossAbove', params.callLevel),
            cond('s1-p', 'put', 'crossBelow', params.putLevel),
          ],
        },
        {
          type: 'group',
          id: 's2',
          logic: 'AND',
          label: 'Scenario 2',
          children: [
            cond('s2-f', 'future', 'above', params.futureLevel),
            cond('s2-c', 'call', 'crossAbove', params.callLevel),
            cond('s2-p', 'put', 'crossBelow', params.putLevel),
          ],
        },
      ],
    },
    createdAt: now,
    updatedAt: now,
  };
}
