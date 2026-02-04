-- Add updated_at column to classes table
ALTER TABLE classes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill: set updated_at = created_at for existing rows
UPDATE classes SET updated_at = created_at WHERE updated_at IS NULL;

-- Make it non-nullable after backfill
ALTER TABLE classes ALTER COLUMN updated_at SET NOT NULL;

-- Auto-update on row modification
CREATE OR REPLACE FUNCTION update_classes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS classes_set_updated_at ON classes;
CREATE TRIGGER classes_set_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW
  EXECUTE FUNCTION update_classes_updated_at();
