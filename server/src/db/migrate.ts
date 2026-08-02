/**
 * Migration runner. Applies pending .sql files from ./migrations in order,
 * each within a transaction, tracking applied files in schema_migrations.
 * Run with: npm run db:migrate
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { closePool, getPool } from './pool.js';

async function migrate(): Promise<void> {
  if (!config.hasDatabase) {
    logger.error('DATABASE_URL is not set; nothing to migrate. Set it in .env to use Postgres.');
    process.exit(1);
  }

  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
    if (applied.rowCount) {
      logger.info(`↷ already applied: ${file}`);
      continue;
    }
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info(`✓ applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, file }, 'migration failed');
      throw err;
    } finally {
      client.release();
    }
  }

  await closePool();
  logger.info('migrations complete');
}

migrate().catch((err) => {
  logger.error({ err }, 'migrate crashed');
  process.exit(1);
});
