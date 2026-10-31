/**
 * Paper trades kept on this computer between end-of-day syncs (the one-process app — RuntimeV2Store).
 *
 * A paper trade opening or closing doesn't go to the database at once. The book keeps the trade's latest state and
 * writes itself to a local file straight away (data/paper-book.json), and the day goes to the database after each
 * market's close — one row per trade, however often it changed (V2Service.syncPaperIfDue). Open trades' latest
 * prices are in the file too (at most every 30 s), so a restart carries on from the real last price, and they are
 * saved with each sync.
 *
 * The file is the only copy of a trade until its sync: it is written to a temporary file and renamed into place, so
 * a crash mid-write never leaves half a book; one that can't be read is moved aside (never overwritten).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PaperTrade } from '@/shared/v2';

export interface BookEntry {
  trade: PaperTrade;
  /** When it first changed since the last sync (ms): it is due at the first market close after this. */
  since: number;
  /** A version of it is in the database already (synced while it was open). */
  saved: boolean;
  /** Bumped on every change, so a sync forgets only what it actually wrote. */
  rev: number;
}

type Mark = { lastPrice: number; lastPriceAt: string };

interface BookFile {
  lastSyncAt: number | null;
  entries: Array<Omit<BookEntry, 'rev'>>;
  marks: Array<Mark & { id: string }>;
}

const MARKS_EVERY_MS = 30_000;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class PaperBook {
  readonly entries = new Map<string, BookEntry>();
  /** Open trades' latest prices — kept in the file so a restart picks them up. */
  readonly marks = new Map<string, Mark>();
  /** Open trades' last price as the database has it — which ones the next sync has to save. */
  readonly savedMarks = new Map<string, number | null>();
  lastSyncAt: number | null = null;
  lastError: string | null = null;
  /** The sync running now (one at a time). */
  syncing: Promise<unknown> | null = null;
  private marksTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly file?: string,
    private readonly log?: { warn(msg: string, data?: Record<string, unknown>): void; info(msg: string, data?: Record<string, unknown>): void },
  ) {
    this.load();
  }

  /** A trade opened or closed: keep its latest state and save the book now. `saved`: the database has it already (new entries only). */
  record(trade: PaperTrade, now: number, saved = false): void {
    const e = this.entries.get(trade.id);
    if (e) {
      e.trade = trade;
      e.rev++;
    } else this.entries.set(trade.id, { trade, since: now, saved, rev: 1 });
    if (trade.status === 'OPEN' && trade.lastPrice !== null && trade.lastPriceAt)
      this.marks.set(trade.id, { lastPrice: trade.lastPrice, lastPriceAt: trade.lastPriceAt });
    else this.marks.delete(trade.id);
    this.save();
  }

  /** An open trade's latest price: in the file within 30 s (not a change the sync is due for by itself). */
  mark(id: string, lastPrice: number, lastPriceAt: string): void {
    this.marks.set(id, { lastPrice, lastPriceAt });
    const e = this.entries.get(id);
    if (e?.trade.status === 'OPEN') e.trade = { ...e.trade, lastPrice, lastPriceAt };
    if (!this.marksTimer && this.file) {
      this.marksTimer = setTimeout(() => {
        this.marksTimer = null;
        this.save();
      }, MARKS_EVERY_MS);
      this.marksTimer.unref?.();
    }
  }

  /** Forget trades (deleted with their strategy / connection, reset, the history clean-up); returns how many the database never had. */
  forget(gone: (t: PaperTrade) => boolean): number {
    let unsaved = 0;
    for (const [id, e] of this.entries) {
      if (!gone(e.trade)) continue;
      if (!e.saved) unsaved++;
      this.entries.delete(id);
      this.marks.delete(id);
      this.savedMarks.delete(id);
    }
    this.save();
    return unsaved;
  }

  /** The earliest change waiting for a sync (ms). */
  oldest(): number | null {
    let min: number | null = null;
    for (const e of this.entries.values()) if (min === null || e.since < min) min = e.since;
    return min;
  }

  /**
   * A sync wrote these (`rev` = the version it wrote; none = an open trade's price only). What changed while it ran
   * stays, due at the next close.
   */
  synced(written: Array<{ trade: PaperTrade; rev?: number }>, at: number): void {
    for (const w of written) {
      const id = w.trade.id;
      const e = this.entries.get(id);
      if (e && w.rev !== undefined && e.rev === w.rev) this.entries.delete(id);
      else if (e) {
        e.saved = true;
        e.since = Math.max(e.since, at);
      }
      if (w.trade.status === 'OPEN') this.savedMarks.set(id, w.trade.lastPrice);
      else this.savedMarks.delete(id);
    }
    // Anything the database neither saved nor skipped waits for the next close too (no retry every minute).
    for (const e of this.entries.values()) if (e.since < at) e.since = at;
    this.lastSyncAt = at;
    this.lastError = null;
    this.save();
  }

  /** Write the book now (on shutdown: the prices still waiting for their 30 s). */
  flush(): void {
    if (this.marksTimer) clearTimeout(this.marksTimer);
    this.marksTimer = null;
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    const data: BookFile = {
      lastSyncAt: this.lastSyncAt,
      entries: [...this.entries.values()].map(({ rev: _r, ...e }) => e),
      marks: [...this.marks].map(([id, m]) => ({ id, ...m })),
    };
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.file);
    } catch (err) {
      this.log?.warn('could not save the paper trades on this computer', { file: this.file, error: message(err) });
    }
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as BookFile;
      this.lastSyncAt = typeof data.lastSyncAt === 'number' ? data.lastSyncAt : null;
      for (const e of data.entries ?? []) this.entries.set(e.trade.id, { ...e, rev: 1 });
      for (const m of data.marks ?? []) this.marks.set(m.id, { lastPrice: m.lastPrice, lastPriceAt: m.lastPriceAt });
      if (this.entries.size) this.log?.info('paper trades kept on this computer since the last sync', { trades: this.entries.size });
    } catch (err) {
      const aside = `${this.file}.unreadable-${Date.now()}`;
      try {
        renameSync(this.file, aside);
      } catch {
        /* left in place */
      }
      this.log?.warn('could not read the paper trades kept on this computer — moved aside, not overwritten', { file: aside, error: message(err) });
    }
  }
}
