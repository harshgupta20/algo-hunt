-- V2: record who each delivery went to (one row per Telegram chat when alerts go to several chats).
ALTER TABLE v2_deliveries ADD COLUMN IF NOT EXISTS target TEXT;
