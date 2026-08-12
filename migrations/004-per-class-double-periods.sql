-- Per-class double periods
-- The authoritative "meets in back-to-back double blocks" setting moves from
-- the subject (with an implicit 6th-grade threshold) to the class itself,
-- visible and editable in class setup. Safe to re-run.

ALTER TABLE classes ADD COLUMN IF NOT EXISTS double_periods BOOLEAN NOT NULL DEFAULT false;
