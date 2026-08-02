import pg from 'pg';
import { config } from '../config/index.js';

let pool: pg.Pool | undefined;

/**
 * Lazily create the shared Postgres pool. Neon (and most hosted Postgres)
 * require TLS; we enable it whenever the URL isn't a local connection.
 */
export function getPool(): pg.Pool {
  if (!config.databaseUrl) {
    throw new Error('getPool() called without DATABASE_URL configured');
  }
  if (!pool) {
    const isLocal = /@(localhost|127\.0\.0\.1)/.test(config.databaseUrl);
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
