/**
 * The trader's settings, entered in the setup wizard: kept in the app's data folder (settings.json), the whole
 * file encrypted with Windows' own protection for this user (Electron safeStorage → DPAPI) — never in the install
 * folder, never in plain text where Windows can encrypt.
 */
import { safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface DesktopConfig {
  databaseUrl: string;
  kiteApiKey: string;
  kiteApiSecret: string;
  appPassword: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  resendApiKey?: string;
  /** Protects the scheduler endpoint; generated, never shown. */
  cronSecret: string;
  /** When the risk disclaimer was accepted. */
  acceptedTermsAt: string;
}

interface Stored {
  version: 1;
  encrypted: boolean;
  data: string;
}

export function configFile(dir: string): string {
  return path.join(dir, 'settings.json');
}

export function loadConfig(dir: string): DesktopConfig | null {
  const file = configFile(dir);
  if (!existsSync(file)) return null;
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Stored;
    const json = stored.encrypted ? safeStorage.decryptString(Buffer.from(stored.data, 'base64')) : Buffer.from(stored.data, 'base64').toString('utf8');
    const c = JSON.parse(json) as DesktopConfig;
    return c.databaseUrl && c.kiteApiKey && c.kiteApiSecret && c.appPassword ? c : null;
  } catch {
    return null; // unreadable (e.g. copied from another Windows user) — the wizard runs again
  }
}

export function saveConfig(dir: string, c: Omit<DesktopConfig, 'cronSecret'> & { cronSecret?: string }): DesktopConfig {
  const full: DesktopConfig = { ...c, cronSecret: c.cronSecret || randomBytes(24).toString('hex') };
  const json = JSON.stringify(full);
  const encrypted = safeStorage.isEncryptionAvailable();
  const stored: Stored = { version: 1, encrypted, data: (encrypted ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')).toString('base64') };
  mkdirSync(dir, { recursive: true });
  const file = configFile(dir);
  writeFileSync(`${file}.tmp`, JSON.stringify(stored));
  renameSync(`${file}.tmp`, file);
  return full;
}

/**
 * The environment the app's commands run with: the computer's own (PATH with Git and Node.js …) plus these settings —
 * what the .bat's .env file held. No .env file is written.
 */
export function appEnv(c: DesktopConfig, dataDir: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: c.databaseUrl,
    KITE_API_KEY: c.kiteApiKey,
    KITE_API_SECRET: c.kiteApiSecret,
    APP_PASSWORD: c.appPassword,
    CRON_SECRET: c.cronSecret,
    // Outside the code folder, which is replaced when a fresh copy is downloaded.
    PENDING_WRITES_FILE: path.join(dataDir, 'pending-writes.json'),
  };
  if (c.telegramBotToken) env.TELEGRAM_BOT_TOKEN = c.telegramBotToken;
  if (c.telegramChatId) env.TELEGRAM_CHAT_ID = c.telegramChatId;
  if (c.resendApiKey) env.RESEND_API_KEY = c.resendApiKey;
  delete env.NODE_ENV; // npm install would skip the packages the build needs
  return env;
}
