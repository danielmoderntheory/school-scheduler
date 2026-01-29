-- Make teacher_id, grade_id, subject_id nullable to support draft/incomplete classes
-- These will be validated at schedule generation time, not at data entry time

ALTER TABLE classes
  ALTER COLUMN teacher_id DROP NOT NULL,
  ALTER COLUMN grade_id DROP NOT NULL,
  ALTER COLUMN subject_id DROP NOT NULL;

-- Update the unique constraint to handle nulls properly (optional - remove if causing issues)
-- Note: In PostgreSQL, NULL values are considered distinct in unique constraints,
-- so multiple rows with NULL teacher_id are allowed by default.
