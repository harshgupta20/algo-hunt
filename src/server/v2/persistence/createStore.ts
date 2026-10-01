/**
 * The V2 store on Postgres (Neon, DATABASE_URL), with hot data kept in memory when the app runs in one process
 * (RuntimeV2Store, runtime.ts). Records waiting to be saved while the database is unreachable are kept in
 * data/pending-writes.json (git-ignored) so a restart doesn't lose them.
 */
import { memoryMode } from '../../runtime';
import { childLogger } from '../../utils/logger';
import { PgV2Store } from './PgV2Store';
import { RuntimeV2Store } from './RuntimeV2Store';
import type { V2Store } from './V2Store';

const log = childLogger('db-writes');

/** Relative paths are taken from the folder the app runs in. */
export function pendingWritesFile(): string {
  return process.env.PENDING_WRITES_FILE?.trim() || 'data/pending-writes.json';
}

export function createV2Store(): V2Store {
  const durable: V2Store = new PgV2Store();
  if (!memoryMode()) return durable;
  const store = new RuntimeV2Store(durable, Date.now, undefined, {
    pendingFile: pendingWritesFile(),
    log: { warn: (m, d) => log.warn(d ?? {}, m), info: (m, d) => log.info(d ?? {}, m) },
  });
  void store.warmUp(); // once per process (the state is shared); later calls find it loaded
  return store;
}
