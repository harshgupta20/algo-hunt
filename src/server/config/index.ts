/**
 * Environment configuration (zod-validated). Resolved lazily on first use so
 * `next build` never needs production secrets; missing required values fail
 * with a readable message at request time instead.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  DATABASE_URL: z.string().optional(),

  KITE_API_KEY: z.string().optional(),
  KITE_API_SECRET: z.string().optional(),

  /** Password protecting the dashboard + API (required in production). */
  APP_PASSWORD: z.string().optional(),
  /** Shared secret for the scheduler calling /api/cron/* (required in production). */
  CRON_SECRET: z.string().optional(),

  /** Optional Telegram delivery so alerts reach you with the dashboard closed. */
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  /** Optional email delivery for MCX V2 alerts (Resend API key). */
  RESEND_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function load() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    isProd: env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    kite: {
      apiKey: env.KITE_API_KEY,
      apiSecret: env.KITE_API_SECRET,
      isConfigured: Boolean(env.KITE_API_KEY && env.KITE_API_SECRET),
    },
    appPassword: env.APP_PASSWORD,
    cronSecret: env.CRON_SECRET,
    telegram:
      env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
        ? { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }
        : undefined,
    // MCX V2 reads these separately: its chat id can come from MCX settings instead of the env.
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
    resendApiKey: env.RESEND_API_KEY,
  } as const;
}

export type AppConfig = ReturnType<typeof load>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= load();
  return cached;
}

/** Kite credentials, or a clear error explaining which env vars to set. */
export function requireKiteCredentials(): { apiKey: string; apiSecret: string } {
  const { kite } = getConfig();
  if (!kite.apiKey || !kite.apiSecret) {
    throw new Error('Zerodha Kite is not configured: set KITE_API_KEY and KITE_API_SECRET.');
  }
  return { apiKey: kite.apiKey, apiSecret: kite.apiSecret };
}
