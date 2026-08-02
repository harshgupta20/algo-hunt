/**
 * Seed the default user, strategy definitions, and default preferences.
 * Idempotent. Run with: npm run db:seed
 */
import { DEFAULT_USER_PREFERENCES } from '@ash/shared';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { createStrategyEngine } from '../services/strategy/StrategyEngine.js';
import { closePool, getPool } from './pool.js';
import { DEFAULT_USER_EMAIL, DEFAULT_USER_ID } from './constants.js';

async function seed(): Promise<void> {
  if (!config.hasDatabase) {
    logger.error('DATABASE_URL is not set; nothing to seed.');
    process.exit(1);
  }
  const pool = getPool();

  await pool.query(
    `INSERT INTO users (id, email, name) VALUES ($1, $2, 'Default User')
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_USER_ID, DEFAULT_USER_EMAIL],
  );

  const engine = createStrategyEngine();
  for (const s of engine.list()) {
    await pool.query(
      `INSERT INTO strategies (key, name, description, default_params, enabled)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (key) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description, default_params = EXCLUDED.default_params`,
      [s.definition.key, s.definition.name, s.definition.description, JSON.stringify(s.definition.defaultParams)],
    );
  }

  await pool.query(
    `INSERT INTO user_preferences (user_id, prefs) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [DEFAULT_USER_ID, JSON.stringify(DEFAULT_USER_PREFERENCES)],
  );

  await closePool();
  logger.info('seed complete');
}

seed().catch((err) => {
  logger.error({ err }, 'seed crashed');
  process.exit(1);
});
