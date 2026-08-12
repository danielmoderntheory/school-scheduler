-- Double-period subjects + lessons-per-week widening
-- A flagged subject pairs its weekly lessons into consecutive same-day doubles
-- (odd remainder = one single meeting), at most one meeting per day.
-- classes.days_per_week now means LESSONS (blocks) per week; for unflagged
-- subjects lessons == days so existing data is unchanged. Lessons above 5
-- require the subject's double-period flag (enforced in app preflight).
-- Safe to re-run.

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS requires_double_periods BOOLEAN DEFAULT false;

ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_days_per_week_check;
ALTER TABLE classes ADD CONSTRAINT classes_days_per_week_check CHECK (days_per_week BETWEEN 1 AND 10);
