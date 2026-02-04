-- Add is_cotaught column to classes table
-- Classes explicitly marked as co-taught will be constrained to the same time slot
ALTER TABLE classes ADD COLUMN is_cotaught BOOLEAN DEFAULT false;

-- Auto-flag existing co-taught classes (same grade_ids + subject_id, different teacher_id, same quarter)
WITH cotaught AS (
  SELECT c1.id
  FROM classes c1
  JOIN classes c2 ON c1.subject_id = c2.subject_id
    AND c1.teacher_id != c2.teacher_id
    AND c1.grade_ids = c2.grade_ids
    AND c1.quarter_id = c2.quarter_id
)
UPDATE classes SET is_cotaught = true WHERE id IN (SELECT id FROM cotaught);

-- Backfill is_cotaught into existing schedule snapshots (schedule_generations.stats.classes_snapshot)
-- For each snapshot entry, detect co-taught (same grade_ids + subject_id, different teacher_id)
-- and set is_cotaught = true on matching entries.
UPDATE schedule_generations
SET stats = jsonb_set(
  stats,
  '{classes_snapshot}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(stats->'classes_snapshot') other
            WHERE other->>'subject_id' = elem->>'subject_id'
              AND other->>'teacher_name' != elem->>'teacher_name'
              AND other->'grade_ids' = elem->'grade_ids'
          )
        THEN elem || '{"is_cotaught": true}'::jsonb
        ELSE elem || '{"is_cotaught": false}'::jsonb
      END
    )
    FROM jsonb_array_elements(stats->'classes_snapshot') elem
  )
)
WHERE stats->'classes_snapshot' IS NOT NULL
  AND jsonb_array_length(stats->'classes_snapshot') > 0;
