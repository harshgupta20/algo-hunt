/**
 * Ready-made equity strategies — the trader's three, written exactly as described, plus well-known setups.
 * Numbers the trader didn't give (target %, money per buy) are set to common values; change them in the builder.
 */
import type { EqCondition, EqGroup, EqNode, EqOperand, EqOperator, EqStrategyDefinition } from './types';

export const price = (field: 'open' | 'high' | 'low' | 'close' | 'volume' = 'close'): EqOperand => ({ kind: 'PRICE', field });
export const num = (value: number): EqOperand => ({ kind: 'NUMBER', value });
export const ind = (indicator: Extract<EqOperand, { kind: 'INDICATOR' }>['indicator'], params: Record<string, number>, extra: Partial<Extract<EqOperand, { kind: 'INDICATOR' }>> = {}): EqOperand => ({ kind: 'INDICATOR', indicator, params, ...extra });
export const cond = (id: string, left: EqOperand, op: EqOperator, right: EqOperand): EqCondition => ({ type: 'CONDITION', id, left, op, right });
export const all = (id: string, ...children: EqNode[]): EqGroup => ({ type: 'AND', id, children });
export const any = (id: string, ...children: EqNode[]): EqGroup => ({ type: 'OR', id, children });

/** A fresh strategy for the builder: one condition and sensible money per buy. */
export function defaultDefinition(): EqStrategyDefinition {
  return {
    name: '',
    timeframe: '1d',
    entry: { when: all('entry', cond('e1', ind('SMA', { period: 50 }), 'CROSSES_ABOVE', ind('SMA', { period: 100 }))), trigger: 'WHEN_TRUE' },
    exit: { targetPct: 20, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: null, maxBars: null },
    pyramid: { enabled: false, maType: 'SMA', maPeriod: 20, maxAdds: null },
    sizing: { mode: 'AMOUNT', value: 50_000 },
  };
}

const base = (patch: Partial<EqStrategyDefinition> & Pick<EqStrategyDefinition, 'name' | 'entry'>): EqStrategyDefinition => ({ ...defaultDefinition(), ...patch });

export interface EqTemplate {
  key: string;
  group: 'Trader' | 'Classic';
  label: string;
  description: string;
  definition: EqStrategyDefinition;
}

const RSI14 = ind('RSI', { period: 14 });
const RSI_MA9 = ind('RSI', { period: 14 }, { ma: { type: 'SMA', period: 9 } });

export const EQ_TEMPLATES: EqTemplate[] = [
  {
    key: 'sma-50-100',
    group: 'Trader',
    label: 'Strategy 1 · SMA 50 / 100 crossover',
    description: 'Buy when SMA 50 crosses above SMA 100. Sell at the target (20% — set yours) or when SMA 50 crosses back below SMA 100.',
    definition: base({
      name: 'SMA 50 / 100 crossover',
      entry: { when: all('entry', cond('e1', ind('SMA', { period: 50 }), 'CROSSES_ABOVE', ind('SMA', { period: 100 }))), trigger: 'WHEN_TRUE' },
      exit: { targetPct: 20, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: any('exit', cond('x1', ind('SMA', { period: 50 }), 'CROSSES_BELOW', ind('SMA', { period: 100 }))), maxBars: null },
    }),
  },
  {
    key: 'rsi-ma',
    group: 'Trader',
    label: 'Strategy 2 · RSI crosses its MA',
    description: 'Buy when RSI(14) crosses above its 9-period moving average (TradingView’s RSI-based MA). Sell at the target (10% — set yours) or when RSI crosses back below it.',
    definition: base({
      name: 'RSI(14) crosses its MA(9)',
      entry: { when: all('entry', cond('e1', RSI14, 'CROSSES_ABOVE', RSI_MA9)), trigger: 'WHEN_TRUE' },
      exit: { targetPct: 10, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: any('exit', cond('x1', RSI14, 'CROSSES_BELOW', RSI_MA9)), maxBars: null },
    }),
  },
  {
    key: 'weekly-ma20-rsi60-pyramid',
    group: 'Trader',
    label: 'Strategy 3 · Weekly MA 20 + RSI 60, pyramiding',
    description:
      'Weekly: buy when the close crosses above MA(20) and RSI(14) is above 60. Each time the rising MA(20) reaches the last buy price, buy one more lot and move the stop for all lots to the MA. Sell everything at the target (30% — set yours), the pyramiding stop, a weekly close below MA(20) or RSI below 60.',
    definition: base({
      name: 'Weekly MA 20 + RSI 60 with pyramiding',
      timeframe: '1w',
      entry: { when: all('entry', cond('e1', price('close'), 'CROSSES_ABOVE', ind('SMA', { period: 20 })), cond('e2', RSI14, 'GT', num(60))), trigger: 'WHEN_TRUE' },
      exit: {
        targetPct: 30,
        stopLossPct: null,
        trailingStopPct: null,
        priceBase: 'AVERAGE',
        when: any('exit', cond('x1', price('close'), 'CROSSES_BELOW', ind('SMA', { period: 20 })), cond('x2', RSI14, 'LT', num(60))),
        maxBars: null,
      },
      pyramid: { enabled: true, maType: 'SMA', maPeriod: 20, maxAdds: null },
    }),
  },
  {
    key: '52w-breakout',
    group: 'Classic',
    label: '52-week high breakout',
    description: 'Buy when the close breaks above the highest high of the previous 252 trading days. 8% stop-loss, 15% trailing stop.',
    definition: base({
      name: '52-week high breakout',
      entry: { when: all('entry', cond('e1', price('close'), 'CROSSES_ABOVE', ind('HIGHEST', { period: 252 }, { source: 'high' }))), trigger: 'WHEN_TRUE' },
      exit: { targetPct: null, stopLossPct: 8, trailingStopPct: 15, priceBase: 'FIRST_BUY', when: null, maxBars: null },
    }),
  },
  {
    key: 'golden-cross',
    group: 'Classic',
    label: 'Golden cross · EMA 50 / 200',
    description: 'Buy when EMA 50 crosses above EMA 200; sell on the death cross (EMA 50 back below EMA 200) or a 20% trailing stop.',
    definition: base({
      name: 'Golden cross EMA 50 / 200',
      entry: { when: all('entry', cond('e1', ind('EMA', { period: 50 }), 'CROSSES_ABOVE', ind('EMA', { period: 200 }))), trigger: 'WHEN_TRUE' },
      exit: { targetPct: null, stopLossPct: null, trailingStopPct: 20, priceBase: 'AVERAGE', when: any('exit', cond('x1', ind('EMA', { period: 50 }), 'CROSSES_BELOW', ind('EMA', { period: 200 }))), maxBars: null },
    }),
  },
  {
    key: 'supertrend',
    group: 'Classic',
    label: 'Supertrend trend-follow',
    description: 'Buy when Supertrend(10, 3) turns up; sell when it turns down.',
    definition: base({
      name: 'Supertrend 10 / 3',
      entry: { when: all('entry', cond('e1', ind('SUPERTREND', { period: 10, multiplier: 3 }, { output: 'direction' }), 'CROSSES_ABOVE', num(0))), trigger: 'WHEN_TRUE' },
      exit: { targetPct: null, stopLossPct: null, trailingStopPct: null, priceBase: 'AVERAGE', when: any('exit', cond('x1', ind('SUPERTREND', { period: 10, multiplier: 3 }, { output: 'direction' }), 'CROSSES_BELOW', num(0))), maxBars: null },
    }),
  },
  {
    key: 'uptrend-pullback',
    group: 'Classic',
    label: 'Pullback in an uptrend',
    description: 'Above SMA 200, buy when RSI(14) recovers above 40 after a dip. 8% target, 5% stop-loss, out after 20 days.',
    definition: base({
      name: 'Uptrend pullback (RSI 40)',
      entry: { when: all('entry', cond('e1', price('close'), 'GT', ind('SMA', { period: 200 })), cond('e2', RSI14, 'CROSSES_ABOVE', num(40))), trigger: 'WHEN_TRUE' },
      exit: { targetPct: 8, stopLossPct: 5, trailingStopPct: null, priceBase: 'AVERAGE', when: null, maxBars: 20 },
    }),
  },
  {
    key: 'volume-breakout',
    group: 'Classic',
    label: 'Volume breakout',
    description: 'Buy when the close breaks the 20-day high on at least twice the 20-day average volume. 10% stop-loss, 12% trailing stop.',
    definition: base({
      name: 'Volume breakout',
      entry: { when: all('entry', cond('e1', price('close'), 'CROSSES_ABOVE', ind('HIGHEST', { period: 20 }, { source: 'close' })), cond('e2', price('volume'), 'GT', ind('SMA', { period: 20 }, { source: 'volume', multiplier: 2 }))), trigger: 'WHEN_TRUE' },
      exit: { targetPct: null, stopLossPct: 10, trailingStopPct: 12, priceBase: 'FIRST_BUY', when: null, maxBars: null },
    }),
  },
];
