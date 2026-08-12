"""Block-format parameterization tests for the CP-SAT solver.

Covers:
  (a) 9-block solve with per-band lunch masks (grade_teachable_blocks) -
      no session lands in a masked block, no teacher/grade conflicts
  (b) forced same-block cross-band overlap is infeasible
  (c) 5-block regression - old-style input with no new fields solves as
      before (fixed slots honored, slots < 25), including after a 9-block
      request (module block state must reset)
  (d) multi-grade class spanning MS+HS avoids both bands' lunch blocks
  (e) preflight caps use the dynamic block counts and per-grade teachable
      counts; fixed slots pinned to a masked block fail preflight
  (f) teacher_lunch hard constraint: a heavily loaded cross-band teacher
      keeps at least one candidate lunch window free every day
  (g) teacher_lunch preflight: fixed slots filling every candidate window
      on a day fail with a message naming teacher + day
  (h) teacher_lunch rule disabled -> constraint off, scenario (g) solves
  (i) legacy requests (no grade_teachable_blocks) -> no lunch constraint
  (j) study hall assignment never takes a supervisor's last free candidate
      lunch window
  (k) double periods: flagged L=7 -> 3 legal-pair doubles + 1 single on 4
      distinct days; flagged L=4 -> 2 doubles on 2 days; multi-grade flagged
      class uses only the intersection of its grades' pairs; pairs never
      straddle a covered grade's lunch
  (l) double-period preflight: unflagged L>5 errors suggesting the subject
      flag; flagged class with zero shared legal pairs errors naming class
      and grades; fixed slots must form same-day legal pairs (+ at most one
      lone single)
  (m) pinned pairs solve (duplicate-subject rule exempts within-pair repeats
      only); a same-day repeat that is NOT a pair stays forbidden; legacy
      requests carry no pairing metadata

Run: ./venv/bin/python test_block_formats.py
"""
import sys
sys.path.insert(0, '.')

import solver
from solver import (
    Teacher, ClassEntry, build_sessions, solve_with_cpsat,
    generate_schedules, set_blocks, DAYS,
    compute_teacher_lunch_candidates, add_study_halls,
)

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, cond, detail=""):
    results.append((name, cond))
    print(f"  [{PASS if cond else FAIL}] {name}" + (f" — {detail}" if detail else ""))


# ---------------------------------------------------------------- scenario
NINE_BLOCKS = list(range(1, 10))
LUNCH = {'K5': 5, 'MS': 6, 'HS': 7}
BAND = {'1st Grade': 'K5', '2nd Grade': 'K5', '7th Grade': 'MS', '10th Grade': 'HS'}
GRADES = list(BAND.keys())

# grade name -> teachable blocks (9 blocks minus the band's lunch block)
MASKS = {g: [b for b in NINE_BLOCKS if b != LUNCH[BAND[g]]] for g in GRADES}

RULES = [
    {'rule_key': 'no_duplicate_subjects', 'enabled': True, 'config': None},
    {'rule_key': 'no_btb_open', 'enabled': True, 'config': None},
    {'rule_key': 'spread_open', 'enabled': True, 'config': None},
    {'rule_key': 'study_hall_distribution', 'enabled': True, 'config': None},
    {'rule_key': 'study_hall_grades', 'enabled': True, 'config': {'grades': ['7th Grade']}},
]

TEACHERS = [
    {'name': 'Karla', 'status': 'full-time'},
    {'name': 'Carolina', 'status': 'full-time'},
    {'name': 'Shary', 'status': 'full-time'},
    {'name': 'Ricardo', 'status': 'full-time'},
    {'name': 'Oscar', 'status': 'full-time'},
    {'name': 'Isa', 'status': 'full-time'},
]


def make_class(teacher, grades, subject, days, fixed=None, elective=False):
    return {
        'teacher': teacher, 'grades': grades, 'subject': subject,
        'daysPerWeek': days, 'isElective': elective, 'fixedSlots': fixed,
    }


def make_classes(oscar_fixed=None):
    classes = []
    for grade, hr in [('1st Grade', 'Karla'), ('2nd Grade', 'Carolina'),
                      ('7th Grade', 'Shary'), ('10th Grade', 'Ricardo')]:
        for subj in ['Math', 'ELA', 'Science', 'Social Studies']:
            classes.append(make_class(hr, [grade], subj, 4))
    # Oscar crosses all three bands
    for grade in ['1st Grade', '7th Grade', '10th Grade']:
        fixed = (oscar_fixed or {}).get(grade)
        classes.append(make_class('Oscar', [grade], 'Music',
                                  len(fixed) if fixed else 3, fixed=fixed))
    # Multi-grade class spanning MS + HS: must avoid blocks 6 AND 7
    classes.append(make_class('Isa', ['7th Grade', '10th Grade'], 'PE', 2))
    return classes


def slot_masks(masks):
    """Block-number masks -> slot-index masks for the current BLOCKS."""
    out = {}
    for g, tbs in masks.items():
        idxs = [solver.BLOCKS.index(b) for b in tbs]
        out[g] = {solver.day_block_to_slot(d, i) for d in range(len(DAYS)) for i in idxs}
    return out


def class_objs(class_dicts):
    return [
        ClassEntry(
            teacher=c['teacher'], grades=c['grades'], subject=c['subject'],
            grade_display=', '.join(c['grades']),
            days_per_week=c['daysPerWeek'], is_elective=c['isElective'],
            fixed_slots=[(d, b) for d, b in (c['fixedSlots'] or [])],
        )
        for c in class_dicts
    ]


def verify_solution(sol, sessions, label):
    by_id = {s.id: s for s in sessions}
    lunch_hits, teacher_conflicts, grade_conflicts = [], [], []
    seen_teacher, seen_grade = set(), set()
    isa_bad = []
    for sid, slot in sol.items():
        s = by_id[sid]
        blk = solver.BLOCKS[solver.slot_to_block(slot)]
        for g in s.grades:
            if blk == LUNCH[BAND[g]]:
                lunch_hits.append((s.teacher, g, s.subject, blk))
            gk = (g, slot)
            if gk in seen_grade:
                grade_conflicts.append(gk)
            seen_grade.add(gk)
        tk = (s.teacher, slot)
        if tk in seen_teacher:
            teacher_conflicts.append(tk)
        seen_teacher.add(tk)
        if s.teacher == 'Isa' and blk in (LUNCH['MS'], LUNCH['HS']):
            isa_bad.append((s.subject, blk))
    check(f"{label}: no session lands in a masked (lunch) block", not lunch_hits, str(lunch_hits[:3]))
    check(f"{label}: no teacher double-booked", not teacher_conflicts, str(teacher_conflicts[:3]))
    check(f"{label}: no grade double-booked", not grade_conflicts, str(grade_conflicts[:3]))
    check(f"{label}: MS+HS class avoids blocks 6 AND 7", not isa_bad, str(isa_bad))


# ================================================================ TEST 1
print("\nTEST 1 — 9-block solve with per-band lunch masks (solver level)")
set_blocks(NINE_BLOCKS)
sessions = build_sessions(class_objs(make_classes()), grades=GRADES,
                          grade_teachable_slots=slot_masks(MASKS))
sols = solve_with_cpsat(sessions, seed=0, time_limit=20.0, max_solutions=1,
                        active_grades=GRADES)
check("solver finds a 9-block schedule", bool(sols))
if sols:
    verify_solution(sols[0], sessions, "9-block")

# ================================================================ TEST 2
print("\nTEST 2 — end-to-end generate_schedules with blocks + grade_teachable_blocks")
result = generate_schedules(
    teachers=TEACHERS, classes=make_classes(), rules=RULES,
    num_options=1, num_attempts=2, max_time_seconds=40.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
)
check("status is success", result['status'] == 'success', result.get('message', ''))
if result['status'] == 'success':
    opt = result['options'][0]
    ts, gs = opt['teacherSchedules'], opt['gradeSchedules']

    some_teacher = next(iter(ts.values()))
    block_keys = sorted(some_teacher['Mon'].keys())
    check("teacher schedules span 9 blocks", block_keys == NINE_BLOCKS, str(block_keys))

    lunch_entries = []
    for g in GRADES:
        lb = LUNCH[BAND[g]]
        for day in DAYS:
            entry = gs.get(g, {}).get(day, {}).get(lb)
            if entry is not None:
                lunch_entries.append((g, day, lb, entry))
    check("grade schedules keep lunch blocks empty (incl. study halls)",
          not lunch_entries, str(lunch_entries[:3]))

    isa_bad = []
    for day in DAYS:
        for block, entry in ts.get('Isa', {}).get(day, {}).items():
            if entry and entry[1] == 'PE' and block in (LUNCH['MS'], LUNCH['HS']):
                isa_bad.append((day, block))
    check("end-to-end: MS+HS class avoids blocks 6 AND 7", not isa_bad, str(isa_bad))

    sh_bad = []
    for day in DAYS:
        for block, entry in gs.get('7th Grade', {}).get(day, {}).items():
            if entry and entry[1] == 'Study Hall' and block == LUNCH['MS']:
                sh_bad.append((day, block))
    check("study hall not placed in 7th grade's lunch block", not sh_bad, str(sh_bad))

# ================================================================ TEST 3
print("\nTEST 3 — forced same-block cross-band overlap is infeasible")
set_blocks(NINE_BLOCKS)
# Block 8 is teachable for every band; same teacher pinned there for two grades
classes_conflict = make_classes(oscar_fixed={'1st Grade': [('Mon', 8)],
                                             '10th Grade': [('Mon', 8)]})
sessions_c = build_sessions(class_objs(classes_conflict), grades=GRADES,
                            grade_teachable_slots=slot_masks(MASKS))
sols_c = solve_with_cpsat(sessions_c, seed=0, time_limit=20.0, max_solutions=1,
                          active_grades=GRADES)
check("solver rejects the double-booking (infeasible)", not sols_c)

result_c = generate_schedules(
    teachers=TEACHERS, classes=classes_conflict, rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=25.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
)
check("end-to-end reports infeasible", result_c['status'] == 'infeasible',
      result_c.get('message', ''))

# ================================================================ TEST 4
print("\nTEST 4 — 5-block regression: legacy request with no new fields")
# Deliberately run AFTER 9-block requests: generate_schedules must reset
# the module block state back to the default 5-block format.
legacy_classes = []
for grade, hr in [('1st Grade', 'Karla'), ('7th Grade', 'Shary')]:
    for subj in ['Math', 'ELA', 'Science', 'Social Studies']:
        legacy_classes.append(make_class(hr, [grade], subj, 4))
legacy_classes.append(make_class('Oscar', ['1st Grade'], 'Music', 3,
                                 fixed=[('Mon', 2), ('Wed', 2), ('Fri', 2)]))
legacy_grades = ['1st Grade', '7th Grade']
result_5 = generate_schedules(
    teachers=TEACHERS, classes=legacy_classes, rules=RULES,
    num_options=1, num_attempts=2, max_time_seconds=30.0, grades=legacy_grades,
)
check("module blocks reset to legacy [1..5]", solver.BLOCKS == [1, 2, 3, 4, 5],
      str(solver.BLOCKS))
check("legacy solve succeeds", result_5['status'] == 'success',
      result_5.get('message', ''))
if result_5['status'] == 'success':
    opt5 = result_5['options'][0]
    ts5 = opt5['teacherSchedules']
    block_keys5 = sorted(next(iter(ts5.values()))['Mon'].keys())
    check("teacher schedules span exactly 5 blocks", block_keys5 == [1, 2, 3, 4, 5],
          str(block_keys5))
    oscar_music = [(day, block)
                   for day in DAYS
                   for block, entry in ts5['Oscar'][day].items()
                   if entry and entry[1] == 'Music']
    check("fixed slots honored at 5 blocks",
          sorted(oscar_music) == sorted([('Mon', 2), ('Wed', 2), ('Fri', 2)]),
          str(oscar_music))

# Solver-level: all slots stay inside the 25-slot legacy range
set_blocks(None)
sess5 = build_sessions(class_objs(legacy_classes), grades=legacy_grades)
sols5 = solve_with_cpsat(sess5, seed=0, time_limit=15.0, max_solutions=1,
                         active_grades=legacy_grades)
check("legacy solver-level solve succeeds", bool(sols5))
if sols5:
    max_slot = max(sols5[0].values())
    check("all slots within legacy range (<25)", max_slot < 25, f"max={max_slot}")

# ================================================================ TEST 5
print("\nTEST 5 — preflight caps use dynamic block counts")
# Teacher cap: 46 sessions at 9 blocks (max 45) must fail with the 9-block message
over_teacher = [make_class('Karla', ['1st Grade'], f'Subj{i}', 5) for i in range(9)]
over_teacher.append(make_class('Karla', ['1st Grade'], 'Extra', 1))
res_t = generate_schedules(
    teachers=TEACHERS, classes=over_teacher, rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
)
errs_t = (res_t.get('diagnostics') or {}).get('preflightErrors', [])
check("teacher overload preflight fires at 9-block cap",
      res_t['status'] == 'infeasible' and any('max is 45' in e and '9 blocks' in e for e in errs_t),
      str(errs_t[:2]))

# Grade cap: 41 sessions for a grade with 8 teachable blocks (max 40), spread
# across teachers so the teacher cap (45) does not fire
over_grade = []
for i, t in enumerate(['Karla', 'Carolina', 'Shary', 'Ricardo']):
    for j in range(2):
        over_grade.append(make_class(t, ['1st Grade'], f'Subj{i}{j}', 5))
over_grade.append(make_class('Oscar', ['1st Grade'], 'Extra', 1))
res_g = generate_schedules(
    teachers=TEACHERS, classes=over_grade, rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
)
errs_g = (res_g.get('diagnostics') or {}).get('preflightErrors', [])
check("grade overload preflight uses teachable-block count (max 40)",
      res_g['status'] == 'infeasible' and any('max is 40' in e and '8 teachable blocks' in e for e in errs_g),
      str(errs_g[:2]))

# Fixed slot pinned to a masked block (7th grade lunch = block 6) fails preflight
pinned = make_classes()
pinned.append(make_class('Oscar', ['7th Grade'], 'Band', 1, fixed=[('Tues', 6)]))
res_p = generate_schedules(
    teachers=TEACHERS, classes=pinned, rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
)
errs_p = (res_p.get('diagnostics') or {}).get('preflightErrors', [])
check("fixed slot in a masked block fails preflight",
      res_p['status'] == 'infeasible' and any('not a teachable block' in e for e in errs_p),
      str(errs_p[:2]))

# ================================================================ TEST 6
print("\nTEST 6 — teacher_lunch: heavily loaded cross-band teacher keeps a window")
# Oscar teaches all three bands -> candidate lunch windows {5, 6, 7}.
# 40 sessions/week is the maximum possible under the lunch constraint
# (9 blocks/day, at least one of {5,6,7} free -> at most 8 sessions/day).
lunch_classes = []
for grade, hr in [('1st Grade', 'Karla'), ('2nd Grade', 'Carolina'),
                  ('7th Grade', 'Shary'), ('10th Grade', 'Ricardo')]:
    for subj in ['Math', 'ELA', 'Science', 'Social Studies']:
        lunch_classes.append(make_class(hr, [grade], subj, 4))
for grade in ['1st Grade', '7th Grade', '10th Grade']:
    for subj in ['Music', 'Art']:
        lunch_classes.append(make_class('Oscar', [grade], subj, 5))
lunch_classes.append(make_class('Oscar', ['1st Grade'], 'Drama', 5))
lunch_classes.append(make_class('Oscar', ['7th Grade'], 'Drama', 5))
lunch_classes.append(make_class('Isa', ['7th Grade', '10th Grade'], 'PE', 2))

result_l = generate_schedules(
    teachers=TEACHERS, classes=lunch_classes, rules=RULES,
    num_options=1, num_attempts=3, max_time_seconds=90.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
)
check("heavily loaded cross-band solve succeeds", result_l['status'] == 'success',
      result_l.get('message', ''))
if result_l['status'] == 'success':
    ts_l = result_l['options'][0]['teacherSchedules']

    def days_without_lunch(ts, teacher, cand):
        bad = []
        for day in DAYS:
            free = [b for b in cand
                    if (ts[teacher][day].get(b) or ['', ''])[1] == 'OPEN']
            if not free:
                bad.append(day)
        return bad

    oscar_bad = days_without_lunch(ts_l, 'Oscar', [5, 6, 7])
    check("Oscar (all 3 bands, 40 sessions) has a free candidate window every day",
          not oscar_bad, str(oscar_bad))
    isa_bad_l = days_without_lunch(ts_l, 'Isa', [6, 7])
    check("Isa (MS+HS) has a free candidate window every day",
          not isa_bad_l, str(isa_bad_l))

# ================================================================ TEST 7
print("\nTEST 7 — teacher_lunch preflight: fixed slots fill every window on a day")
# Oscar's candidate windows are {5, 6, 7}. Each fixed class sits in a block
# teachable for ITS grade, yet together they fill all of Oscar's windows on Mon.
def lunch_pinned_classes():
    classes = []
    for grade, hr in [('1st Grade', 'Karla'), ('2nd Grade', 'Carolina'),
                      ('7th Grade', 'Shary'), ('10th Grade', 'Ricardo')]:
        for subj in ['Math', 'ELA', 'Science', 'Social Studies']:
            classes.append(make_class(hr, [grade], subj, 4))
    classes.append(make_class('Oscar', ['7th Grade'], 'Music', 1, fixed=[('Mon', 5)]))
    classes.append(make_class('Oscar', ['1st Grade'], 'Music', 1, fixed=[('Mon', 6)]))
    classes.append(make_class('Oscar', ['1st Grade'], 'Art', 1, fixed=[('Mon', 7)]))
    classes.append(make_class('Oscar', ['10th Grade'], 'Music', 2))
    return classes

res_lp = generate_schedules(
    teachers=TEACHERS, classes=lunch_pinned_classes(), rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=15.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
)
errs_lp = (res_lp.get('diagnostics') or {}).get('preflightErrors', [])
check("preflight fails closed when fixed slots fill all lunch windows",
      res_lp['status'] == 'infeasible', res_lp.get('message', ''))
check("preflight error names the teacher and day",
      any("Oscar" in e and "Mon" in e and "lunch" in e.lower() for e in errs_lp),
      str(errs_lp[:2]))

# ================================================================ TEST 8
print("\nTEST 8 — teacher_lunch rule disabled: same scenario solves")
# Also disable no_btb_open so redistribution doesn't move Oscar's fixed-window
# classes after solving (keeps the occupancy assertion deterministic)
RULES_LUNCH_OFF = [r for r in RULES if r['rule_key'] != 'no_btb_open'] + [
    {'rule_key': 'teacher_lunch', 'enabled': False, 'config': None},
    {'rule_key': 'no_btb_open', 'enabled': False, 'config': None},
]
res_off = generate_schedules(
    teachers=TEACHERS, classes=lunch_pinned_classes(), rules=RULES_LUNCH_OFF,
    num_options=1, num_attempts=2, max_time_seconds=40.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
)
check("rule disabled -> scenario solves", res_off['status'] == 'success',
      res_off.get('message', ''))
if res_off['status'] == 'success':
    ts_off = res_off['options'][0]['teacherSchedules']
    mon_windows = [(ts_off['Oscar']['Mon'].get(b) or ['', ''])[1] for b in (5, 6, 7)]
    check("Oscar's Mon windows all occupied (constraint really off)",
          all(subj not in ('OPEN', '') for subj in mon_windows), str(mon_windows))

# ================================================================ TEST 9
print("\nTEST 9 — legacy requests: no lunch constraint without masks")
set_blocks(NINE_BLOCKS)
sess_cand = build_sessions(class_objs(make_classes()), grades=GRADES,
                           grade_teachable_slots=slot_masks(MASKS))
check("helper: no masks -> no candidate windows",
      compute_teacher_lunch_candidates(sess_cand, None) == {}
      and compute_teacher_lunch_candidates(sess_cand, {}) == {})
cands = compute_teacher_lunch_candidates(sess_cand, MASKS)
check("helper: cross-band teacher gets union of band lunch blocks",
      cands.get('Oscar') == {5, 6, 7} and cands.get('Isa') == {6, 7}
      and cands.get('Karla') == {5}, str(cands))

# Legacy 5-block request: teacher booked solid all week must still solve
# (no masks -> teacher_lunch is inert even though the rule defaults to enabled)
legacy_full = [make_class('Oscar', ['1st Grade'], subj, 5)
               for subj in ['Math', 'ELA', 'Science', 'Social Studies', 'Music']]
res_lf = generate_schedules(
    teachers=TEACHERS, classes=legacy_full, rules=RULES,
    num_options=1, num_attempts=2, max_time_seconds=30.0, grades=['1st Grade'],
)
check("legacy: fully booked teacher (no free block at all) still solves",
      res_lf['status'] == 'success', res_lf.get('message', ''))
if res_lf['status'] == 'success':
    ts_lf = res_lf['options'][0]['teacherSchedules']
    open_count = sum(1 for d in DAYS for b in solver.BLOCKS
                     if (ts_lf['Oscar'][d].get(b) or ['', ''])[1] == 'OPEN')
    check("legacy: teacher has zero open blocks (constraint fully inert)",
          open_count == 0, f"open={open_count}")

# ================================================================ TEST 10
print("\nTEST 10 — study halls never take a supervisor's last lunch window")
set_blocks(NINE_BLOCKS)
# Karla (K5 band) is free ONLY at Mon block 5 - her one candidate lunch window.
# Shary is free ONLY at Mon block 2. Without the guard, Karla (tried first)
# would supervise 7th grade's study hall at Mon B5 and lose her lunch.
ts_sh = {}
for teacher, (free_day, free_block) in [('Karla', ('Mon', 5)), ('Shary', ('Mon', 2))]:
    ts_sh[teacher] = {
        day: {b: (None if (day, b) == (free_day, free_block) else ['X', 'Class'])
              for b in solver.BLOCKS}
        for day in DAYS
    }
gs_sh = {g: {day: {b: None for b in solver.BLOCKS} for day in DAYS} for g in GRADES}
sh_result = add_study_halls(
    ts_sh, gs_sh, ['Karla', 'Shary'], preserve_existing=True, rules=RULES,
    grades=GRADES, grade_teachable_blocks=MASKS,
    teacher_lunch_windows={'Karla': {5}, 'Shary': {6}},
)
placed_sh = [a for a in sh_result if a.teacher is not None]
check("study hall placed", len(placed_sh) == 1, str(sh_result))
if placed_sh:
    a = placed_sh[0]
    check("guard skips Karla's last lunch window; Shary supervises instead",
          a.teacher == 'Shary' and a.day == 'Mon' and a.block == 2,
          f"{a.teacher} {a.day} B{a.block}")
check("Karla's lunch window untouched", ts_sh['Karla']['Mon'][5] is None,
      str(ts_sh['Karla']['Mon'][5]))

# ================================================================ TEST 11
print("\nTEST 11 — double periods: doubles use legal pairs on distinct days")
TEACHERS_D = TEACHERS + [{'name': 'Sofia', 'status': 'full-time'}]


def pairs_excluding(lunch_block):
    """Consecutive block pairs on the 9-block grid avoiding a lunch block."""
    return [[b, b + 1] for b in range(1, 9) if lunch_block not in (b, b + 1)]


# Realistic per-grade pair lists: e.g. the MS grade's pairs exclude anything
# touching block 6 (its lunch); HS excludes block 7; K5 excludes block 5.
PAIRS = {g: pairs_excluding(LUNCH[BAND[g]]) for g in GRADES}
MS_PAIRS = {tuple(p) for p in PAIRS['7th Grade']}
HS_PAIRS = {tuple(p) for p in PAIRS['10th Grade']}


def find_subject_days(ts, teacher, subject):
    """day -> sorted list of blocks where teacher teaches subject."""
    out = {}
    for day in DAYS:
        for b in sorted(ts[teacher][day].keys()):
            entry = ts[teacher][day][b]
            if entry and entry[1] == subject:
                out.setdefault(day, []).append(b)
    return out


dbl_classes = []
for subj in ['Math', 'ELA', 'Science', 'Social Studies']:
    dbl_classes.append(make_class('Shary', ['7th Grade'], subj, 4))
    dbl_classes.append(make_class('Ricardo', ['10th Grade'], subj, 4))
spanish = make_class('Sofia', ['7th Grade'], 'Spanish', 7)       # (a) L=7
spanish['is_double'] = True
french = make_class('Sofia', ['10th Grade'], 'French', 4)        # (b) L=4
french['requires_double_periods'] = True                         # other key accepted
debate = make_class('Isa', ['7th Grade', '10th Grade'], 'Debate', 4)  # (f) multi-grade
debate['is_double'] = True
dbl_classes += [spanish, french, debate]

res_d = generate_schedules(
    teachers=TEACHERS_D, classes=dbl_classes, rules=RULES,
    num_options=1, num_attempts=2, max_time_seconds=60.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
    grade_block_pairs=PAIRS,
)
check("double-period solve succeeds", res_d['status'] == 'success',
      res_d.get('message', ''))
if res_d['status'] == 'success':
    ts_d = res_d['options'][0]['teacherSchedules']

    # (a) flagged L=7 -> 3 doubles + 1 single, 4 distinct days, legal MS pairs
    spa = find_subject_days(ts_d, 'Sofia', 'Spanish')
    spa_doubles = [tuple(v) for v in spa.values() if len(v) == 2]
    spa_singles = [v for v in spa.values() if len(v) == 1]
    check("L=7: all 7 lessons placed", sum(len(v) for v in spa.values()) == 7, str(spa))
    check("L=7: meetings on exactly 4 distinct days", len(spa) == 4, str(spa))
    check("L=7: 3 doubles + 1 single", len(spa_doubles) == 3 and len(spa_singles) == 1, str(spa))
    check("L=7: every double is a legal 7th-grade pair (no block-6 straddle)",
          all(d in MS_PAIRS for d in spa_doubles), str(spa_doubles))

    # (b) flagged L=4 -> exactly 2 doubles on 2 days, legal HS pairs
    fre = find_subject_days(ts_d, 'Sofia', 'French')
    fre_doubles = [tuple(v) for v in fre.values() if len(v) == 2]
    check("L=4: exactly 2 doubles on 2 days",
          len(fre) == 2 and len(fre_doubles) == 2, str(fre))
    check("L=4: doubles are legal 10th-grade pairs (no block-7 straddle)",
          all(d in HS_PAIRS for d in fre_doubles), str(fre_doubles))

    # (f) multi-grade class: only intersection pairs (neither block 6 nor 7)
    deb = find_subject_days(ts_d, 'Isa', 'Debate')
    deb_doubles = [tuple(v) for v in deb.values() if len(v) == 2]
    check("multi-grade: 2 doubles on 2 days", len(deb) == 2 and len(deb_doubles) == 2, str(deb))
    check("multi-grade: doubles only in MS∩HS pair intersection",
          all(d in (MS_PAIRS & HS_PAIRS) for d in deb_doubles), str(deb_doubles))
    check("multi-grade: doubles avoid blocks 6 AND 7",
          all(6 not in d and 7 not in d for d in deb_doubles), str(deb_doubles))

# ================================================================ TEST 12
print("\nTEST 12 — preflight: unflagged L=7 is impossible, suggests the flag")
res_u7 = generate_schedules(
    teachers=TEACHERS_D,
    classes=[make_class('Sofia', ['7th Grade'], 'Spanish', 7)], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
errs_u7 = (res_u7.get('diagnostics') or {}).get('preflightErrors', [])
check("unflagged L=7 fails preflight", res_u7['status'] == 'infeasible',
      res_u7.get('message', ''))
check("error names the class and suggests double periods",
      any('Sofia - Spanish' in e and 'double period' in e for e in errs_u7),
      str(errs_u7[:2]))

# ================================================================ TEST 13
print("\nTEST 13 — preflight: flagged class with zero shared legal pairs")
# (i) new fields absent entirely: flagged class still fails closed
flagged4 = make_class('Sofia', ['7th Grade'], 'Spanish', 4)
flagged4['is_double'] = True
res_np = generate_schedules(
    teachers=TEACHERS_D, classes=[flagged4], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
)
errs_np = (res_np.get('diagnostics') or {}).get('preflightErrors', [])
check("flagged class without grade_block_pairs fails preflight",
      res_np['status'] == 'infeasible'
      and any('Sofia - Spanish' in e and 'no legal' in e and '7th Grade' in e for e in errs_np),
      str(errs_np[:2]))

# (ii) empty intersection across a multi-grade class's pairs
flagged_mg = make_class('Isa', ['7th Grade', '10th Grade'], 'Debate', 4)
flagged_mg['is_double'] = True
res_ei = generate_schedules(
    teachers=TEACHERS_D, classes=[flagged_mg], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
    grade_block_pairs={'7th Grade': [[1, 2]], '10th Grade': [[3, 4]]},
)
errs_ei = (res_ei.get('diagnostics') or {}).get('preflightErrors', [])
check("empty pair intersection fails preflight naming class and grades",
      res_ei['status'] == 'infeasible'
      and any('Isa - Debate' in e and '7th Grade' in e and '10th Grade' in e for e in errs_ei),
      str(errs_ei[:2]))

# ================================================================ TEST 14
print("\nTEST 14 — fixed slots on a flagged class: pinned pairs")
# (i) valid pinned pairs (+ one single) solve at exactly those slots.
# Mon B1+B2 is a same-day repeat - only legal because it's a pinned pair.
pinned_ok = make_class('Sofia', ['7th Grade'], 'Spanish', 5,
                       fixed=[('Mon', 1), ('Mon', 2), ('Wed', 3), ('Wed', 4), ('Fri', 8)])
pinned_ok['is_double'] = True
res_pk = generate_schedules(
    teachers=TEACHERS_D, classes=[pinned_ok], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=15.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
check("pinned pairs + one single solve", res_pk['status'] == 'success',
      res_pk.get('message', ''))
if res_pk['status'] == 'success':
    ts_pk = res_pk['options'][0]['teacherSchedules']
    placed = find_subject_days(ts_pk, 'Sofia', 'Spanish')
    check("lessons pinned exactly where fixed",
          placed == {'Mon': [1, 2], 'Wed': [3, 4], 'Fri': [8]}, str(placed))

# (ii) same-day fixed slots that are NOT a legal pair fail preflight
pinned_bad = make_class('Sofia', ['7th Grade'], 'Spanish', 2,
                        fixed=[('Mon', 1), ('Mon', 3)])
pinned_bad['is_double'] = True
res_pb = generate_schedules(
    teachers=TEACHERS_D, classes=[pinned_bad], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
errs_pb = (res_pb.get('diagnostics') or {}).get('preflightErrors', [])
check("non-adjacent same-day fixed slots fail preflight",
      res_pb['status'] == 'infeasible'
      and any('not a legal double-period pair' in e for e in errs_pb),
      str(errs_pb[:2]))

# (iii) two lone fixed singles (L even) fail preflight
pinned_lone = make_class('Sofia', ['7th Grade'], 'Spanish', 2,
                         fixed=[('Mon', 1), ('Tues', 2)])
pinned_lone['is_double'] = True
res_pl = generate_schedules(
    teachers=TEACHERS_D, classes=[pinned_lone], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
errs_pl = (res_pl.get('diagnostics') or {}).get('preflightErrors', [])
check("two lone fixed singles fail preflight",
      res_pl['status'] == 'infeasible'
      and any('lone fixed lesson' in e for e in errs_pl),
      str(errs_pl[:2]))

# ================================================================ TEST 15
print("\nTEST 15 — duplicate-subject rule still blocks non-pair same-day repeats")
# (g) a third same-day occurrence: pinned double Mon B1+B2 plus ANOTHER class
# of the same grade+subject fixed the same day -> infeasible (not preflight)
pinned_pair = make_class('Sofia', ['7th Grade'], 'Spanish', 2,
                         fixed=[('Mon', 1), ('Mon', 2)])
pinned_pair['is_double'] = True
third = make_class('Karla', ['7th Grade'], 'Spanish', 1, fixed=[('Mon', 4)])
res_3rd = generate_schedules(
    teachers=TEACHERS_D, classes=[pinned_pair, third], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=15.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
errs_3rd = (res_3rd.get('diagnostics') or {}).get('preflightErrors', [])
check("third same-day occurrence next to a pinned pair is infeasible",
      res_3rd['status'] == 'infeasible' and not errs_3rd,
      f"status={res_3rd['status']} preflight={errs_3rd[:1]}")

# unflagged same-day repeat (not a pair) stays forbidden by the solver
rep = make_class('Sofia', ['7th Grade'], 'Spanish', 2,
                 fixed=[('Mon', 1), ('Mon', 3)])
res_rep = generate_schedules(
    teachers=TEACHERS_D, classes=[rep], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=15.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
errs_rep = (res_rep.get('diagnostics') or {}).get('preflightErrors', [])
check("unflagged same-day repeat still infeasible (solver, not preflight)",
      res_rep['status'] == 'infeasible' and not errs_rep,
      f"status={res_rep['status']} preflight={errs_rep[:1]}")

# ================================================================ TEST 16
print("\nTEST 16 — legacy requests carry no pairing metadata")
set_blocks(None)
sess_leg = build_sessions(class_objs(legacy_classes), grades=legacy_grades)
check("legacy sessions: no pair ids, no double-class flags",
      all(s.pair_id is None and not s.is_double_class and s.pair_slots is None
          for s in sess_leg),
      str([(s.teacher, s.subject) for s in sess_leg if s.pair_id is not None][:3]))

# ================================================================ summary
print("\n" + "=" * 60)
fails = [n for n, ok in results if not ok]
print(f"RESULT: {len(results) - len(fails)}/{len(results)} passed"
      + (f"; FAILED: {fails}" if fails else ""))
sys.exit(1 if fails else 0)
