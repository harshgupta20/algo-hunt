/**
 * One-time copy of your data from Postgres (e.g. Neon) into the local SQLite database — every table the app
 * uses, row for row (nothing trimmed). Retired V1 / MCX tables stay in Postgres.
 *
 *   npm run db:import -- "postgres://user:pass@host/db?sslmode=require"
 *   (or IMPORT_DATABASE_URL in .env.local)   add --force to replace a local database that already has data
 *
 * The local database is DATABASE_FILE (default data/algo-hunt.db); DATABASE_URL must not be set, or the app
 * would keep using Postgres.
 */
import './env';
import pg from 'pg';
import { backupNow } from '../src/server/db/backup';
import { closeSqlite, databaseFile, getSqlite, transaction, usesPostgres } from '../src/server/db/sqlite';

/** In foreign-key order. The live worker's heartbeat and the scan lock are not copied (they are only "now"). */
const TABLES = [
  'kite_session',
  'user_preferences',
  'v2_instruments',
  'v2_products',
  'v2_calendar',
  'v2_strategies',
  'v2_strategy_versions',
  'v2_connections',
  'v2_unit_state',
  'v2_signals',
  'v2_alerts',
  'v2_deliveries',
  'v2_scan_runs',
  'v2_settings',
  'v2_paper_plans',
  'v2_paper_trades',
  'v2_paper_overrides',
] as const;

const source = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.env.IMPORT_DATABASE_URL;
const force = process.argv.includes('--force');
if (!source) {
  console.error('✗ Give the Postgres connection string: npm run db:import -- "postgres://…"  (or set IMPORT_DATABASE_URL)');
  process.exit(1);
}
if (usesPostgres()) {
  console.error('✗ DATABASE_URL is set, so the app uses Postgres — remove it from .env.local to use the local database, then import.');
  process.exit(1);
}

const url = source.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, '$1verify-full');
const local = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new pg.Pool({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false }, max: 2 });
const db = getSqlite();
const count = (t: string) => Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);

try {
  if (count('v2_strategies') + count('v2_alerts') > 0) {
    if (!force) {
      console.error(`✗ ${databaseFile()} already has data — add --force to replace it (a snapshot is saved first).`);
      process.exit(1);
    }
    console.log(`Saved the current local data first: ${backupNow({ label: 'before-import' })}`);
  }
  const exists = new Set((await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name as string));
  const now = new Date().toISOString();
  /** Postgres value → SQLite value for a column. */
  const value = (v: unknown): string | number | null => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  const report: string[] = [];
  transaction(db, () => {
    for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
  });
  for (const t of TABLES) {
    if (!exists.has(t)) {
      report.push(`${t.padEnd(22)} —  (not in Postgres)`);
      continue;
    }
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string; notnull: number; type: string }>).map((c) => c);
    const rows = (await pool.query(`SELECT * FROM ${t}`)).rows as Array<Record<string, unknown>>;
    const numeric = new Set(cols.filter((c) => /INT|REAL/.test(c.type)).map((c) => c.name));
    const ins = db.prepare(`INSERT INTO ${t} (${cols.map((c) => c.name).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    transaction(db, () => {
      for (const r of rows) {
        ins.run(
          ...cols.map((c) => {
            let v = value(r[c.name]);
            if (v !== null && numeric.has(c.name) && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v); // bigint / numeric
            // Columns Postgres doesn't have (older schema): a timestamp now, else the SQLite default.
            if (v === null && !(c.name in r) && c.notnull) v = /_at$/.test(c.name) ? now : null;
            return v;
          }),
        );
      }
    });
    report.push(`${t.padEnd(22)} ${String(rows.length).padStart(7)}`);
  }
  console.log(`✓ Copied into ${databaseFile()}:\n${report.map((l) => `  ${l}`).join('\n')}`);
} catch (err) {
  console.error(`✗ Import failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
  closeSqlite();
}
