import { config } from '../config/index.js';
import { childLogger } from '../utils/logger.js';
import type { DataStore } from './store.js';
import { MemoryDataStore } from './memory/memoryStore.js';

const log = childLogger('datastore');

/** Create the DataStore appropriate for the current configuration. */
export async function createDataStore(): Promise<DataStore> {
  if (config.hasDatabase) {
    const { PgDataStore } = await import('./pg/pgStore.js');
    const store = new PgDataStore();
    await store.init();
    log.info('using Postgres data store');
    return store;
  }
  log.warn('DATABASE_URL not set — using in-memory store (alert history resets on restart)');
  const store = new MemoryDataStore();
  await store.init();
  return store;
}

export type { DataStore } from './store.js';
