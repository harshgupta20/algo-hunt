/**
 * npm run backup            save a complete snapshot of the local database now (safe while the app runs)
 * npm run backup -- --list  list the snapshots
 * Snapshots go to BACKUP_DIR (default backups/); the app also makes one a day and keeps the newest 14.
 */
import './env';
import { backupDir, backupNow, listBackups, pruneBackups } from '../src/server/db/backup';
import { closeSqlite, databaseFile, usesPostgres } from '../src/server/db/sqlite';

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
if (usesPostgres()) {
  console.error('✗ DATABASE_URL is set — this app is on Postgres, back it up with your provider (backups here are for the local database).');
  process.exit(1);
}
if (process.argv.includes('--list')) {
  const list = listBackups();
  console.log(list.length ? list.map((b) => `${b.name}  ${mb(b.bytes)}`).join('\n') : `No snapshots in ${backupDir()} yet.`);
} else {
  const file = backupNow();
  pruneBackups();
  console.log(`✓ Saved ${file}\n  (from ${databaseFile()}; keep a copy somewhere safe, e.g. a cloud-synced folder)`);
}
closeSqlite();
