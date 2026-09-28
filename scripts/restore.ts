/**
 * npm run restore -- <snapshot.db>   replace the local database with a snapshot (stop the app first).
 * npm run restore                    list the snapshots you can restore
 * The current database is saved first as a "before-restore" snapshot, so a restore can be undone.
 */
import './env';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { backupDir, checkBackup, listBackups, restoreFrom } from '../src/server/db/backup';
import { databaseFile, usesPostgres } from '../src/server/db/sqlite';
import { pidFile } from '../src/server/background';

if (usesPostgres()) {
  console.error('✗ DATABASE_URL is set — restore applies to the local database only.');
  process.exit(1);
}
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!arg) {
  const list = listBackups();
  console.log(list.length ? `Snapshots in ${backupDir()}:\n${list.map((b) => `  ${b.name}`).join('\n')}\n\nnpm run restore -- <file>` : `No snapshots in ${backupDir()}.`);
  process.exit(0);
}
const file = existsSync(arg) ? path.resolve(arg) : path.join(backupDir(), arg);
// The app must not be running: it holds the database open.
if (existsSync(pidFile())) {
  const pid = Number(readFileSync(pidFile(), 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    /* stale marker */
  }
  if (alive) {
    console.error(`✗ The app is running (process ${pid}) — stop it (Ctrl+C in its window), then run the restore again.`);
    process.exit(1);
  }
}
const check = checkBackup(file);
if (!check.ok) {
  console.error(`✗ Can't restore ${file}: ${check.error}`);
  process.exit(1);
}
const { saved } = restoreFrom(file);
console.log(`✓ Restored ${path.basename(file)} (${check.strategies} strategies, ${check.alerts} alerts) into ${databaseFile()}`);
if (saved) console.log(`  The previous database was saved as ${saved}`);
console.log('  Start the app again: npm start');
