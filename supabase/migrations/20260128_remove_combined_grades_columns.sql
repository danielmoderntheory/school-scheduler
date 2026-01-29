-- Remove legacy combined grades columns from grades table
-- These columns are no longer used - multi-grade classes now use grade_ids array on classes table

ALTER TABLE grades
  DROP COLUMN IF EXISTS is_combined,
  DROP COLUMN IF EXISTS combined_grades;
