/**
 * Work the app does by itself while it runs (started once from src/instrumentation.ts):
 *
 *   live worker   streams Kite and alerts seconds after each candle close — in the app's own process, so
 *                 `npm start` (or `npm run dev`) is the only command, and hot data stays in memory (runtime.ts).
 *                 LIVE_WORKER=off runs without it (then `npm run live` separately). Not started when a
 *                 separate worker is already running on this computer.
 *   backups       the local database: a snapshot a day (keeps 14), checked hourly.
 *   history       deletes alerts / signals / closed paper trades older than Settings → Database keeps (daily;
 *                 nothing by default — everything is kept).
 *   on stop       saves the records still waiting for the database (or keeps them for the next start).
 *
 * Nothing runs on Vercel (serverless).
 */
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { databaseFile } from './db/sqlite';
import { childLogger } from './utils/logger';
import { claimWorkerLock, liveWorkerWanted, memoryMode, otherWorkerPid } from './runtime';

const log = childLogger('background');
const HOUR = 3_600_000;
const g = globalThis as unknown as { __ashBackground?: boolean };

/** Marks the app as running, next to the database file (`npm run restore` needs the app stopped). */
export function pidFile(): string {
  return path.join(path.dirname(databaseFile()), 'app.pid');
}

export async function startBackground(): Promise<void> {
  if (g.__ashBackground || process.env.VERCEL) return;
  g.__ashBackground = true;
  log.info({ memory: memoryMode() }, memoryMode() ? 'one-process app: hot data in memory, the database for core records' : 'database for everything (a separate live worker may be writing)');
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

  const other = otherWorkerPid();
  if (liveWorkerWanted() && other !== null) {
    log.warn({ pid: other }, 'a live worker is already running on this computer (npm run live) — not starting one in the app');
  } else if (liveWorkerWanted()) {
    try {
      stops.push(claimWorkerLock());
      const { getContext } = await import('./api/context');
      const { createV2LiveWorker } = await import('./v2');
      const ctx = getContext();
      const worker = createV2LiveWorker({ kiteAuth: ctx.kiteAuth, historical: ctx.historical });
      await worker.start();
      stops.push(() => worker.stop());
      log.info({ worker: worker.id.slice(0, 8) }, 'live worker started in the app');
    } catch (err) {
      // E.g. Kite keys missing. The lock stays held so a separate `npm run live` can't write next to this app's memory.
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'live worker not started in the app');
    }
  }

  // History clean-up — only when Settings → Database keeps a limited period (default: keep everything). Daily.
  const housekeeping = async () => {
    try {
      const { getContext } = await import('./api/context');
      const out = await getContext().v2.service.dailyHousekeeping();
      if (out) log.info(out, 'history older than the chosen period removed');
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'history clean-up failed');
    }
  };
  setTimeout(() => void housekeeping(), 2 * 60_000).unref();
  setInterval(() => void housekeeping(), HOUR).unref();

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.race([Promise.allSettled(stops.map((s) => s())), new Promise((r) => setTimeout(r, 3_000))]);
    // Last: save what's waiting (or keep it in data/pending-writes.json for the next start).
    const { runtimeState } = await import('./v2/persistence/RuntimeV2Store');
    await runtimeState()
      .writes?.close(2_000)
      .catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
