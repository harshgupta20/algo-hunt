/**
 * Priority queue for Kite historical requests (the only rate-limited resource
 * the live worker uses: ~3 requests/second per API key). Lower number = sooner:
 *   0 confirm   re-checking a result against Kite's candles before alerting
 *   1 warm-up   history for contracts a connection uses right now
 *   2 buffer    history for nearby strikes (ready before ATM moves there)
 *   3 repair    re-fetching today's candles after a stream gap
 * Jobs with the same key share one request while queued or running; asking
 * again with a higher priority moves the job up.
 */
export type FetchPriority = 0 | 1 | 2 | 3;

interface Job {
  key: string;
  priority: FetchPriority;
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  promise: Promise<unknown>;
}

export class FetchQueue {
  private readonly lanes: Job[][] = [[], [], [], []];
  private readonly byKey = new Map<string, Job>();
  private active = 0;
  private waiters: Array<() => void> = [];
  done = 0;
  failed = 0;

  constructor(private readonly concurrency = 2) {}

  run<T>(priority: FetchPriority, key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.byKey.get(key);
    if (existing) {
      if (priority < existing.priority) {
        const lane = this.lanes[existing.priority]!;
        const i = lane.indexOf(existing);
        if (i >= 0) {
          lane.splice(i, 1);
          existing.priority = priority;
          this.lanes[priority]!.push(existing);
        }
      }
      return existing.promise as Promise<T>;
    }
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job: Job = { key, priority, run: fn, resolve, reject, promise };
    this.byKey.set(key, job);
    this.lanes[priority]!.push(job);
    this.pump();
    return promise as Promise<T>;
  }

  /** Queued (not yet running) jobs per lane. */
  sizes(): { confirm: number; warmup: number; buffer: number; repair: number } {
    return { confirm: this.lanes[0]!.length, warmup: this.lanes[1]!.length, buffer: this.lanes[2]!.length, repair: this.lanes[3]!.length };
  }

  get pending(): number {
    return this.active + this.lanes.reduce((n, l) => n + l.length, 0);
  }

  /** Drop queued jobs (new trading day); running ones finish. */
  clear(): void {
    for (const lane of this.lanes) {
      for (const job of lane.splice(0)) {
        this.byKey.delete(job.key);
        job.reject(new Error('cancelled'));
      }
    }
    this.settle();
  }

  /** Resolves when nothing is queued or running. */
  idle(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private next(): Job | undefined {
    for (const lane of this.lanes) if (lane.length) return lane.shift();
    return undefined;
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const job = this.next();
      if (!job) break;
      this.active++;
      job
        .run()
        .then(
          (v) => {
            this.done++;
            job.resolve(v);
          },
          (e) => {
            this.failed++;
            job.reject(e);
          },
        )
        .finally(() => {
          this.active--;
          this.byKey.delete(job.key);
          this.pump();
          this.settle();
        });
    }
  }

  private settle(): void {
    if (this.pending === 0) for (const w of this.waiters.splice(0)) w();
  }
}
