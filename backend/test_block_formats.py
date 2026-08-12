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
  (k) double periods REQUIRED mode (is_double): flagged L=7 -> 3 legal-pair
      doubles + 1 single on 4 distinct days; flagged L=4 -> 2 doubles on 2
      days; multi-grade flagged class uses only the intersection of its
      grades' pairs; pairs never straddle a covered grade's lunch
  (l) required-mode preflight: flagged class with zero shared legal pairs
      errors naming class and grades; fixed slots must form same-day legal
      pairs (+ at most one lone single)
  (m) pinned pairs solve (duplicate-subject rule exempts within-pair repeats
      only); a same-day repeat that is NOT a legal pair fails; legacy
      requests carry no pairing metadata
  (n) optional doubles DEFAULT mode: when grade_block_pairs is provided,
      ANY class may hold a day's lessons as one legal double - but ONLY when
      the week cannot fit otherwise - unflagged L=7 solves as exactly two
      legal pairs + three singles on 5 days; unflagged L=4 never pairs
      (4 distinct single days); a pinned legal pair on an unflagged class
      solves
  (o) optional-doubles preflight: unflagged L=7 with NO legal pairs errors;
      >2 same-day fixed lessons error; 2 same-day fixed lessons that are not
      a legal pair error
  (p) three same-day occurrences are impossible at the model level too
      (availability-forced, infeasible without preflight errors)
  (q) no_duplicate_subjects disabled -> same-day repeats unrestricted (the
      existing escape hatch, unchanged)
  (r) legacy requests (no pairs map): unflagged L=7 still errors with the
      old message; L=5 solves singles-only
  (s) pairing budget (unflagged classes pair only when necessary): same-day
      pairs are capped at max(0, L - usable_days) - L=4 with 5 usable days
      NEVER pairs (several seeds, solver level); L=6 -> exactly one pair +
      4 singles; L=6 restricted to 3 available days -> 3 pairs; a fixed
      same-day pair is honored with no additional free pair; realistic load
      (masks + lunch + fixed elective) still solves with budgets enforced;
      flagged classes and the rule-disabled escape hatch are unchanged
      (tests 11/13/14 and 17 rerun above)

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
print("\nTEST 12 — optional doubles: unflagged L=7 WITH legal pairs solves")


def day_legality_issues(day_blocks, legal_pairs):
    """Every day must hold ONE meeting: a lone single or one legal pair."""
    issues = []
    for day, blocks in day_blocks.items():
        if len(blocks) == 1:
            continue
        if len(blocks) == 2 and tuple(sorted(blocks)) in legal_pairs:
            continue
        issues.append((day, blocks))
    return issues


res_u7 = generate_schedules(
    teachers=TEACHERS_D,
    classes=[make_class('Sofia', ['7th Grade'], 'Spanish', 7)], rules=RULES,
    num_options=1, num_attempts=2, max_time_seconds=30.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
check("unflagged L=7 with legal pairs solves", res_u7['status'] == 'success',
      res_u7.get('message', ''))
if res_u7['status'] == 'success':
    spa_u7 = find_subject_days(res_u7['options'][0]['teacherSchedules'],
                               'Sofia', 'Spanish')
    check("optional L=7: all 7 lessons placed",
          sum(len(v) for v in spa_u7.values()) == 7, str(spa_u7))
    check("optional L=7: every day is one single or one legal MS pair",
          not day_legality_issues(spa_u7, MS_PAIRS),
          str(day_legality_issues(spa_u7, MS_PAIRS)))
    spa_u7_pairs = [tuple(v) for v in spa_u7.values() if len(v) == 2]
    check("optional L=7: exactly two pairs + three singles (budget = L - days)",
          len(spa_u7) == 5 and len(spa_u7_pairs) == 2, str(spa_u7))

# unflagged L=4: the week fits without pairing, so the budget forbids pairs
res_u4 = generate_schedules(
    teachers=TEACHERS_D,
    classes=[make_class('Sofia', ['7th Grade'], 'Spanish', 4)], rules=RULES,
    num_options=1, num_attempts=2, max_time_seconds=30.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
check("unflagged L=4 with legal pairs solves", res_u4['status'] == 'success',
      res_u4.get('message', ''))
if res_u4['status'] == 'success':
    spa_u4 = find_subject_days(res_u4['options'][0]['teacherSchedules'],
                               'Sofia', 'Spanish')
    check("optional L=4: all 4 lessons placed",
          sum(len(v) for v in spa_u4.values()) == 4, str(spa_u4))
    check("optional L=4: never pairs when the week fits (4 distinct single days)",
          len(spa_u4) == 4 and all(len(v) == 1 for v in spa_u4.values()),
          str(spa_u4))

# unflagged L=7 with NO legal pairs -> preflight error (fail closed)
res_u7np = generate_schedules(
    teachers=TEACHERS_D,
    classes=[make_class('Sofia', ['7th Grade'], 'Spanish', 7)], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS,
    grade_block_pairs={'7th Grade': []},
)
errs_u7np = (res_u7np.get('diagnostics') or {}).get('preflightErrors', [])
check("unflagged L=7 with NO legal pairs fails preflight",
      res_u7np['status'] == 'infeasible'
      and any('Sofia - Spanish' in e and 'no legal consecutive block pairs' in e
              for e in errs_u7np),
      str(errs_u7np[:2]))

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

# unflagged same-day repeat that is NOT a legal pair stays forbidden
# (now caught in preflight with a readable message)
rep = make_class('Sofia', ['7th Grade'], 'Spanish', 2,
                 fixed=[('Mon', 1), ('Mon', 3)])
res_rep = generate_schedules(
    teachers=TEACHERS_D, classes=[rep], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=15.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
errs_rep = (res_rep.get('diagnostics') or {}).get('preflightErrors', [])
check("unflagged non-pair same-day repeat still forbidden (preflight)",
      res_rep['status'] == 'infeasible'
      and any('not a legal double-period pair' in e for e in errs_rep),
      f"status={res_rep['status']} preflight={errs_rep[:1]}")

# ...but an unflagged same-day repeat that IS a legal pair now solves
rep_ok = make_class('Sofia', ['7th Grade'], 'Spanish', 2,
                    fixed=[('Mon', 1), ('Mon', 2)])
res_rep_ok = generate_schedules(
    teachers=TEACHERS_D, classes=[rep_ok], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=15.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
check("unflagged pinned LEGAL pair solves (optional double)",
      res_rep_ok['status'] == 'success', res_rep_ok.get('message', ''))
if res_rep_ok['status'] == 'success':
    placed_ok = find_subject_days(res_rep_ok['options'][0]['teacherSchedules'],
                                  'Sofia', 'Spanish')
    check("pinned optional double lands exactly at Mon B1+B2",
          placed_ok == {'Mon': [1, 2]}, str(placed_ok))

# three same-day fixed lessons -> preflight (at most 2, forming one double)
rep3 = make_class('Sofia', ['7th Grade'], 'Spanish', 3,
                  fixed=[('Mon', 1), ('Mon', 2), ('Mon', 3)])
res_rep3 = generate_schedules(
    teachers=TEACHERS_D, classes=[rep3], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
errs_rep3 = (res_rep3.get('diagnostics') or {}).get('preflightErrors', [])
check("three same-day fixed lessons fail preflight",
      res_rep3['status'] == 'infeasible'
      and any('at most 2' in e for e in errs_rep3),
      str(errs_rep3[:2]))

# model level: three same-day occurrences are impossible even without fixed
# slots (availability forces all three onto Mon) - infeasible, no preflight
rep3m = make_class('Sofia', ['7th Grade'], 'Spanish', 3)
rep3m['availableDays'] = ['Mon']
res_rep3m = generate_schedules(
    teachers=TEACHERS_D, classes=[rep3m], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=15.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
errs_rep3m = (res_rep3m.get('diagnostics') or {}).get('preflightErrors', [])
check("three same-day occurrences infeasible at the model level (no preflight)",
      res_rep3m['status'] == 'infeasible' and not errs_rep3m,
      f"status={res_rep3m['status']} preflight={errs_rep3m[:1]}")

# ================================================================ TEST 16
print("\nTEST 16 — legacy requests carry no pairing metadata")
set_blocks(None)
sess_leg = build_sessions(class_objs(legacy_classes), grades=legacy_grades)
check("legacy sessions: no pair ids, no double-class flags",
      all(s.pair_id is None and not s.is_double_class and s.pair_slots is None
          and s.allowed_block_pairs is None
          for s in sess_leg),
      str([(s.teacher, s.subject) for s in sess_leg if s.pair_id is not None][:3]))

# ================================================================ TEST 17
print("\nTEST 17 — no_duplicate_subjects disabled: same-day repeats unrestricted")
RULES_DUP_OFF = [r for r in RULES if r['rule_key'] != 'no_duplicate_subjects'] + [
    {'rule_key': 'no_duplicate_subjects', 'enabled': False, 'config': None},
]
# The exact scenario preflight rejects when the rule is ON (Mon B1+B3 is not
# a legal pair) must sail through with the rule OFF - scattered repeats allowed
scatter = make_class('Sofia', ['7th Grade'], 'Spanish', 2,
                     fixed=[('Mon', 1), ('Mon', 3)])
res_scatter = generate_schedules(
    teachers=TEACHERS_D, classes=[scatter], rules=RULES_DUP_OFF,
    num_options=1, num_attempts=1, max_time_seconds=15.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
check("rule off: non-pair same-day repeat solves", res_scatter['status'] == 'success',
      res_scatter.get('message', ''))
if res_scatter['status'] == 'success':
    placed_sc = find_subject_days(res_scatter['options'][0]['teacherSchedules'],
                                  'Sofia', 'Spanish')
    check("rule off: repeats land exactly at Mon B1+B3",
          placed_sc == {'Mon': [1, 3]}, str(placed_sc))

# ================================================================ TEST 18
print("\nTEST 18 — legacy (no pairs map): unflagged L=7 errors, L=5 singles-only")
res_leg7 = generate_schedules(
    teachers=TEACHERS_D,
    classes=[make_class('Sofia', ['7th Grade'], 'Spanish', 7)], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=10.0, grades=GRADES,
)
errs_leg7 = (res_leg7.get('diagnostics') or {}).get('preflightErrors', [])
check("legacy unflagged L=7 fails preflight with the old message",
      res_leg7['status'] == 'infeasible'
      and any('Sofia - Spanish' in e and "requires double periods" in e
              for e in errs_leg7),
      str(errs_leg7[:2]))

res_leg5 = generate_schedules(
    teachers=TEACHERS_D,
    classes=[make_class('Sofia', ['7th Grade'], 'Spanish', 5)], rules=RULES,
    num_options=1, num_attempts=2, max_time_seconds=30.0, grades=GRADES,
)
check("legacy unflagged L=5 solves", res_leg5['status'] == 'success',
      res_leg5.get('message', ''))
if res_leg5['status'] == 'success':
    spa_leg = find_subject_days(res_leg5['options'][0]['teacherSchedules'],
                                'Sofia', 'Spanish')
    check("legacy L=5 is singles-only (one lesson per day, 5 days)",
          len(spa_leg) == 5 and all(len(v) == 1 for v in spa_leg.values()),
          str(spa_leg))

# ================================================================ TEST 19
print("\nTEST 19 — pairing budget: unflagged classes pair only when necessary")

# (a) solver level, several seeds: L=4 with 5 usable days must NEVER pair
set_blocks(NINE_BLOCKS)
budget_cls = ClassEntry(
    teacher='Sofia', grades=['7th Grade'], subject='Spanish',
    grade_display='7th Grade', days_per_week=4,
    allowed_pairs=[tuple(p) for p in PAIRS['7th Grade']],
)
sess_bud = build_sessions([budget_cls], grades=GRADES,
                          grade_teachable_slots=slot_masks(MASKS))
solved_count, paired_solutions = 0, []
for seed in range(6):
    sols_bud = solve_with_cpsat(sess_bud, seed=seed, time_limit=10.0,
                                max_solutions=3, rules=RULES,
                                active_grades=GRADES)
    for sol in sols_bud:
        solved_count += 1
        days_hit = [solver.slot_to_day(v) for v in sol.values()]
        if len(set(days_hit)) != len(days_hit):
            paired_solutions.append((seed, sorted(days_hit)))
check("budget L=4: solutions found across seeds", solved_count > 0,
      f"solutions={solved_count}")
check("budget L=4, 5 usable days: NEVER pairs in any seed/solution",
      not paired_solutions, str(paired_solutions[:3]))

# (b) unflagged L=6 on 5 days -> exactly one pair + 4 singles
res_b6 = generate_schedules(
    teachers=TEACHERS_D,
    classes=[make_class('Sofia', ['7th Grade'], 'Spanish', 6)], rules=RULES,
    num_options=1, num_attempts=2, max_time_seconds=30.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
check("budget L=6 solves", res_b6['status'] == 'success',
      res_b6.get('message', ''))
if res_b6['status'] == 'success':
    spa_b6 = find_subject_days(res_b6['options'][0]['teacherSchedules'],
                               'Sofia', 'Spanish')
    b6_pairs = [tuple(v) for v in spa_b6.values() if len(v) == 2]
    check("budget L=6: exactly one pair + 4 singles on 5 days",
          len(spa_b6) == 5 and len(b6_pairs) == 1
          and sum(len(v) for v in spa_b6.values()) == 6, str(spa_b6))
    check("budget L=6: the pair is a legal MS pair",
          all(p in MS_PAIRS for p in b6_pairs), str(b6_pairs))

# (d) unflagged L=6 restricted to 3 available days -> 3 pairs (one per day).
# no_btb_open disabled: post-solve redistribution doesn't know class-level
# availableDays, so keep it off to assert on the raw solver placement.
RULES_BTB_OFF = [r for r in RULES if r['rule_key'] != 'no_btb_open'] + [
    {'rule_key': 'no_btb_open', 'enabled': False, 'config': None},
]
tri = make_class('Sofia', ['7th Grade'], 'Spanish', 6)
tri['availableDays'] = ['Mon', 'Tues', 'Wed']
res_tri = generate_schedules(
    teachers=TEACHERS_D, classes=[tri], rules=RULES_BTB_OFF,
    num_options=1, num_attempts=2, max_time_seconds=30.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
check("budget L=6 over 3 available days solves", res_tri['status'] == 'success',
      res_tri.get('message', ''))
if res_tri['status'] == 'success':
    spa_tri = find_subject_days(res_tri['options'][0]['teacherSchedules'],
                                'Sofia', 'Spanish')
    tri_pairs = [tuple(v) for v in spa_tri.values() if len(v) == 2]
    check("budget L=6/3 days: three legal pairs, one per available day",
          sorted(spa_tri.keys()) == sorted(['Mon', 'Tues', 'Wed'])
          and len(tri_pairs) == 3 and all(p in MS_PAIRS for p in tri_pairs),
          str(spa_tri))

# (e) a user-pinned same-day pair on an unflagged class is always honored;
# the budget only governs free pairing on top (no additional pair appears)
pin_bud = make_class('Sofia', ['7th Grade'], 'Spanish', 4,
                     fixed=[('Mon', 1), ('Mon', 2), ('Wed', 3), ('Fri', 8)])
res_pin = generate_schedules(
    teachers=TEACHERS_D, classes=[pin_bud], rules=RULES,
    num_options=1, num_attempts=1, max_time_seconds=15.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
check("budget: pinned pair + 2 singles solves", res_pin['status'] == 'success',
      res_pin.get('message', ''))
if res_pin['status'] == 'success':
    spa_pin = find_subject_days(res_pin['options'][0]['teacherSchedules'],
                                'Sofia', 'Spanish')
    check("budget: pinned pair honored, no additional pair",
          spa_pin == {'Mon': [1, 2], 'Wed': [3], 'Fri': [8]}, str(spa_pin))

# realistic load: full grade loads + lunch masks + a fixed elective; budgets
# hold (L=6 classes pair exactly once, L=4 classes never pair) and it solves
load_classes = []
for subj in ['Math', 'ELA', 'Science', 'Social Studies']:
    load_classes.append(make_class('Shary', ['7th Grade'], subj, 4))
    load_classes.append(make_class('Ricardo', ['10th Grade'], subj, 4))
load_classes.append(make_class('Sofia', ['7th Grade'], 'Spanish', 6))
load_classes.append(make_class('Sofia', ['10th Grade'], 'French', 6))
load_classes.append(make_class('Isa', ['7th Grade', '10th Grade'], 'PE', 2))
load_classes.append(make_class('Karla', ['7th Grade'], 'Art', 1,
                               elective=True, fixed=[('Mon', 8)]))
res_load = generate_schedules(
    teachers=TEACHERS_D, classes=load_classes, rules=RULES,
    num_options=1, num_attempts=2, max_time_seconds=60.0, grades=GRADES,
    blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
)
check("budget: realistic load (masks + lunch + fixed elective) solves",
      res_load['status'] == 'success', res_load.get('message', ''))
if res_load['status'] == 'success':
    ts_load = res_load['options'][0]['teacherSchedules']
    for teacher, subj, legal in [('Sofia', 'Spanish', MS_PAIRS),
                                 ('Sofia', 'French', HS_PAIRS)]:
        placed_l = find_subject_days(ts_load, teacher, subj)
        l_pairs = [tuple(v) for v in placed_l.values() if len(v) == 2]
        check(f"budget load: {subj} L=6 -> exactly one legal pair + 4 singles",
              len(placed_l) == 5 and len(l_pairs) == 1
              and all(p in legal for p in l_pairs), str(placed_l))
    l4_paired = []
    for teacher in ('Shary', 'Ricardo'):
        for subj in ['Math', 'ELA', 'Science', 'Social Studies']:
            placed_l4 = find_subject_days(ts_load, teacher, subj)
            if any(len(v) > 1 for v in placed_l4.values()):
                l4_paired.append((teacher, subj, placed_l4))
    check("budget load: no unflagged L=4 class pairs", not l4_paired,
          str(l4_paired[:2]))

# ================================================================ summary
print("\n" + "=" * 60)


# =========================================================================
# TEST 20: study hall eligibility + even distribution
# =========================================================================
def test_20():
    print("\nTEST 20 — study hall eligibility (False = excluded) and even spread")
    from solver import get_study_hall_eligible, Teacher as T

    teachers = [
        T(name='Excluded', status='full-time', can_supervise_study_hall=False),
        T(name='EligibleTrue', status='full-time', can_supervise_study_hall=True),
        T(name='EligibleNone', status='full-time', can_supervise_study_hall=None),
        T(name='PartTimer', status='part-time', can_supervise_study_hall=True),
    ]
    rules = [{'rule_key': 'study_hall_teacher_eligibility', 'enabled': True,
              'config': {'allow_full_time': True, 'allow_part_time': False}}]
    elig = get_study_hall_eligible(teachers, [], rules)
    check('False-flagged teacher excluded', 'Excluded' not in elig, str(elig))
    check('True/None-flagged full-timers eligible',
          'EligibleTrue' in elig and 'EligibleNone' in elig, str(elig))
    check('part-timer excluded by status', 'PartTimer' not in elig, str(elig))

    # Even spread: 2 eligible teachers with plenty of open blocks, 6 groups ->
    # 3 each, never 5+1
    from solver import add_study_halls, set_blocks, DAYS
    set_blocks([1,2,3,4,5,6,7,8,9])
    grades6 = [f'{n}th Grade' for n in (6,7,8,9,10,11)]
    ts = {t: {d: {b: None for b in range(1,10)} for d in DAYS} for t in ('A','B')}
    # Give A fewer teaching blocks than B so the old sort would give A everything
    ts['B']['Mon'][1] = ['6th Grade','Math']; ts['B']['Mon'][2] = ['7th Grade','Math']
    gs = {g: {d: {b: None for b in range(1,10)} for d in DAYS} for g in grades6}
    sh_rules = [{'rule_key':'study_hall_grades','enabled':True,'config':{'grades':grades6}}]
    res = add_study_halls(ts, gs, ['A','B'], preserve_existing=False, rules=sh_rules, grades=grades6)
    counts = {}
    for a in res:
        if a.teacher: counts[a.teacher] = counts.get(a.teacher, 0) + 1
    placed = sum(counts.values())
    check('all 6 study halls placed', placed == 6, str(counts))
    check('spread evenly (3/3, not 6/0)', counts.get('A') == 3 and counts.get('B') == 3, str(counts))

test_20()


# =========================================================================
# TEST 21: pair-aware redistribution — double periods move TOGETHER
# =========================================================================
def test_21():
    print("\nTEST 21 — pair-aware redistribution: pairs move atomically, fixed stays frozen")
    import copy
    from solver import redistribute_open_blocks, count_back_to_back, set_blocks

    set_blocks(None)  # legacy 5-block grid for the direct-call scenarios
    B = solver.BLOCKS
    G = '7th Grade'
    MON, TUE = DAYS[0], DAYS[1]

    FROZEN = {('Pat', G, s) for s in ('Science', 'History', 'Geography')}
    ALL_PAIRS = {(1, 2), (2, 3), (3, 4), (4, 5)}

    def fresh_schedules(spanish_pair=(1, 2), tues_b3=None):
        """Pat teaches a Spanish PAIR on Mon plus singles arranged so that NO
        single-session move can fill Tuesday's BTB-OPEN hole:
        - Math/ELA singles duplicate subjects already on Tuesday
        - Science/History/Geography are frozen (fixed-slot classes)
        Only relocating the Spanish pair atomically can reduce BTB."""
        mon = {spanish_pair[0]: [G, 'Spanish'], spanish_pair[1]: [G, 'Spanish']}
        for b, subj in zip([b for b in B if b not in mon], ['Math', 'ELA', 'Science']):
            mon[b] = [G, subj]
        tues = {b: ['', 'OPEN'] for b in B}
        tues[4] = [G, 'Math']
        tues[5] = [G, 'ELA']
        if tues_b3:
            tues[3] = [G, tues_b3]
        def full_day():
            return {1: [G, 'Math'], 2: [G, 'ELA'], 3: [G, 'Science'],
                    4: [G, 'History'], 5: [G, 'Geography']}
        ts = {'Pat': {MON: mon, TUE: tues, DAYS[2]: full_day(),
                      DAYS[3]: full_day(), DAYS[4]: full_day()}}
        gs = {G: {d: {b: None for b in B} for d in DAYS}}
        for d in DAYS:
            for b in B:
                e = ts['Pat'][d][b]
                if e and e[1] != 'OPEN':
                    gs[G][d][b] = ['Pat', e[1]]
        return ts, gs

    def subject_days(ts, teacher, subject):
        out = {}
        for d in DAYS:
            for b in sorted(ts[teacher][d].keys()):
                e = ts[teacher][d][b]
                if e and e[1] == subject:
                    out.setdefault(d, []).append(b)
        return out

    def pairs_intact(ts, teacher, subject, allowed):
        """Invariant: every meeting is a lone single or ONE legal consecutive
        pair — a pair is never split into blocks on different days/positions."""
        for d, blocks in subject_days(ts, teacher, subject).items():
            if len(blocks) == 1:
                continue
            if len(blocks) == 2 and tuple(sorted(blocks)) in allowed:
                continue
            return False
        return True

    def frozen_untouched(ts, ts_orig):
        return all(subject_days(ts, 'Pat', s) == subject_days(ts_orig, 'Pat', s)
                   for s in ('Science', 'History', 'Geography'))

    # (a) a BTB hole only a pair move can fill -> pair relocates TOGETHER
    ts, gs = fresh_schedules()
    ts_orig = copy.deepcopy(ts)
    btb_before = count_back_to_back(ts, 'Pat')
    redistribute_open_blocks(ts, gs, ['Pat'],
                             frozen_class_entries=FROZEN,
                             class_allowed_pairs={('Pat', G, 'Spanish'): ALL_PAIRS})
    btb_after = count_back_to_back(ts, 'Pat')
    spa = subject_days(ts, 'Pat', 'Spanish')
    check("pair move: BTB strictly decreased", btb_after < btb_before,
          f"{btb_before} -> {btb_after}")
    check("pair moved TOGETHER onto the hole (Tues B1+B2)",
          spa == {TUE: [1, 2]}, str(spa))
    check("pair invariant holds after redistribution",
          pairs_intact(ts, 'Pat', 'Spanish', ALL_PAIRS), str(spa))
    check("fixed-slot (frozen) classes never moved", frozen_untouched(ts, ts_orig))
    check("grade schedule tracks the moved pair",
          gs[G][TUE][1] == ['Pat', 'Spanish'] and gs[G][TUE][2] == ['Pat', 'Spanish']
          and gs[G][MON][1] is None and gs[G][MON][2] is None,
          str({d: gs[G][d] for d in (MON, TUE)}))

    # (b) net-zero pair move is rejected (state fully reverted, no thrashing)
    ts, gs = fresh_schedules(tues_b3='Geography')
    ts_orig = copy.deepcopy(ts)
    redistribute_open_blocks(ts, gs, ['Pat'],
                             frozen_class_entries=FROZEN,
                             class_allowed_pairs={('Pat', G, 'Spanish'): ALL_PAIRS})
    check("net-zero pair move rejected: schedule unchanged", ts == ts_orig)

    # (c) target pair must be in the class's pair table
    ts, gs = fresh_schedules()
    ts_orig = copy.deepcopy(ts)
    redistribute_open_blocks(ts, gs, ['Pat'],
                             frozen_class_entries=FROZEN,
                             class_allowed_pairs={('Pat', G, 'Spanish'): {(4, 5)}})
    check("pair never lands outside its allowed-pair table", ts == ts_orig)

    # (d) grade teachable mask holds for BOTH blocks: block 1 masked out ->
    # the pair must land at Tues (2,3), leaving the masked block untouched
    ts, gs = fresh_schedules(spanish_pair=(2, 3))
    redistribute_open_blocks(ts, gs, ['Pat'],
                             grade_teachable_blocks={G: [2, 3, 4, 5]},
                             frozen_class_entries=FROZEN,
                             class_allowed_pairs={('Pat', G, 'Spanish'): {(2, 3), (3, 4), (4, 5)}})
    spa_m = subject_days(ts, 'Pat', 'Spanish')
    check("masked pair move: lands on the legal in-mask pair (Tues B2+B3)",
          spa_m == {TUE: [2, 3]}, str(spa_m))
    check("masked pair move: masked block stays untouched",
          ts['Pat'][TUE][1] == ['', 'OPEN'], str(ts['Pat'][TUE][1]))

    # (e) teacher_lunch guard holds for BOTH blocks.
    # Lunch-aware hole finding means the designated lunch is NOT open, so the
    # scenario pins the designation (single window {3}) and leaves a genuine
    # BTB pair elsewhere on the day (Tues open 1,2 + lunch at 3).
    FROZEN_ALL = {('Pat', G, s)
                  for s in ('Math', 'ELA', 'Science', 'History', 'Geography')}

    def lunch_guard_schedules():
        """Pat: Spanish pair Mon (2,3); Tues open 1,2,3 where window {3} is
        the designated lunch -> genuine hole at (1,2). All singles frozen, so
        only the pair can move."""
        mon = {1: [G, 'Math'], 2: [G, 'Spanish'], 3: [G, 'Spanish'],
               4: [G, 'ELA'], 5: [G, 'Science']}
        tues = {1: ['', 'OPEN'], 2: ['', 'OPEN'], 3: ['', 'OPEN'],
                4: [G, 'History'], 5: [G, 'Geography']}
        def full_day():
            return {1: [G, 'Math'], 2: [G, 'ELA'], 3: [G, 'Science'],
                    4: [G, 'History'], 5: [G, 'Geography']}
        ts = {'Pat': {MON: mon, TUE: tues, DAYS[2]: full_day(),
                      DAYS[3]: full_day(), DAYS[4]: full_day()}}
        gs = {G: {d: {b: None for b in B} for d in DAYS}}
        for d in DAYS:
            for b in B:
                e = ts['Pat'][d][b]
                if e and e[1] != 'OPEN':
                    gs[G][d][b] = ['Pat', e[1]]
        return ts, gs

    # last free window {3}: the only allowed landing (2,3) would take it
    ts, gs = lunch_guard_schedules()
    ts_orig = copy.deepcopy(ts)
    redistribute_open_blocks(ts, gs, ['Pat'],
                             teacher_lunch_windows={'Pat': {3}},
                             frozen_class_entries=FROZEN_ALL,
                             class_allowed_pairs={('Pat', G, 'Spanish'): {(2, 3)}})
    check("pair move refused when it would take the last lunch window",
          ts == ts_orig, str(subject_days(ts, 'Pat', 'Spanish')))
    # all pairs allowed: landing at (1,2) fills the hole, window 3 survives
    ts, gs = lunch_guard_schedules()
    redistribute_open_blocks(ts, gs, ['Pat'],
                             teacher_lunch_windows={'Pat': {3}},
                             frozen_class_entries=FROZEN_ALL,
                             class_allowed_pairs={('Pat', G, 'Spanish'): ALL_PAIRS})
    spa_l = subject_days(ts, 'Pat', 'Spanish')
    check("pair lands where a lunch window survives (Tues B1+B2)",
          spa_l == {TUE: [1, 2]}, str(spa_l))
    check("lunch window kept free after the pair move",
          ts['Pat'][TUE][3] == ['', 'OPEN'], str(ts['Pat'][TUE][3]))

    # (f) end-to-end: a flagged double survives redistribution intact
    # (no_btb_open enabled; the under-loaded teacher forces many BTB holes)
    set_blocks(NINE_BLOCKS)
    e2e_classes = []
    for subj in ['Math', 'ELA', 'Science', 'Social Studies']:
        e2e_classes.append(make_class('Shary', ['7th Grade'], subj, 4))
    dbl = make_class('Sofia', ['7th Grade'], 'Spanish', 4)
    dbl['is_double'] = True
    e2e_classes.append(dbl)
    res_e2e = generate_schedules(
        teachers=TEACHERS_D, classes=e2e_classes, rules=RULES,
        num_options=1, num_attempts=2, max_time_seconds=40.0, grades=GRADES,
        blocks=NINE_BLOCKS, grade_teachable_blocks=MASKS, grade_block_pairs=PAIRS,
    )
    check("e2e: flagged double with redistribution enabled solves",
          res_e2e['status'] == 'success', res_e2e.get('message', ''))
    if res_e2e['status'] == 'success':
        ts_e = res_e2e['options'][0]['teacherSchedules']
        spa_e = find_subject_days(ts_e, 'Sofia', 'Spanish')
        pairs_e = [tuple(v) for v in spa_e.values() if len(v) == 2]
        check("e2e: pairs never split — 2 legal doubles on 2 days post-redistribution",
              len(spa_e) == 2 and len(pairs_e) == 2
              and all(p in MS_PAIRS for p in pairs_e), str(spa_e))

test_21()


# =========================================================================
# TEST 22: teacher lunch designation — a teacher's daily lunch is NOT OPEN
# =========================================================================
def test_22():
    print("\nTEST 22 — lunch designation: designated lunch block is not OPEN")
    import copy
    from solver import (designate_teacher_lunch, count_back_to_back,
                        compute_teacher_stats, redistribute_open_blocks,
                        Teacher as T)

    set_blocks(NINE_BLOCKS)
    B9 = list(solver.BLOCKS)
    G = '7th Grade'

    def day(open_blocks=(), sh_blocks=()):
        d = {}
        for b in B9:
            if b in open_blocks:
                d[b] = ['', 'OPEN']
            elif b in sh_blocks:
                d[b] = [G, 'Study Hall']
            else:
                d[b] = [G, f'Subj{b}']
        return d

    # (a) candidates {5,6,7}, free at 5 and 6, teaching elsewhere:
    # exactly one of them is designated lunch (tie -> lowest = 5) and the
    # (5,6) open adjacency is broken by the designation
    lena_day = day(open_blocks=(5, 6))
    check("designation: tie between free 5 and 6 -> lowest block (5)",
          designate_teacher_lunch(lena_day, {5, 6, 7}) == 5)
    ts_a = {'Lena': {d: copy.deepcopy(lena_day) for d in DAYS}}
    lena = [T(name='Lena', status='full-time')]
    check("BTB pair (5,6) not counted when the designation breaks it (5 -> 0)",
          count_back_to_back(ts_a, 'Lena', {5, 6, 7}) == 0
          and count_back_to_back(ts_a, 'Lena') == 5)
    st_lunch = compute_teacher_stats(ts_a, lena, {'Lena': {5, 6, 7}})[0]
    st_legacy = compute_teacher_stats(ts_a, lena)[0]
    check("stats: open excludes exactly one candidate block per day (10 -> 5)",
          st_lunch.open == 5 and st_legacy.open == 10,
          f"lunch={st_lunch.open} legacy={st_legacy.open}")
    check("stats: lunch is neither teaching nor study hall (counts unchanged)",
          st_lunch.teaching == 35 and st_lunch.study_hall == 0
          and st_lunch.total_used == 35 and st_legacy.teaching == 35,
          str(st_lunch))
    check("stats: back_to_back_issues lunch-aware (5 -> 0)",
          st_lunch.back_to_back_issues == 0
          and st_legacy.back_to_back_issues == 5)

    # (b) determinism: the free window whose exclusion MINIMIZES the day's
    # BTB wins, even when it is not the lowest block
    d_min6 = day(open_blocks=(5, 6, 7))
    check("designation minimizes BTB: 6 chosen over lower 5 (splits 5|7)",
          designate_teacher_lunch(d_min6, {5, 6}) == 6)
    d_min5 = day(open_blocks=(4, 5, 6))
    check("designation minimizes BTB: 5 chosen over 6 here (splits 4|6)",
          designate_teacher_lunch(d_min5, {5, 6}) == 5)
    ts_b = {'Kim': {DAYS[0]: d_min6, **{d: day() for d in DAYS[1:]}}}
    check("open run 5,6,7 with lunch at 6 -> zero BTB (legacy counted 2)",
          count_back_to_back(ts_b, 'Kim', {5, 6}) == 0
          and count_back_to_back(ts_b, 'Kim') == 2)

    # edge: no free candidate window -> designate none (Study Hall occupies)
    check("fully booked day -> no designation",
          designate_teacher_lunch(day(), {5, 6, 7}) is None)
    check("Study Hall in the only window -> occupied, no designation",
          designate_teacher_lunch(day(sh_blocks=(5,)), {5}) is None)
    ts_sh = {'Ana': {DAYS[0]: day(open_blocks=(6,), sh_blocks=(5,)),
                     **{d: day() for d in DAYS[1:]}}}
    check("no designation -> Study Hall/OPEN adjacency still counts as BTB",
          count_back_to_back(ts_sh, 'Ana', {5}) == 1)

    # (c) legacy (no masks/windows): stats byte-identical to old behavior
    set_blocks(None)
    ts_leg = {'Sam': {d: {1: [G, 'Math'], 2: ['', 'OPEN'], 3: ['', 'OPEN'],
                          4: [G, 'ELA'], 5: ['', 'OPEN']} for d in DAYS}}
    sam = [T(name='Sam', status='full-time')]
    s_none = compute_teacher_stats(ts_leg, sam)[0]
    s_null = compute_teacher_stats(ts_leg, sam, None)[0]
    s_empty = compute_teacher_stats(ts_leg, sam, {})[0]
    check("legacy stats unchanged (open=15, teaching=10, btb=5)",
          s_none.open == 15 and s_none.teaching == 10
          and s_none.total_used == 10 and s_none.back_to_back_issues == 5,
          str(s_none))
    check("windows None / {} are byte-identical to the two-arg call",
          s_none == s_null == s_empty)
    if result_5['status'] == 'success':
        bad5 = [s for s in result_5['options'][0]['teacherStats']
                if s['teaching'] + s['studyHall'] + s['open'] != 25]
        check("legacy e2e teacherStats still cover all 25 blocks", not bad5,
              str(bad5[:2]))
    if result_l['status'] == 'success':
        bad_l = [s for s in result_l['options'][0]['teacherStats']
                 if s['teaching'] + s['studyHall'] + s['open'] != 40]
        check("masked e2e stats drop exactly one lunch block per day (45 -> 40)",
              not bad_l, str(bad_l[:2]))

    # (d) redistribution: a "hole" that is only lunch-adjacent is left alone.
    # Pat is free Mon B6+B7; with 6 designated lunch there is no BTB issue.
    set_blocks(NINE_BLOCKS)

    def redis_schedules():
        ts = {'Pat': {DAYS[0]: {b: (['', 'OPEN'] if b in (6, 7)
                                    else [G, f'Mon{b}']) for b in B9}}}
        for i, d in enumerate(DAYS[1:], start=1):
            ts['Pat'][d] = {b: [G, f'D{i}B{b}'] for b in B9}
        gs = {G: {d: {b: None for b in B9} for d in DAYS}}
        for d in DAYS:
            for b in B9:
                e = ts['Pat'][d][b]
                if e[1] != 'OPEN':
                    gs[G][d][b] = ['Pat', e[1]]
        return ts, gs

    ts_r, gs_r = redis_schedules()
    # control: without lunch windows the (6,7) hole attracts a move
    ts_ctrl, gs_ctrl = copy.deepcopy(ts_r), copy.deepcopy(gs_r)
    redistribute_open_blocks(ts_ctrl, gs_ctrl, ['Pat'])
    check("control: without lunch windows the (6,7) hole attracts a move",
          ts_ctrl != ts_r)
    # lunch-aware: 6 designated -> no BTB -> redistribution does nothing
    ts_l2, gs_l2 = copy.deepcopy(ts_r), copy.deepcopy(gs_r)
    redistribute_open_blocks(ts_l2, gs_l2, ['Pat'],
                             teacher_lunch_windows={'Pat': {6}})
    check("lunch-aware: free 6,7 with 6 designated -> no BTB -> no move",
          ts_l2 == ts_r and gs_l2 == gs_r)

test_22()


fails = [n for n, ok in results if not ok]
print(f"RESULT: {len(results) - len(fails)}/{len(results)} passed"
      + (f"; FAILED: {fails}" if fails else ""))
sys.exit(1 if fails else 0)