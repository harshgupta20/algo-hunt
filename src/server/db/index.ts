/** Which database this process uses, and closing it at the end of a script. */
import { getPool } from './pool';
import { closeSqlite, databaseFile, usesPostgres } from './sqlite';

export { usesPostgres, databaseFile };

/** Human-readable: where the data lives. */
export function databaseLabel(): string {
  return usesPostgres() ? 'Postgres (DATABASE_URL)' : `local SQLite file ${databaseFile()}`;
}

export async function closeDatabase(): Promise<void> {
  if (usesPostgres()) await getPool().end();
  else closeSqlite();
}
