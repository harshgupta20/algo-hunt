-- Light is now the default theme. Migration 004 seeded the default user with
-- "dark" back when the UI had no light mode (so it was never a real choice);
-- switch that seeded value to "light". Theme changes made in the UI afterwards
-- are ordinary preference updates and are not touched by later migrations.
UPDATE user_preferences
SET prefs = jsonb_set(prefs, '{theme}', '"light"'), updated_at = now()
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND prefs->>'theme' = 'dark';
