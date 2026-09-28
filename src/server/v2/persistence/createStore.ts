/** The V2 store on the configured database: Postgres when DATABASE_URL is set, otherwise the local SQLite file. */
import { getSqlite, usesPostgres } from '../../db/sqlite';
import { PgV2Store } from './PgV2Store';
import { SqliteV2Store } from './SqliteV2Store';
import type { V2Store } from './V2Store';

export function createV2Store(): V2Store {
  return usesPostgres() ? new PgV2Store() : new SqliteV2Store(getSqlite());
}
