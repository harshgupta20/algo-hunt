-- v2_paper_trades as 010 defines it, on a database that ran an early draft of 010 before it was committed: that
-- draft had `unit_key` (required) instead of `slot`, and no "one open position per connection + slot" index. There
-- every paper trade failed to save ("column slot does not exist") and held up the whole save queue behind it.
-- On a database created from 010 as committed this changes nothing.
ALTER TABLE v2_paper_trades ADD COLUMN IF NOT EXISTS slot TEXT;
UPDATE v2_paper_trades SET slot = COALESCE(trade->>'slot', 'shift:0') WHERE slot IS NULL;
ALTER TABLE v2_paper_trades ALTER COLUMN slot SET NOT NULL;

-- The draft's unit_key: dropped when nothing is in it (nothing could be saved), otherwise just made optional.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'v2_paper_trades' AND column_name = 'unit_key') THEN
    IF EXISTS (SELECT 1 FROM v2_paper_trades WHERE unit_key IS NOT NULL) THEN
      ALTER TABLE v2_paper_trades ALTER COLUMN unit_key DROP NOT NULL;
    ELSE
      DROP INDEX IF EXISTS v2_paper_trades_unit_idx;
      ALTER TABLE v2_paper_trades DROP COLUMN unit_key;
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS v2_paper_trades_one_open ON v2_paper_trades (connection_id, slot) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS v2_paper_trades_strategy_idx ON v2_paper_trades (strategy_id, entry_at DESC);
