/**
 * Postgres-backed DataStore (Neon in production). Row shapes are
 * mapped to the shared domain types; numeric/bigint columns come back as
 * strings from node-postgres and are coerced here.
 */
import type {
  Alert,
  AlertConfiguration,
  AlertConfigurationInput,
  AlertHistoryFilters,
  AnalyticsSummary,
  StrategyDef,
  StrategyDefInput,
  StrategyStatus,
  StrategyVersion,
  UnderlyingGroup,
  UnderlyingGroupInput,
  Instrument,
  InstrumentType,
  UserPreferences,
} from '@ash/shared';
import { DEFAULT_USER_PREFERENCES } from '@ash/shared';
import type pg from 'pg';
import { getPool } from '../pool';
import type {
  AlertRepository,
  ConfigRepository,
  DataStore,
  GroupRepository,
  InstrumentRepository,
  KiteSessionRepository,
  KvRepository,
  LockRepository,
  MonitorStateRepository,
  NotificationLogRepository,
  PreferencesRepository,
  StrategyRepository,
} from '../store';
import { BUILTIN_INDICES_GROUP_ID, buildConfiguration, buildGroup, buildStrategy, indicesGroup, summarize } from '../store';
import type { KiteSessionRecord, MonitorState, NewAlert, NewNotificationLog, NotificationLog } from '../types';
import { DEFAULT_USER_ID } from '../constants';

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapAlert(r: any): Alert {
  return {
    id: r.id,
    configId: r.config_id,
    underlying: r.underlying,
    expiry: r.expiry,
    strike: Number(r.strike),
    timeframe: r.timeframe,
    strategy: r.strategy,
    scenario: r.scenario == null ? undefined : (Number(r.scenario) as 1 | 2),
    bucket: Number(r.bucket),
    snapshot: {
      futureRsi: Number(r.future_rsi),
      callRsi: Number(r.call_rsi),
      putRsi: Number(r.put_rsi),
      futurePrevRsi: r.future_prev_rsi == null ? undefined : Number(r.future_prev_rsi),
      callPrevRsi: r.call_prev_rsi == null ? undefined : Number(r.call_prev_rsi),
      putPrevRsi: r.put_prev_rsi == null ? undefined : Number(r.put_prev_rsi),
    },
    triggeredAt: new Date(r.triggered_at).toISOString(),
    title: r.title,
    strategyId: r.strategy_id ?? undefined,
    strategyName: r.strategy_name ?? undefined,
    variant: r.variant ?? undefined,
    conditions: r.conditions ?? undefined,
    groupId: r.group_id ?? undefined,
    groupName: r.group_name ?? undefined,
  };
}

function mapConfig(r: any): AlertConfiguration {
  return {
    id: r.id,
    underlying: r.underlying,
    expiryType: r.expiry_type,
    expiryDate: r.expiry_date ?? undefined,
    strikeSelection: r.strike_selection,
    customStrike: r.custom_strike == null ? undefined : Number(r.custom_strike),
    timeframe: r.timeframe,
    strategy: r.strategy,
    params: r.params,
    active: r.active,
    groupId: r.group_id ?? undefined,
    groupName: r.group_name ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

class PgAlertRepository implements AlertRepository {
  constructor(private readonly pool: pg.Pool) {}

  async insert(a: NewAlert): Promise<Alert | null> {
    const res = await this.pool.query(
      `INSERT INTO alerts
        (config_id, underlying, expiry, strike, timeframe, strategy, scenario, bucket,
         future_rsi, call_rsi, put_rsi, future_prev_rsi, call_prev_rsi, put_prev_rsi, title, triggered_at,
         strategy_id, strategy_name, variant, conditions, group_id, group_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        a.configId,
        a.underlying,
        a.expiry,
        a.strike,
        a.timeframe,
        a.strategy,
        a.scenario ?? null,
        a.bucket,
        a.snapshot.futureRsi,
        a.snapshot.callRsi,
        a.snapshot.putRsi,
        a.snapshot.futurePrevRsi ?? null,
        a.snapshot.callPrevRsi ?? null,
        a.snapshot.putPrevRsi ?? null,
        a.title,
        a.triggeredAt,
        a.strategyId ?? null,
        a.strategyName ?? null,
        a.variant ?? null,
        a.conditions ? JSON.stringify(a.conditions) : null,
        a.groupId ?? null,
        a.groupName ?? null,
      ],
    );
    return res.rows[0] ? mapAlert(res.rows[0]) : null;
  }

  async getById(id: string): Promise<Alert | null> {
    const res = await this.pool.query('SELECT * FROM alerts WHERE id = $1', [id]);
    return res.rows[0] ? mapAlert(res.rows[0]) : null;
  }

  async list(f: AlertHistoryFilters): Promise<Alert[]> {
    const where: string[] = [];
    const vals: unknown[] = [];
    const add = (clause: string, val: unknown) => {
      vals.push(val);
      where.push(clause.replace('?', `$${vals.length}`));
    };
    if (f.from) add('triggered_at >= ?', f.from);
    if (f.to) add('triggered_at <= ?', f.to);
    if (f.underlying) add('underlying = ?', f.underlying);
    if (f.expiry) add('expiry = ?', f.expiry);
    if (f.timeframe) add('timeframe = ?', f.timeframe);
    if (f.scenario) add('scenario = ?', f.scenario);
    if (f.strategyId) add('strategy_id = ?', f.strategyId);
    if (f.groupId) add('group_id = ?', f.groupId);
    if (f.configId) add('config_id = ?', f.configId);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    vals.push(f.limit ?? 100, f.offset ?? 0);
    const res = await this.pool.query(
      `SELECT * FROM alerts ${whereSql} ORDER BY triggered_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals,
    );
    return res.rows.map(mapAlert);
  }

  async analytics(): Promise<AnalyticsSummary> {
    const res = await this.pool.query('SELECT * FROM alerts ORDER BY triggered_at DESC LIMIT 5000');
    return summarize(res.rows.map(mapAlert));
  }
}

class PgConfigRepository implements ConfigRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: AlertConfigurationInput): Promise<AlertConfiguration> {
    const cfg = buildConfiguration(input);
    await this.pool.query(
      `INSERT INTO alert_configurations
        (id, user_id, underlying, expiry_type, expiry_date, strike_selection, custom_strike,
         timeframe, strategy, params, active, created_at, updated_at, group_id, group_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        cfg.id,
        DEFAULT_USER_ID,
        cfg.underlying,
        cfg.expiryType,
        cfg.expiryDate ?? null,
        cfg.strikeSelection,
        cfg.customStrike ?? null,
        cfg.timeframe,
        cfg.strategy,
        JSON.stringify(cfg.params),
        cfg.active,
        cfg.createdAt,
        cfg.updatedAt,
        cfg.groupId ?? null,
        cfg.groupName ?? null,
      ],
    );
    return cfg;
  }

  async update(id: string, patch: Partial<AlertConfigurationInput>): Promise<AlertConfiguration | null> {
    const current = await this.getById(id);
    if (!current) return null;
    const merged: AlertConfiguration = {
      ...current,
      ...patch,
      params: { ...current.params, ...patch.params },
      updatedAt: new Date().toISOString(),
    };
    await this.pool.query(
      `UPDATE alert_configurations SET underlying=$2, expiry_type=$3, strike_selection=$4,
        custom_strike=$5, timeframe=$6, strategy=$7, params=$8, updated_at=$9 WHERE id=$1`,
      [
        id,
        merged.underlying,
        merged.expiryType,
        merged.strikeSelection,
        merged.customStrike ?? null,
        merged.timeframe,
        merged.strategy,
        JSON.stringify(merged.params),
        merged.updatedAt,
      ],
    );
    return merged;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM alert_configurations WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async getById(id: string): Promise<AlertConfiguration | null> {
    const res = await this.pool.query('SELECT * FROM alert_configurations WHERE id = $1', [id]);
    return res.rows[0] ? mapConfig(res.rows[0]) : null;
  }

  async list(): Promise<AlertConfiguration[]> {
    const res = await this.pool.query('SELECT * FROM alert_configurations ORDER BY created_at DESC');
    return res.rows.map(mapConfig);
  }

  async listActive(): Promise<AlertConfiguration[]> {
    const res = await this.pool.query('SELECT * FROM alert_configurations WHERE active = true');
    return res.rows.map(mapConfig);
  }

  async setActive(id: string, active: boolean, expiryDate?: string): Promise<AlertConfiguration | null> {
    const res = await this.pool.query(
      `UPDATE alert_configurations
       SET active = $2, expiry_date = COALESCE($3, expiry_date), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, active, expiryDate ?? null],
    );
    return res.rows[0] ? mapConfig(res.rows[0]) : null;
  }
}

class PgNotificationLogRepository implements NotificationLogRepository {
  constructor(private readonly pool: pg.Pool) {}

  async insert(log: NewNotificationLog): Promise<NotificationLog> {
    const res = await this.pool.query(
      `INSERT INTO notification_logs (alert_id, channel, status, error)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [log.alertId, log.channel, log.status, log.error ?? null],
    );
    const r = res.rows[0];
    return {
      id: r.id,
      alertId: r.alert_id,
      channel: r.channel,
      status: r.status,
      error: r.error ?? undefined,
      sentAt: new Date(r.sent_at).toISOString(),
    };
  }

  async list(limit = 100): Promise<NotificationLog[]> {
    const res = await this.pool.query('SELECT * FROM notification_logs ORDER BY sent_at DESC LIMIT $1', [limit]);
    return res.rows.map((r: any) => ({
      id: r.id,
      alertId: r.alert_id,
      channel: r.channel,
      status: r.status,
      error: r.error ?? undefined,
      sentAt: new Date(r.sent_at).toISOString(),
    }));
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

class PgStrategyRepository implements StrategyRepository {
  constructor(private readonly pool: pg.Pool) {}

  private async persist(def: StrategyDef, versioned: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO custom_strategies (id, user_id, name, category, status, version, definition, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, category = EXCLUDED.category, status = EXCLUDED.status,
             version = EXCLUDED.version, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at`,
      [def.id, DEFAULT_USER_ID, def.name, def.category ?? null, def.status, def.version, JSON.stringify(def), def.createdAt, def.updatedAt],
    );
    if (versioned) {
      await this.pool.query(
        `INSERT INTO strategy_versions (strategy_id, version, definition) VALUES ($1,$2,$3)
         ON CONFLICT (strategy_id, version) DO NOTHING`,
        [def.id, def.version, JSON.stringify(def)],
      );
    }
  }

  async create(input: StrategyDefInput): Promise<StrategyDef> {
    const def = buildStrategy(input);
    await this.persist(def, true);
    return def;
  }

  async update(id: string, patch: Partial<StrategyDefInput>): Promise<StrategyDef | null> {
    const cur = await this.get(id);
    if (!cur) return null;
    const updated: StrategyDef = {
      ...cur,
      ...patch,
      root: patch.root ?? cur.root,
      version: cur.version + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(updated, true);
    return updated;
  }

  async get(id: string): Promise<StrategyDef | null> {
    const res = await this.pool.query('SELECT definition FROM custom_strategies WHERE id = $1', [id]);
    return res.rows[0] ? (res.rows[0].definition as StrategyDef) : null;
  }

  async list(): Promise<StrategyDef[]> {
    const res = await this.pool.query('SELECT definition FROM custom_strategies ORDER BY updated_at DESC');
    return res.rows.map((r: any) => r.definition as StrategyDef);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM custom_strategies WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async setStatus(id: string, status: StrategyStatus): Promise<StrategyDef | null> {
    const cur = await this.get(id);
    if (!cur) return null;
    const updated = { ...cur, status, updatedAt: new Date().toISOString() };
    await this.persist(updated, false);
    return updated;
  }

  async duplicate(id: string): Promise<StrategyDef | null> {
    const cur = await this.get(id);
    if (!cur) return null;
    const copy = buildStrategy({ ...cur, name: `${cur.name} (copy)`, status: 'draft' });
    await this.persist(copy, true);
    return copy;
  }

  async versions(id: string): Promise<StrategyVersion[]> {
    const res = await this.pool.query(
      'SELECT version, definition, created_at FROM strategy_versions WHERE strategy_id = $1 ORDER BY version DESC',
      [id],
    );
    return res.rows.map((r: any) => ({ version: r.version, createdAt: new Date(r.created_at).toISOString(), def: r.definition as StrategyDef }));
  }
}

class PgGroupRepository implements GroupRepository {
  constructor(private readonly pool: pg.Pool) {}

  private map(r: any): UnderlyingGroup {
    return {
      id: r.id,
      name: r.name,
      members: r.members,
      builtin: false,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async create(input: UnderlyingGroupInput): Promise<UnderlyingGroup> {
    const g = buildGroup(input);
    await this.pool.query(
      `INSERT INTO underlying_groups (id, user_id, name, members, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [g.id, DEFAULT_USER_ID, g.name, JSON.stringify(g.members), g.createdAt, g.updatedAt],
    );
    return g;
  }

  async update(id: string, patch: Partial<UnderlyingGroupInput>): Promise<UnderlyingGroup | null> {
    const cur = await this.get(id);
    if (!cur || cur.builtin) return null;
    const updated = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    await this.pool.query('UPDATE underlying_groups SET name=$2, members=$3, updated_at=$4 WHERE id=$1', [
      id,
      updated.name,
      JSON.stringify(updated.members),
      updated.updatedAt,
    ]);
    return updated;
  }

  async get(id: string): Promise<UnderlyingGroup | null> {
    if (id === BUILTIN_INDICES_GROUP_ID) return indicesGroup();
    const res = await this.pool.query('SELECT * FROM underlying_groups WHERE id = $1', [id]);
    return res.rows[0] ? this.map(res.rows[0]) : null;
  }

  async list(): Promise<UnderlyingGroup[]> {
    const res = await this.pool.query('SELECT * FROM underlying_groups ORDER BY name');
    return [indicesGroup(), ...res.rows.map((r: any) => this.map(r))];
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM underlying_groups WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }
}

class PgMonitorStateRepository implements MonitorStateRepository {
  constructor(private readonly pool: pg.Pool) {}

  private map(r: any): MonitorState {
    return {
      configId: r.config_id,
      strike: Number(r.strike),
      expiry: r.expiry,
      triplet: r.triplet,
      activatedAt: new Date(r.activated_at).toISOString(),
      lastBucket: r.last_bucket == null ? null : Number(r.last_bucket),
      snapshot: r.snapshot ?? null,
      lastError: r.last_error ?? null,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async get(configId: string): Promise<MonitorState | null> {
    const res = await this.pool.query('SELECT * FROM monitor_state WHERE config_id = $1', [configId]);
    return res.rows[0] ? this.map(res.rows[0]) : null;
  }

  async list(): Promise<MonitorState[]> {
    const res = await this.pool.query('SELECT * FROM monitor_state');
    return res.rows.map((r: any) => this.map(r));
  }

  async upsert(s: MonitorState): Promise<void> {
    await this.pool.query(
      `INSERT INTO monitor_state (config_id, strike, expiry, triplet, activated_at, last_bucket, snapshot, last_error, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (config_id) DO UPDATE SET
         strike = EXCLUDED.strike, expiry = EXCLUDED.expiry, triplet = EXCLUDED.triplet,
         activated_at = EXCLUDED.activated_at, last_bucket = EXCLUDED.last_bucket,
         snapshot = EXCLUDED.snapshot, last_error = EXCLUDED.last_error, updated_at = now()`,
      [
        s.configId,
        s.strike,
        s.expiry,
        JSON.stringify(s.triplet),
        s.activatedAt,
        s.lastBucket,
        s.snapshot ? JSON.stringify(s.snapshot) : null,
        s.lastError,
      ],
    );
  }

  async recordRun(configId: string, p: Pick<MonitorState, 'lastBucket' | 'snapshot' | 'lastError'>): Promise<void> {
    await this.pool.query(
      `UPDATE monitor_state
       SET last_bucket = CASE WHEN $2::bigint IS NULL THEN last_bucket
                              ELSE GREATEST(COALESCE(last_bucket, $2::bigint), $2::bigint) END,
           snapshot = COALESCE($3::jsonb, snapshot), last_error = $4, updated_at = now()
       WHERE config_id = $1`,
      [configId, p.lastBucket, p.snapshot ? JSON.stringify(p.snapshot) : null, p.lastError],
    );
  }

  async delete(configId: string): Promise<void> {
    await this.pool.query('DELETE FROM monitor_state WHERE config_id = $1', [configId]);
  }
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
      [
        k.accessTokenEnc ?? null,
        k.kiteUserId ?? null,
        k.userName ?? null,
        k.loginTime ?? null,
        k.expiresAt ?? null,
        k.state,
        k.lastError ?? null,
      ],
    );
  }

  async markState(state: KiteSessionRecord['state'], lastError?: string): Promise<void> {
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

class PgInstrumentRepository implements InstrumentRepository {
  constructor(private readonly pool: pg.Pool) {}

  async replaceAll(instruments: Instrument[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM instruments');
      const CHUNK = 5000;
      for (let i = 0; i < instruments.length; i += CHUNK) {
        const rows = instruments.slice(i, i + CHUNK);
        await client.query(
          `INSERT INTO instruments (token, tradingsymbol, underlying, exchange, instrument_type, strike, expiry, lot_size, tick_size)
           SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::text[], $8::int[], $9::numeric[])
           ON CONFLICT (token) DO NOTHING`,
          [
            rows.map((r) => r.token),
            rows.map((r) => r.tradingSymbol),
            rows.map((r) => r.underlying),
            rows.map((r) => r.exchange),
            rows.map((r) => r.instrumentType),
            rows.map((r) => r.strike),
            rows.map((r) => r.expiry),
            rows.map((r) => r.lotSize ?? null),
            rows.map((r) => r.tickSize ?? null),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async list(): Promise<Instrument[]> {
    const res = await this.pool.query('SELECT * FROM instruments');
    return res.rows.map((r: any) => ({
      token: Number(r.token),
      tradingSymbol: r.tradingsymbol,
      underlying: r.underlying,
      exchange: r.exchange as Instrument['exchange'],
      instrumentType: r.instrument_type as InstrumentType,
      strike: Number(r.strike),
      expiry: r.expiry,
      lotSize: r.lot_size ?? undefined,
      tickSize: r.tick_size == null ? undefined : Number(r.tick_size),
    }));
  }

  async count(): Promise<number> {
    const res = await this.pool.query('SELECT count(*)::int AS n FROM instruments');
    return res.rows[0]?.n ?? 0;
  }
}

class PgLockRepository implements LockRepository {
  constructor(private readonly pool: pg.Pool) {}

  async acquire(name: string, leaseSeconds: number, minIntervalSeconds: number): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO app_locks (name, locked_until) VALUES ($1, now() + make_interval(secs => $2))
       ON CONFLICT (name) DO UPDATE SET locked_until = EXCLUDED.locked_until
       WHERE app_locks.locked_until < now()
         AND (app_locks.last_run_at IS NULL OR app_locks.last_run_at < now() - make_interval(secs => $3))
       RETURNING name`,
      [name, leaseSeconds, minIntervalSeconds],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async release(name: string): Promise<void> {
    await this.pool.query('UPDATE app_locks SET locked_until = now(), last_run_at = now() WHERE name = $1', [name]);
  }
}

class PgKvRepository implements KvRepository {
  constructor(private readonly pool: pg.Pool) {}

  async get<T>(key: string): Promise<{ value: T; updatedAt: string } | null> {
    const res = await this.pool.query('SELECT value, updated_at FROM app_kv WHERE key = $1', [key]);
    const r = res.rows[0];
    return r ? { value: r.value as T, updatedAt: new Date(r.updated_at).toISOString() } : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
}

export class PgDataStore implements DataStore {
  readonly alerts: AlertRepository;
  readonly configs: ConfigRepository;
  readonly notifications: NotificationLogRepository;
  readonly preferences: PreferencesRepository;
  readonly strategies: StrategyRepository;
  readonly groups: GroupRepository;
  readonly monitors: MonitorStateRepository;
  readonly kite: KiteSessionRepository;
  readonly instruments: InstrumentRepository;
  readonly locks: LockRepository;
  readonly kv: KvRepository;

  constructor(pool: pg.Pool = getPool()) {
    this.alerts = new PgAlertRepository(pool);
    this.configs = new PgConfigRepository(pool);
    this.notifications = new PgNotificationLogRepository(pool);
    this.preferences = new PgPreferencesRepository(pool);
    this.strategies = new PgStrategyRepository(pool);
    this.groups = new PgGroupRepository(pool);
    this.monitors = new PgMonitorStateRepository(pool);
    this.kite = new PgKiteSessionRepository(pool);
    this.instruments = new PgInstrumentRepository(pool);
    this.locks = new PgLockRepository(pool);
    this.kv = new PgKvRepository(pool);
  }
}
