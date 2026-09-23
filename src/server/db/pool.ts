import pg from 'pg';
import { getConfig } from '../config/index';

/**
 * Shared Postgres pool, cached on globalThis so warm serverless invocations
 * (and dev hot-reloads) reuse connections. Use Neon's *pooled* connection
 * string on Vercel. TLS is enabled for every non-local host.
 */
const globalForPg = globalThis as unknown as { __ashPgPool?: pg.Pool };

export function getPool(): pg.Pool {
  const url = getConfig().databaseUrl;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add your Neon Postgres connection string to the environment.');
  }
  if (!globalForPg.__ashPgPool) {
    const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
    globalForPg.__ashPgPool = new pg.Pool({
      // pg treats sslmode=require as verify-full and warns; state it explicitly (same behavior, no warning).
      connectionString: url.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, '$1verify-full'),
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10_000,
    });
  }
  return globalForPg.__ashPgPool;
}
