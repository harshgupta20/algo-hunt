/**
 * The local database around the store: snapshots (taken while open), checking and restoring one (the
 * current data saved first), keeping the newest 14, and the Kite session / preferences on SQLite.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteAppStore } from '../../src/server/db/appStore';
import { backupNow, checkBackup, listBackups, pruneBackups, restoreFrom } from '../../src/server/db/backup';
import { openSqlite } from '../../src/server/db/sqlite';
import { SqliteV2Store } from '../../src/server/v2/persistence/SqliteV2Store';
import { cond, field, legSeries, num, strategy } from '../helpers/v2Fakes';

const DEF = { ...strategy([{ id: 'A', kind: 'FUT' }], cond(field(legSeries('A')), 'GT', num(1))), name: 'Kept' };
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'algo-hunt-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('local database', () => {
  it('snapshots while open, checks and restores one — saving the current data first', async () => {
    const dir = tmp();
    const file = path.join(dir, 'data', 'algo-hunt.db');
    const backups = path.join(dir, 'backups');
    let db = openSqlite(file);
    await new SqliteV2Store(db).strategies.create(DEF);
    const snap = backupNow({ db, dir: backups });
    expect(checkBackup(snap)).toEqual({ ok: true, strategies: 1, alerts: 0 });
    await new SqliteV2Store(db).strategies.create({ ...DEF, name: 'Added later' });
    db.close();

    const { saved } = restoreFrom(snap, file);
    expect(saved).toMatch(/before-restore\.db$/);
    db = openSqlite(file);
    expect((await new SqliteV2Store(db).strategies.list()).map((s) => s.name)).toEqual(['Kept']);
    db.close();
    expect(checkBackup(saved!)).toMatchObject({ ok: true, strategies: 2 }); // the restore can be undone

    writeFileSync(path.join(backups, 'broken.db'), 'not a database');
    expect(checkBackup(path.join(backups, 'broken.db'))).toMatchObject({ ok: false });
    expect(() => restoreFrom(path.join(backups, 'broken.db'), file)).toThrow();
  });

  it('keeps the newest 14 dated snapshots (and labelled ones)', () => {
    const dir = tmp();
    for (let d = 1; d <= 16; d++) writeFileSync(path.join(dir, `algo-hunt-2026-09-${String(d).padStart(2, '0')}-2000.db`), '');
    writeFileSync(path.join(dir, 'algo-hunt-2026-09-01-0900-before-restore.db'), '');
    expect(pruneBackups(dir)).toEqual(['algo-hunt-2026-09-02-2000.db', 'algo-hunt-2026-09-01-2000.db']);
    const left = listBackups(dir).map((b) => b.name);
    expect(left).toHaveLength(15);
    expect(left).toContain('algo-hunt-2026-09-01-0900-before-restore.db');
  });

  it('Kite session and preferences on SQLite', async () => {
    const app = new SqliteAppStore(openSqlite(':memory:'));
    expect(await app.kite.get()).toBeNull();
    await app.kite.save({ accessTokenEnc: 'enc', kiteUserId: 'AB1234', userName: 'Trader', loginTime: '2026-09-29T03:30:00.000Z', expiresAt: '2026-09-30T00:30:00.000Z', state: 'connected' });
    expect(await app.kite.get()).toMatchObject({ accessTokenEnc: 'enc', kiteUserId: 'AB1234', state: 'connected', expiresAt: '2026-09-30T00:30:00.000Z' });
    await app.kite.markState('needs-login', 'expired');
    expect(await app.kite.get()).toMatchObject({ state: 'needs-login', lastError: 'expired', accessTokenEnc: 'enc' });
    await app.kite.clear();
    expect(await app.kite.get()).toBeNull();
    const prefs = await app.preferences.get();
    await app.preferences.save({ ...prefs, soundEnabled: false });
    expect((await app.preferences.get()).soundEnabled).toBe(false);
  });
});
