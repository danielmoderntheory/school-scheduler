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

# NOTE: Grade lists are now passed from the database - no hardcoded grade constants


def is_rule_enabled(rules: list[dict], rule_key: str) -> bool:
    """Check if a scheduling rule is enabled.

    Returns True if:
    - rules is None or empty (default to enabled)
    - rule not found in list (default to enabled)
    - rule is found and enabled=True
    """
    if not rules:
        return True
    for rule in rules:
        if rule.get('rule_key') == rule_key:
            return rule.get('enabled', True)
    return True  # Default to enabled if rule not found


def get_rule_config(rules: list[dict], rule_key: str) -> dict:
    """Get the config for a scheduling rule.

    Returns empty dict if rules is None, rule not found, or no config.
    """
    if not rules:
        return {}
    for rule in rules:
        if rule.get('rule_key') == rule_key:
            return rule.get('config') or {}
    return {}


def get_study_hall_grades(rules: list[dict]) -> list[str]:
    """Get the list of grades that should have study halls assigned.

    Reads from study_hall_grades rule config. Returns empty if not configured.
    All study hall grades must be explicitly configured in the database.
    """
    if not is_rule_enabled(rules, 'study_hall_grades'):
        return []

    config = get_rule_config(rules, 'study_hall_grades')
    grades = config.get('grades', [])

    # Return configured grades (no hardcoded defaults)
    return list(grades) if grades else []


def get_study_hall_eligible_statuses(rules: list[dict]) -> set[str]:
    """Get the set of teacher statuses eligible for study hall supervision.

    Reads from study_hall_teacher_eligibility rule config.
    Returns set of statuses like {'full-time', 'part-time'}.
    Default is {'full-time'} only.
    """
    if not is_rule_enabled(rules, 'study_hall_teacher_eligibility'):
        return {'full-time'}  # Default to full-time only

    config = get_rule_config(rules, 'study_hall_teacher_eligibility')

    statuses = set()
    if config.get('allow_full_time', True):  # Default to True
        statuses.add('full-time')
    if config.get('allow_part_time', False):  # Default to False
        statuses.add('part-time')

    # If somehow both are unchecked, default to full-time
    if not statuses:
        statuses.add('full-time')

    return statuses


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


def number_to_grade(num: int) -> str:
    """Convert number to grade name: 0 -> 'Kindergarten', 6 -> '6th Grade'."""
    if num == 0:
        return 'Kindergarten'
    suffix = 'st' if num == 1 else 'nd' if num == 2 else 'rd' if num == 3 else 'th'
    return f'{num}{suffix} Grade'


def parse_grades(grade_field: str) -> list:
    """Parse grade display name to individual grades.
    Used internally by the solver for constraint checking.
    For matching against database grades, use parse_grades_from_database instead.
    """
    import re

    if 'elective' in grade_field.lower():
        return []

    trimmed = grade_field.strip()

    # Try to parse grade ranges like "6th-8th Grade" or "6th-11th"
    range_match = re.match(r'(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?', trimmed, re.IGNORECASE)
    if range_match:
        start = int(range_match.group(1))
        end = int(range_match.group(2))
        if start > 0 and end > 0 and start <= end:
            return [number_to_grade(i) for i in range(start, end + 1)]

    # Try Kindergarten
    if 'kindergarten' in trimmed.lower():
        return ['Kindergarten']

    # Try single grade parsing (e.g., "6th Grade", "6th")
    single_match = re.match(r'^(\d+)(?:st|nd|rd|th)', trimmed, re.IGNORECASE)
    if single_match:
        num = int(single_match.group(1))
        if num >= 1:
            return [number_to_grade(num)]

    # If no pattern matched, return the original as-is (it might be a valid grade name)
    return [trimmed] if trimmed else []


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


def get_study_hall_eligible(teachers: list[Teacher], classes: list[ClassEntry], rules: list[dict] = None) -> list[str]:
    """Get teachers eligible to supervise study hall.

    Eligibility:
    - Status must match allowed statuses from study_hall_teacher_eligibility rule
      (default: full-time only)
    - Not individually excluded (canSuperviseStudyHall=True means excluded)

    Note: The field is inverted - canSuperviseStudyHall=True means EXCLUDED from study hall
    (because the UI checkbox is "Exclude from Study Hall")
    """
    allowed_statuses = get_study_hall_eligible_statuses(rules)

    eligible = []
    for t in teachers:
        # Check if teacher's status is allowed by the rule config
        if t.status not in allowed_statuses:
            continue
        # canSuperviseStudyHall=True means EXCLUDED (checkbox is "Exclude from Study Hall")
        if t.can_supervise_study_hall is True:
            continue
        eligible.append(t.name)
    return eligible


def build_sessions(
    classes: list[ClassEntry],
    locked_grade_slots: dict[str, set[int]] = None,
    grades: list[str] = None,
    locked_grade_subject_days: dict[tuple[str, str], set[int]] = None
) -> list[Session]:
    """Convert classes to sessions (one per day of instruction).

    Args:
        classes: List of ClassEntry objects
        locked_grade_slots: Dict mapping grade to set of blocked slot numbers
        grades: List of grade names from database (for grade_blocked_slots initialization)
        locked_grade_subject_days: Dict mapping (grade, subject) to set of day indices where
            that subject is already taught by a locked teacher (to prevent duplicate subjects per day)

    Sessions are sorted by constraint level (most constrained first):
    1. Fixed slots first (only 1 valid slot)
    2. Teacher load factor (busier teachers = higher priority)
    3. Fewer valid slots = more constrained = higher priority

    This "Most Constrained Variable" (MRV) heuristic helps the solver
    by handling the hardest assignments first, failing fast if infeasible.

    Teacher load matters because a teacher with 20 sessions has less
    flexibility than one with 5, even if individual sessions have
    the same number of valid slots.

    Args:
        classes: List of ClassEntry objects to schedule
        locked_grade_slots: Optional dict mapping grade -> set of slots blocked by locked teachers
        locked_grade_subject_days: Optional dict mapping (grade, subject) -> set of day indices
            where that subject is already taught by locked teachers
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
    all_grades = grades if grades else []
    grade_blocked_slots: dict[str, set[int]] = {g: set() for g in all_grades}
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

            # For regular (non-elective) classes, remove slots blocked by:
            # 1. Electives with fixed slots
            # 2. Locked teachers (for partial regeneration)
            # 3. Days where locked teachers already teach same subject to same grade
            if not cls.is_elective and cls.grades:
                blocked = set()
                for grade in cls.grades:
                    blocked.update(grade_blocked_slots.get(grade, set()))
                    # Also block slots from locked teachers
                    if locked_grade_slots:
                        blocked.update(locked_grade_slots.get(grade, set()))
                if blocked:
                    valid_slots = [s for s in valid_slots if s not in blocked]

                # Block entire days where locked teachers already teach this subject to this grade
                # This prevents "same subject twice per day per grade" conflicts with locked schedules
                if locked_grade_subject_days:
                    blocked_days = set()
                    for grade in cls.grades:
                        key = (grade, cls.subject)
                        if key in locked_grade_subject_days:
                            blocked_days.update(locked_grade_subject_days[key])
                    if blocked_days:
                        # Filter out slots on blocked days (day = slot // 5)
                        valid_slots = [s for s in valid_slots if (s // 5) not in blocked_days]

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


def solve_with_cpsat(sessions: list[Session], seed: int = 0, time_limit: float = 10.0, max_solutions: int = 5, diagnostics: dict = None, rules: list[dict] = None, active_grades: list[str] = None) -> list[dict]:
    """
    Solve the scheduling problem using CP-SAT.

    Returns list of dicts mapping session_id -> slot, or empty list if infeasible.

    If diagnostics dict is provided, it will be populated with diagnostic info
    that can be shown to end users to help understand infeasibility.

    If rules is provided, certain constraints can be toggled on/off based on rule settings.

    active_grades is required - list of all grade names from the database.
    """
    import random
    rng = random.Random(seed)

    # active_grades is required - no fallback
    if not active_grades:
        active_grades = []

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
    for grade in active_grades:
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
    # This constraint can be toggled via the 'no_duplicate_subjects' rule
    if is_rule_enabled(rules, 'no_duplicate_subjects'):
        for grade in active_grades:
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


def build_schedules(assignment: dict, sessions: list[Session], teachers: list[Teacher], grades: list[str] = None):
    """Build teacher and grade schedule dictionaries from assignment.

    Args:
        assignment: Dict mapping session ID to slot
        sessions: List of sessions being scheduled
        teachers: List of all teachers
        grades: Optional list of all grades (from database). If provided, all grades will be initialized.
    """
    teacher_schedules = {}
    grade_schedules = {}

    # Initialize empty schedules
    all_teachers = list(set(s.teacher for s in sessions))
    for t in all_teachers:
        teacher_schedules[t] = {day: {b: None for b in BLOCKS} for day in DAYS}

    # Use provided grades if available, otherwise collect from sessions
    if grades:
        all_grades = set(grades)
    else:
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


def parse_grades_from_database(grade_display: str, database_grades: set) -> list[str]:
    """Parse grade display name to individual grades using DATABASE grades (no hardcoding).

    Args:
        grade_display: The display name from a schedule entry (e.g., "6th Grade" or "6th-7th Grade")
        database_grades: Set of grade names from the database

    Returns:
        List of matching grade names from the database
    """
    import re

    # Note: We no longer skip electives - they DO map to specific grades
    # (e.g., "6th-11th Elective" should map to grades 6-11)

    trimmed = grade_display.strip()

    # 1. Direct match - most common case
    if trimmed in database_grades:
        return [trimmed]

    # 2. Try to parse as a grade range (e.g., "6th-7th Grade", "6th-11th")
    range_match = re.match(r'(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?', trimmed, re.IGNORECASE)
    if range_match:
        start = int(range_match.group(1))
        end = int(range_match.group(2))
        if start > 0 and end > 0 and start <= end:
            matched_grades = []
            # Find database grades that match numbers in this range
            for db_grade in database_grades:
                grade_num = grade_to_number(db_grade)
                if grade_num >= start and grade_num <= end:
                    matched_grades.append(db_grade)
            if matched_grades:
                return matched_grades

    # 3. Try single grade number parsing and find matching database grade
    single_match = re.search(r'(\d+)(?:st|nd|rd|th)', trimmed, re.IGNORECASE)
    if single_match:
        num = int(single_match.group(1))
        # Find database grade with this number
        for db_grade in database_grades:
            if grade_to_number(db_grade) == num:
                return [db_grade]

    # 4. Handle Kindergarten variations
    if 'kindergarten' in trimmed.lower():
        for db_grade in database_grades:
            if 'kindergarten' in db_grade.lower():
                return [db_grade]

    # No match found
    return []


def grade_to_number(grade: str) -> int:
    """Parse grade number from string like '6th Grade' -> 6, 'Kindergarten' -> 0."""
    import re
    if 'kindergarten' in grade.lower():
        return 0
    match = re.search(r'(\d+)', grade)
    return int(match.group(1)) if match else -1


def rebuild_grade_schedules(teacher_schedules: dict, grades: list[str]) -> dict:
    """Rebuild grade schedules entirely from teacher schedules.

    This is a destructive rebuild that ensures grade schedules always match
    teacher schedules, avoiding any merge/sync issues.

    IMPORTANT: Uses database grades dynamically - NO hardcoded grade lists.

    Args:
        teacher_schedules: Dict mapping teacher names to their schedules
        grades: List of all grade names (from database)

    Returns:
        New grade_schedules dict built from teacher_schedules
    """
    grade_schedules = {}
    database_grades = set(grades)

    # Initialize empty schedules for all database grades
    for g in grades:
        grade_schedules[g] = {day: {b: None for b in BLOCKS} for day in DAYS}

    # Track entries that failed to parse (for debugging)
    unparsed_entries = []

    # Populate from teacher schedules
    for teacher, schedule in teacher_schedules.items():
        for day in DAYS:
            for block in BLOCKS:
                entry = schedule.get(day, {}).get(block)
                if entry and len(entry) > 1 and entry[1] != 'OPEN':
                    grade_display = entry[0]
                    subject = entry[1]

                    # Skip Study Hall - it's tracked separately
                    if subject == 'Study Hall':
                        continue

                    # Parse grades using DATABASE grades (no hardcoding)
                    parsed_grades = parse_grades_from_database(grade_display, database_grades)

                    if not parsed_grades:
                        # Log entries that couldn't be parsed
                        unparsed_entries.append({
                            'teacher': teacher,
                            'day': day,
                            'block': block,
                            'grade_display': grade_display,
                            'subject': subject,
                        })

                    for g in parsed_grades:
                        # Initialize grade if somehow not in the list (safety)
                        if g not in grade_schedules:
                            grade_schedules[g] = {d: {b: None for b in BLOCKS} for d in DAYS}
                        grade_schedules[g][day][block] = [teacher, subject]

    # Log warning if entries couldn't be parsed
    if unparsed_entries:
        print(f"[rebuild_grade_schedules] WARNING: {len(unparsed_entries)} entries could not be parsed to grades:")
        for e in unparsed_entries[:10]:  # Limit to first 10
            print(f"  - {e['teacher']} on {e['day']} B{e['block']}: '{e['grade_display']}' / '{e['subject']}'")
        if len(unparsed_entries) > 10:
            print(f"  ... and {len(unparsed_entries) - 10} more")

    return grade_schedules


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
                    eligible_teachers: list[str],
                    preserve_existing: bool = True,
                    rules: list[dict] = None,
                    grades: list[str] = None) -> list[StudyHallAssignment]:
    """Assign study halls to eligible teachers with open blocks.

    Strategy:
    1. Try to place each grade (configured in study_hall_grades rule) individually first
    2. If placement fails, mark as unplaced (no auto-combining)

    Args:
        preserve_existing: If True, keep existing study halls and only fill gaps.
                          If False, reassign all study halls from scratch.
        rules: Scheduling rules to read config from (study_hall_grades).

    Prioritizes teachers with MORE open blocks (not even distribution).
    """
    # Get configured study hall grades from rules
    study_hall_grades = get_study_hall_grades(rules)

    # If no grades configured (or rule disabled), skip study hall assignment
    if not study_hall_grades:
        return []

    assignments = []

    if not eligible_teachers:
        return [StudyHallAssignment(group=g) for g in study_hall_grades]

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
        return [StudyHallAssignment(group=g) for g in study_hall_grades]

    # Track which days each grade already has a study hall
    all_grades = grades if grades else []
    grade_study_hall_days: dict[str, set[str]] = {g: set() for g in all_grades}
    # Track which grades have been placed
    placed_grades: set[str] = set()

    # Pre-populate with existing study halls from grade_schedules (for partial regen)
    # Only if preserve_existing is True - otherwise we reassign all study halls
    if preserve_existing:
        for grade in all_grades:
            if grade not in grade_schedules:
                continue
            for day in DAYS:
                for block in BLOCKS:
                    entry = grade_schedules.get(grade, {}).get(day, {}).get(block)
                    if entry and len(entry) > 1 and entry[1] == 'Study Hall':
                        grade_study_hall_days[grade].add(day)
                        placed_grades.add(grade)
                        # Also record as an assignment (for return value)
                        assignments.append(StudyHallAssignment(
                            group=grade,
                            teacher=entry[0],  # teacher name is in entry[0]
                            day=day,
                            block=block
                        ))

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

    # Try to place each grade individually
    failed_grades = []
    for grade in study_hall_grades:
        # Skip grades that already have study halls (from locked teachers)
        if grade in placed_grades:
            continue
        if try_place_study_hall(grade, [grade]):
            placed_grades.add(grade)
        else:
            failed_grades.append(grade)

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


def count_same_day_open(teacher_schedules: dict, teacher: str) -> int:
    """Count days with multiple OPEN blocks for a teacher (spread_open metric).

    Returns the number of "extra" OPEN blocks per day beyond the first.
    E.g., if a teacher has 3 OPEN blocks on Monday, that's 2 issues (3-1=2).

    Both OPEN and Study Hall count as "open" for this calculation.
    """
    count = 0
    schedule = teacher_schedules.get(teacher, {})

    for day in DAYS:
        open_count = 0
        for block in BLOCKS:
            cell = schedule.get(day, {}).get(block)
            if cell and len(cell) > 1 and cell[1] in ('OPEN', 'Study Hall'):
                open_count += 1
        # Penalize having more than 1 OPEN block per day
        if open_count > 1:
            count += open_count - 1

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
    rules: list[dict] = None,  # Scheduling rules from database
    num_options: int = 3,
    num_attempts: int = 150,
    max_time_seconds: float = 280.0,
    on_progress=None,
    locked_teachers: dict = None,  # Dict of teacher_name -> schedule (for partial regen)
    teachers_needing_study_halls: list = None,  # List of teacher names that need study halls
    start_seed: int = 0,  # Starting seed offset for variety on re-runs
    skip_top_solutions: int = 0,  # Skip the top N solutions and return next best (for variety)
    randomize_scoring: bool = False,  # Add noise to scoring to pick suboptimal but valid solutions
    allow_study_hall_reassignment: bool = False,  # If True, reassign all study halls; if False, preserve locked teacher study halls
    grades: list[str] = None  # All grade names from database - used for grade schedule initialization
) -> dict:
    """
    Main entry point for schedule generation.

    Args:
        teachers: List of teacher dicts with name, status, can_supervise_study_hall
        classes: List of class dicts with teacher, grade, subject, days_per_week, etc.
        rules: List of scheduling rules from database (controls which constraints are enforced)
        num_options: Number of schedule options to return
        num_attempts: Number of seeds to try
        max_time_seconds: Maximum total time for all attempts
        on_progress: Optional callback(current, total, message)
        locked_teachers: Dict mapping teacher names to their fixed schedules (for partial regen)
        teachers_needing_study_halls: List of teacher names that need study halls assigned

    Returns:
        Dict with status, options, message, seeds_completed
    """
    start_time = time.time()
    time_per_attempt = min(10.0, max_time_seconds / num_attempts)

    # Validate required inputs
    if not teachers or len(teachers) == 0:
        return {
            'status': 'error',
            'options': [],
            'message': 'No teachers provided. At least one teacher is required.',
            'seeds_completed': 0,
            'infeasible_count': 0,
        }

    if not classes or len(classes) == 0:
        return {
            'status': 'error',
            'options': [],
            'message': 'No classes provided. At least one class is required.',
            'seeds_completed': 0,
            'infeasible_count': 0,
        }

    if not rules or len(rules) == 0:
        return {
            'status': 'error',
            'options': [],
            'message': 'No rules provided. Scheduling rules must be configured in the database.',
            'seeds_completed': 0,
            'infeasible_count': 0,
        }

    # Use grades from database (required - no fallback)
    active_grades = grades if grades and len(grades) > 0 else []

    if not active_grades:
        return {
            'status': 'error',
            'options': [],
            'message': 'No grades provided. Grades must be configured in the database.',
            'seeds_completed': 0,
            'infeasible_count': 0,
        }

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
        # Sort by grade order (use active_grades from database) and create range display
        grade_order = {g: i for i, g in enumerate(active_grades)}
        sorted_grades = sorted(grades_list, key=lambda g: grade_order.get(g, 99))
        first = sorted_grades[0].replace(' Grade', '')
        last = sorted_grades[-1].replace(' Grade', '')
        return f"{first}-{last} Grade"

    # Create a set for fast lookups
    active_grades_set = set(active_grades)

    def normalize_grades(grades_input) -> list:
        """Normalize grade input to list of grade names from database."""
        if isinstance(grades_input, list):
            # Already a list - use parse_grades_from_database for each
            result = []
            for g in grades_input:
                parsed = parse_grades_from_database(g, active_grades_set)
                result.extend(parsed)
            return list(set(result))  # Remove duplicates
        elif isinstance(grades_input, str):
            # Single grade string
            return parse_grades_from_database(grades_input, active_grades_set)
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

    # Handle locked teachers for partial regeneration
    locked_teacher_names = set(locked_teachers.keys()) if locked_teachers else set()
    is_partial_regen = len(locked_teacher_names) > 0

    # Filter out classes from locked teachers
    if is_partial_regen:
        classes_to_schedule = [c for c in class_objs if c.teacher not in locked_teacher_names]
    else:
        classes_to_schedule = class_objs

    # Pre-compute grade slots blocked by locked teachers
    locked_grade_slots: dict[str, set[int]] = {g: set() for g in active_grades}
    # Also track which subjects are taught on each day for each grade (to prevent duplicate subjects per day)
    locked_grade_subject_days: dict[tuple[str, str], set[int]] = {}
    if locked_teachers:
        for teacher_name, schedule in locked_teachers.items():
            for day, blocks in schedule.items():
                if day not in DAYS:
                    continue
                day_idx = DAYS.index(day)
                for block_str, entry in blocks.items():
                    if entry is None:
                        continue
                    block_num = int(block_str)
                    if block_num not in BLOCKS:
                        continue
                    block_idx = BLOCKS.index(block_num)
                    slot = day_block_to_slot(day_idx, block_idx)
                    # entry is [grade, subject] - block this slot for this grade
                    grade, subject = entry[0], entry[1]
                    if subject != "OPEN" and subject != "Study Hall":
                        # Parse grades (handle multi-grade like "6th-7th Grade")
                        parsed_grades = parse_grades_from_database(grade, active_grades_set)
                        for g in parsed_grades:
                            if g in locked_grade_slots:
                                locked_grade_slots[g].add(slot)
                            # Track subject+day combinations to prevent duplicate subjects per day per grade
                            key = (g, subject)
                            if key not in locked_grade_subject_days:
                                locked_grade_subject_days[key] = set()
                            locked_grade_subject_days[key].add(day_idx)

    eligible = get_study_hall_eligible(teacher_objs, classes_to_schedule, rules)

    # For partial regen, only allow study halls on non-locked teachers
    # Locked teachers already have their study halls preserved in their schedules
    if is_partial_regen and locked_teachers:
        locked_teacher_names = set(locked_teachers.keys())
        eligible = [t for t in eligible if t not in locked_teacher_names]

    # Override study hall eligible teachers if specific ones are requested
    if teachers_needing_study_halls:
        # Include both base eligible and explicitly requested teachers (but still exclude locked)
        additional = [t for t in teachers_needing_study_halls if t not in (locked_teachers or {}).keys()]
        eligible = list(set(eligible + additional))

    sessions = build_sessions(
        classes_to_schedule,
        locked_grade_slots if is_partial_regen else None,
        active_grades,
        locked_grade_subject_days if is_partial_regen else None
    )

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

        actual_seed = start_seed + attempt
        if on_progress:
            on_progress(attempt + 1, num_attempts, f'Solving seed {actual_seed} ({attempt + 1}/{num_attempts})...')

        # Solve with this seed
        remaining_time = max_time_seconds - elapsed - 5
        attempt_time = min(time_per_attempt, remaining_time)

        # Get multiple solutions per seed for more variety
        # Collect diagnostics on first attempt to help diagnose infeasibility
        solutions = solve_with_cpsat(
            sessions,
            seed=actual_seed,
            time_limit=attempt_time,
            max_solutions=5,
            diagnostics=diagnostics if attempt == 0 else None,
            rules=rules,
            active_grades=active_grades
        )
        seeds_completed = attempt + 1

        if not solutions:
            infeasible_count += 1
            continue

        # Process each solution from this seed
        import copy
        for sol_idx, assignment in enumerate(solutions):
            # Build schedules (pass active_grades to ensure all grades are initialized for merge)
            teacher_schedules, grade_schedules = build_schedules(assignment, sessions, teacher_objs, active_grades)

            # Merge locked teacher schedules (for partial regeneration)
            if locked_teachers:
                for teacher_name, schedule in locked_teachers.items():
                    teacher_schedules[teacher_name] = {}
                    for day in DAYS:
                        teacher_schedules[teacher_name][day] = {}
                        for block in BLOCKS:
                            entry = schedule.get(day, {}).get(str(block))
                            teacher_schedules[teacher_name][day][block] = entry
                            # Also update grade schedules (skip OPEN but include Study Hall)
                            if entry and entry[1] != "OPEN":
                                grade, subject = entry[0], entry[1]
                                # Handle multi-grade entries (use active_grades from database)
                                parsed_grades = parse_grades_from_database(grade, active_grades_set)
                                for g in parsed_grades:
                                    # Initialize grade if it doesn't exist (needed for study halls on grades
                                    # that regenerated teachers don't teach)
                                    if g not in grade_schedules:
                                        grade_schedules[g] = {d: {b: None for b in BLOCKS} for d in DAYS}
                                    if day not in grade_schedules[g]:
                                        grade_schedules[g][day] = {}
                                    grade_schedules[g][day][block] = [teacher_name, subject]

            # Deep copy for processing
            ts = copy.deepcopy(teacher_schedules)
            gs = copy.deepcopy(grade_schedules)

            # Add study halls (only if study_hall_distribution rule is enabled)
            # preserve_existing=True means keep locked teacher study halls
            # allow_study_hall_reassignment=True means reassign all (preserve_existing=False)
            if is_rule_enabled(rules, 'study_hall_distribution'):
                sh_assignments = add_study_halls(ts, gs, eligible, preserve_existing=not allow_study_hall_reassignment, rules=rules, grades=active_grades)
                sh_placed = sum(1 for sh in sh_assignments if sh.teacher is not None)
            else:
                sh_assignments = []
                sh_placed = 0

            # Fill open blocks
            fill_open_blocks(ts)

            # Redistribute open blocks to minimize back-to-back issues
            # Only run if the no_btb_open rule is enabled
            # IMPORTANT: Only redistribute for non-locked teachers to preserve locked schedules
            if is_rule_enabled(rules, 'no_btb_open'):
                unlocked_full_time = [t for t in full_time_names if t not in locked_teacher_names]
                redistribute_open_blocks(ts, gs, unlocked_full_time)

            # CRITICAL: Rebuild grade schedules from teacher schedules to ensure consistency.
            # This is a destructive rebuild that ensures grade_schedules always match teacher_schedules,
            # avoiding any sync issues from the merge logic above.
            gs = rebuild_grade_schedules(ts, active_grades)

            # Calculate score (lower is better)
            # Only count back-to-back issues if the rule is enabled
            if is_rule_enabled(rules, 'no_btb_open'):
                total_btb = sum(count_back_to_back(ts, t) for t in full_time_names)
            else:
                total_btb = 0  # Don't penalize for BTB if rule is disabled

            # Count spread_open issues (multiple OPEN on same day) if rule is enabled
            if is_rule_enabled(rules, 'spread_open'):
                total_spread = sum(count_same_day_open(ts, t) for t in full_time_names)
            else:
                total_spread = 0

            # Score: missing study halls (heavily penalized) + BTB issues + spread issues
            score = (5 - sh_placed) * 100 + total_btb + total_spread

            candidates.append({
                'seed': actual_seed,
                'score': score,
                'btb': total_btb,
                'spread': total_spread,
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
    # When randomize_scoring is True, add noise to encourage picking suboptimal but valid solutions
    if randomize_scoring:
        import random
        scoring_rng = random.Random(start_seed)
        # Add noise of up to +/- 10 to the score (enough to shuffle rankings but not pick terrible solutions)
        candidates.sort(key=lambda c: c['score'] + scoring_rng.uniform(-10, 10))
    else:
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
    # When skip_top_solutions is set, skip those and return next best solutions for variety
    options = []
    solutions_to_use = unique[skip_top_solutions:skip_top_solutions + num_options] if skip_top_solutions > 0 else unique[:num_options]
    for i, c in enumerate(solutions_to_use):
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
