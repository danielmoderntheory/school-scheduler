-- Teacher lunch rule + 12th grade study hall config
-- Safe to re-run: every statement is guarded.

-- 1. Teacher lunch hard constraint (26/27 block formats).
-- Every teacher must keep at least one free block among the lunch windows of
-- the bands they teach, each day. Only binds for cross-band teachers on
-- formats with per-grade lunch masks; no-op on the legacy 5-block format.
INSERT INTO rules (name, description, rule_key, rule_type, priority, enabled)
SELECT
  'Teacher Lunch',
  'Every teacher keeps at least one free block among their students'' lunch windows each day (only affects teachers who teach across bands with different lunch blocks)',
  'teacher_lunch',
  'hard',
  0,
  true
WHERE NOT EXISTS (SELECT 1 FROM rules WHERE rule_key = 'teacher_lunch');

-- 2. 12th grade gets a weekly study hall like 6th-11th
UPDATE rules
SET config = jsonb_set(config, '{grades}', (config->'grades') || '"12th Grade"'::jsonb)
WHERE rule_key = 'study_hall_grades'
  AND config ? 'grades'
  AND NOT (config->'grades') @> '"12th Grade"'::jsonb;

-- 3. Teachers who teach 12th are eligible study hall supervisors
UPDATE rules
SET config = jsonb_set(config, '{require_teaches_grades}', (config->'require_teaches_grades') || '"12th Grade"'::jsonb)
WHERE rule_key = 'study_hall_teacher_eligibility'
  AND config ? 'require_teaches_grades'
  AND NOT (config->'require_teaches_grades') @> '"12th Grade"'::jsonb;
