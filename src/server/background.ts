/**
 * Work the app does by itself while it runs (started once from src/instrumentation.ts):
 *
 *   live worker   streams Kite and alerts seconds after each candle close — in the app's own process, so
 *                 `npm start` (or `npm run dev`) is the only command, and hot data stays in memory (runtime.ts).
 *                 LIVE_WORKER=off runs without it (then `npm run live` separately). Not started when a
 *                 separate worker is already running on this computer.
 *   history       deletes alerts / signals / closed paper trades older than Settings → Database keeps (daily;
 *                 nothing by default — everything is kept).
 *   on stop       saves the records still waiting for the database (or keeps them for the next start).
 *
 * Nothing runs on Vercel (serverless).
 */
import { childLogger } from './utils/logger';
import { claimWorkerLock, liveWorkerWanted, memoryMode, otherWorkerPid } from './runtime';

const log = childLogger('background');
const HOUR = 3_600_000;
const g = globalThis as unknown as { __ashBackground?: boolean };

export async function startBackground(): Promise<void> {
  if (g.__ashBackground || process.env.VERCEL) return;
  g.__ashBackground = true;
  if (!process.env.DATABASE_URL?.trim()) {
    log.error('DATABASE_URL is not set — add your Neon connection string to .env.local (or .env) and restart. Nothing works without it.');
    return;
  }
  log.info({ memory: memoryMode() }, memoryMode() ? 'one-process app: hot data in memory, the database for core records' : 'database for everything (a separate live worker may be writing)');
  const stops: Array<() => Promise<void> | void> = [];

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
  process.once('SIGHUP', () => void stop()); // Windows: the app's window was closed (a few seconds to save)
}
