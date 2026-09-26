/**
 * zod schemas for MCX V2 payloads (shape only). Semantic rules — units,
 * history, destinations, universe size — live in validate.ts.
 */
import { z } from 'zod';
import type { ExprNode, McxStrategyDefinition } from './types';

const timeframe = z.enum(['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '1d', '1w']);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');
const sourceField = z.enum(['open', 'high', 'low', 'close', 'volume', 'oi']);

const expirySelector = z.union([
  z.object({ mode: z.enum(['CURRENT', 'NEXT', 'FAR', 'ALL']) }),
  z.object({ mode: z.literal('SPECIFIC'), date: isoDate }),
]);

const strikeSelector = z.union([
  z.object({ mode: z.literal('ATM_OFFSETS'), offsets: z.array(z.number().int().min(-50).max(50)).min(1).max(101) }),
  z.object({ mode: z.literal('SPECIFIC'), strikes: z.array(z.number().positive()).min(1).max(200) }),
  z.object({ mode: z.literal('RANGE'), from: z.number().nonnegative(), to: z.number().nonnegative() }),
  z.object({ mode: z.literal('ALL') }),
]);

export const mcxUniverseSchema = z.object({
  underlying: z.string().min(1),
  target: z.union([
    z.object({ kind: z.literal('FUTURE'), expiry: expirySelector }),
    z.object({ kind: z.literal('OPTION'), expiry: expirySelector, strikes: strikeSelector }),
  ]),
});

const candleSpec = z.union([
  z.object({ type: z.literal('NORMAL') }),
  z.object({ type: z.literal('HEIKIN_ASHI') }),
  z.object({ type: z.literal('VOLUME'), volumePerCandle: z.number().positive() }),
]);

const series = z.object({ leg: z.enum(['FUT', 'CE', 'PE']), timeframe, candle: candleSpec });

const operand = z.union([
  z.object({ kind: z.literal('CONSTANT'), value: z.number().finite() }),
  z.object({ kind: z.literal('FIELD'), series, field: sourceField }),
  z.object({ kind: z.literal('OI_CHANGE'), series, lookback: z.number().int().min(1).max(500) }),
  z.object({
    kind: z.literal('INDICATOR'),
    series,
    indicator: z.string().min(1),
    params: z.record(z.string(), z.number().finite()),
    source: sourceField.optional(),
    output: z.string().optional(),
    multiplier: z.number().finite().positive().optional(),
  }),
]);

const operator = z.enum(['GT', 'LT', 'GTE', 'LTE', 'EQ', 'CROSSED_ABOVE', 'CROSSED_BELOW']);
const patternId = z.enum([
  'DOJI', 'HAMMER', 'INVERTED_HAMMER', 'SHOOTING_STAR', 'HANGING_MAN', 'BULLISH_ENGULFING', 'BEARISH_ENGULFING',
  'MORNING_STAR', 'EVENING_STAR', 'BULLISH_HARAMI', 'BEARISH_HARAMI', 'PIERCING', 'DARK_CLOUD_COVER',
  'THREE_WHITE_SOLDIERS', 'THREE_BLACK_CROWS', 'BULLISH_MARUBOZU', 'BEARISH_MARUBOZU', 'ANY_BULLISH', 'ANY_BEARISH',
]);

const exprNode: z.ZodType<ExprNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.enum(['AND', 'OR']), id: z.string().min(1), label: z.string().optional(), children: z.array(exprNode) }),
    z.object({ type: z.literal('NOT'), id: z.string().min(1), child: exprNode }),
    z.object({ type: z.literal('CONDITION'), id: z.string().min(1), left: operand, operator, right: operand }),
    z.object({ type: z.literal('PATTERN'), id: z.string().min(1), series, pattern: patternId }),
  ]),
) as z.ZodType<ExprNode>;

export const mcxStrategyDefinitionSchema: z.ZodType<McxStrategyDefinition> = z.object({
  schemaVersion: z.literal(2),
  market: z.literal('MCX'),
  name: z.string().trim().min(1, 'name is required').max(120),
  description: z.string().max(500).optional(),
  universe: mcxUniverseSchema,
  evaluation: z.object({ mode: z.enum(['COMPLETED_CANDLE', 'LIVE_CANDLE']), triggerTimeframe: timeframe }),
  expression: exprNode,
  alert: z.object({
    channels: z.object({ telegram: z.boolean(), email: z.boolean() }),
    trigger: z.enum(['ON_TRANSITION', 'WHILE_TRUE']),
    cooldownMinutes: z.number().int().min(1).max(7 * 24 * 60).nullable(),
    oncePerCandle: z.boolean(),
  }),
}) as z.ZodType<McxStrategyDefinition>;

export const mcxSettingsSchema = z.object({
  telegramChatId: z.string().trim().max(64).optional(),
  emailRecipients: z.array(z.string().email()).max(20),
  emailFrom: z.string().trim().min(3).max(200),
  universeCap: z.number().int().min(1).max(200),
  requestBudget: z.number().int().min(10).max(600),
});

export const mcxCalendarSchema = z.array(
  z.union([
    z.object({ date: isoDate, kind: z.literal('HOLIDAY'), note: z.string().max(200).optional() }),
    z.object({
      date: isoDate,
      kind: z.literal('SPECIAL_SESSION'),
      openMin: z.number().int().min(0).max(1439),
      closeMin: z.number().int().min(1).max(1440),
      note: z.string().max(200).optional(),
    }),
  ]),
);
