/**
 * Work the app does by itself while it runs (started once from src/instrumentation.ts):
 *
 *   live worker   streams Kite and alerts seconds after each candle close — in the app's own process, so
 *                 `npm start` is the only command. On with `next start`, off with `next dev` (the developer
 *                 can run `npm run live`); LIVE_WORKER=on / off overrides. Skipped when another worker is
 *                 already running (e.g. a separate `npm run live`).
 *   backups       the local database: a snapshot a day (keeps 14), checked hourly.
 *
 * Nothing runs on Vercel (serverless).
 */
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { databaseFile } from './db/sqlite';
import { childLogger } from './utils/logger';

const log = childLogger('background');
const HOUR = 3_600_000;
const g = globalThis as unknown as { __ashBackground?: boolean };

function liveWorkerWanted(): boolean {
  const v = process.env.LIVE_WORKER?.trim().toLowerCase();
  if (v === 'off' || v === 'false' || v === '0') return false;
  if (v === 'on' || v === 'true' || v === '1') return true;
  return process.env.NODE_ENV === 'production';
}

/** Marks the app as running, next to the database file (`npm run restore` needs the app stopped). */
export function pidFile(): string {
  return path.join(path.dirname(databaseFile()), 'app.pid');
}

export async function startBackground(): Promise<void> {
  if (g.__ashBackground || process.env.VERCEL) return;
  g.__ashBackground = true;
  const { getSqlite, usesPostgres } = await import('./db/sqlite');
  const stops: Array<() => Promise<void> | void> = [];

  if (!usesPostgres()) {
    const { backedUpToday, backupNow, pruneBackups } = await import('./db/backup');
    getSqlite(); // create / migrate the local database now, not on the first request
    try {
      writeFileSync(pidFile(), String(process.pid));
      stops.push(() => rmSync(pidFile(), { force: true }));
    } catch {
      /* the data folder is created with the database; not critical */
    }
    const daily = () => {
      try {
        if (backedUpToday()) return;
        const file = backupNow();
        const dropped = pruneBackups();
        log.info({ file, dropped: dropped.length }, 'daily database backup');
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, 'daily backup failed');
      }
    };
    setTimeout(daily, 60_000).unref();
    setInterval(daily, HOUR).unref();
  }

  if (liveWorkerWanted()) {
    try {
      const { getContext } = await import('./api/context');
      const { createV2LiveWorker } = await import('./v2');
      const ctx = getContext();
      const worker = createV2LiveWorker({ kiteAuth: ctx.kiteAuth, historical: ctx.historical });
      await worker.start();
      stops.push(() => worker.stop());
      log.info({ worker: worker.id.slice(0, 8) }, 'live worker started in the app');
    } catch (err) {
      // Most often: another worker is already running (npm run live) — it keeps working.
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'live worker not started in the app');
    }
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.race([Promise.allSettled(stops.map((s) => s())), new Promise((r) => setTimeout(r, 3_000))]);
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
