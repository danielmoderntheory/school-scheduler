-- K-5 afternoon restructure (Brittany's break + SEL plan), 26/27 9-Block template.
-- K-5 gives up Block 9. New K-5 afternoon on the shared clock:
--   Block 7 ends 1:20 -> Break 1:20-1:40 -> last class 1:40-2:25 (K-5's Block 8,
--   straddling the shared Block 8 AND Block 9 windows) -> SEL 2:30-2:45.
-- The K-5 Block 8 row carries "conflictsWith": [9]: a teacher teaching K-5 at
-- Block 8 is really busy until 2:25, so they can hold nothing at Block 9 that
-- day. Solvers enforce this via the grade_block_conflicts payload field.
--
-- DO NOT APPLY until the straddle-rule code (backend + frontend) is deployed:
-- this flips the active 26/27 quarter to the 7-block K-5 week immediately.
-- Safe to re-run (rebuilds the template's rows from scratch, same as 001).

DO $$
DECLARE
  k5_names  text[] := ARRAY['kindergarten','1st','2nd','3rd','4th','5th'];
  ms_names  text[] := ARRAY['6th','7th','8th'];
  hs_names  text[] := ARRAY['9th','10th','11th','12th'];
  k5 jsonb; ms jsonb; hs jsonb;
  b5_ids jsonb;   -- can teach 11:10 window (MS+HS members only)
  b6_ids jsonb;   -- can teach 11:50 window (K5+HS members only)
  b7_ids jsonb;   -- can teach 12:35 window (K5+MS members only)
  b89_ids jsonb;  -- can teach the shared 1:20 / 2:05 windows (MS+HS only now)
  k5_all jsonb;   -- K-5 members + combined grades fully inside K-5
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
    RAISE EXCEPTION 'Band grade lookup failed (K-5: %, MS: %, HS: %)', k5, ms, hs;
  END IF;

  SELECT ms || hs || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO b5_ids
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ (ms_names || hs_names);
  SELECT k5 || hs || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO b6_ids
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ (k5_names || hs_names);
  SELECT k5 || ms || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO b7_ids
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ (k5_names || ms_names);
  -- Blocks 8/9 on the shared clock: MS/HS only (K-5 has its own afternoon now)
  SELECT ms || hs || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO b89_ids
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ (ms_names || hs_names);
  -- K-5 afternoon rows: K-5 members + combined grades fully inside K-5 (K/1, 4/5)
  SELECT k5 || COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO k5_all
    FROM grades WHERE deleted_at IS NULL AND is_combined = true
    AND combined_grades <@ k5_names;

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
    jsonb_build_object('sort_order', 7,  'time', '11:10-11:50','label', 'Block 5', 'type', 'block', 'blockNumber', 5, 'grade_ids', b5_ids),
    jsonb_build_object('sort_order', 8,  'time', '11:10-11:50','label', 'Lunch', 'type', 'break', 'grade_ids', k5_lunch),
    jsonb_build_object('sort_order', 9,  'time', '11:50-12:35','label', 'Block 6', 'type', 'block', 'blockNumber', 6, 'grade_ids', b6_ids),
    jsonb_build_object('sort_order', 10, 'time', '11:50-12:35','label', 'Lunch', 'type', 'break', 'grade_ids', ms_lunch),
    jsonb_build_object('sort_order', 11, 'time', '12:35-1:20', 'label', 'Block 7', 'type', 'block', 'blockNumber', 7, 'grade_ids', b7_ids),
    jsonb_build_object('sort_order', 12, 'time', '12:35-1:20', 'label', 'Lunch', 'type', 'break', 'grade_ids', hs_lunch),
    -- Shared 1:20 window: MS/HS teach Block 8; K-5 is on Break
    jsonb_build_object('sort_order', 13, 'time', '1:20-2:00',  'label', 'Block 8', 'type', 'block', 'blockNumber', 8, 'grade_ids', b89_ids),
    jsonb_build_object('sort_order', 14, 'time', '1:20-1:40',  'label', 'Break', 'type', 'break', 'grade_ids', k5_all),
    -- K-5 last class: straddles the shared Block 8 and Block 9 windows
    jsonb_build_object('sort_order', 15, 'time', '1:40-2:25',  'label', 'Block 8', 'type', 'block', 'blockNumber', 8, 'grade_ids', k5_all, 'conflictsWith', jsonb_build_array(9)),
    -- Shared 2:05 window: MS/HS teach Block 9; K-5 wraps up with SEL
    jsonb_build_object('sort_order', 16, 'time', '2:05-2:45',  'label', 'Block 9', 'type', 'block', 'blockNumber', 9, 'grade_ids', b89_ids),
    jsonb_build_object('sort_order', 17, 'time', '2:30-2:45',  'label', 'End of Day Meeting / SEL', 'type', 'transition', 'grade_ids', k5_all)
  );

  UPDATE timetable_templates SET rows = new_rows WHERE name = '26/27 9-Block';
  IF NOT FOUND THEN
    RAISE EXCEPTION '26/27 9-Block template not found';
  END IF;
  RAISE NOTICE 'Applied K-5 afternoon restructure to 26/27 9-Block template';
END $$;
