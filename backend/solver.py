"""
School Schedule Solver - OR-Tools CP-SAT Implementation

Uses Constraint Programming with CP-SAT for optimal school scheduling.
Handles all hard and soft constraints with multiple seed attempts for variety.
"""

import time
from typing import Optional
from dataclasses import dataclass, field
from ortools.sat.python import cp_model

# Constants
DAYS = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']
BLOCKS = [1, 2, 3, 4, 5]
NUM_SLOTS = 25

ALL_GRADES = [
    'Kindergarten', '1st Grade', '2nd Grade', '3rd Grade', '4th Grade', '5th Grade',
    '6th Grade', '7th Grade', '8th Grade', '9th Grade', '10th Grade', '11th Grade'
]

GRADE_MAP = {
    # Standard grade names
    'Kindergarten': ['Kindergarten'],
    'Kingergarten': ['Kindergarten'],  # Handle typo
    'kindergarten': ['Kindergarten'],  # Handle lowercase
    '1st Grade': ['1st Grade'],
    '2nd Grade': ['2nd Grade'],
    '3rd Grade': ['3rd Grade'],
    '4th Grade': ['4th Grade'],
    '5th Grade': ['5th Grade'],
    '6th Grade': ['6th Grade'],
    '7th Grade': ['7th Grade'],
    '8th Grade': ['8th Grade'],
    '9th Grade': ['9th Grade'],
    '10th Grade': ['10th Grade'],
    '11th Grade': ['11th Grade'],
    # Shortened versions (database format)
    '1st': ['1st Grade'],
    '2nd': ['2nd Grade'],
    '3rd': ['3rd Grade'],
    '4th': ['4th Grade'],
    '5th': ['5th Grade'],
    '6th': ['6th Grade'],
    '7th': ['7th Grade'],
    '8th': ['8th Grade'],
    '9th': ['9th Grade'],
    '10th': ['10th Grade'],
    '11th': ['11th Grade'],
    # Combined grades
    '6th-7th Grade': ['6th Grade', '7th Grade'],
    '6th-7th': ['6th Grade', '7th Grade'],
    '10th-11th Grade': ['10th Grade', '11th Grade'],
    '10th-11th': ['10th Grade', '11th Grade'],
    # Electives - spans multiple grades but treated as a single group
    # Don't map to individual grades to avoid excessive conflicts
    '6th-11th-elective': [],  # Electives handled specially - no grade conflicts
}

UPPER_GRADES = {
    '6th Grade', '7th Grade', '8th Grade', '9th Grade', '10th Grade', '11th Grade',
    '6th', '7th', '8th', '9th', '10th', '11th',  # Shortened versions
    '6th-7th', '10th-11th', '6th-11th-elective',  # Combined grades
}

# Study hall groups - each grade needs one study hall per week
# Grades that CAN be combined if individual placement fails
STUDY_HALL_GRADES = ['6th Grade', '7th Grade', '8th Grade', '9th Grade', '10th Grade', '11th Grade']
COMBINABLE_GRADES = [
    ('6th Grade', '7th Grade'),    # Can combine 6th-7th
    ('10th Grade', '11th Grade'),  # Can combine 10th-11th
]


@dataclass
class Teacher:
    name: str
    status: str  # 'full-time' or 'part-time'
    can_supervise_study_hall: Optional[bool] = None  # None/True = eligible, False = excluded


@dataclass
class ClassEntry:
    teacher: str
    grades: list  # List of grade names (e.g., ['6th Grade', '7th Grade'])
    subject: str
    days_per_week: int
    grade_display: str = ''  # Display name for schedules (e.g., '6th-7th Grade')
    is_elective: bool = False  # Electives skip grade conflicts
    available_days: list = field(default_factory=lambda: DAYS.copy())
    available_blocks: list = field(default_factory=lambda: BLOCKS.copy())
    fixed_slots: list = field(default_factory=list)  # [(day, block), ...]


@dataclass
class Session:
    id: int
    teacher: str
    grades: list  # List of grade names this session covers
    grade_display: str  # Display name for schedules
    subject: str
    valid_slots: list
    is_fixed: bool = False
    is_elective: bool = False  # Electives skip grade conflicts


@dataclass
class StudyHallAssignment:
    group: str
    teacher: Optional[str] = None
    day: Optional[str] = None
    block: Optional[int] = None


@dataclass
class TeacherStat:
    teacher: str
    status: str
    teaching: int = 0
    study_hall: int = 0
    open: int = 0
    total_used: int = 0
    back_to_back_issues: int = 0


# Utility functions
def slot_to_day(slot: int) -> int:
    return slot // 5


def slot_to_block(slot: int) -> int:
    return slot % 5


def day_block_to_slot(day_idx: int, block_idx: int) -> int:
    return day_idx * 5 + block_idx


def parse_grades(grade_field: str) -> list:
    if 'Elective' in grade_field:
        return []
    return GRADE_MAP.get(grade_field.strip(), [])


def get_valid_slots(avail_days: list, avail_blocks: list) -> list:
    slots = []
    for day in avail_days:
        if day not in DAYS:
            continue
        day_idx = DAYS.index(day)
        for block in avail_blocks:
            if block not in BLOCKS:
                continue
            block_idx = BLOCKS.index(block)
            slots.append(day_block_to_slot(day_idx, block_idx))
    return slots if slots else list(range(25))


def get_study_hall_eligible(teachers: list[Teacher], classes: list[ClassEntry]) -> list[str]:
    """Get teachers eligible to supervise study hall.

    Eligibility:
    - Must be full-time
    - Not excluded (excludeFromStudyHall=True means excluded, stored as canSuperviseStudyHall)

    Note: The field is inverted - canSuperviseStudyHall=True means EXCLUDED from study hall
    (because the UI checkbox is "Exclude from Study Hall")
    """
    eligible = []
    for t in teachers:
        if t.status != 'full-time':
            continue
        # canSuperviseStudyHall=True means EXCLUDED (checkbox is "Exclude from Study Hall")
        if t.can_supervise_study_hall is True:
            continue
        eligible.append(t.name)
    return eligible


def build_sessions(classes: list[ClassEntry]) -> list[Session]:
    """Convert classes to sessions (one per day of instruction).

    Sessions are sorted by constraint level (most constrained first):
    1. Fixed slots first (only 1 valid slot)
    2. Teacher load factor (busier teachers = higher priority)
    3. Fewer valid slots = more constrained = higher priority

    This "Most Constrained Variable" (MRV) heuristic helps the solver
    by handling the hardest assignments first, failing fast if infeasible.

    Teacher load matters because a teacher with 20 sessions has less
    flexibility than one with 5, even if individual sessions have
    the same number of valid slots.
    """
    sessions = []
    session_id = 0

    # First pass: count sessions per teacher (teacher load)
    teacher_session_count: dict[str, int] = {}
    for cls in classes:
        count = len(cls.fixed_slots) if cls.fixed_slots else cls.days_per_week
        teacher_session_count[cls.teacher] = teacher_session_count.get(cls.teacher, 0) + count

    # Also calculate "constraint score" per teacher:
    # sessions / average_valid_slots (higher = more constrained)
    teacher_avg_slots: dict[str, float] = {}
    teacher_total_slots: dict[str, int] = {}
    for cls in classes:
        teacher = cls.teacher
        if cls.fixed_slots:
            slots_count = 1  # Fixed = 1 valid slot
            num_sessions = len(cls.fixed_slots)
        else:
            valid_slots = get_valid_slots(cls.available_days, cls.available_blocks)
            slots_count = len(valid_slots)
            num_sessions = cls.days_per_week

        teacher_total_slots[teacher] = teacher_total_slots.get(teacher, 0) + (slots_count * num_sessions)

    for teacher in teacher_session_count:
        total_sessions = teacher_session_count[teacher]
        total_slots = teacher_total_slots.get(teacher, 25 * total_sessions)
        # Average valid slots per session for this teacher
        teacher_avg_slots[teacher] = total_slots / total_sessions if total_sessions > 0 else 25

    # Pre-compute slots blocked by electives for each grade
    # Electives with fixed slots block those slots for all grades they cover
    grade_blocked_slots: dict[str, set[int]] = {g: set() for g in ALL_GRADES}
    for cls in classes:
        if cls.is_elective and cls.fixed_slots:
            for day, block in cls.fixed_slots:
                if day in DAYS and block in BLOCKS:
                    day_idx = DAYS.index(day)
                    block_idx = BLOCKS.index(block)
                    slot = day_block_to_slot(day_idx, block_idx)
                    # Block this slot for all grades this elective covers
                    for grade in cls.grades:
                        if grade in grade_blocked_slots:
                            grade_blocked_slots[grade].add(slot)

    # Build sessions
    for cls in classes:
        if cls.fixed_slots:
            for day, block in cls.fixed_slots:
                if day in DAYS and block in BLOCKS:
                    day_idx = DAYS.index(day)
                    block_idx = BLOCKS.index(block)
                    slot = day_block_to_slot(day_idx, block_idx)
                    sessions.append(Session(
                        id=session_id,
                        teacher=cls.teacher,
                        grades=cls.grades,
                        grade_display=cls.grade_display,
                        subject=cls.subject,
                        valid_slots=[slot],
                        is_fixed=True,
                        is_elective=cls.is_elective
                    ))
                    session_id += 1
        else:
            valid_slots = get_valid_slots(cls.available_days, cls.available_blocks)

            # For regular (non-elective) classes, remove slots blocked by electives
            # This optimization pre-excludes slots where electives are fixed,
            # reducing the solver's search space significantly
            if not cls.is_elective and cls.grades:
                blocked = set()
                for grade in cls.grades:
                    blocked.update(grade_blocked_slots.get(grade, set()))
                if blocked:
                    valid_slots = [s for s in valid_slots if s not in blocked]

            for _ in range(cls.days_per_week):
                sessions.append(Session(
                    id=session_id,
                    teacher=cls.teacher,
                    grades=cls.grades,
                    grade_display=cls.grade_display,
                    subject=cls.subject,
                    valid_slots=valid_slots,
                    is_fixed=False,
                    is_elective=cls.is_elective
                ))
                session_id += 1

    # Sort by constraint level:
    # 1. Fixed slots first (is_fixed=True → 0, else 1)
    # 2. Teacher constraint score: sessions / avg_slots (higher = more constrained, so negate)
    # 3. Fewer valid slots for this specific session
    def sort_key(s: Session) -> tuple:
        teacher_load = teacher_session_count.get(s.teacher, 0)
        teacher_flexibility = teacher_avg_slots.get(s.teacher, 25)
        # Constraint score: more sessions + fewer avg slots = more constrained
        # We want higher constraint = lower sort value, so negate
        constraint_score = -teacher_load / teacher_flexibility if teacher_flexibility > 0 else 0
        return (
            0 if s.is_fixed else 1,      # Fixed first
            constraint_score,             # Busier/more constrained teachers first
            len(s.valid_slots)            # Fewer valid slots first
        )

    sessions.sort(key=sort_key)

    # Reassign IDs after sorting to maintain sequential order
    for i, s in enumerate(sessions):
        s.id = i

    return sessions


class SolutionCollector(cp_model.CpSolverSolutionCallback):
    """Collects multiple solutions from CP-SAT solver."""

    def __init__(self, variables: dict, max_solutions: int = 5):
        cp_model.CpSolverSolutionCallback.__init__(self)
        self._variables = variables
        self._max_solutions = max_solutions
        self._solutions = []

    def on_solution_callback(self):
        solution = {sid: self.Value(var) for sid, var in self._variables.items()}
        self._solutions.append(solution)
        if len(self._solutions) >= self._max_solutions:
            self.StopSearch()

    def get_solutions(self):
        return self._solutions


def solve_with_cpsat(sessions: list[Session], seed: int = 0, time_limit: float = 10.0, max_solutions: int = 5, diagnostics: dict = None) -> list[dict]:
    """
    Solve the scheduling problem using CP-SAT.

    Returns list of dicts mapping session_id -> slot, or empty list if infeasible.

    If diagnostics dict is provided, it will be populated with diagnostic info
    that can be shown to end users to help understand infeasibility.
    """
    import random
    rng = random.Random(seed)

    if diagnostics is not None:
        # Collect diagnostic info for end users
        fixed_sessions = [s for s in sessions if len(s.valid_slots) == 1]
        diagnostics['totalSessions'] = len(sessions)
        diagnostics['fixedSessions'] = len(fixed_sessions)

        # Check for teacher overload (more than 25 sessions)
        from collections import Counter
        teacher_counts = Counter(s.teacher for s in sessions)
        overloaded = [(t, c) for t, c in teacher_counts.items() if c > 25]
        if overloaded:
            diagnostics['teacherOverload'] = [{'teacher': t, 'sessions': c} for t, c in overloaded]

        # Check for fixed slot conflicts (same teacher, same slot)
        conflicts = []
        teacher_fixed = {}
        for s in fixed_sessions:
            slot = s.valid_slots[0]
            key = (s.teacher, slot)
            if key in teacher_fixed:
                day_idx = slot // 5
                block_idx = slot % 5
                conflicts.append({
                    'teacher': s.teacher,
                    'day': DAYS[day_idx],
                    'block': BLOCKS[block_idx],
                    'class1': {'subject': teacher_fixed[key].subject, 'grades': teacher_fixed[key].grades},
                    'class2': {'subject': s.subject, 'grades': s.grades},
                })
            teacher_fixed[key] = s
        if conflicts:
            diagnostics['fixedSlotConflicts'] = conflicts

    model = cp_model.CpModel()

    # Create variables: one integer variable per session representing assigned slot
    # Shuffle non-fixed sessions based on seed to explore different solution paths
    shuffled_sessions = sessions.copy()
    # Keep fixed sessions first, shuffle the rest
    fixed = [s for s in shuffled_sessions if len(s.valid_slots) == 1]
    non_fixed = [s for s in shuffled_sessions if len(s.valid_slots) > 1]
    rng.shuffle(non_fixed)
    shuffled_sessions = fixed + non_fixed

    slot_vars = {}
    non_fixed_vars = []
    for s in shuffled_sessions:
        if len(s.valid_slots) == 1:
            # Fixed slot - create constant
            slot_vars[s.id] = model.NewConstant(s.valid_slots[0])
        else:
            # Shuffle the valid slots to explore different assignments
            shuffled_slots = s.valid_slots.copy()
            rng.shuffle(shuffled_slots)
            # Create domain from valid slots
            var = model.NewIntVarFromDomain(
                cp_model.Domain.FromValues(shuffled_slots),
                f'session_{s.id}'
            )
            slot_vars[s.id] = var
            non_fixed_vars.append(var)

    # Decision strategy: use random value selection for more variety
    # Different seeds will explore different parts of the solution space
    value_strategy = cp_model.SELECT_MIN_VALUE if seed % 2 == 0 else cp_model.SELECT_MAX_VALUE
    if non_fixed_vars:
        model.AddDecisionStrategy(
            non_fixed_vars,
            cp_model.CHOOSE_FIRST,
            value_strategy
        )

    # Hard Constraint 1: No teacher conflicts (teacher can't be in two places at once)
    teachers = list(set(s.teacher for s in sessions))
    for teacher in teachers:
        teacher_sessions = [s for s in sessions if s.teacher == teacher]
        if len(teacher_sessions) > 1:
            teacher_vars = [slot_vars[s.id] for s in teacher_sessions]
            model.AddAllDifferent(teacher_vars)

    # Hard Constraint 2: No grade conflicts (grade can't have two classes at once)
    #
    # Elective logic:
    # - Elective vs Elective (same grades): NO conflict - they're concurrent "pick one" choices
    # - Elective vs Regular (same grades): CONFLICT - elective period blocks regular classes
    # - Regular vs Regular (same grades): CONFLICT - standard grade blocking
    #
    for grade in ALL_GRADES:
        regular_sessions = [s for s in sessions if grade in s.grades and not s.is_elective]
        elective_sessions = [s for s in sessions if grade in s.grades and s.is_elective]

        # Regular vs Regular: all must be at different times
        if len(regular_sessions) > 1:
            regular_vars = [slot_vars[s.id] for s in regular_sessions]
            model.AddAllDifferent(regular_vars)

        # Regular vs Elective: each regular class must not overlap with any elective
        # (electives block the grade from having regular classes at that time)
        for reg in regular_sessions:
            for elec in elective_sessions:
                model.Add(slot_vars[reg.id] != slot_vars[elec.id])

        # Elective vs Elective: NO constraint - they can all be at the same time

    # Hard Constraint 3: No duplicate subjects per day per grade
    # Note: Also skip electives for this constraint
    for grade in ALL_GRADES:
        subjects_for_grade = set()
        for s in sessions:
            if s.is_elective:
                continue
            if grade in s.grades:
                subjects_for_grade.add(s.subject)

        for subject in subjects_for_grade:
            # Get all sessions for this grade+subject (excluding electives)
            gs_sessions = [s for s in sessions
                         if grade in s.grades and s.subject == subject and not s.is_elective]

            if len(gs_sessions) > 1:
                # For each pair, ensure they're on different days
                for i, s1 in enumerate(gs_sessions):
                    for s2 in gs_sessions[i+1:]:
                        # day = slot // 5, so different days means slot1//5 != slot2//5
                        day1 = model.NewIntVar(0, 4, f'd1_{s1.id}_{s2.id}')
                        day2 = model.NewIntVar(0, 4, f'd2_{s1.id}_{s2.id}')
                        model.AddDivisionEquality(day1, slot_vars[s1.id], 5)
                        model.AddDivisionEquality(day2, slot_vars[s2.id], 5)
                        model.Add(day1 != day2)

    # Hard Constraint 4: Co-taught classes (same grade+subject, different teachers)
    # If multiple teachers teach the same grade+subject, they must be scheduled together.
    # This is used when two teachers team-teach a class together.
    #
    # Optimization: Skip adding constraint if both sessions are already fixed to the
    # same slot (constraint would be redundant: constant == constant).
    from collections import defaultdict
    cotaught_groups = defaultdict(list)  # (grade, subject) -> [sessions]

    for s in sessions:
        for grade in s.grades:
            key = (grade, s.subject)
            cotaught_groups[key].append(s)

    cotaught_count = 0
    cotaught_info = []  # For diagnostics
    cotaught_mismatches = []  # Session count mismatches

    for (grade, subject), group_sessions in cotaught_groups.items():
        # Get unique teachers in this grade+subject
        teachers_in_group = set(s.teacher for s in group_sessions)
        if len(teachers_in_group) > 1:
            # Multiple teachers for same grade+subject = co-taught
            cotaught_info.append({
                'grade': grade,
                'subject': subject,
                'teachers': list(teachers_in_group),
            })

            # Group sessions by teacher to find matching pairs
            by_teacher = defaultdict(list)
            for s in group_sessions:
                by_teacher[s.teacher].append(s)

            # Each teacher should have same number of sessions
            # Pair them up: teacher1's 1st session with teacher2's 1st session, etc.
            teacher_list = list(by_teacher.keys())
            first_teacher_sessions = by_teacher[teacher_list[0]]

            for other_teacher in teacher_list[1:]:
                other_sessions = by_teacher[other_teacher]
                if len(first_teacher_sessions) != len(other_sessions):
                    cotaught_mismatches.append({
                        'grade': grade,
                        'subject': subject,
                        'teacher1': teacher_list[0],
                        'sessions1': len(first_teacher_sessions),
                        'teacher2': other_teacher,
                        'sessions2': len(other_sessions),
                    })
                # Pair sessions in order (assumes same daysPerWeek)
                for i, s1 in enumerate(first_teacher_sessions):
                    if i < len(other_sessions):
                        s2 = other_sessions[i]
                        # Skip if both are fixed to the same slot (redundant constraint)
                        if s1.is_fixed and s2.is_fixed and s1.valid_slots == s2.valid_slots:
                            continue
                        # Must be at same time
                        model.Add(slot_vars[s1.id] == slot_vars[s2.id])
                        cotaught_count += 1

    if diagnostics is not None:
        diagnostics['cotaughtClasses'] = cotaught_info
        diagnostics['cotaughtConstraints'] = cotaught_count
        if cotaught_mismatches:
            diagnostics['cotaughtMismatches'] = cotaught_mismatches

    # Note: Back-to-back OPEN minimization is handled in post-processing via
    # redistribute_open_blocks() which is more effective since it can account for
    # study halls (added after solving) and only applies to full-time teachers.

    # Solve with solution collector to get multiple solutions
    solver = cp_model.CpSolver()
    solver.parameters.random_seed = seed
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 1  # Deterministic with seed
    solver.parameters.enumerate_all_solutions = True  # Enable solution enumeration

    collector = SolutionCollector(slot_vars, max_solutions=max_solutions)
    status = solver.Solve(model, collector)

    status_names = {0: 'UNKNOWN', 1: 'MODEL_INVALID', 2: 'FEASIBLE', 3: 'INFEASIBLE', 4: 'OPTIMAL'}
    if diagnostics is not None:
        diagnostics['solverStatus'] = status_names.get(status, str(status))

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        solutions = collector.get_solutions()
        if solutions:
            return solutions
        # Fallback: if callback didn't capture, get at least one solution
        assignment = {s.id: solver.Value(slot_vars[s.id]) for s in sessions}
        return [assignment]

    return []


def build_schedules(assignment: dict, sessions: list[Session], teachers: list[Teacher]):
    """Build teacher and grade schedule dictionaries from assignment."""
    teacher_schedules = {}
    grade_schedules = {}

    # Initialize empty schedules
    all_teachers = list(set(s.teacher for s in sessions))
    for t in all_teachers:
        teacher_schedules[t] = {day: {b: None for b in BLOCKS} for day in DAYS}

    all_grades = set()
    for s in sessions:
        for g in s.grades:
            all_grades.add(g)
    for grade in all_grades:
        grade_schedules[grade] = {day: {b: None for b in BLOCKS} for day in DAYS}

    # Fill in assignments
    for s in sessions:
        slot = assignment[s.id]
        day_idx = slot_to_day(slot)
        block_idx = slot_to_block(slot)
        day = DAYS[day_idx]
        block = BLOCKS[block_idx]

        # Teacher schedule: [grade_display, subject]
        teacher_schedules[s.teacher][day][block] = [s.grade_display, s.subject]

        # Grade schedules: [teacher, subject]
        for grade in s.grades:
            if grade in grade_schedules:
                grade_schedules[grade][day][block] = [s.teacher, s.subject]

    return teacher_schedules, grade_schedules


def redistribute_open_blocks(teacher_schedules: dict, grade_schedules: dict,
                             full_time_teachers: list[str]) -> None:
    """
    Post-processing to break up consecutive OPEN blocks by swapping classes around.
    This mimics the JavaScript solver's redistributeOpenBlocks function.
    """
    def get_back_to_back_slots(teacher: str) -> list[tuple[str, int]]:
        """Get (day, block) pairs where there's a back-to-back OPEN issue."""
        pairs = []
        schedule = teacher_schedules.get(teacher, {})
        for day in DAYS:
            for i in range(len(BLOCKS) - 1):
                b1, b2 = BLOCKS[i], BLOCKS[i + 1]
                entry1 = schedule.get(day, {}).get(b1)
                entry2 = schedule.get(day, {}).get(b2)
                is_open1 = not entry1 or (len(entry1) > 1 and entry1[1] in ('OPEN', 'Study Hall'))
                is_open2 = not entry2 or (len(entry2) > 1 and entry2[1] in ('OPEN', 'Study Hall'))
                if is_open1 and is_open2:
                    pairs.append((day, b2))  # Return the second slot to try to fill
        return pairs

    def would_create_btb(teacher: str, day: str, block: int) -> bool:
        """Check if putting an OPEN at (day, block) would create a BTB issue."""
        block_idx = BLOCKS.index(block)
        schedule = teacher_schedules.get(teacher, {}).get(day, {})

        # Check previous block
        if block_idx > 0:
            prev_entry = schedule.get(BLOCKS[block_idx - 1])
            if not prev_entry or (len(prev_entry) > 1 and prev_entry[1] in ('OPEN', 'Study Hall')):
                return True

        # Check next block
        if block_idx < 4:
            next_entry = schedule.get(BLOCKS[block_idx + 1])
            if not next_entry or (len(next_entry) > 1 and next_entry[1] in ('OPEN', 'Study Hall')):
                return True

        return False

    # Run up to 2000 iterations (like JS solver)
    for iteration in range(2000):
        made_swap = False

        for teacher in full_time_teachers:
            if made_swap:
                break

            btb_slots = get_back_to_back_slots(teacher)
            if not btb_slots:
                continue

            for issue_day, issue_block in btb_slots:
                if made_swap:
                    break

                # Try to find a class that can be moved to this slot
                for target_day in DAYS:
                    if made_swap:
                        break

                    for target_block in BLOCKS:
                        entry = teacher_schedules.get(teacher, {}).get(target_day, {}).get(target_block)

                        # Skip if not a teaching entry (needs to be a class, not OPEN/Study Hall)
                        if not entry or not entry[0] or entry[1] in ('OPEN', 'Study Hall'):
                            continue

                        # Skip if moving from here would create a BTB issue
                        if would_create_btb(teacher, target_day, target_block):
                            continue

                        grade_display, subject = entry

                        # Find which grades this class covers by checking grade_schedules
                        # This is more robust than parsing the display name
                        grades = []
                        for g in grade_schedules:
                            slot_entry = grade_schedules[g].get(target_day, {}).get(target_block)
                            if slot_entry and slot_entry[0] == teacher and slot_entry[1] == subject:
                                grades.append(g)

                        if not grades:
                            # Fallback to parse_grades if we can't find grades in schedule
                            grades = parse_grades(grade_display)
                            if not grades:
                                continue

                        # Check for conflicts at the target location
                        has_conflict = False

                        # Check grade conflicts
                        for g in grades:
                            slot_entry = grade_schedules.get(g, {}).get(issue_day, {}).get(issue_block)
                            if slot_entry and slot_entry[1] not in ('OPEN', None):
                                has_conflict = True
                                break

                        if has_conflict:
                            continue

                        # Check subject/day conflict
                        for g in grades:
                            for b in BLOCKS:
                                if b == issue_block:
                                    continue
                                slot_entry = grade_schedules.get(g, {}).get(issue_day, {}).get(b)
                                if slot_entry and slot_entry[1] == subject:
                                    has_conflict = True
                                    break
                            if has_conflict:
                                break

                        if has_conflict:
                            continue

                        # Perform the swap
                        teacher_schedules[teacher][issue_day][issue_block] = [grade_display, subject]
                        teacher_schedules[teacher][target_day][target_block] = ['', 'OPEN']

                        for g in grades:
                            if g in grade_schedules:
                                grade_schedules[g][target_day][target_block] = None
                                grade_schedules[g][issue_day][issue_block] = [teacher, subject]

                        made_swap = True
                        break

        if not made_swap:
            break


def add_study_halls(teacher_schedules: dict, grade_schedules: dict,
                    eligible_teachers: list[str]) -> list[StudyHallAssignment]:
    """Assign study halls to eligible teachers with open blocks.

    Strategy:
    1. Try to place each grade (6th-11th) individually first
    2. For grades that fail, try combining with adjacent grade (6th-7th or 10th-11th)

    Prioritizes teachers with MORE open blocks (not even distribution).
    """
    assignments = []

    if not eligible_teachers:
        return [StudyHallAssignment(group=g) for g in STUDY_HALL_GRADES]

    def count_open_blocks(teacher: str) -> int:
        """Count remaining open blocks (not teaching, not already study hall)."""
        count = 0
        schedule = teacher_schedules.get(teacher, {})
        for day in DAYS:
            for block in BLOCKS:
                entry = schedule.get(day, {}).get(block)
                if entry is None:
                    count += 1
        return count

    # Filter to teachers that exist in schedules
    valid_teachers = [t for t in eligible_teachers if t in teacher_schedules]

    if not valid_teachers:
        return [StudyHallAssignment(group=g) for g in STUDY_HALL_GRADES]

    # Track which days each grade already has a study hall
    grade_study_hall_days: dict[str, set[str]] = {g: set() for g in ALL_GRADES}
    # Track which grades have been placed
    placed_grades: set[str] = set()

    def try_place_study_hall(group_name: str, group_grades: list[str]) -> bool:
        """Try to place a study hall for a group of grades. Returns True if successful."""
        teachers_by_availability = sorted(
            valid_teachers,
            key=count_open_blocks,
            reverse=True
        )

        for teacher in teachers_by_availability:
            if count_open_blocks(teacher) == 0:
                continue

            for day in DAYS:
                # Skip if any grade in this group already has study hall today
                if any(day in grade_study_hall_days.get(g, set()) for g in group_grades):
                    continue

                for block in BLOCKS:
                    # Teacher must be free
                    if teacher_schedules[teacher][day][block] is not None:
                        continue

                    # All grades in group must be free
                    grades_free = all(
                        grade_schedules.get(g, {}).get(day, {}).get(block) is None
                        for g in group_grades
                    )

                    if grades_free:
                        # Assign study hall
                        teacher_schedules[teacher][day][block] = [group_name, 'Study Hall']
                        for g in group_grades:
                            if g in grade_schedules:
                                grade_schedules[g][day][block] = [teacher, 'Study Hall']
                            grade_study_hall_days[g].add(day)

                        assignments.append(StudyHallAssignment(
                            group=group_name,
                            teacher=teacher,
                            day=day,
                            block=block
                        ))
                        return True
        return False

    # Phase 1: Try to place each grade individually
    failed_grades = []
    for grade in STUDY_HALL_GRADES:
        if try_place_study_hall(grade, [grade]):
            placed_grades.add(grade)
        else:
            failed_grades.append(grade)

    # Phase 2: For failed grades, try combining with adjacent grade
    for grade1, grade2 in COMBINABLE_GRADES:
        # Only combine if BOTH grades failed individually
        if grade1 in failed_grades and grade2 in failed_grades:
            combined_name = f"{grade1.replace(' Grade', '')}-{grade2.replace(' Grade', '')} Grade"
            if try_place_study_hall(combined_name, [grade1, grade2]):
                placed_grades.add(grade1)
                placed_grades.add(grade2)
                failed_grades.remove(grade1)
                failed_grades.remove(grade2)

    # Add unplaced grades as failed assignments
    for grade in failed_grades:
        assignments.append(StudyHallAssignment(group=grade))

    return assignments


def fill_open_blocks(teacher_schedules: dict):
    """Fill remaining empty blocks with 'OPEN'."""
    for teacher in teacher_schedules:
        for day in DAYS:
            for block in BLOCKS:
                if teacher_schedules[teacher][day][block] is None:
                    teacher_schedules[teacher][day][block] = ['', 'OPEN']


def count_back_to_back(teacher_schedules: dict, teacher: str) -> int:
    """Count back-to-back OPEN blocks for a teacher.

    Both OPEN and Study Hall count as "open" for this calculation, since
    consecutive free/supervision blocks should be minimized.
    """
    count = 0
    schedule = teacher_schedules.get(teacher, {})

    for day in DAYS:
        for i in range(len(BLOCKS) - 1):
            b1, b2 = BLOCKS[i], BLOCKS[i + 1]
            cell1 = schedule.get(day, {}).get(b1)
            cell2 = schedule.get(day, {}).get(b2)

            # Both OPEN and Study Hall count as "open" for BTB detection
            is_open1 = cell1 and len(cell1) > 1 and cell1[1] in ('OPEN', 'Study Hall')
            is_open2 = cell2 and len(cell2) > 1 and cell2[1] in ('OPEN', 'Study Hall')

            if is_open1 and is_open2:
                count += 1

    return count


def compute_teacher_stats(teacher_schedules: dict, teachers: list[Teacher]) -> list[TeacherStat]:
    """Compute statistics for each teacher."""
    stats = []
    teacher_status = {t.name: t.status for t in teachers}

    for teacher, schedule in teacher_schedules.items():
        teaching = 0
        study_hall = 0
        open_blocks = 0

        for day in DAYS:
            for block in BLOCKS:
                cell = schedule.get(day, {}).get(block)
                if cell is None:
                    open_blocks += 1
                elif len(cell) > 1:
                    if cell[1] == 'OPEN':
                        open_blocks += 1
                    elif cell[1] == 'Study Hall':
                        study_hall += 1
                    else:
                        teaching += 1

        btb = count_back_to_back(teacher_schedules, teacher)

        stats.append(TeacherStat(
            teacher=teacher,
            status=teacher_status.get(teacher, 'unknown'),
            teaching=teaching,
            study_hall=study_hall,
            open=open_blocks,
            total_used=teaching + study_hall,
            back_to_back_issues=btb
        ))

    return stats


def generate_schedules(
    teachers: list[dict],
    classes: list[dict],
    num_options: int = 3,
    num_attempts: int = 150,
    max_time_seconds: float = 280.0,
    on_progress=None
) -> dict:
    """
    Main entry point for schedule generation.

    Args:
        teachers: List of teacher dicts with name, status, can_supervise_study_hall
        classes: List of class dicts with teacher, grade, subject, days_per_week, etc.
        num_options: Number of schedule options to return
        num_attempts: Number of seeds to try
        max_time_seconds: Maximum total time for all attempts
        on_progress: Optional callback(current, total, message)

    Returns:
        Dict with status, options, message, seeds_completed
    """
    start_time = time.time()
    time_per_attempt = min(10.0, max_time_seconds / num_attempts)

    # Convert dicts to dataclasses
    # Note: canSuperviseStudyHall can be True, False, or None/undefined
    # None means "not excluded" (eligible if full-time)
    # False means "excluded"
    # True means "explicitly eligible" (not currently used differently from None)
    teacher_objs = [
        Teacher(
            name=t['name'],
            status=t.get('status', 'full-time'),
            can_supervise_study_hall=t.get('canSuperviseStudyHall')  # Keep None as-is
        )
        for t in teachers
    ]

    def make_grade_display(grades_list: list) -> str:
        """Create a display name from a list of grades."""
        if not grades_list:
            return ''
        if len(grades_list) == 1:
            return grades_list[0]
        # Sort by grade order and create range display
        grade_order = {g: i for i, g in enumerate(ALL_GRADES)}
        sorted_grades = sorted(grades_list, key=lambda g: grade_order.get(g, 99))
        first = sorted_grades[0].replace(' Grade', '')
        last = sorted_grades[-1].replace(' Grade', '')
        return f"{first}-{last} Grade"

    def normalize_grades(grades_input) -> list:
        """Normalize grade input to list of standard grade names."""
        if isinstance(grades_input, list):
            # Already a list, normalize each grade name
            result = []
            for g in grades_input:
                # Map short names to full names
                normalized = GRADE_MAP.get(g, [g] if g in ALL_GRADES else [])
                result.extend(normalized)
            return list(set(result))  # Remove duplicates
        elif isinstance(grades_input, str):
            # Single grade string (legacy format)
            return GRADE_MAP.get(grades_input, [grades_input] if grades_input in ALL_GRADES else [])
        return []

    class_objs = []
    for c in classes:
        # Support both new 'grades' array and legacy 'grade' string
        if 'grades' in c and c['grades']:
            grades_list = normalize_grades(c['grades'])
        elif 'grade' in c:
            grades_list = normalize_grades(c['grade'])
        else:
            grades_list = []

        grade_display = c.get('gradeDisplay') or make_grade_display(grades_list)

        class_objs.append(ClassEntry(
            teacher=c['teacher'],
            grades=grades_list,
            grade_display=grade_display,
            subject=c['subject'],
            days_per_week=c.get('daysPerWeek', 1),
            is_elective=c.get('isElective', False),
            available_days=c.get('availableDays') or DAYS.copy(),
            available_blocks=c.get('availableBlocks') or BLOCKS.copy(),
            fixed_slots=[(fs[0], fs[1]) for fs in (c.get('fixedSlots') or [])]
        ))

    full_time_names = [t.name for t in teacher_objs if t.status == 'full-time']
    eligible = get_study_hall_eligible(teacher_objs, class_objs)
    sessions = build_sessions(class_objs)

    if on_progress:
        on_progress(0, num_attempts, 'Initializing CP-SAT solver...')

    # Pre-flight validation checks
    diagnostics = {}  # Collect diagnostic info for end users
    preflight_errors = []
    incomplete_classes = []

    # Check 0: Missing required fields (teacher, grade, subject)
    for i, cls in enumerate(class_objs):
        issues = []
        if not cls.teacher or cls.teacher.strip() == '':
            issues.append('no teacher')
        if not cls.grades or len(cls.grades) == 0:
            issues.append('no grade')
        if not cls.subject or cls.subject.strip() == '':
            issues.append('no subject')
        if issues:
            incomplete_classes.append({
                'index': i + 1,
                'teacher': cls.teacher or '(none)',
                'subject': cls.subject or '(none)',
                'grades': cls.grades if cls.grades else [],
                'issues': issues,
            })
            preflight_errors.append(
                f"Class #{i+1} ({cls.teacher or 'no teacher'} - {cls.subject or 'no subject'}): {', '.join(issues)}"
            )

    if incomplete_classes:
        diagnostics['incompleteClasses'] = incomplete_classes

    # Check 1: Teacher overload (more than 25 sessions)
    teacher_session_count = {}
    for cls in class_objs:
        count = len(cls.fixed_slots) if cls.fixed_slots else cls.days_per_week
        teacher_session_count[cls.teacher] = teacher_session_count.get(cls.teacher, 0) + count

    overloaded_teachers = [(t, c) for t, c in teacher_session_count.items() if c > 25]
    if overloaded_teachers:
        diagnostics['teacherOverload'] = [{'teacher': t, 'sessions': c} for t, c in overloaded_teachers]
        for t, c in overloaded_teachers:
            preflight_errors.append(f"Teacher '{t}' has {c} sessions but max is 25 (5 days × 5 blocks)")

    # Check 2: Grade overload (more than 25 sessions per grade)
    # Note: Elective sessions don't count toward individual grade limits
    # Note: Co-taught classes (same grade+subject, different teachers) only count once
    grade_session_count = {}
    seen_grade_subject = set()  # Track (grade, subject) to avoid double-counting co-taught
    for cls in class_objs:
        if cls.is_elective:
            continue  # Skip electives for grade counting
        count = len(cls.fixed_slots) if cls.fixed_slots else cls.days_per_week
        for grade in cls.grades:
            key = (grade, cls.subject)
            if key in seen_grade_subject:
                continue  # Already counted this grade+subject (co-taught)
            seen_grade_subject.add(key)
            grade_session_count[grade] = grade_session_count.get(grade, 0) + count

    overloaded_grades = [(g, c) for g, c in grade_session_count.items() if c > 25]
    if overloaded_grades:
        diagnostics['gradeOverload'] = [{'grade': g, 'sessions': c} for g, c in overloaded_grades]
        for g, c in overloaded_grades:
            preflight_errors.append(f"Grade '{g}' has {c} sessions but max is 25 (5 days × 5 blocks)")

    # Check 3: Fixed slot conflicts (same teacher, same slot)
    teacher_fixed_slots = {}
    fixed_conflicts = []
    for cls in class_objs:
        if cls.fixed_slots:
            for day, block in cls.fixed_slots:
                if day in DAYS and block in BLOCKS:
                    day_idx = DAYS.index(day)
                    block_idx = BLOCKS.index(block)
                    slot = day_block_to_slot(day_idx, block_idx)
                    key = (cls.teacher, slot)
                    if key in teacher_fixed_slots:
                        existing = teacher_fixed_slots[key]
                        fixed_conflicts.append({
                            'teacher': cls.teacher,
                            'day': day,
                            'block': block,
                            'class1': {'subject': existing.subject, 'grades': existing.grades},
                            'class2': {'subject': cls.subject, 'grades': cls.grades},
                        })
                        preflight_errors.append(
                            f"Teacher '{cls.teacher}' has fixed slot conflict on {day} Block {block}: "
                            f"'{existing.subject}' and '{cls.subject}'"
                        )
                    teacher_fixed_slots[key] = cls

    if fixed_conflicts:
        diagnostics['fixedSlotConflicts'] = fixed_conflicts

    # If there are pre-flight errors, return immediately
    if preflight_errors:
        diagnostics['preflightErrors'] = preflight_errors
        return {
            'status': 'infeasible',
            'options': [],
            'message': f'Found {len(preflight_errors)} constraint issue(s) that make scheduling impossible.',
            'seeds_completed': 0,
            'infeasible_count': 0,
            'diagnostics': diagnostics,
        }

    candidates = []
    infeasible_count = 0
    seeds_completed = 0

    for attempt in range(num_attempts):
        # Check time limit
        elapsed = time.time() - start_time
        if elapsed > max_time_seconds - 5:  # Leave 5s buffer
            break

        if on_progress:
            on_progress(attempt + 1, num_attempts, f'Solving seed {attempt + 1}/{num_attempts}...')

        # Solve with this seed
        remaining_time = max_time_seconds - elapsed - 5
        attempt_time = min(time_per_attempt, remaining_time)

        # Get multiple solutions per seed for more variety
        # Collect diagnostics on first attempt to help diagnose infeasibility
        solutions = solve_with_cpsat(
            sessions,
            seed=attempt,
            time_limit=attempt_time,
            max_solutions=5,
            diagnostics=diagnostics if attempt == 0 else None
        )
        seeds_completed = attempt + 1

        if not solutions:
            infeasible_count += 1
            continue

        # Process each solution from this seed
        import copy
        for sol_idx, assignment in enumerate(solutions):
            # Build schedules
            teacher_schedules, grade_schedules = build_schedules(assignment, sessions, teacher_objs)

            # Deep copy for processing
            ts = copy.deepcopy(teacher_schedules)
            gs = copy.deepcopy(grade_schedules)

            # Add study halls
            sh_assignments = add_study_halls(ts, gs, eligible)
            sh_placed = sum(1 for sh in sh_assignments if sh.teacher is not None)

            # Fill open blocks
            fill_open_blocks(ts)

            # Redistribute open blocks to minimize back-to-back issues
            redistribute_open_blocks(ts, gs, full_time_names)

            # Calculate score (lower is better)
            total_btb = sum(count_back_to_back(ts, t) for t in full_time_names)
            score = (5 - sh_placed) * 100 + total_btb

            candidates.append({
                'seed': attempt,
                'score': score,
                'btb': total_btb,
                'sh_placed': sh_placed,
                'teacher_schedules': ts,
                'grade_schedules': gs,
                'sh_assignments': sh_assignments,
            })

    # Check if we got any solutions
    if not candidates:
        return {
            'status': 'infeasible',
            'options': [],
            'message': f'No feasible schedule found after {seeds_completed} attempts. Check constraints.',
            'seeds_completed': seeds_completed,
            'infeasible_count': infeasible_count,
            'diagnostics': diagnostics,
        }

    # Sort by score and deduplicate
    candidates.sort(key=lambda c: c['score'])

    seen_fingerprints = set()
    unique = []
    # Keep up to 30 unique solutions for alternative browsing
    max_solutions = 30
    for c in candidates:
        # Create fingerprint from assignments
        fp = str(sorted((t, d, b, str(c['teacher_schedules'][t][d][b]))
                       for t in c['teacher_schedules']
                       for d in DAYS
                       for b in BLOCKS))
        fp_hash = hash(fp)
        if fp_hash not in seen_fingerprints:
            seen_fingerprints.add(fp_hash)
            unique.append(c)
            if len(unique) >= max_solutions:
                break

    # Build primary options (top 3 for backward compatibility)
    options = []
    for i, c in enumerate(unique[:num_options]):
        stats = compute_teacher_stats(c['teacher_schedules'], teacher_objs)

        options.append({
            'optionNumber': i + 1,
            'seed': c['seed'],
            'backToBackIssues': c['btb'],
            'studyHallsPlaced': c['sh_placed'],
            'teacherSchedules': c['teacher_schedules'],
            'gradeSchedules': c['grade_schedules'],
            'studyHallAssignments': [
                {
                    'group': sh.group,
                    'teacher': sh.teacher,
                    'day': sh.day,
                    'block': sh.block,
                }
                for sh in c['sh_assignments']
            ],
            'teacherStats': [
                {
                    'teacher': s.teacher,
                    'status': s.status,
                    'teaching': s.teaching,
                    'studyHall': s.study_hall,
                    'open': s.open,
                    'totalUsed': s.total_used,
                    'backToBackIssues': s.back_to_back_issues,
                }
                for s in stats
            ],
        })

    # Build all solutions for alternative browsing
    all_solutions = []
    for i, c in enumerate(unique):
        all_solutions.append({
            'index': i,
            'score': c['score'],
            'backToBackIssues': c['btb'],
            'studyHallsPlaced': c['sh_placed'],
            'teacherSchedules': c['teacher_schedules'],
            'gradeSchedules': c['grade_schedules'],
            'studyHallAssignments': [
                {
                    'group': sh.group,
                    'teacher': sh.teacher,
                    'day': sh.day,
                    'block': sh.block,
                }
                for sh in c['sh_assignments']
            ],
        })

    elapsed = time.time() - start_time
    return {
        'status': 'success',
        'options': options,
        'allSolutions': all_solutions,
        'message': f'Found {len(unique)} unique solutions from {len(candidates)} valid ({seeds_completed} seeds in {elapsed:.1f}s)',
        'seeds_completed': seeds_completed,
        'infeasible_count': infeasible_count,
        'diagnostics': diagnostics,
    }
