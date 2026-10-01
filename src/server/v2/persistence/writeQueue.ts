/**
 * Saves that never hold an alert up. The memory layer (RuntimeV2Store) applies an event at once — the alert
 * goes out, the paper trade opens — and queues its database write here. One writer sends the writes in order;
 * while the database can't be reached (Neon asleep, offline, over its monthly allowance) it keeps retrying
 * (1 s → 30 s), and the queue is kept in a small local file so a restart doesn't lose it.
 *
 * Writes are plain data ({ op, args }), so they survive a restart. A write the database refuses for a reason
 * that retrying can't fix (a duplicate, a deleted connection) is dropped after a few tries, along with the
 * writes that depend on it (an alert whose signal wasn't saved, that alert's deliveries).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PendingWrites } from '@/shared/v2';
import type { V2Store } from './V2Store';

export type { PendingWrites };

export type WriteOp =
  | 'signals.insert'
  | 'alerts.insert'
  | 'alerts.addDelivery'
  | 'alerts.setStatus'
  | 'units.upsertMany'
  | 'paper.insertTrade'
  | 'paper.closeTrade'
  | 'scanRuns.prune';

export interface QueuedWrite {
  op: WriteOp;
  args: unknown[];
  /** When it was queued (ms). */
  at: number;
  /** The record id this write creates — when it isn't saved, writes that depend on it are skipped. */
  provides?: string;
  dependsOn?: string[];
}

export interface WriteQueueOptions {
  clock?: () => number;
  /** Wait before retry number `attempt` (1, 2, …). */
  retryMs?: (attempt: number) => number;
  /** Where waiting writes are kept across restarts (none = memory only). */
  file?: string;
  log?: { warn(msg: string, data?: Record<string, unknown>): void; info(msg: string, data?: Record<string, unknown>): void };
}

const PERMANENT_TRIES = 3;
const defaultRetry = (attempt: number) => Math.min(30_000, 1000 * 2 ** (attempt - 1));
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * True when retrying can't help: the database answered and refused the write (Postgres classes 22 data and
 * 23 constraint). Everything else — no connection, timeouts, Neon's "quota exceeded", a restarting server,
 * a missing table until migrations run — is worth retrying.
 */
export function isPermanentWriteError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' && /^(22|23)[0-9A-Z]{3}$/.test(code);
}

async function run(db: V2Store, w: QueuedWrite): Promise<unknown> {
  const a = w.args as any[];
  switch (w.op) {
    case 'signals.insert':
      return db.signals.insert(a[0]);
    case 'alerts.insert':
      return db.alerts.insert(a[0]);
    case 'alerts.addDelivery':
      return db.alerts.addDelivery(a[0], a[1]);
    case 'alerts.setStatus':
      return db.alerts.setStatus(a[0], a[1]);
    case 'units.upsertMany':
      return db.units.upsertMany(a[0]);
    case 'paper.insertTrade':
      return db.paper.insertTrade(a[0]);
    case 'paper.closeTrade':
      return db.paper.closeTrade(a[0], a[1]);
    case 'scanRuns.prune':
      return db.scanRuns.prune(a[0]);
  }
}

export class WriteQueue {
  private jobs: Array<QueuedWrite & { tries: number }> = [];
  private running = false;
  private waiters: Array<() => void> = [];
  private wake: (() => void) | null = null;
  private failingSince: number | null = null;
  private lastError: string | null = null;
  private dropped = 0;
  /** Records that weren't saved (their dependants are skipped). */
  private skipped = new Set<string>();
  private persisted = false;
  private closed = false;
  private readonly clock: () => number;
  private readonly retryMs: (attempt: number) => number;

  constructor(
    private readonly db: V2Store,
    private readonly opts: WriteQueueOptions = {},
  ) {
    this.clock = opts.clock ?? Date.now;
    this.retryMs = opts.retryMs ?? defaultRetry;
    this.load();
  }

  push(w: Omit<QueuedWrite, 'at'>): void {
    this.jobs.push({ ...w, at: this.clock(), tries: 0 });
    if (this.failingSince !== null) this.save();
    void this.pump();
  }

  /**
   * Wait until everything queued so far is saved, so a database read sees it. Returns at once while the
   * database is failing (the caller's own query then fails or succeeds by itself) — and asks for a retry now.
   */
  async drain(): Promise<void> {
    if (!this.jobs.length) return;
    if (this.failingSince !== null) {
      this.wake?.();
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Writes still waiting. */
  get size(): number {
    return this.jobs.length;
  }

  pending(): PendingWrites {
    const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
    return { count: this.jobs.length, oldestAt: iso(this.jobs[0]?.at ?? null), failingSince: iso(this.failingSince), lastError: this.lastError, dropped: this.dropped };
  }

  /** On shutdown: try to save everything within `ms`, then stop and keep whatever is left in the file. */
  async close(ms = 3_000): Promise<void> {
    if (this.jobs.length && this.failingSince === null) await Promise.race([this.drain(), new Promise((r) => setTimeout(r, ms))]);
    this.closed = true;
    this.wake?.();
    this.save();
  }

  private notify(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length && !this.closed) {
        const job = this.jobs[0]!;
        if (job.dependsOn?.some((id) => this.skipped.has(id))) {
          if (job.op === 'paper.insertTrade') {
            // The trade stands on its own — save it without the link to an alert that wasn't saved.
            job.args = [{ ...(job.args[0] as object), alertId: null }];
            job.dependsOn = undefined;
          } else {
            this.jobs.shift();
            if (job.provides) this.skipped.add(job.provides);
            continue;
          }
        }
        try {
          const out = await run(this.db, job);
          this.jobs.shift();
          // A create that returned nothing (duplicate signal, slot already taken) saved no record.
          if (job.provides && out === null) this.skipped.add(job.provides);
          if (this.failingSince !== null) {
            this.opts.log?.info('database reachable again — saving the waiting records', { waiting: this.jobs.length, since: new Date(this.failingSince).toISOString() });
            this.failingSince = null;
            this.lastError = null;
          }
        } catch (err) {
          job.tries++;
          if (isPermanentWriteError(err)) {
            if (job.tries < PERMANENT_TRIES) {
              await new Promise((r) => setTimeout(r, 100));
              continue;
            }
            this.jobs.shift();
            this.dropped++;
            if (job.provides) this.skipped.add(job.provides);
            this.opts.log?.warn('database refused a write — dropped', { op: job.op, error: message(err) });
            continue;
          }
          if (this.closed) break;
          if (this.failingSince === null) {
            this.failingSince = this.clock();
            this.opts.log?.warn('database unreachable — records wait in the app and are saved when it is back', { op: job.op, error: message(err) });
          }
          this.lastError = message(err);
          this.save();
          this.notify(); // readers don't wait for a database that's down
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, this.retryMs(job.tries));
            this.wake = () => {
              clearTimeout(t);
              resolve();
            };
          });
          this.wake = null;
        }
      }
    } finally {
      this.running = false;
      if (this.skipped.size > 5_000) this.skipped.clear();
      if (this.persisted && !this.closed) this.save();
      this.notify();
    }
  }

  /** Keep the waiting writes in the file (or remove it once none wait). */
  private save(): void {
    const file = this.opts.file;
    if (!file) return;
    try {
      if (!this.jobs.length) {
        if (this.persisted || existsSync(file)) rmSync(file, { force: true });
        this.persisted = false;
        return;
      }
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(this.jobs.map(({ tries: _t, ...w }) => w)));
      this.persisted = true;
    } catch (err) {
      this.opts.log?.warn('could not keep the waiting records in a file', { file, error: message(err) });
    }
  }

  /** Writes left from the last run (the app stopped while the database was unreachable). */
  private load(): void {
    const file = this.opts.file;
    if (!file || !existsSync(file)) return;
    try {
      const list = JSON.parse(readFileSync(file, 'utf8')) as QueuedWrite[];
      if (!Array.isArray(list) || !list.length) return;
      this.jobs.push(...list.map((w) => ({ ...w, tries: 0 })));
      this.persisted = true;
      this.opts.log?.info('saving records left from the last run', { count: list.length });
      void this.pump();
    } catch (err) {
      this.opts.log?.warn('could not read the waiting records file — left in place', { file, error: message(err) });
    }
  }
}
