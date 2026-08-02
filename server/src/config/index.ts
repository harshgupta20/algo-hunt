import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Load .env from the server working dir or the repo root, whichever exists.
loadEnv({ path: ['.env', '../.env'] });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MARKET_PROVIDER: z.enum(['mock', 'kite']).default('mock'),
  MOCK_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(1000),

  DATABASE_URL: z.string().optional(),

  KITE_API_KEY: z.string().optional(),
  KITE_API_SECRET: z.string().optional(),
  KITE_ACCESS_TOKEN: z.string().optional(),

  RSI_PERIOD: z.coerce.number().int().positive().default(14),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast with a readable message rather than surfacing a raw ZodError.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  clientOrigin: env.CLIENT_ORIGIN,
  logLevel: env.LOG_LEVEL,
  marketProvider: env.MARKET_PROVIDER,
  mockTickIntervalMs: env.MOCK_TICK_INTERVAL_MS,
  databaseUrl: env.DATABASE_URL,
  hasDatabase: Boolean(env.DATABASE_URL),
  kite: {
    apiKey: env.KITE_API_KEY,
    apiSecret: env.KITE_API_SECRET,
    accessToken: env.KITE_ACCESS_TOKEN,
    /** Enough to run the login flow (token is obtained via login). */
    canLogin: Boolean(env.KITE_API_KEY && env.KITE_API_SECRET),
    isConfigured: Boolean(env.KITE_API_KEY && env.KITE_ACCESS_TOKEN),
  },
  rsiPeriod: env.RSI_PERIOD,
} as const;

export type AppConfig = typeof config;
