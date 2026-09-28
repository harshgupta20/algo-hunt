/**
 * The local database: SQLite built into Node.js (no server, no install) in one file, by default
 * `data/algo-hunt.db` (DATABASE_FILE overrides it). Used whenever DATABASE_URL is not set.
 *
 *   - opened once per process and cached on globalThis; the schema migrates itself on open
 *   - WAL mode, so the app and a separate `npm run live` can share the file safely
 *   - foreign keys on (deleting a strategy removes its versions, connections, alerts …)
 *
 * node:sqlite is loaded with process.getBuiltinModule so bundlers leave it alone.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { SQLITE_MIGRATIONS } from './sqliteSchema';

export type { DatabaseSync };

/** Postgres when DATABASE_URL is set (e.g. Neon / the Vercel copy), otherwise the local SQLite file. */
export function usesPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function databaseFile(): string {
  return path.resolve(process.env.DATABASE_FILE?.trim() || 'data/algo-hunt.db'); // relative = the folder the app runs in
}

function loadSqlite(): typeof import('node:sqlite') {
  // Node prints an "experimental" notice the first time it loads SQLite — harmless, and noise for the trader.
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(typeof warning === 'string' ? warning : warning?.message).includes('SQLite')) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    const mod = process.getBuiltinModule('node:sqlite');
    if (!mod) throw new Error('This Node.js has no built-in SQLite — install Node.js 22.13 or newer (24 LTS recommended).');
    return mod;
  } finally {
    process.emitWarning = emit;
  }
}

/** Apply the migrations not applied yet (each in a transaction). */
export function migrate(db: DatabaseSync): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map((r) => r.id));
  const applied: string[] = [];
  for (const m of SQLITE_MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, new Date().toISOString());
      db.exec('COMMIT');
      applied.push(m.id);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return applied;
}

/** Open a SQLite database with the app's settings and schema (`:memory:` for tests). */
export function openSqlite(file: string): DatabaseSync {
  const { DatabaseSync } = loadSqlite();
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 10000');
  migrate(db);
  return db;
}

/** Open a database file read-only, as it is (no migrations) — to inspect a backup. */
export function openReadOnly(file: string): DatabaseSync {
  const { DatabaseSync } = loadSqlite();
  return new DatabaseSync(file, { readOnly: true });
}

const globalForDb = globalThis as unknown as { __ashSqlite?: DatabaseSync };

/** The process-wide local database. */
export function getSqlite(): DatabaseSync {
  globalForDb.__ashSqlite ??= openSqlite(databaseFile());
  return globalForDb.__ashSqlite;
}

/** Close the local database (end of a script / process). */
export function closeSqlite(): void {
  globalForDb.__ashSqlite?.close();
  globalForDb.__ashSqlite = undefined;
}

/** Run `fn` in one write transaction (atomic; other processes wait on the busy timeout). */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
