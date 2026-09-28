/**
 * Backups of the local database: complete, consistent snapshots (SQLite `VACUUM INTO`, safe while the app
 * runs) in BACKUP_DIR (default `backups/`), named algo-hunt-YYYY-MM-DD-HHMM.db. The app makes one a day and
 * keeps the newest 14; `npm run backup` makes one now; `npm run restore <file>` puts one back.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { databaseFile, getSqlite, openReadOnly, openSqlite, type DatabaseSync } from './sqlite';

export const KEEP_BACKUPS = 14;
const PREFIX = 'algo-hunt-';

export function backupDir(): string {
  return path.resolve(process.env.BACKUP_DIR?.trim() || 'backups');
}

/** IST stamp for file names: 2026-09-29-2130. */
function stamp(ms = Date.now()): string {
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
}

export interface BackupFile {
  file: string;
  name: string;
  bytes: number;
  at: string;
}

export function listBackups(dir = backupDir()): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.startsWith(PREFIX) && n.endsWith('.db'))
    .map((name) => {
      const file = path.join(dir, name);
      const st = statSync(file);
      return { file, name, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Write a snapshot now; returns its path. `label` goes into the name (e.g. "before-restore"). */
export function backupNow(opts: { db?: DatabaseSync; dir?: string; label?: string } = {}): string {
  const dir = opts.dir ?? backupDir();
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${PREFIX}${stamp()}${opts.label ? `-${opts.label}` : ''}.db`);
  if (existsSync(file)) rmSync(file);
  (opts.db ?? getSqlite()).prepare('VACUUM INTO ?').run(file);
  return file;
}

/** Keep the newest `keep` dated snapshots (labelled ones, like before-restore, are kept). */
export function pruneBackups(dir = backupDir(), keep = KEEP_BACKUPS): string[] {
  const dated = listBackups(dir).filter((b) => /^algo-hunt-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(b.name));
  const drop = dated.slice(keep);
  for (const b of drop) rmSync(b.file, { force: true });
  return drop.map((b) => b.name);
}

/** Today's (IST) dated snapshot exists? */
export function backedUpToday(dir = backupDir(), now = Date.now()): boolean {
  const day = stamp(now).slice(0, 10);
  return listBackups(dir).some((b) => b.name.startsWith(`${PREFIX}${day}`));
}

/** Check a snapshot can be opened and holds the app's tables. */
export function checkBackup(file: string): { ok: true; strategies: number; alerts: number } | { ok: false; error: string } {
  if (!existsSync(file)) return { ok: false, error: `No such file: ${file}` };
  let db: DatabaseSync | undefined;
  try {
    db = openReadOnly(file);
    const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    if (integrity !== 'ok') return { ok: false, error: `The file is damaged (${integrity})` };
    const n = (t: string) => Number((db!.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
    return { ok: true, strategies: n('v2_strategies'), alerts: n('v2_alerts') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    db?.close();
  }
}

/**
 * Replace the local database with a snapshot (the app must be stopped). The current database is saved
 * first as a "before-restore" snapshot.
 */
export function restoreFrom(file: string, target = databaseFile()): { saved: string | null } {
  const check = checkBackup(file);
  if (!check.ok) throw new Error(check.error);
  let saved: string | null = null;
  if (existsSync(target)) {
    const current = openSqlite(target);
    try {
      saved = backupNow({ db: current, label: 'before-restore' });
    } finally {
      current.close();
    }
  }
  mkdirSync(path.dirname(target), { recursive: true });
  for (const f of [`${target}-wal`, `${target}-shm`]) rmSync(f, { force: true });
  copyFileSync(file, target);
  return { saved };
}
