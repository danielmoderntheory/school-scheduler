-- Migration tracking.
-- Until now nothing recorded which migrations a database had received, so
-- environments drifted silently: staging sat three template migrations behind
-- production (its 26/27 Block 1 was still 8:20-9:00) and nobody could tell
-- without probing the schema for each migration's fingerprint.
--
-- scripts/migrate.sh applies every migrations/*.sql not listed here, in
-- filename order, and records it. Numbered 000 so it sorts FIRST: it has to
-- create the table and backfill before any later migration is considered,
-- or the backfill could never take effect. Safe to re-run.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill for databases that already ran 001-009 by hand.
-- Guarded on timetable_templates, which 001 creates: an ESTABLISHED database
-- has it and its earlier migrations are genuinely applied, so recording them
-- keeps the runner from re-running data migrations (006-008 rewrite the 26/27
-- template) against production for no reason. A FRESH database has no such
-- table, records nothing here, and the runner applies 001 onward normally.
INSERT INTO schema_migrations (filename)
SELECT f FROM (VALUES
  ('001-block-format-per-quarter.sql'),
  ('002-teacher-lunch-and-12th-study-hall.sql'),
  ('003-double-period-subjects.sql'),
  ('004-per-class-double-periods.sql'),
  ('005-study-hall-default-eligible.sql'),
  ('006-k5-afternoon-template.sql'),
  ('007-45-ms-lunch.sql'),
  ('008-three-minute-passing.sql'),
  ('009-subject-short-name.sql')
) AS m(f)
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables WHERE table_name = 'timetable_templates'
)
ON CONFLICT (filename) DO NOTHING;
