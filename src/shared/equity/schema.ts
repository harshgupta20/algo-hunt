/** zod schemas for equity payloads (shape only — meaning is checked by validate.ts). */
import { z } from 'zod';
import type { EqBacktestRequest, EqGroup, EqNode, EqScreenRequest, EqStrategyDefinition } from './types';

const timeframe = z.enum(['1d', '1w']);
const priceField = z.enum(['open', 'high', 'low', 'close', 'volume']);
const maType = z.enum(['SMA', 'EMA', 'WMA']);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');
const barsAgo = z.number().int().min(0).max(500).optional();

const operand = z.union([
  z.object({ kind: z.literal('PRICE'), field: priceField, barsAgo }),
  z.object({
    kind: z.literal('INDICATOR'),
    indicator: z.enum(['SMA', 'EMA', 'WMA', 'RSI', 'MACD', 'BB', 'ATR', 'SUPERTREND', 'ADX', 'DMI', 'HIGHEST', 'LOWEST', 'ROC']),
    params: z.record(z.string(), z.number().finite()),
    source: priceField.optional(),
    output: z.string().optional(),
    ma: z.object({ type: maType, period: z.number().int().min(1).max(500) }).optional(),
    multiplier: z.number().finite().positive().optional(),
    barsAgo,
  }),
  z.object({ kind: z.literal('NUMBER'), value: z.number().finite() }),
]);

const condition = z.object({
  type: z.literal('CONDITION'),
  id: z.string().min(1),
  left: operand,
  op: z.enum(['CROSSES_ABOVE', 'CROSSES_BELOW', 'GT', 'GTE', 'LT', 'LTE']),
  right: operand,
});

export const eqGroupSchema: z.ZodType<EqGroup> = z.lazy(() =>
  z.object({
    type: z.enum(['AND', 'OR']),
    id: z.string().min(1),
    label: z.string().max(80).optional(),
    children: z.array(z.union([condition, eqGroupSchema]) as z.ZodType<EqNode>).max(40),
  }),
);

const pct = (max: number) => z.number().positive().max(max).nullable();

export const eqDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  timeframe,
  entry: z.object({ when: eqGroupSchema, trigger: z.enum(['WHEN_TRUE', 'BECOMES_TRUE']) }),
  exit: z.object({
    targetPct: pct(1000),
    stopLossPct: pct(99),
    trailingStopPct: pct(99),
    priceBase: z.enum(['AVERAGE', 'FIRST_BUY']),
    when: eqGroupSchema.nullable(),
    maxBars: z.number().int().min(1).max(5000).nullable(),
  }),
  pyramid: z.object({ enabled: z.boolean(), maType, maPeriod: z.number().int().min(2).max(500), maxAdds: z.number().int().min(1).max(100).nullable() }),
  sizing: z.object({ mode: z.enum(['AMOUNT', 'QUANTITY', 'PERCENT']), value: z.number().positive().max(1e10) }),
}) as z.ZodType<EqStrategyDefinition>;

export const eqWatchlistInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  symbols: z.array(z.string().trim().min(1).max(40)).max(5000),
});

const symbols = z.array(z.string().trim().min(1).max(40)).min(1).max(5000);

export const eqBacktestRequestSchema = z
  .object({
    strategyId: z.string().min(1).optional(),
    definition: eqDefinitionSchema.optional(),
    symbols,
    from: isoDate,
    to: isoDate,
    capital: z.number().min(1_000).max(1e11).nullable(),
    maxPositions: z.number().int().min(1).max(5000).nullable(),
    stocksLabel: z.string().trim().max(120).optional(),
    source: z
      .union([
        z.object({ kind: z.literal('PRESET'), preset: z.enum(['NIFTY50', 'NIFTYNEXT50', 'NIFTY100', 'MIDCAP150', 'SMALLCAP250', 'NIFTY500', 'FNO', 'ALL', 'IDX_FNO', 'IDX_BROAD', 'IDX_SECTOR', 'IDX_THEME', 'IDX_STRATEGY', 'IDX_OTHER', 'IDX_BSE', 'IDX_ALL']) }),
        z.object({ kind: z.literal('WATCHLIST'), id: z.string().min(1).max(64) }),
        z.object({ kind: z.literal('PICK'), symbols }),
      ])
      .optional(),
  })
  .refine((r) => r.strategyId || r.definition, 'strategyId or definition is required') as z.ZodType<EqBacktestRequest>;

export const eqScreenRequestSchema = z
  .object({ strategyId: z.string().min(1).optional(), definition: eqDefinitionSchema.optional(), symbols })
  .refine((r) => r.strategyId || r.definition, 'strategyId or definition is required') as z.ZodType<EqScreenRequest>;
