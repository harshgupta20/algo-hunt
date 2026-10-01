/**
 * App-level persistence outside V2: the Kite login session (encrypted token)
 * and the user's UI preferences. Everything strategy- and alert-related lives
 * in V2's own store (src/server/v2/persistence). Postgres when DATABASE_URL is
 * set, otherwise the local SQLite file (createAppStore picks).
 */
import type pg from 'pg';
import type { UserPreferences } from '@ash/shared';
import { DEFAULT_USER_PREFERENCES } from '@ash/shared';
import { getPool } from './pool';
import { getSqlite, usesPostgres, type DatabaseSync } from './sqlite';
import { memoryMode } from '../runtime';

/** Fixed single user of this deployment. */
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

export type KiteSessionState = 'needs-login' | 'connected' | 'error';

export interface KiteSessionRecord {
  /** Encrypted access token (base64 iv.tag.ciphertext). */
  accessTokenEnc?: string;
  kiteUserId?: string;
  userName?: string;
  loginTime?: string;
  /** Kite tokens are invalidated at ~06:00 IST the next day. */
  expiresAt?: string;
  state: KiteSessionState;
  lastError?: string;
  updatedAt?: string;
}

export interface KiteSessionRepository {
  get(): Promise<KiteSessionRecord | null>;
  save(record: KiteSessionRecord): Promise<void>;
  /** Flag the stored session as unusable (expired / revoked) without deleting the audit fields. */
  markState(state: KiteSessionState, lastError?: string): Promise<void>;
  clear(): Promise<void>;
}

export interface PreferencesRepository {
  get(): Promise<UserPreferences>;
  save(prefs: UserPreferences): Promise<UserPreferences>;
}

export interface AppStore {
  readonly kite: KiteSessionRepository;
  readonly preferences: PreferencesRepository;
}

class PgKiteSessionRepository implements KiteSessionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async get(): Promise<KiteSessionRecord | null> {
    const res = await this.pool.query('SELECT * FROM kite_session WHERE id = 1');
    const r = res.rows[0];
    if (!r) return null;
    const iso = (v: unknown) => (v == null ? undefined : new Date(v as string).toISOString());
    return {
      accessTokenEnc: r.access_token ?? undefined,
      kiteUserId: r.kite_user_id ?? undefined,
      userName: r.user_name ?? undefined,
      loginTime: iso(r.login_time),
      expiresAt: iso(r.expires_at),
      state: r.state,
      lastError: r.last_error ?? undefined,
      updatedAt: iso(r.updated_at),
    };
  }

  async save(k: KiteSessionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO kite_session (id, access_token, kite_user_id, user_name, login_time, expires_at, state, last_error, updated_at)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (id) DO UPDATE SET
         access_token = EXCLUDED.access_token, kite_user_id = EXCLUDED.kite_user_id, user_name = EXCLUDED.user_name,
         login_time = EXCLUDED.login_time, expires_at = EXCLUDED.expires_at, state = EXCLUDED.state,
         last_error = EXCLUDED.last_error, updated_at = now()`,
      [k.accessTokenEnc ?? null, k.kiteUserId ?? null, k.userName ?? null, k.loginTime ?? null, k.expiresAt ?? null, k.state, k.lastError ?? null],
    );
  }

  async markState(state: KiteSessionState, lastError?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO kite_session (id, state, last_error, updated_at) VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, last_error = EXCLUDED.last_error, updated_at = now()`,
      [state, lastError ?? null],
    );
  }

  async clear(): Promise<void> {
    await this.pool.query('DELETE FROM kite_session WHERE id = 1');
  }
}

class PgPreferencesRepository implements PreferencesRepository {
  constructor(private readonly pool: pg.Pool) {}

  async get(): Promise<UserPreferences> {
    const res = await this.pool.query('SELECT prefs FROM user_preferences WHERE user_id = $1', [DEFAULT_USER_ID]);
    return { ...DEFAULT_USER_PREFERENCES, ...(res.rows[0]?.prefs ?? {}) };
  }

  async save(prefs: UserPreferences): Promise<UserPreferences> {
    await this.pool.query(
      `INSERT INTO user_preferences (user_id, prefs, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`,
      [DEFAULT_USER_ID, JSON.stringify(prefs)],
    );
    return prefs;
  }
}

export class PgAppStore implements AppStore {
  readonly kite: KiteSessionRepository;
  readonly preferences: PreferencesRepository;

  constructor(pool: pg.Pool = getPool()) {
    this.kite = new PgKiteSessionRepository(pool);
    this.preferences = new PgPreferencesRepository(pool);
  }
}

// ---- SQLite (the local database) ---------------------------------------------------------------

class SqliteKiteSessionRepository implements KiteSessionRepository {
  constructor(private readonly db: DatabaseSync) {}

  async get(): Promise<KiteSessionRecord | null> {
    const r = this.db.prepare('SELECT * FROM kite_session WHERE id = 1').get() as Record<string, string | null> | undefined;
    if (!r) return null;
    return {
      accessTokenEnc: r.access_token ?? undefined,
      kiteUserId: r.kite_user_id ?? undefined,
      userName: r.user_name ?? undefined,
      loginTime: r.login_time ?? undefined,
      expiresAt: r.expires_at ?? undefined,
      state: r.state as KiteSessionState,
      lastError: r.last_error ?? undefined,
      updatedAt: r.updated_at ?? undefined,
    };
  }

  async save(k: KiteSessionRecord): Promise<void> {
    const iso = (v?: string) => (v ? new Date(v).toISOString() : null);
    this.db
      .prepare(
        `INSERT INTO kite_session (id, access_token, kite_user_id, user_name, login_time, expires_at, state, last_error, updated_at)
         VALUES (1,?,?,?,?,?,?,?,?)
         ON CONFLICT (id) DO UPDATE SET
           access_token = excluded.access_token, kite_user_id = excluded.kite_user_id, user_name = excluded.user_name,
           login_time = excluded.login_time, expires_at = excluded.expires_at, state = excluded.state,
           last_error = excluded.last_error, updated_at = excluded.updated_at`,
      )
      .run(k.accessTokenEnc ?? null, k.kiteUserId ?? null, k.userName ?? null, iso(k.loginTime), iso(k.expiresAt), k.state, k.lastError ?? null, new Date().toISOString());
  }

  async markState(state: KiteSessionState, lastError?: string): Promise<void> {
    this.db
      .prepare(`INSERT INTO kite_session (id, state, last_error, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state, last_error = excluded.last_error, updated_at = excluded.updated_at`)
      .run(state, lastError ?? null, new Date().toISOString());
  }

  async clear(): Promise<void> {
    this.db.prepare('DELETE FROM kite_session WHERE id = 1').run();
  }
}

class SqlitePreferencesRepository implements PreferencesRepository {
  constructor(private readonly db: DatabaseSync) {}

  async get(): Promise<UserPreferences> {
    const r = this.db.prepare('SELECT prefs FROM user_preferences WHERE user_id = ?').get(DEFAULT_USER_ID) as { prefs: string } | undefined;
    return { ...DEFAULT_USER_PREFERENCES, ...(r ? (JSON.parse(r.prefs) as Partial<UserPreferences>) : {}) };
  }

  async save(prefs: UserPreferences): Promise<UserPreferences> {
    this.db
      .prepare(`INSERT INTO user_preferences (user_id, prefs, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`)
      .run(DEFAULT_USER_ID, JSON.stringify(prefs), new Date().toISOString());
    return prefs;
  }
}

export class SqliteAppStore implements AppStore {
  readonly kite: KiteSessionRepository;
  readonly preferences: PreferencesRepository;

  constructor(db: DatabaseSync = getSqlite()) {
    this.kite = new SqliteKiteSessionRepository(db);
    this.preferences = new SqlitePreferencesRepository(db);
  }
}

// ---- in memory (one-process app, see runtime.ts) -----------------------------------------------------

const g = globalThis as unknown as { __ashAppState?: { kite?: KiteSessionRecord | null; prefs?: UserPreferences } };

/**
 * The Kite session and preferences read once and kept in memory, written through on change: the Kite status
 * is checked many times a minute (scanner, live worker, status bar) and would otherwise read the database each time.
 */
export class RuntimeAppStore implements AppStore {
  readonly kite: KiteSessionRepository;
  readonly preferences: PreferencesRepository;

  constructor(db: AppStore) {
    const st = (g.__ashAppState ??= {});
    const copy = <T>(v: T): T => (v == null ? v : structuredClone(v));
    this.kite = {
      get: async () => {
        if (st.kite === undefined) st.kite = await db.kite.get();
        return copy(st.kite);
      },
      save: async (r) => {
        await db.kite.save(r);
        st.kite = { ...copy(r), updatedAt: new Date().toISOString() };
      },
      markState: async (state, lastError) => {
        await db.kite.markState(state, lastError);
        const cur = st.kite === undefined ? await db.kite.get() : st.kite;
        st.kite = { ...(cur ?? {}), state, lastError, updatedAt: new Date().toISOString() };
      },
      clear: async () => {
        await db.kite.clear();
        st.kite = null;
      },
    };
    this.preferences = {
      get: async () => {
        st.prefs ??= await db.preferences.get();
        return copy(st.prefs);
      },
      save: async (prefs) => {
        st.prefs = copy(await db.preferences.save(prefs));
        return copy(st.prefs);
      },
    };
  }
}

/** The app store on the configured database (kept in memory when the app runs in one process). */
export function createAppStore(): AppStore {
  const db: AppStore = usesPostgres() ? new PgAppStore() : new SqliteAppStore();
  return memoryMode() ? new RuntimeAppStore(db) : db;
}
