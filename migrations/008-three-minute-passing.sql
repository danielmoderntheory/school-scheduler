-- 3-minute passing periods between classes (school decision, 2026-08-23).
-- Rewrites ONLY the time strings on the 26/27 9-Block template. Block numbers,
-- grade scoping, lunch assignment and the K-5 Block 8 -> conflictsWith [9]
-- straddle are all byte-identical to 007, so the solver model is unchanged:
-- EXISTING SCHEDULES STAY VALID AND DO NOT NEED REGENERATING. Only displayed
-- bell times move.
--
-- Every class-to-class transition gets a full 3 minutes (the morning break
-- absorbs its own passing time on both sides). Funded by morning meeting
-- 20 -> 12 min and by flattening the two 45-min blocks (6 and 7) to 40.
--
-- Two hard constraints from the other campus (Jim), whose bell schedule our
-- 10th and 12th graders join remotely -- see the block comment at the bottom:
--   * Block 4 must END by 11:10  (his Fri 10th English starts 11:10)
--   * Block 8 must END by 2:00   (his Fri TOK -- our 12th grade -- starts 2:00)
-- Both hold with 2 and 0 minutes of margin respectively. Do not shift the
-- morning later without re-checking them.
--
-- Block 9 runs 2:03-2:45 (42 min) so it ends with his Thu 12th English at 2:45.
-- Block 8, the K-5 last class (1:40-2:25) and K-5 SEL (2:30-2:45) are unchanged.
-- Safe to re-run: full rebuild of the template's rows, same as 001/006/007.

DO $$
DECLARE
  k5_names  text[] := ARRAY['kindergarten','1st','2nd','3rd','4th','5th'];
  k3_names  text[] := ARRAY['kindergarten','1st','2nd','3rd'];  -- keep B5 lunch
  ff_names  text[] := ARRAY['4th','5th'];                       -- on the MS lunch
  ms_names  text[] := ARRAY['6th','7th','8th'];
  hs_names  text[] := ARRAY['9th','10th','11th','12th'];
  k5 jsonb; k3 jsonb; ff jsonb; ms jsonb; hs jsonb;
  b5_ids jsonb;   -- teach 11:11 window: MS + HS + 4th/5th
  b6_ids jsonb;   -- teach 11:54 window: K-3rd + HS
  b7_ids jsonb;   -- teach 12:37 window: K-5 + MS
  b89_ids jsonb;  -- shared 1:20 / 2:03 windows: MS + HS
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
    jsonb_build_object('sort_order', 1,  'time', '8:00-8:12',  'label', 'Morning Meeting/SEL', 'type', 'transition'),
    jsonb_build_object('sort_order', 2,  'time', '8:12-8:52',  'label', 'Block 1', 'type', 'block', 'blockNumber', 1),
    jsonb_build_object('sort_order', 3,  'time', '8:55-9:35',  'label', 'Block 2', 'type', 'block', 'blockNumber', 2),
    -- 10-min break absorbs its own passing time on both sides
    jsonb_build_object('sort_order', 4,  'time', '9:35-9:45',  'label', 'Break', 'type', 'break'),
    jsonb_build_object('sort_order', 5,  'time', '9:45-10:25', 'label', 'Block 3', 'type', 'block', 'blockNumber', 3),
    -- Block 4 must end by 11:10 (other campus, Fri 10th English) -- 2 min margin
    jsonb_build_object('sort_order', 6,  'time', '10:28-11:08','label', 'Block 4', 'type', 'block', 'blockNumber', 4),
    -- 11:11-11:51: K-3rd eats; MS/HS/4th/5th teach Block 5
    jsonb_build_object('sort_order', 7,  'time', '11:11-11:51','label', 'Block 5', 'type', 'block', 'blockNumber', 5, 'grade_ids', b5_ids),
    jsonb_build_object('sort_order', 8,  'time', '11:11-11:51','label', 'Lunch', 'type', 'break', 'grade_ids', k3_lunch),
    -- 11:54-12:34: MS + 4th/5th eat; K-3rd/HS teach Block 6
    jsonb_build_object('sort_order', 9,  'time', '11:54-12:34','label', 'Block 6', 'type', 'block', 'blockNumber', 6, 'grade_ids', b6_ids),
    jsonb_build_object('sort_order', 10, 'time', '11:54-12:34','label', 'Lunch', 'type', 'break', 'grade_ids', ms45_lunch),
    -- 12:37-1:17: HS eats; K-5/MS teach Block 7
    jsonb_build_object('sort_order', 11, 'time', '12:37-1:17', 'label', 'Block 7', 'type', 'block', 'blockNumber', 7, 'grade_ids', b7_ids),
    jsonb_build_object('sort_order', 12, 'time', '12:37-1:17', 'label', 'Lunch', 'type', 'break', 'grade_ids', hs_lunch),
    -- Shared 1:20 window: MS/HS teach Block 8; K-5 is on Break.
    -- Block 8 must end by 2:00 (other campus, Fri TOK = our 12th) -- 0 margin.
    jsonb_build_object('sort_order', 13, 'time', '1:20-2:00',  'label', 'Block 8', 'type', 'block', 'blockNumber', 8, 'grade_ids', b89_ids),
    jsonb_build_object('sort_order', 14, 'time', '1:17-1:37',  'label', 'Break', 'type', 'break', 'grade_ids', k5_all),
    -- K-5 last class: straddles the shared Block 8 and Block 9 windows
    jsonb_build_object('sort_order', 15, 'time', '1:40-2:25',  'label', 'Block 8', 'type', 'block', 'blockNumber', 8, 'grade_ids', k5_all, 'conflictsWith', jsonb_build_array(9)),
    -- Shared 2:03 window: MS/HS teach Block 9 (42 min, ends with the other
    -- campus's Thu 12th English at 2:45); K-5 wraps up with SEL
    jsonb_build_object('sort_order', 16, 'time', '2:03-2:45',  'label', 'Block 9', 'type', 'block', 'blockNumber', 9, 'grade_ids', b89_ids),
    jsonb_build_object('sort_order', 17, 'time', '2:30-2:45',  'label', 'End of Day Meeting / SEL', 'type', 'transition', 'grade_ids', k5_all)
  );

  UPDATE timetable_templates SET rows = new_rows WHERE name = '26/27 9-Block';
  IF NOT FOUND THEN
    RAISE EXCEPTION '26/27 9-Block template not found';
  END IF;
  RAISE NOTICE 'Applied 3-minute passing periods to 26/27 9-Block template';
END $$;

-- Remote sessions this clock must keep clear (other campus, already in our DB):
--   12th: Mon B3-4 TOK | Tue B3-4 Eng A | Wed B1-2 Eng A | Thu B8-9 Eng A | Fri B9 TOK
--   10th: Tue B1-2 | Thu B3-4 | Fri B5-6  (English Lang & Lit)
-- Their campus labels our 12th grade's TOK class "11 TOK" -- the grade numbers
-- differ between campuses; this is not a data error.
