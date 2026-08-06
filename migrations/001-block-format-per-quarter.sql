-- Block format per quarter
-- Each quarter references a timetable template; the template's block rows define
-- the quarter's block count (5-block for 25/26 and earlier, 9-block for 26/27+).
-- Also adds 12th Grade (new for 2026-27).
-- Safe to re-run: every statement is guarded; the template seed is an upsert.

-- 1. Quarters reference their timetable template
ALTER TABLE quarters ADD COLUMN IF NOT EXISTS timetable_template_id UUID REFERENCES timetable_templates(id);

-- 2. Name the existing template after the era it describes
UPDATE timetable_templates SET name = '25/26 5-Block' WHERE name = 'Default';

-- 3. Backfill all existing quarters to the original (oldest) template
UPDATE quarters
SET timetable_template_id = (
  SELECT id FROM timetable_templates
  WHERE deleted_at IS NULL
  ORDER BY created_at
  LIMIT 1
)
WHERE timetable_template_id IS NULL;

-- 4. Add 12th Grade (new for 2026-27)
INSERT INTO grades (name, display_name, is_combined, combined_grades, sort_order)
SELECT '12th', '12th Grade', false, NULL, (SELECT MAX(sort_order) + 1 FROM grades)
WHERE NOT EXISTS (
  SELECT 1 FROM grades WHERE name = '12th' OR display_name = '12th Grade'
);

-- 5. Seed/refresh the 26/27 9-block template ("Distribución 2026-2027")
-- 9 shared windows P1-P9 on one clock for every band; lunch occupies one
-- numbered block per band (standard US band split):
--   K-5 -> Block 5, MS (6th-8th) -> Block 6, HS (9th-12th) -> Block 7.
-- Morning meeting and break are display-only rows (type transition/break).
-- Combined/elective grade rows (e.g. 6th-7th, 10th-11th, 6th-11th elective) are
-- scoped into a block row only when EVERY member grade can teach that block.
DO $$
DECLARE
  k5_names  text[] := ARRAY['kindergarten','1st','2nd','3rd','4th','5th'];
  ms_names  text[] := ARRAY['6th','7th','8th'];
  hs_names  text[] := ARRAY['9th','10th','11th','12th'];
  k5 jsonb; ms jsonb; hs jsonb;
  b5_ids jsonb;  -- can teach 11:10 window (MS+HS members only)
  b6_ids jsonb;  -- can teach 11:50 window (K5+HS members only)
  b7_ids jsonb;  -- can teach 12:35 window (K5+MS members only)
  k5_lunch jsonb; ms_lunch jsonb; hs_lunch jsonb;
  new_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO k5
    FROM grades WHERE deleted_at IS NULL AND is_combined = false AND name = ANY(k5_names);
  SELECT COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO ms
    FROM grades WHERE deleted_at IS NULL AND is_combined = false AND name = ANY(ms_names);
  SELECT COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO hs
    FROM grades WHERE deleted_at IS NULL AND is_combined = false AND name = ANY(hs_names);

  IF k5 = '[]'::jsonb OR ms = '[]'::jsonb OR hs = '[]'::jsonb THEN
    RAISE EXCEPTION 'Band grade lookup failed (K-5: %, MS: %, HS: %) - check grade names before seeding', k5, ms, hs;
  END IF;

  -- Block eligibility per window: individual band members plus any combined
  -- grade whose members are ALL inside the allowed set for that window.
  SELECT ms || hs || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO b5_ids
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ (ms_names || hs_names);
  SELECT k5 || hs || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO b6_ids
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ (k5_names || hs_names);
  SELECT k5 || ms || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO b7_ids
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ (k5_names || ms_names);

  -- Lunch display rows: band members plus combined grades fully inside the band
  SELECT k5 || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO k5_lunch
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ k5_names;
  SELECT ms || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO ms_lunch
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ ms_names;
  SELECT hs || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO hs_lunch
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ hs_names;

  new_rows := jsonb_build_array(
    jsonb_build_object('sort_order', 1,  'time', '8:00-8:20',  'label', 'Morning Meeting/SEL', 'type', 'transition'),
    jsonb_build_object('sort_order', 2,  'time', '8:20-9:00',  'label', 'Block 1', 'type', 'block', 'blockNumber', 1),
    jsonb_build_object('sort_order', 3,  'time', '9:00-9:40',  'label', 'Block 2', 'type', 'block', 'blockNumber', 2),
    jsonb_build_object('sort_order', 4,  'time', '9:40-9:50',  'label', 'Break', 'type', 'break'),
    jsonb_build_object('sort_order', 5,  'time', '9:50-10:30', 'label', 'Block 3', 'type', 'block', 'blockNumber', 3),
    jsonb_build_object('sort_order', 6,  'time', '10:30-11:10','label', 'Block 4', 'type', 'block', 'blockNumber', 4),
    -- 11:10-11:50: K-5 eats, MS/HS teach Block 5
    jsonb_build_object('sort_order', 7,  'time', '11:10-11:50','label', 'Block 5', 'type', 'block', 'blockNumber', 5, 'grade_ids', b5_ids),
    jsonb_build_object('sort_order', 8,  'time', '11:10-11:50','label', 'Lunch', 'type', 'break', 'grade_ids', k5_lunch),
    -- 11:50-12:35: MS eats, K-5/HS teach Block 6
    jsonb_build_object('sort_order', 9,  'time', '11:50-12:35','label', 'Block 6', 'type', 'block', 'blockNumber', 6, 'grade_ids', b6_ids),
    jsonb_build_object('sort_order', 10, 'time', '11:50-12:35','label', 'Lunch', 'type', 'break', 'grade_ids', ms_lunch),
    -- 12:35-1:20: HS eats, K-5/MS teach Block 7
    jsonb_build_object('sort_order', 11, 'time', '12:35-1:20', 'label', 'Block 7', 'type', 'block', 'blockNumber', 7, 'grade_ids', b7_ids),
    jsonb_build_object('sort_order', 12, 'time', '12:35-1:20', 'label', 'Lunch', 'type', 'break', 'grade_ids', hs_lunch),
    jsonb_build_object('sort_order', 13, 'time', '1:20-2:00',  'label', 'Block 8', 'type', 'block', 'blockNumber', 8),
    jsonb_build_object('sort_order', 14, 'time', '2:05-2:45',  'label', 'Block 9', 'type', 'block', 'blockNumber', 9)
  );

  IF EXISTS (SELECT 1 FROM timetable_templates WHERE name = '26/27 9-Block') THEN
    UPDATE timetable_templates SET rows = new_rows WHERE name = '26/27 9-Block';
    RAISE NOTICE 'Refreshed 26/27 9-Block template rows';
  ELSE
    INSERT INTO timetable_templates (name, rows) VALUES ('26/27 9-Block', new_rows);
    RAISE NOTICE 'Seeded 26/27 9-Block template';
  END IF;
END $$;
