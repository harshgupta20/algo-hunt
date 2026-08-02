/**
 * Minimal .env upsert so the Kite access token (regenerated daily) persists
 * across restarts without a database. Writes to the .env that holds
 * KITE_API_KEY, falling back to the repo-root .env.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function resolveEnvPath(): string {
  const candidates = [path.resolve('.env'), path.resolve('..', '.env')];
  const withKey = candidates.find((p) => existsSync(p) && readFileSync(p, 'utf8').includes('KITE_API_KEY'));
  return withKey ?? candidates.find((p) => existsSync(p)) ?? candidates[1]!;
}

export function upsertEnv(key: string, value: string, file = resolveEnvPath()): void {
  const line = `${key}=${value}`;
  let content = existsSync(file) ? readFileSync(file, 'utf8') : '';
  // Replace an existing (possibly commented) definition, else append.
  const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
  content = re.test(content) ? content.replace(re, line) : `${content.replace(/\n?$/, '\n')}${line}\n`;
  writeFileSync(file, content);
}
