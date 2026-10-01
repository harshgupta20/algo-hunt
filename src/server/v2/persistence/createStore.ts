/**
 * The V2 store on the configured database — Postgres (Neon) when DATABASE_URL is set, otherwise the local
 * SQLite file — with hot data kept in memory when the app runs in one process (RuntimeV2Store, runtime.ts).
 * Records waiting to be saved while the database is unreachable are kept next to the local data
 * (data/pending-writes.json) so a restart doesn't lose them.
 */
import path from 'node:path';
import { databaseFile, getSqlite, usesPostgres } from '../../db/sqlite';
import { memoryMode } from '../../runtime';
import { childLogger } from '../../utils/logger';
import { PgV2Store } from './PgV2Store';
import { RuntimeV2Store } from './RuntimeV2Store';
import { SqliteV2Store } from './SqliteV2Store';
import type { V2Store } from './V2Store';

const log = childLogger('db-writes');

export function pendingWritesFile(): string {
  return path.join(path.dirname(databaseFile()), 'pending-writes.json');
}

export function createV2Store(): V2Store {
  const durable: V2Store = usesPostgres() ? new PgV2Store() : new SqliteV2Store(getSqlite());
  if (!memoryMode()) return durable;
  const store = new RuntimeV2Store(durable, Date.now, undefined, {
    pendingFile: pendingWritesFile(),
    log: { warn: (m, d) => log.warn(d ?? {}, m), info: (m, d) => log.info(d ?? {}, m) },
  });
  void store.warmUp(); // once per process (the state is shared); later calls find it loaded
  return store;
}
