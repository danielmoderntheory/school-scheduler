-- 4th/5th join the middle-school lunch (school decision, 2026-08-13).
-- Their day becomes: teach Blocks 1-5, lunch 11:50-12:35 (Block 6 window,
-- with 6th-8th), teach Blocks 7-8(shifted), Break, last class, SEL.
-- Template-only change: K-3rd keep Block 5 lunch; the K-5 afternoon rows
-- (Break / shifted Block 8 with conflictsWith 9 / SEL) still cover ALL of K-5
-- including 4th/5th. Requires regenerating any 26/27 schedule generated
-- before this change (4/5 classes may sit in the Block 6 window).
-- Safe to re-run: full rebuild of the template's rows, same as 001/006.

DO $$
DECLARE
  k5_names  text[] := ARRAY['kindergarten','1st','2nd','3rd','4th','5th'];
  k3_names  text[] := ARRAY['kindergarten','1st','2nd','3rd'];  -- keep B5 lunch
  ff_names  text[] := ARRAY['4th','5th'];                       -- move to MS lunch
  ms_names  text[] := ARRAY['6th','7th','8th'];
  hs_names  text[] := ARRAY['9th','10th','11th','12th'];
  k5 jsonb; k3 jsonb; ff jsonb; ms jsonb; hs jsonb;
  b5_ids jsonb;   -- teach 11:10 window: MS + HS + 4th/5th
  b6_ids jsonb;   -- teach 11:50 window: K-3rd + HS
  b7_ids jsonb;   -- teach 12:35 window: K-5 + MS
  b89_ids jsonb;  -- shared 1:20 / 2:05 windows: MS + HS
  k3_lunch jsonb; ms45_lunch jsonb; hs_lunch jsonb;
  k5_all jsonb;   -- K-5 afternoon rows (break / shifted B8 / SEL)
  new_rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO k5
    FROM grades WHERE deleted_at IS NULL AND is_combined = false AND name = ANY(k5_names);
  SELECT COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO k3
    FROM grades WHERE deleted_at IS NULL AND is_combined = false AND name = ANY(k3_names);
  SELECT COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO ff
    FROM grades WHERE deleted_at IS NULL AND is_combined = false AND name = ANY(ff_names);
  SELECT COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO ms
    FROM grades WHERE deleted_at IS NULL AND is_combined = false AND name = ANY(ms_names);
  SELECT COALESCE(jsonb_agg(id ORDER BY sort_order), '[]'::jsonb) INTO hs
    FROM grades WHERE deleted_at IS NULL AND is_combined = false AND name = ANY(hs_names);

  IF k3 = '[]'::jsonb OR ff = '[]'::jsonb OR ms = '[]'::jsonb OR hs = '[]'::jsonb THEN
    RAISE EXCEPTION 'Grade lookup failed (K-3: %, 4/5: %, MS: %, HS: %)', k3, ff, ms, hs;
  END IF;

  b5_ids     := ms || hs || ff;
  b6_ids     := k3 || hs;
  b7_ids     := k5 || ms;
  b89_ids    := ms || hs;
  k3_lunch   := k3;
  ms45_lunch := ms || ff;
  hs_lunch   := hs;
  k5_all     := k5;

  new_rows := jsonb_build_array(
    jsonb_build_object('sort_order', 1,  'time', '8:00-8:20',  'label', 'Morning Meeting/SEL', 'type', 'transition'),
    jsonb_build_object('sort_order', 2,  'time', '8:20-9:00',  'label', 'Block 1', 'type', 'block', 'blockNumber', 1),
    jsonb_build_object('sort_order', 3,  'time', '9:00-9:40',  'label', 'Block 2', 'type', 'block', 'blockNumber', 2),
    jsonb_build_object('sort_order', 4,  'time', '9:40-9:50',  'label', 'Break', 'type', 'break'),
    jsonb_build_object('sort_order', 5,  'time', '9:50-10:30', 'label', 'Block 3', 'type', 'block', 'blockNumber', 3),
    jsonb_build_object('sort_order', 6,  'time', '10:30-11:10','label', 'Block 4', 'type', 'block', 'blockNumber', 4),
    -- 11:10-11:50: K-3rd eats; MS/HS/4th/5th teach Block 5
    jsonb_build_object('sort_order', 7,  'time', '11:10-11:50','label', 'Block 5', 'type', 'block', 'blockNumber', 5, 'grade_ids', b5_ids),
    jsonb_build_object('sort_order', 8,  'time', '11:10-11:50','label', 'Lunch', 'type', 'break', 'grade_ids', k3_lunch),
    -- 11:50-12:35: MS + 4th/5th eat; K-3rd/HS teach Block 6
    jsonb_build_object('sort_order', 9,  'time', '11:50-12:35','label', 'Block 6', 'type', 'block', 'blockNumber', 6, 'grade_ids', b6_ids),
    jsonb_build_object('sort_order', 10, 'time', '11:50-12:35','label', 'Lunch', 'type', 'break', 'grade_ids', ms45_lunch),
    -- 12:35-1:20: HS eats; K-5/MS teach Block 7
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
  RAISE NOTICE 'Applied 4th/5th MS-lunch rescope to 26/27 9-Block template';
END $$;
