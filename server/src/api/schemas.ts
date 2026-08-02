/**
 * Zod schemas for request validation. Kept next to the API so controllers can
 * parse-and-throw with a single call.
 */
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler.js';

export const timeframeSchema = z.enum(['5m', '15m', '30m', '1h']);
export const strikeSelectionSchema = z.enum(['ATM', 'ATM+1', 'ATM-1', 'ATM+2', 'ATM-2', 'CUSTOM']);
export const expiryTypeSchema = z.enum(['current-weekly', 'next-weekly', 'monthly']);

export const rsiParamsSchema = z
  .object({
    rsiPeriod: z.number().int().positive(),
    futureLevel: z.number(),
    callLevel: z.number(),
    putLevel: z.number(),
  })
  .partial();

export const configInputSchema = z.object({
  underlying: z.string().min(1),
  expiryType: expiryTypeSchema,
  strikeSelection: strikeSelectionSchema,
  customStrike: z.number().optional(),
  timeframe: timeframeSchema,
  strategy: z.string().min(1),
  params: rsiParamsSchema.optional(),
});

export const configUpdateSchema = configInputSchema.partial();

export const simulateSchema = z.object({
  configId: z.string().min(1),
  scenario: z.union([z.literal(1), z.literal(2)]),
});

export const preferencesSchema = z.object({
  theme: z.enum(['dark', 'light']),
  soundEnabled: z.boolean(),
  browserNotifications: z.boolean(),
});

export const dateRangePresetSchema = z.enum([
  'today',
  'yesterday',
  'last-week',
  'last-month',
  'last-3-months',
  'last-6-months',
  'last-year',
  'custom',
]);

export const analyzerParamsSchema = z.object({
  underlying: z.string().min(1),
  expiryType: expiryTypeSchema,
  strikeSelection: strikeSelectionSchema,
  customStrike: z.number().optional(),
  timeframe: timeframeSchema,
  strategy: z.string().min(1),
  preset: dateRangePresetSchema,
  from: z.string().optional(),
  to: z.string().optional(),
  params: rsiParamsSchema.optional(),
});

export const analyzerChartSchema = z.object({
  params: analyzerParamsSchema,
  center: z.number(),
  span: z.number().int().positive().optional(),
});

// ---- Strategy Builder ----

const indicatorKindSchema = z.enum(['RSI', 'EMA', 'SMA', 'VWAP', 'MACD', 'BBANDS', 'SUPERTREND', 'VOLUME', 'PRICE', 'OI']);
const instrumentSchema = z.enum(['future', 'call', 'put', 'spot', 'index', 'vix']);
const operatorSchema = z.enum([
  'gt', 'lt', 'gte', 'lte', 'eq', 'neq',
  'crossAbove', 'crossBelow',
  'rising', 'falling',
  'above', 'below',
  'between', 'outside',
  'increasedByPct', 'decreasedByPct',
]);

const indicatorRefSchema = z.object({
  kind: indicatorKindSchema,
  params: z.record(z.string(), z.number()).optional(),
  field: z.string().optional(),
});

const conditionSchema = z.object({
  type: z.literal('condition'),
  id: z.string(),
  instrument: instrumentSchema,
  indicator: indicatorRefSchema,
  operator: operatorSchema,
  value: z.number().optional(),
  value2: z.number().optional(),
  compareTo: indicatorRefSchema.optional(),
  compareInstrument: instrumentSchema.optional(),
  lookback: z.number().int().positive().optional(),
  timeframe: timeframeSchema.optional(),
});

// Recursive group schema.
type GroupShape = {
  type: 'group';
  id: string;
  logic: 'AND' | 'OR';
  label?: string;
  not?: boolean;
  children: Array<GroupShape | z.infer<typeof conditionSchema>>;
};
const groupSchema: z.ZodType<GroupShape> = z.lazy(() =>
  z.object({
    type: z.literal('group'),
    id: z.string(),
    logic: z.enum(['AND', 'OR']),
    label: z.string().optional(),
    not: z.boolean().optional(),
    children: z.array(z.union([groupSchema, conditionSchema])),
  }),
);

export const strategyDefInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
  scope: z.enum(['index-futures', 'stock-futures', 'options', 'spot']),
  underlying: z.string().min(1),
  expiryType: expiryTypeSchema,
  strikeSelection: strikeSelectionSchema,
  timeframe: timeframeSchema,
  root: groupSchema,
  status: z.enum(['draft', 'active', 'disabled']).optional(),
});

/** Parse `data` with `schema`, throwing a 400 HttpError on failure. */
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, msg);
  }
  return result.data;
}
