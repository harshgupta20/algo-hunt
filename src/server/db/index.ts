/** Where the data lives, and closing the connection at the end of a script. */
import { getPool } from './pool';

/** Human-readable: where the data lives. */
export function databaseLabel(): string {
  return 'Postgres (DATABASE_URL)';
}

export async function closeDatabase(): Promise<void> {
  await getPool().end();
}
