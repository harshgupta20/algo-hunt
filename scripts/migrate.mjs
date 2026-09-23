/**
 * Migration runner. Applies pending db/migrations/*.sql in order, each in a
 * transaction, tracking applied files in schema_migrations. Idempotent.
 *
 *   npm run db:migrate                         # fails if DATABASE_URL is missing
 *   node scripts/migrate.mjs --if-configured   # (used by `npm run build`) skips quietly
 *   ... --soft                                  # (used by `npm run dev`) warn instead of failing
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env/.env.local loader for local runs (Vercel injects env vars itself).
for (const file of ['.env.local', '.env']) {
  const p = path.join(root, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const ifConfigured = process.argv.includes('--if-configured');
const soft = process.argv.includes('--soft');
// pg treats sslmode=require as verify-full and prints a warning; state it explicitly (same behavior).
const url = process.env.DATABASE_URL?.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, '$1verify-full');

if (!url) {
  if (ifConfigured) {
    console.warn('[migrate] DATABASE_URL not set — skipping migrations.');
    process.exit(0);
  }
  console.error('[migrate] DATABASE_URL is not set.');
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new pg.Pool({ connectionString: url, ssl: isLocal ? undefined : { rejectUnauthorized: false }, max: 1 });

try {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const dir = path.join(root, 'db', 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
    if (applied.rowCount) {
      console.log(`[migrate] ↷ already applied: ${file}`);
      continue;
    }
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] ✓ applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }
  console.log('[migrate] migrations complete');
} catch (err) {
  console.error('[migrate]', err instanceof Error ? err.message : err);
  if (soft) console.warn('[migrate] continuing without migrations (--soft); API calls may fail until they succeed.');
  else process.exitCode = 1;
} finally {
  await pool.end();
}
