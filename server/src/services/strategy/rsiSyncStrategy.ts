/**
 * RSI-synchronized strategy.
 *
 * Fires ONE combined match when the Future/Call/Put RSIs align on the same
 * closed candle:
 *
 *   Scenario 1  Future RSI crossing above  futureLevel (60)
 *               AND Call  RSI crossing above  callLevel  (60)
 *               AND Put   RSI crossing below  putLevel   (40)
 *
 *   Scenario 2  Future RSI ALREADY above    futureLevel (60)
 *               AND Call  RSI crossing above  callLevel  (60)
 *               AND Put   RSI crossing below  putLevel   (40)
 *
 * The Future condition differs (cross vs already) and the two are mutually
 * exclusive — "crossing above" requires prev < level while "already above"
 * requires prev >= level — so at most one scenario matches per candle. The
 * result is a single strategy alert, never three per-instrument alerts.
 */
import type { Strategy, StrategyContext, StrategyDefinition, StrategyMatch } from '@ash/shared';
import { DEFAULT_RSI_SYNC_PARAMS } from '@ash/shared';
import { readingAlreadyAbove, readingCrossAbove, readingCrossBelow } from './crossing.js';

const definition: StrategyDefinition = {
  key: 'rsi-sync',
  name: 'RSI Synchronized (Future / Call / Put)',
  description:
    'Detects synchronized RSI alignment across the Future, ATM Call and ATM Put on the same ' +
    'closed candle. Distinguishes an RSI crossing from an RSI that is already beyond its level.',
  scenarios: [
    {
      id: 1,
      title: 'All three crossing',
      description:
        'Future RSI crossing above 60 AND Call RSI crossing above 60 AND Put RSI crossing below 40.',
    },
    {
      id: 2,
      title: 'Future already above',
      description:
        'Future RSI already above 60 AND Call RSI crossing above 60 AND Put RSI crossing below 40.',
    },
  ],
  defaultParams: DEFAULT_RSI_SYNC_PARAMS,
};

export class RsiSyncStrategy implements Strategy {
  readonly definition = definition;

  evaluate(ctx: StrategyContext): StrategyMatch | null {
    const { readings, params, bucket } = ctx;
    const { future, call, put } = readings;

    // The Call and Put crossings are common to both scenarios.
    const callCross = readingCrossAbove(call, params.callLevel);
    const putCross = readingCrossBelow(put, params.putLevel);
    if (!callCross || !putCross) return null;

    const futureCross = readingCrossAbove(future, params.futureLevel);
    const futureAlready = readingAlreadyAbove(future, params.futureLevel);

    if (futureCross) {
      return this.match(1, ctx, bucket);
    }
    if (futureAlready) {
      return this.match(2, ctx, bucket);
    }
    return null;
  }

  private match(scenario: 1 | 2, ctx: StrategyContext, bucket: number): StrategyMatch {
    const { future, call, put } = ctx.readings;
    const reason =
      scenario === 1
        ? `Future crossed >${ctx.params.futureLevel}, Call crossed >${ctx.params.callLevel}, Put crossed <${ctx.params.putLevel}`
        : `Future already >${ctx.params.futureLevel}, Call crossed >${ctx.params.callLevel}, Put crossed <${ctx.params.putLevel}`;
    return {
      strategy: 'rsi-sync',
      scenario,
      bucket,
      reason,
      readings: { future, call, put },
    };
  }
}
