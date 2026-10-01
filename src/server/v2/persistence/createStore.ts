/**
 * The V2 store on the configured database — Postgres (Neon) when DATABASE_URL is set, otherwise the local
 * SQLite file — with hot data kept in memory when the app runs in one process (RuntimeV2Store, runtime.ts).
 */
import { getSqlite, usesPostgres } from '../../db/sqlite';
import { memoryMode } from '../../runtime';
import { PgV2Store } from './PgV2Store';
import { RuntimeV2Store } from './RuntimeV2Store';
import { SqliteV2Store } from './SqliteV2Store';
import type { V2Store } from './V2Store';

export function createV2Store(): V2Store {
  const durable: V2Store = usesPostgres() ? new PgV2Store() : new SqliteV2Store(getSqlite());
  return memoryMode() ? new RuntimeV2Store(durable) : durable;
}
