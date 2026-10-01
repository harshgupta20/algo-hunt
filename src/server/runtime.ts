/**
 * How this process runs. The normal way is one process — `npm start` / `npm run dev`: UI, API, scanner and the
 * live worker together — so hot data can live in memory and the database sees only core records (see
 * RuntimeV2Store). That is safe only while no other process writes the same data, so memory mode is off:
 *   - on Vercel (serverless: many short-lived instances);
 *   - when the live worker isn't inside this process (LIVE_WORKER=off — e.g. a separate `npm run live`);
 *   - in the separate `npm run live` process itself, and when one is already running on this machine.
 * A small lock file (in the system temp folder, per project folder) marks the running live worker.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const g = globalThis as unknown as { __ashMemoryMode?: boolean };

/** The live worker should run inside this app process (default on; LIVE_WORKER=off to run it separately). */
export function liveWorkerWanted(): boolean {
  if (process.env.ALGO_HUNT_STANDALONE_WORKER === '1') return false;
  const v = process.env.LIVE_WORKER?.trim().toLowerCase();
  return !(v === 'off' || v === 'false' || v === '0');
}

/** The lock file that marks this project's running live worker. */
export function workerLockFile(): string {
  const id = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `algo-hunt-live-worker-${id}.pid`);
}

/** Process id of a live worker running elsewhere on this machine (not this process), or null. */
export function otherWorkerPid(): number | null {
  const file = workerLockFile();
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, 'utf8'));
  if (!pid || pid === process.pid) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null; // stale lock from a process that's gone
  }
}

export function claimWorkerLock(): () => void {
  const file = workerLockFile();
  writeFileSync(file, String(process.pid));
  return () => {
    try {
      if (Number(readFileSync(file, 'utf8')) === process.pid) rmSync(file, { force: true });
    } catch {
      /* already gone */
    }
  };
}

/** Keep hot data in memory (decided once per process). */
export function memoryMode(): boolean {
  g.__ashMemoryMode ??= !process.env.VERCEL && liveWorkerWanted() && otherWorkerPid() === null;
  return g.__ashMemoryMode;
}
