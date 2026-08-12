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

# Block format is per-request (per-quarter timetable template). BLOCKS/NUM_SLOTS
# are module-level state configured via set_blocks() at the top of every
# generate_schedules() call. This is safe because the Cloud Run service runs
# with --concurrency 1 (one request at a time per instance); if concurrency is
# ever raised, this must be refactored into explicit parameter threading.
DEFAULT_BLOCKS = [1, 2, 3, 4, 5]
BLOCKS = list(DEFAULT_BLOCKS)
NUM_SLOTS = len(DAYS) * len(BLOCKS)


def set_blocks(blocks: Optional[list] = None) -> None:
    """Configure the block list for the current solve request.

    Args:
        blocks: List of block numbers (e.g. [1..9] for the 9-block format).
                None/empty resets to the legacy 5-block format.
    """
    global BLOCKS, NUM_SLOTS
    BLOCKS = list(blocks) if blocks else list(DEFAULT_BLOCKS)
    NUM_SLOTS = len(DAYS) * len(BLOCKS)

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
    available_days: Optional[list] = None   # None = all days available
    available_blocks: Optional[list] = None  # None = all blocks available


@dataclass
class ClassEntry:
    teacher: str
    grades: list  # List of grade names (e.g., ['6th Grade', '7th Grade'])
    subject: str
    days_per_week: int  # Lessons (blocks) per week - may exceed 5 for double-period subjects
    grade_display: str = ''  # Display name for schedules (e.g., '6th-7th Grade')
    is_elective: bool = False  # Electives skip grade conflicts
    is_cotaught: bool = False  # Co-taught classes must be scheduled together
    is_double: bool = False  # Subject REQUIRES double periods (every meeting is two consecutive blocks)
    # [(earlierBlock, laterBlock), ...] legal double pairs (intersection of every
    # covered grade's pairs). Computed for EVERY class when grade_block_pairs is
    # provided: flagged classes MUST use them; unflagged classes MAY use them, but
    # only when the week cannot fit otherwise (same-day pairs are capped at
    # max(0, lessons - usable_days) - see the pairing-budget constraint).
    allowed_pairs: list = field(default_factory=list)
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
    is_cotaught: bool = False  # Co-taught classes must be scheduled together
    # Double-period metadata:
    class_key: int = -1  # Index of the originating class (groups a class's meetings)
    is_double_class: bool = False  # Session belongs to a class REQUIRING double periods
    pair_id: Optional[int] = None  # Shared by the two halves of one double meeting
    pair_pos: int = 0  # 0 = first half (or single/meeting representative), 1 = second half
    pair_slots: Optional[list] = None  # (first_slot, second_slot) tuples; stored on first half
    # Optional doubles (default mode): the class's legal (earlierBlock, laterBlock)
    # pairs. Set on every session of an UNFLAGGED class that has >=1 legal pair;
    # lets two same-class sessions share a day iff their blocks form a legal pair.
    allowed_block_pairs: Optional[list] = None


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
    return slot // len(BLOCKS)


def slot_to_block(slot: int) -> int:
    return slot % len(BLOCKS)


def day_block_to_slot(day_idx: int, block_idx: int) -> int:
    return day_idx * len(BLOCKS) + block_idx


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
    Handles: single grades, ranges, comma-separated lists, and Kindergarten.

    Note: Electives ARE parsed - they have real grades. The solver handles
    elective-to-elective slot sharing separately via the is_elective flag.
    """
    import re

    trimmed = grade_field.strip()
    grades = []

    # Handle Kindergarten (can appear alone or in comma-separated list)
    if 'kindergarten' in trimmed.lower():
        grades.append('Kindergarten')
        # If ONLY kindergarten, return early
        if ',' not in trimmed and not re.search(r'\d', trimmed):
            return grades

    # Handle comma-separated list like "6th Grade, 7th Grade" or "10th, 11th"
    if ',' in trimmed:
        parts = [p.strip() for p in trimmed.split(',')]
        for part in parts:
            # Skip if already handled kindergarten
            if 'kindergarten' in part.lower():
                continue
            num_match = re.search(r'(\d+)', part)
            if num_match:
                n = int(num_match.group(1))
                grade_name = number_to_grade(n)
                if grade_name not in grades:
                    grades.append(grade_name)
        return grades

    # Try to parse grade ranges like "6th-8th Grade" or "6th-11th"
    range_match = re.match(r'(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?', trimmed, re.IGNORECASE)
    if range_match:
        start = int(range_match.group(1))
        end = int(range_match.group(2))
        if start > 0 and end > 0 and start <= end:
            for i in range(start, end + 1):
                grade_name = number_to_grade(i)
                if grade_name not in grades:
                    grades.append(grade_name)
            return grades

    # Try single grade parsing (e.g., "6th Grade", "6th")
    single_match = re.match(r'^(\d+)(?:st|nd|rd|th)', trimmed, re.IGNORECASE)
    if single_match:
        num = int(single_match.group(1))
        if num >= 1:
            grade_name = number_to_grade(num)
            if grade_name not in grades:
                grades.append(grade_name)

    # If no pattern matched and no grades found, return the original as-is
    if not grades and trimmed:
        return [trimmed]

    return grades


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
    return slots if slots else list(range(len(DAYS) * len(BLOCKS)))


def get_study_hall_eligible(teachers: list[Teacher], classes: list[ClassEntry], rules: list[dict] = None) -> list[str]:
    """Get teachers eligible to supervise study hall.

    Eligibility:
    - Status must match allowed statuses from study_hall_teacher_eligibility rule
      (default: full-time only)
    - Not individually excluded: can_supervise_study_hall=False means EXCLUDED.
      The Teachers page stores the "Exclude from Study Hall" checkbox as
      can_supervise = NOT checked, so False = excluded and None/True = eligible
      (matches the JS solver's `canSuperviseStudyHall !== false`).
    """
    allowed_statuses = get_study_hall_eligible_statuses(rules)

    eligible = []
    for t in teachers:
        # Check if teacher's status is allowed by the rule config
        if t.status not in allowed_statuses:
            continue
        # False = explicitly excluded; None/True = eligible
        if t.can_supervise_study_hall is False:
            continue
        eligible.append(t.name)
    return eligible


def compute_teacher_lunch_candidates(
    sessions: list[Session],
    grade_teachable_blocks: dict,
) -> dict[str, set[int]]:
    """Compute each teacher's candidate lunch windows (block numbers).

    A teacher's candidate lunch windows are the union, over all grades covered
    by their sessions, of (BLOCKS minus that grade's teachable blocks) - i.e.
    the blocks during which at least one band of their students is at lunch.
    On every day at least one of these windows must stay free of the teacher's
    obligations so they get a lunch break.

    Grades absent from grade_teachable_blocks are teachable in every block and
    contribute no windows. Teachers whose candidate set comes out empty (e.g.
    legacy 5-block requests, or teachers of only unmasked grades) are omitted.
    """
    if not grade_teachable_blocks:
        return {}
    blocks_set = set(BLOCKS)
    candidates: dict[str, set[int]] = {}
    for s in sessions:
        cset = candidates.setdefault(s.teacher, set())
        for g in s.grades:
            mask = grade_teachable_blocks.get(g)
            if mask is not None:
                cset |= blocks_set - set(mask)
    return {t: c for t, c in candidates.items() if c}


def build_sessions(
    classes: list[ClassEntry],
    locked_grade_slots: dict[str, set[int]] = None,
    grades: list[str] = None,
    locked_grade_subject_days: dict[tuple[str, str], set[int]] = None,
    teachers: list[Teacher] = None,
    grade_teachable_slots: dict[str, set[int]] = None
) -> list[Session]:
    """Convert classes to sessions (one per day of instruction).

    Args:
        classes: List of ClassEntry objects
        locked_grade_slots: Dict mapping grade to set of blocked slot numbers
        grades: List of grade names from database (for grade_blocked_slots initialization)
        locked_grade_subject_days: Dict mapping (grade, subject) to set of day indices where
            that subject is already taught by a locked teacher (to prevent duplicate subjects per day)
        teachers: List of Teacher objects (used to intersect teacher availability into valid slots)
        grade_teachable_slots: Dict mapping grade name to the set of slot indices that grade
            can be taught in (e.g. lunch blocks excluded). Grades absent from the dict can be
            taught in any slot. A session covering multiple grades is restricted to the
            intersection of all covered grades' teachable slots.

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

    # Build teacher availability lookup: teacher_name -> set of valid slot indices
    # This ensures teacher-level availability is intersected with class-level restrictions
    teacher_valid_slots: dict[str, set[int]] = {}
    if teachers:
        for t in teachers:
            if t.available_days or t.available_blocks:
                days = t.available_days or DAYS
                blocks = t.available_blocks or BLOCKS
                teacher_valid_slots[t.name] = set(get_valid_slots(days, blocks))

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
        total_slots = teacher_total_slots.get(teacher, NUM_SLOTS * total_sessions)
        # Average valid slots per session for this teacher
        teacher_avg_slots[teacher] = total_slots / total_sessions if total_sessions > 0 else NUM_SLOTS

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
    next_pair_id = 0
    for class_key, cls in enumerate(classes):
        # Optional-double metadata: unflagged classes with >=1 legal pair may
        # (but never must) hold a day's two lessons as a legal consecutive pair.
        # Flagged (required) classes use the pair_id/pair_slots machinery instead.
        opt_pairs = list(cls.allowed_pairs) if (cls.allowed_pairs and not cls.is_double) else None
        if cls.fixed_slots:
            class_fixed_sessions = []
            for day, block in cls.fixed_slots:
                if day in DAYS and block in BLOCKS:
                    day_idx = DAYS.index(day)
                    block_idx = BLOCKS.index(block)
                    slot = day_block_to_slot(day_idx, block_idx)
                    s = Session(
                        id=session_id,
                        teacher=cls.teacher,
                        grades=cls.grades,
                        grade_display=cls.grade_display,
                        subject=cls.subject,
                        valid_slots=[slot],
                        is_fixed=True,
                        is_elective=cls.is_elective,
                        is_cotaught=cls.is_cotaught,
                        class_key=class_key,
                        is_double_class=cls.is_double,
                        allowed_block_pairs=opt_pairs,
                    )
                    sessions.append(s)
                    class_fixed_sessions.append(s)
                    session_id += 1
            # For double-period classes, link same-day fixed slots as pinned pairs
            # so the duplicate-subject constraint exempts them (preflight validates
            # the grouping - here we just tag whatever pairs exist).
            if cls.is_double:
                fixed_by_day: dict[int, list[Session]] = {}
                for s in class_fixed_sessions:
                    fixed_by_day.setdefault(slot_to_day(s.valid_slots[0]), []).append(s)
                for day_group in fixed_by_day.values():
                    if len(day_group) == 2:
                        first, second = sorted(day_group, key=lambda s: s.valid_slots[0])
                        first.pair_id = next_pair_id
                        first.pair_pos = 0
                        second.pair_id = next_pair_id
                        second.pair_pos = 1
                        next_pair_id += 1
        else:
            valid_slots = get_valid_slots(cls.available_days, cls.available_blocks)

            # Intersect with teacher-level availability (defense-in-depth:
            # frontend also pre-intersects, but solver should be self-contained)
            if cls.teacher in teacher_valid_slots:
                teacher_slots = teacher_valid_slots[cls.teacher]
                valid_slots = [s for s in valid_slots if s in teacher_slots]

            # Restrict to the teachable slots of every grade this class covers
            # (e.g. exclude each covered band's lunch block). Applies to electives
            # too - students still aren't available during their lunch block.
            if grade_teachable_slots and cls.grades:
                for grade in cls.grades:
                    mask = grade_teachable_slots.get(grade)
                    if mask is not None:
                        valid_slots = [s for s in valid_slots if s in mask]

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
                        # Filter out slots on blocked days (day = slot // num_blocks)
                        valid_slots = [s for s in valid_slots if slot_to_day(s) not in blocked_days]

            def make_session(v_slots, pair_id=None, pair_pos=0, pair_slots=None):
                return Session(
                    id=0,  # reassigned below
                    teacher=cls.teacher,
                    grades=cls.grades,
                    grade_display=cls.grade_display,
                    subject=cls.subject,
                    valid_slots=v_slots,
                    is_fixed=False,
                    is_elective=cls.is_elective,
                    is_cotaught=cls.is_cotaught,
                    class_key=class_key,
                    is_double_class=cls.is_double,
                    pair_id=pair_id,
                    pair_pos=pair_pos,
                    pair_slots=pair_slots,
                    allowed_block_pairs=opt_pairs,
                )

            if cls.is_double:
                # Double-period class: floor(L/2) double meetings (two blocks from a
                # legal pair, same day) + (L mod 2) single meetings, distinct days.
                lessons = cls.days_per_week
                num_doubles = lessons // 2
                num_singles = lessons % 2

                # All legal (first_slot, second_slot) tuples: each allowed block
                # pair replicated across days, both halves within valid slots.
                valid_set = set(valid_slots)
                pair_tuples = []
                for d in range(len(DAYS)):
                    for b1, b2 in cls.allowed_pairs:
                        if b1 not in BLOCKS or b2 not in BLOCKS:
                            continue
                        s1 = day_block_to_slot(d, BLOCKS.index(b1))
                        s2 = day_block_to_slot(d, BLOCKS.index(b2))
                        if s1 in valid_set and s2 in valid_set:
                            pair_tuples.append((s1, s2))
                first_slots = sorted({t[0] for t in pair_tuples})
                second_slots = sorted({t[1] for t in pair_tuples})

                for _ in range(num_doubles):
                    sessions.append(make_session(list(first_slots),
                                                 pair_id=next_pair_id, pair_pos=0,
                                                 pair_slots=list(pair_tuples)))
                    session_id += 1
                    sessions.append(make_session(list(second_slots),
                                                 pair_id=next_pair_id, pair_pos=1))
                    session_id += 1
                    next_pair_id += 1
                for _ in range(num_singles):
                    sessions.append(make_session(list(valid_slots)))
                    session_id += 1
            else:
                for _ in range(cls.days_per_week):
                    sessions.append(make_session(valid_slots))
                    session_id += 1

    # Sort by constraint level:
    # 1. Fixed slots first (is_fixed=True → 0, else 1)
    # 2. Teacher constraint score: sessions / avg_slots (higher = more constrained, so negate)
    # 3. Fewer valid slots for this specific session
    def sort_key(s: Session) -> tuple:
        teacher_load = teacher_session_count.get(s.teacher, 0)
        teacher_flexibility = teacher_avg_slots.get(s.teacher, NUM_SLOTS)
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


# ============================================================================
# Unlock Suggestions - Help diagnose which locked teachers block feasibility
# ============================================================================

def get_affecting_teachers(
    selected_teachers: set[str],
    locked_teachers: dict,
    classes: list,
) -> list[str]:
    """
    Find locked teachers who share grades with selected teachers.

    Only these teachers can directly affect feasibility through grade conflicts.
    Returns list of locked teacher names that have grade overlap.
    """
    if not locked_teachers:
        return []

    # Get all grades taught by selected teachers
    selected_grades = set()
    for cls in classes:
        teacher = cls.get('teacher') or (cls.teacher if hasattr(cls, 'teacher') else '')
        grades = cls.get('grades') or (cls.grades if hasattr(cls, 'grades') else [])
        if not grades:
            grade = cls.get('grade') or (cls.grade if hasattr(cls, 'grade') else '')
            grades = [grade] if grade else []

        if teacher in selected_teachers:
            selected_grades.update(grades)

    if not selected_grades:
        return []

    # Find locked teachers who teach any of those grades
    affecting = []
    for teacher_name in locked_teachers.keys():
        teacher_grades = set()
        for cls in classes:
            cls_teacher = cls.get('teacher') or (cls.teacher if hasattr(cls, 'teacher') else '')
            if cls_teacher == teacher_name:
                grades = cls.get('grades') or (cls.grades if hasattr(cls, 'grades') else [])
                if not grades:
                    grade = cls.get('grade') or (cls.grade if hasattr(cls, 'grade') else '')
                    grades = [grade] if grade else []
                teacher_grades.update(grades)

        # Check for grade overlap
        if teacher_grades & selected_grades:
            affecting.append(teacher_name)

    return affecting


def count_shared_sessions(
    teacher_name: str,
    selected_grades: set[str],
    classes: list,
) -> int:
    """
    Count how many class sessions a teacher has that overlap with selected grades.

    Higher count = more potential impact on feasibility.
    """
    shared = 0
    for cls in classes:
        cls_teacher = cls.get('teacher') or (cls.teacher if hasattr(cls, 'teacher') else '')
        if cls_teacher != teacher_name:
            continue

        grades = cls.get('grades') or (cls.grades if hasattr(cls, 'grades') else [])
        if not grades:
            grade = cls.get('grade') or (cls.grade if hasattr(cls, 'grade') else '')
            grades = [grade] if grade else []

        days_per_week = cls.get('daysPerWeek') or cls.get('days_per_week') or (cls.days_per_week if hasattr(cls, 'days_per_week') else 1)

        # Check if any of this class's grades overlap with selected grades
        if set(grades) & selected_grades:
            shared += days_per_week

    return shared


def suggest_teachers_to_unlock(
    teachers: list[dict],
    classes: list[dict],
    rules: list[dict],
    locked_teachers: dict,
    grades: list[str],
    max_suggestions: int = 3,
    trial_timeout: float = 5.0,
    blocks: list = None,
    grade_teachable_blocks: dict = None,
    grade_block_pairs: dict = None,
) -> list[dict]:
    """
    When solver returns infeasible, try unlocking each affecting teacher
    to see which ones would make the problem feasible.

    Returns ranked list of suggestions with impact info.
    Only checks teachers who share grades with selected (unlocked) teachers.
    """
    if not locked_teachers:
        return []

    # Determine selected (unlocked) teachers
    all_teachers = {t['name'] for t in teachers}
    locked_names = set(locked_teachers.keys())
    selected_teachers = all_teachers - locked_names

    if not selected_teachers:
        return []

    # Get grades taught by selected teachers for ranking
    selected_grades = set()
    for cls in classes:
        if cls.get('teacher') in selected_teachers:
            cls_grades = cls.get('grades') or [cls.get('grade', '')]
            selected_grades.update(g for g in cls_grades if g)

    # Get only teachers who affect our selected teachers (share grades)
    affecting = get_affecting_teachers(selected_teachers, locked_teachers, classes)

    if not affecting:
        return []

    # Pre-calculate shared sessions for ranking
    teacher_shared = {}
    for teacher_name in affecting:
        teacher_shared[teacher_name] = count_shared_sessions(teacher_name, selected_grades, classes)

    # Sort by shared sessions (most impact first) for trial order
    affecting.sort(key=lambda t: -teacher_shared.get(t, 0))

    suggestions = []

    for teacher_name in affecting:
        # Create a copy of locked_teachers without this one
        trial_locked = {k: v for k, v in locked_teachers.items() if k != teacher_name}

        # Run quick feasibility check (minimal settings)
        # Import here to avoid circular dependency issues
        trial_result = _quick_feasibility_check(
            teachers=teachers,
            classes=classes,
            rules=rules,
            locked_teachers=trial_locked,
            grades=grades,
            timeout=trial_timeout,
            blocks=blocks,
            grade_teachable_blocks=grade_teachable_blocks,
            grade_block_pairs=grade_block_pairs,
        )

        is_feasible = trial_result.get('status') == 'success' and len(trial_result.get('options', [])) > 0
        options_found = len(trial_result.get('options', []))

        shared = teacher_shared.get(teacher_name, 0)

        suggestions.append({
            'teacher': teacher_name,
            'shared_sessions': shared,
            'feasible': is_feasible,
            'options_found': options_found,
            'impact': 'high' if is_feasible else ('medium' if shared >= 4 else 'low'),
        })

        # Stop early if we found enough suggestions that make it feasible
        feasible_count = sum(1 for s in suggestions if s['feasible'])
        if feasible_count >= max_suggestions:
            break

    # If no single teacher made it feasible, try pairs of top candidates
    single_feasible = any(s['feasible'] for s in suggestions)
    if not single_feasible and len(affecting) >= 2:
        # Only try pairs of top 3 candidates (to limit trials)
        top_candidates = affecting[:3]
        found_pair = False
        for i, teacher1 in enumerate(top_candidates):
            for teacher2 in top_candidates[i+1:]:
                # Create a copy without both teachers
                trial_locked = {k: v for k, v in locked_teachers.items()
                               if k != teacher1 and k != teacher2}

                trial_result = _quick_feasibility_check(
                    teachers=teachers,
                    classes=classes,
                    rules=rules,
                    locked_teachers=trial_locked,
                    grades=grades,
                    timeout=trial_timeout,
                    blocks=blocks,
                    grade_teachable_blocks=grade_teachable_blocks,
                    grade_block_pairs=grade_block_pairs,
                )

                is_feasible = trial_result.get('status') == 'success' and len(trial_result.get('options', [])) > 0

                if is_feasible:
                    combined_shared = teacher_shared.get(teacher1, 0) + teacher_shared.get(teacher2, 0)
                    suggestions.append({
                        'teacher': f"{teacher1} + {teacher2}",
                        'shared_sessions': combined_shared,
                        'feasible': True,
                        'options_found': len(trial_result.get('options', [])),
                        'impact': 'high',
                        'is_pair': True,
                        'teachers': [teacher1, teacher2],
                    })
                    found_pair = True
                    break
            if found_pair:
                break

        # If no pair worked and we have 3+ candidates, try all top candidates together
        if not found_pair and len(top_candidates) >= 3:
            trial_locked = {k: v for k, v in locked_teachers.items()
                           if k not in set(top_candidates)}

            trial_result = _quick_feasibility_check(
                teachers=teachers,
                classes=classes,
                rules=rules,
                locked_teachers=trial_locked,
                grades=grades,
                timeout=trial_timeout,
                blocks=blocks,
                grade_teachable_blocks=grade_teachable_blocks,
                grade_block_pairs=grade_block_pairs,
            )

            is_feasible = trial_result.get('status') == 'success' and len(trial_result.get('options', [])) > 0

            if is_feasible:
                combined_shared = sum(teacher_shared.get(t, 0) for t in top_candidates)
                suggestions.append({
                    'teacher': ' + '.join(top_candidates),
                    'shared_sessions': combined_shared,
                    'feasible': True,
                    'options_found': len(trial_result.get('options', [])),
                    'impact': 'high',
                    'is_pair': True,  # Reuse pair handling in frontend
                    'teachers': top_candidates,
                })

    # Only return suggestions that have been verified to help (feasible)
    # Non-feasible suggestions with just overlap counts are misleading
    verified = [s for s in suggestions if s['feasible']]
    verified.sort(key=lambda x: (-x['shared_sessions'],))

    return verified[:max_suggestions]


def _quick_feasibility_check(
    teachers: list[dict],
    classes: list[dict],
    rules: list[dict],
    locked_teachers: dict,
    grades: list[str],
    timeout: float = 5.0,
    blocks: list = None,
    grade_teachable_blocks: dict = None,
    grade_block_pairs: dict = None,
) -> dict:
    """
    Run a quick solver check to test feasibility.

    Uses short timeout - we just need to know if ANY solution exists.
    """
    # Use generate_schedules with minimal settings
    # This is a forward reference - will be resolved at runtime
    return generate_schedules(
        teachers=teachers,
        classes=classes,
        rules=rules,
        num_options=1,
        num_attempts=3,  # Just a few seeds to check feasibility
        max_time_seconds=timeout,
        locked_teachers=locked_teachers,
        skip_study_halls=True,  # Skip study halls for speed
        grades=grades,
        blocks=blocks,
        grade_teachable_blocks=grade_teachable_blocks,
        grade_block_pairs=grade_block_pairs,
        # Don't recurse into suggestions for trial runs
        _skip_unlock_suggestions=True,
    )


def solve_with_cpsat(sessions: list[Session], seed: int = 0, time_limit: float = 10.0, max_solutions: int = 5, diagnostics: dict = None, rules: list[dict] = None, active_grades: list[str] = None, teacher_lunch_windows: dict = None) -> list[dict]:
    """
    Solve the scheduling problem using CP-SAT.

    Returns list of dicts mapping session_id -> slot, or empty list if infeasible.

    If diagnostics dict is provided, it will be populated with diagnostic info
    that can be shown to end users to help understand infeasibility.

    If rules is provided, certain constraints can be toggled on/off based on rule settings.

    active_grades is required - list of all grade names from the database.

    teacher_lunch_windows: optional dict mapping teacher name -> set of candidate
    lunch block numbers (see compute_teacher_lunch_candidates). When provided,
    a hard constraint keeps at least one candidate window free of the teacher's
    classes on every day. Callers gate this on the 'teacher_lunch' rule.
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

        # Check for teacher overload (more sessions than available slots)
        from collections import Counter
        teacher_counts = Counter(s.teacher for s in sessions)
        overloaded = [(t, c) for t, c in teacher_counts.items() if c > NUM_SLOTS]
        if overloaded:
            diagnostics['teacherOverload'] = [{'teacher': t, 'sessions': c} for t, c in overloaded]

        # Check for fixed slot conflicts (same teacher, same slot)
        conflicts = []
        teacher_fixed = {}
        for s in fixed_sessions:
            slot = s.valid_slots[0]
            key = (s.teacher, slot)
            if key in teacher_fixed:
                day_idx = slot_to_day(slot)
                block_idx = slot_to_block(slot)
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
        if len(s.valid_slots) == 0:
            # No valid slots - session can't be placed (slots all blocked by locked teachers)
            # Skip this session entirely - constraints will work without it
            continue
        elif len(s.valid_slots) == 1:
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

    # Filter sessions to only those with variables (excludes sessions with no valid slots)
    active_sessions = [s for s in sessions if s.id in slot_vars]

    # Hard Constraint 1: No teacher conflicts (teacher can't be in two places at once)
    teachers = list(set(s.teacher for s in active_sessions))
    for teacher in teachers:
        teacher_sessions = [s for s in active_sessions if s.teacher == teacher]
        if len(teacher_sessions) > 1:
            teacher_vars = [slot_vars[s.id] for s in teacher_sessions]
            model.AddAllDifferent(teacher_vars)

    # Hard Constraint 2: No grade conflicts (grade can't have two classes at once)
    #
    # Elective logic:
    # - Elective vs Elective (same grades): NO conflict - they're concurrent "pick one" choices
    # - Elective vs Regular (same grades): CONFLICT - elective period blocks regular classes
    # - Regular vs Regular (same grades): CONFLICT - standard grade blocking
    # - Co-taught vs Co-taught (same grade+subject): NO conflict - they're the same class with multiple teachers
    #
    for grade in active_grades:
        regular_sessions = [s for s in active_sessions if grade in s.grades and not s.is_elective]
        elective_sessions = [s for s in active_sessions if grade in s.grades and s.is_elective]

        # Regular vs Regular: all must be at different times
        # EXCEPT: co-taught classes (same grade+subject, different teachers) CAN be at same time
        if len(regular_sessions) > 1:
            # Group co-taught sessions by (subject, teacher) - we need one teacher's sessions per subject
            from collections import defaultdict
            cotaught_by_subject_teacher = defaultdict(list)
            non_cotaught = []
            for s in regular_sessions:
                if s.is_cotaught:
                    cotaught_by_subject_teacher[(s.subject, s.teacher)].append(s)
                else:
                    non_cotaught.append(s)

            # Non-cotaught sessions must all be different from each other
            unique_slots = [slot_vars[s.id] for s in non_cotaught]

            # For co-taught: add ALL sessions from ONE teacher per subject
            # (the other teachers' sessions are constrained to same slots by co-taught constraint)
            seen_subjects = set()
            for (subject, teacher), sessions in cotaught_by_subject_teacher.items():
                if subject not in seen_subjects:
                    seen_subjects.add(subject)
                    # Add all sessions from this teacher for this subject
                    for s in sessions:
                        unique_slots.append(slot_vars[s.id])

            if len(unique_slots) > 1:
                model.AddAllDifferent(unique_slots)

        # Regular vs Elective: each regular class must not overlap with any elective
        # (electives block the grade from having regular classes at that time)
        for reg in regular_sessions:
            for elec in elective_sessions:
                model.Add(slot_vars[reg.id] != slot_vars[elec.id])

        # Elective vs Elective: NO constraint - they can all be at the same time

    # Hard Constraint 3: No duplicate subjects per day per grade
    # Note: Also skip electives for this constraint
    # Note: Co-taught sessions (same subject, different teachers) are allowed on same day
    #       because they're constrained to be at the SAME time slot
    # Exception (optional doubles): two sessions of the SAME unflagged class may
    # share a day iff their blocks form one of the class's legal consecutive
    # pairs (allowed_block_pairs) - i.e. a day holds one single OR one legal
    # double, the solver's choice. Pairwise legality also caps a grade+subject
    # at two lessons per day: a legal pair has exactly two distinct blocks, so
    # three same-day sessions can never be pairwise-paired.
    # This constraint can be toggled via the 'no_duplicate_subjects' rule
    if is_rule_enabled(rules, 'no_duplicate_subjects'):
        # Lazily-created per-session day/block vars, shared by the optional-double
        # branch below (a multi-grade class hits the same session pair once per
        # covered grade; relaxed_pairs_done dedupes the reified machinery).
        dup_day_block_vars: dict[int, tuple] = {}
        relaxed_pairs_done: set[tuple] = set()
        # Per-class same_day literals for the pairing budget below (unflagged
        # classes only; one literal per unordered session pair, deduped via
        # relaxed_pairs_done so multi-grade classes don't double-count).
        class_same_day_lits: dict[int, list] = {}

        def get_day_block_vars(sess):
            if sess.id not in dup_day_block_vars:
                dv = model.NewIntVar(0, len(DAYS) - 1, f'dupday_{sess.id}')
                model.AddDivisionEquality(dv, slot_vars[sess.id], len(BLOCKS))
                bv = model.NewIntVar(0, len(BLOCKS) - 1, f'dupblk_{sess.id}')
                model.AddModuloEquality(bv, slot_vars[sess.id], len(BLOCKS))
                dup_day_block_vars[sess.id] = (dv, bv)
            return dup_day_block_vars[sess.id]

        for grade in active_grades:
            subjects_for_grade = set()
            for s in active_sessions:
                if s.is_elective:
                    continue
                if grade in s.grades:
                    subjects_for_grade.add(s.subject)

            for subject in subjects_for_grade:
                # Get all sessions for this grade+subject (excluding electives)
                gs_sessions = [s for s in active_sessions
                             if grade in s.grades and s.subject == subject and not s.is_elective]

                if len(gs_sessions) > 1:
                    # For each pair, ensure they're on different days
                    # EXCEPT: co-taught sessions from different teachers can be on same day
                    # (they're actually constrained to be at the exact same time)
                    for i, s1 in enumerate(gs_sessions):
                        for s2 in gs_sessions[i+1:]:
                            # Skip if both are co-taught (they'll be at same slot anyway)
                            if s1.is_cotaught and s2.is_cotaught and s1.teacher != s2.teacher:
                                continue
                            # Skip the two halves of one double meeting of a REQUIRED
                            # class - halves of DIFFERENT meetings (or a single vs. a
                            # pair half) still get the different-day constraint, so a
                            # third same-day occurrence and two meetings of one class
                            # per day stay forbidden.
                            if s1.pair_id is not None and s1.pair_id == s2.pair_id:
                                continue
                            # Optional doubles: two sessions of the same UNFLAGGED
                            # class may share a day iff their blocks form one of the
                            # class's legal pairs. (Required classes keep the strict
                            # path - their pairing is modeled via pair_id above and
                            # constraint 3b below.)
                            if (s1.class_key >= 0 and s1.class_key == s2.class_key
                                    and not s1.is_double_class and s1.allowed_block_pairs):
                                pkey = (min(s1.id, s2.id), max(s1.id, s2.id))
                                if pkey in relaxed_pairs_done:
                                    continue
                                relaxed_pairs_done.add(pkey)
                                d1, b1 = get_day_block_vars(s1)
                                d2, b2 = get_day_block_vars(s2)
                                same_day = model.NewBoolVar(f'sameday_{s1.id}_{s2.id}')
                                model.Add(d1 == d2).OnlyEnforceIf(same_day)
                                model.Add(d1 != d2).OnlyEnforceIf(same_day.Not())
                                class_same_day_lits.setdefault(
                                    s1.class_key, []).append(same_day)
                                # same_day => the two blocks are a legal pair
                                # (either orientation; sessions are interchangeable)
                                pair_lits = []
                                for pa, pb in s1.allowed_block_pairs:
                                    if pa not in BLOCKS or pb not in BLOCKS:
                                        continue
                                    ia, ib = BLOCKS.index(pa), BLOCKS.index(pb)
                                    for x, y in ((ia, ib), (ib, ia)):
                                        lit = model.NewBoolVar(
                                            f'optdbl_{s1.id}_{s2.id}_{x}_{y}')
                                        model.Add(b1 == x).OnlyEnforceIf(lit)
                                        model.Add(b2 == y).OnlyEnforceIf(lit)
                                        pair_lits.append(lit)
                                if pair_lits:
                                    model.AddBoolOr(pair_lits).OnlyEnforceIf(same_day)
                                else:
                                    model.Add(d1 != d2)
                                continue
                            # day = slot // num_blocks, so different days means
                            # slot1 // num_blocks != slot2 // num_blocks
                            num_blocks = len(BLOCKS)
                            day1 = model.NewIntVar(0, len(DAYS) - 1, f'd1_{s1.id}_{s2.id}')
                            day2 = model.NewIntVar(0, len(DAYS) - 1, f'd2_{s1.id}_{s2.id}')
                            model.AddDivisionEquality(day1, slot_vars[s1.id], num_blocks)
                            model.AddDivisionEquality(day2, slot_vars[s2.id], num_blocks)
                            model.Add(day1 != day2)

        # Hard Constraint 3a: Optional-double pairing budget.
        # Unflagged classes may pair ONLY when the week cannot fit otherwise:
        # the number of same-day pairs must not exceed the arithmetic minimum
        # max(0, L - usable_days), where L is the class's lesson count and
        # usable_days is the number of distinct days covered by the union of
        # its sessions' valid slots. Fixed slots that already form a same-day
        # pair are explicit user pins - always honored - so the bound is
        # max(fixed_same_day_pairs, max_pairs). Flagged (is_double) classes
        # are governed by constraints 3b below instead and never appear here.
        if class_same_day_lits:
            sessions_by_class: dict[int, list] = {}
            for s in active_sessions:
                if s.class_key in class_same_day_lits:
                    sessions_by_class.setdefault(s.class_key, []).append(s)
            for ck, lits in class_same_day_lits.items():
                cls_sessions = sessions_by_class.get(ck, [])
                lessons = len(cls_sessions)
                usable_days = len({slot_to_day(slot)
                                   for s in cls_sessions
                                   for slot in s.valid_slots})
                usable_days = min(usable_days, len(DAYS))
                max_pairs = max(0, lessons - usable_days)
                fixed_day_counts: dict[int, int] = {}
                for s in cls_sessions:
                    if s.is_fixed and s.valid_slots:
                        d = slot_to_day(s.valid_slots[0])
                        fixed_day_counts[d] = fixed_day_counts.get(d, 0) + 1
                fixed_pairs = sum(n * (n - 1) // 2 for n in fixed_day_counts.values())
                budget = max(fixed_pairs, max_pairs)
                if len(lits) > budget:
                    model.Add(sum(lits) <= budget)

    # Hard Constraint 3b: Double periods
    # Each double meeting is two sessions sharing a pair_id. The pair must land
    # on one of the class's legal (first_slot, second_slot) tuples - same day and
    # a legal consecutive block pair by construction (pairs whose blocks are
    # separated only by another band's lunch row are legal and are NOT +1 apart
    # in slot space, hence the table constraint instead of slot arithmetic).
    pair_members: dict[int, list] = {}
    for s in active_sessions:
        if s.pair_id is not None:
            pair_members.setdefault(s.pair_id, []).append(s)
    for pid, members in pair_members.items():
        if len(members) != 2:
            continue  # half was dropped (no valid slots) - nothing to link
        first = min(members, key=lambda m: m.pair_pos)
        second = max(members, key=lambda m: m.pair_pos)
        if first.is_fixed and second.is_fixed:
            continue  # pinned pair - already validated in preflight
        tuples = first.pair_slots or []
        if tuples:
            model.AddAllowedAssignments(
                [slot_vars[first.id], slot_vars[second.id]], tuples)

    # Each meeting of a double-period class on a DISTINCT day (at most one
    # meeting per day). Meeting representatives = pair first-halves + singles.
    # Enforced unconditionally (not gated on no_duplicate_subjects) because
    # distinct meeting days are part of the double-period semantics.
    meetings_by_class: dict[int, list] = {}
    for s in active_sessions:
        if s.is_double_class and s.pair_pos == 0:
            meetings_by_class.setdefault(s.class_key, []).append(s)
    for ck, reps in meetings_by_class.items():
        if len(reps) > 1:
            day_vars = []
            for s in reps:
                dv = model.NewIntVar(0, len(DAYS) - 1, f'dblday_{ck}_{s.id}')
                model.AddDivisionEquality(dv, slot_vars[s.id], len(BLOCKS))
                day_vars.append(dv)
            model.AddAllDifferent(day_vars)

    # Hard Constraint 4: Co-taught classes (same grade+subject, different teachers)
    # If multiple teachers teach the same grade+subject, they must be scheduled together.
    # This is used when two teachers team-teach a class together.
    #
    # Optimization: Skip adding constraint if both sessions are already fixed to the
    # same slot (constraint would be redundant: constant == constant).
    from collections import defaultdict
    cotaught_groups = defaultdict(list)  # (grade, subject) -> [sessions]

    for s in active_sessions:
        if not s.is_cotaught:
            continue
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

    # Hard Constraint 5: Teacher lunch (only when candidate windows are provided)
    # For each affected teacher, on every day at least one candidate lunch
    # window (a block during which some band of their students is at lunch)
    # must remain free of that teacher's classes.
    #
    # Teachers are skipped when the constraint is vacuously true:
    # - empty candidate set (legacy requests / only unmasked grades)
    # - some candidate window can never be occupied by any of their sessions
    #   (e.g. single-band teachers: their only candidate window is their own
    #   band's lunch block, which all their sessions are masked away from)
    if teacher_lunch_windows:
        for lunch_teacher, cand_blocks in teacher_lunch_windows.items():
            t_sessions = [s for s in active_sessions if s.teacher == lunch_teacher]
            if not t_sessions:
                continue
            cand = sorted(b for b in cand_blocks if b in BLOCKS)
            if not cand:
                continue

            # Occupiability check: a window no session can ever land in is
            # always free, so the whole per-day constraint is vacuously true.
            ever_occupiable = {b: False for b in cand}
            for s in t_sessions:
                for slot in s.valid_slots:
                    bnum = BLOCKS[slot_to_block(slot)]
                    if bnum in ever_occupiable:
                        ever_occupiable[bnum] = True
            if not all(ever_occupiable.values()):
                continue

            num_windows = len(cand)
            cand_block_idx = {b: BLOCKS.index(b) for b in cand}
            for day_idx in range(len(DAYS)):
                occupied_lits = []
                fixed_occupied = 0
                for b in cand:
                    window_slot = day_block_to_slot(day_idx, cand_block_idx[b])
                    for s in t_sessions:
                        if window_slot not in s.valid_slots:
                            continue
                        if len(s.valid_slots) == 1:
                            fixed_occupied += 1
                        else:
                            lit = model.NewBoolVar(f'lunch_{lunch_teacher}_{day_idx}_{b}_{s.id}')
                            model.Add(slot_vars[s.id] == window_slot).OnlyEnforceIf(lit)
                            model.Add(slot_vars[s.id] != window_slot).OnlyEnforceIf(lit.Not())
                            occupied_lits.append(lit)
                # AddAllDifferent on the teacher's sessions guarantees at most
                # one session per slot, so the sum of these literals equals the
                # number of occupied candidate windows on this day.
                if fixed_occupied >= num_windows:
                    # Fixed slots alone fill every window - infeasible.
                    # (Preflight reports this with a readable message first.)
                    model.AddBoolOr([])
                elif occupied_lits:
                    model.Add(sum(occupied_lits) <= num_windows - 1 - fixed_occupied)

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
        assignment = {s.id: solver.Value(slot_vars[s.id]) for s in active_sessions}
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

    # Fill in assignments (skip sessions not in assignment, e.g. those with no valid slots)
    for s in sessions:
        if s.id not in assignment:
            continue
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
    Handles: single grades, ranges, comma-separated lists, and Kindergarten.

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
    matched_grades = []

    # 1. Direct match - most common case (single grade that exactly matches DB)
    if trimmed in database_grades:
        return [trimmed]

    # 2. Handle Kindergarten (can appear alone or in comma-separated list)
    if 'kindergarten' in trimmed.lower():
        for db_grade in database_grades:
            if 'kindergarten' in db_grade.lower():
                matched_grades.append(db_grade)
                break
        # If ONLY kindergarten, return early
        if ',' not in trimmed and not re.search(r'\d', trimmed):
            return matched_grades

    # 3. Handle comma-separated list like "6th Grade, 7th Grade" or "10th, 11th"
    if ',' in trimmed:
        parts = [p.strip() for p in trimmed.split(',')]
        for part in parts:
            # Skip if already handled kindergarten
            if 'kindergarten' in part.lower():
                continue
            # Try direct match first
            if part in database_grades and part not in matched_grades:
                matched_grades.append(part)
                continue
            # Try to extract grade number and find matching database grade
            num_match = re.search(r'(\d+)', part)
            if num_match:
                num = int(num_match.group(1))
                for db_grade in database_grades:
                    if grade_to_number(db_grade) == num and db_grade not in matched_grades:
                        matched_grades.append(db_grade)
                        break
        return matched_grades

    # 4. Try to parse as a grade range (e.g., "6th-7th Grade", "6th-11th")
    range_match = re.match(r'(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?', trimmed, re.IGNORECASE)
    if range_match:
        start = int(range_match.group(1))
        end = int(range_match.group(2))
        if start > 0 and end > 0 and start <= end:
            # Find database grades that match numbers in this range
            for db_grade in database_grades:
                grade_num = grade_to_number(db_grade)
                if grade_num >= start and grade_num <= end and db_grade not in matched_grades:
                    matched_grades.append(db_grade)
            if matched_grades:
                return matched_grades

    # 5. Try single grade number parsing and find matching database grade
    single_match = re.search(r'(\d+)(?:st|nd|rd|th)', trimmed, re.IGNORECASE)
    if single_match:
        num = int(single_match.group(1))
        # Find database grade with this number
        for db_grade in database_grades:
            if grade_to_number(db_grade) == num:
                return [db_grade]

    # Return any grades found (from kindergarten handling) or empty
    return matched_grades


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
                             full_time_teachers: list[str],
                             grade_teachable_blocks: dict = None,
                             teacher_lunch_windows: dict = None,
                             frozen_class_entries: set = None) -> None:
    """
    Post-processing to break up consecutive OPEN blocks by swapping classes around.
    This mimics the JavaScript solver's redistributeOpenBlocks function.

    grade_teachable_blocks: optional dict mapping grade name -> set/list of block
    numbers the grade can be taught in. A class is never moved into a block that
    is not teachable for one of its grades (e.g. that grade band's lunch block).

    teacher_lunch_windows: optional dict mapping teacher name -> set of candidate
    lunch block numbers. A class is never moved into a teacher's last free
    candidate lunch window on a day (would leave them without a lunch break).

    frozen_class_entries: optional set of (teacher, grade_display, subject)
    triples whose sessions must never be moved. Used for double-period classes:
    the two halves of a double must stay together, and the simplest safe policy
    is to never move any session of a flagged class.
    """

    def would_lose_lunch(teacher: str, issue_day: str, issue_block: int,
                         target_day: str, target_block: int) -> bool:
        """Would moving a class into (issue_day, issue_block) - vacating
        (target_day, target_block) - leave the teacher with no free candidate
        lunch window on issue_day? Study Hall counts as occupied."""
        cand = (teacher_lunch_windows or {}).get(teacher)
        if not cand or issue_block not in cand:
            return False
        day_sched = teacher_schedules.get(teacher, {}).get(issue_day, {})
        for b in cand:
            if b == issue_block or b not in BLOCKS:
                continue
            # The vacated slot becomes OPEN, so it counts as free
            if target_day == issue_day and b == target_block:
                return False
            entry = day_sched.get(b)
            if entry is None or (len(entry) > 1 and entry[1] == 'OPEN'):
                return False
        return True
    def grades_teachable_at(grades: list, block: int) -> bool:
        if not grade_teachable_blocks:
            return True
        for g in grades:
            mask = grade_teachable_blocks.get(g)
            if mask is not None and block not in mask:
                return False
        return True

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
        if block_idx < len(BLOCKS) - 1:
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

                        # Never move a session of a double-period class - the two
                        # halves of a double must stay together
                        if frozen_class_entries and (teacher, entry[0], entry[1]) in frozen_class_entries:
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

                        # Never move a class into a block that isn't teachable
                        # for one of its grades (e.g. that band's lunch block)
                        if not grades_teachable_at(grades, issue_block):
                            continue

                        # Never move a class into the teacher's last free
                        # candidate lunch window on that day
                        if would_lose_lunch(teacher, issue_day, issue_block,
                                            target_day, target_block):
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
                    grades: list[str] = None,
                    teacher_availability: dict = None,
                    grade_teachable_blocks: dict = None,
                    teacher_lunch_windows: dict = None) -> list[StudyHallAssignment]:
    """Assign study halls to eligible teachers with open blocks.

    Strategy:
    1. Try to place each grade (configured in study_hall_grades rule) individually first
    2. If placement fails, mark as unplaced (no auto-combining)

    Args:
        preserve_existing: If True, keep existing study halls and only fill gaps.
                          If False, reassign all study halls from scratch.
        rules: Scheduling rules to read config from (study_hall_grades).
        grade_teachable_blocks: Optional dict mapping grade name -> set/list of
            block numbers the grade can occupy. Study halls are never placed in
            a block that isn't teachable for every grade in the group.
        teacher_lunch_windows: Optional dict mapping teacher name -> set of
            candidate lunch block numbers. A study hall is never assigned to a
            supervisor's last free candidate lunch window on a day (a study
            hall occupies its supervisor, who still needs a lunch break).

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
        # Spread study halls evenly: fewest already-assigned study halls first
        # (counting preserved ones), then most open blocks as the tie-breaker.
        # Sorting by open blocks alone made the lightest-loaded teacher absorb
        # nearly every study hall.
        sh_counts: dict[str, int] = {}
        for a in assignments:
            if a.teacher:
                sh_counts[a.teacher] = sh_counts.get(a.teacher, 0) + 1
        teachers_by_availability = sorted(
            valid_teachers,
            key=lambda t: (sh_counts.get(t, 0), -count_open_blocks(t))
        )

        for teacher in teachers_by_availability:
            if count_open_blocks(teacher) == 0:
                continue

            for day in DAYS:
                # Skip if any grade in this group already has study hall today
                if any(day in grade_study_hall_days.get(g, set()) for g in group_grades):
                    continue

                for block in BLOCKS:
                    # Block must be teachable for every grade in the group
                    # (e.g. skip that grade band's lunch block)
                    if grade_teachable_blocks:
                        blocked = False
                        for g in group_grades:
                            mask = grade_teachable_blocks.get(g)
                            if mask is not None and block not in mask:
                                blocked = True
                                break
                        if blocked:
                            continue

                    # Teacher must be free
                    if teacher_schedules[teacher][day][block] is not None:
                        continue

                    # Never take the supervisor's last free candidate lunch
                    # window on this day (study hall occupies the teacher)
                    if teacher_lunch_windows:
                        cand = teacher_lunch_windows.get(teacher)
                        if cand and block in cand:
                            day_sched = teacher_schedules[teacher][day]
                            if not any(
                                b != block and b in BLOCKS and day_sched.get(b) is None
                                for b in cand
                            ):
                                continue

                    # Teacher must be available on this day/block
                    if teacher_availability and teacher in teacher_availability:
                        slot = day_block_to_slot(DAYS.index(day), BLOCKS.index(block))
                        if slot not in teacher_availability[teacher]:
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
    skip_study_halls: bool = False,  # If True, skip study hall assignment entirely (reassign after saving)
    grades: list[str] = None,  # All grade names from database - used for grade schedule initialization
    blocks: list = None,  # Block numbers for this quarter's timetable (None = legacy [1..5])
    grade_teachable_blocks: dict = None,  # grade name -> list of teachable block numbers (None = all)
    grade_block_pairs: dict = None,  # grade name -> list of [earlierBlock, laterBlock] legal double pairs
    _skip_unlock_suggestions: bool = False,  # Internal: skip unlock suggestions to prevent recursion
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
        blocks: Block numbers defined by the quarter's timetable template (e.g. [1..9]).
            None/empty falls back to the legacy 5-block format.
        grade_teachable_blocks: Dict mapping grade name (e.g. '1st Grade') to the list of
            block numbers that grade can be scheduled into (e.g. its band's lunch block
            excluded). Grades absent from the dict may use all blocks.
        grade_block_pairs: Dict mapping grade name to a list of [earlierBlock, laterBlock]
            pairs the grade can hold a double period in (never straddling a break or
            that grade's lunch - built upstream from the timetable template). A class
            may only use pairs present for EVERY grade it covers (intersection).
            When provided, EVERY class may schedule a day's lessons as one single or
            one legal double - but unflagged classes pair ONLY when the week cannot
            fit otherwise (same-day pairs capped at max(0, lessons - usable days);
            user-pinned fixed pairs are always honored); classes flagged
            is_double MUST pair every meeting (odd lesson = one single), meetings on
            distinct days. Absent field = no pairing available: unflagged classes are
            strictly one lesson per day (legacy behavior); flagged classes needing at
            least one double fail preflight.

    Returns:
        Dict with status, options, message, seeds_completed
    """
    start_time = time.time()

    # Configure the block format for this request (module-level; see set_blocks docs)
    set_blocks(blocks)

    # Normalize the per-grade teachable-block masks: drop unknown block numbers,
    # keep only masks that actually restrict something meaningful.
    grade_teachable: dict[str, list[int]] = {}
    if grade_teachable_blocks:
        blocks_set = set(BLOCKS)
        for g, tbs in grade_teachable_blocks.items():
            grade_teachable[g] = sorted(b for b in set(tbs or []) if b in blocks_set)

    # Slot-index form of the masks (same blocks every day), for session building
    grade_teachable_slots: dict[str, set[int]] = None
    if grade_teachable:
        grade_teachable_slots = {}
        for g, tbs in grade_teachable.items():
            block_idxs = [BLOCKS.index(b) for b in tbs]
            grade_teachable_slots[g] = {
                day_block_to_slot(d, bi)
                for d in range(len(DAYS))
                for bi in block_idxs
            }
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
            can_supervise_study_hall=t.get('canSuperviseStudyHall'),  # Keep None as-is
            available_days=t.get('availableDays'),
            available_blocks=t.get('availableBlocks'),
        )
        for t in teachers
    ]

    # Build teacher availability lookup for study hall filtering
    teacher_availability = {}
    for t in teacher_objs:
        if t.available_days or t.available_blocks:
            days = t.available_days or DAYS
            blocks = t.available_blocks or BLOCKS
            teacher_availability[t.name] = set(get_valid_slots(days, blocks))

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

    # Normalize legal double-period pairs per grade: keep only pairs whose blocks
    # both exist in this quarter's block list and are ordered (earlier, later).
    # The lists are authoritative (built upstream so no pair straddles a break or
    # the grade's lunch); anything malformed is dropped, failing closed.
    grade_pairs: dict[str, list[tuple]] = {}
    if grade_block_pairs:
        blocks_set = set(BLOCKS)
        for key, plist in grade_block_pairs.items():
            norm = []
            for p in (plist or []):
                if not p or len(p) != 2:
                    continue
                b1, b2 = p[0], p[1]
                if b1 in blocks_set and b2 in blocks_set and BLOCKS.index(b1) < BLOCKS.index(b2):
                    pair = (b1, b2)
                    if pair not in norm:
                        norm.append(pair)
            grade_pairs[key] = norm
        # Alias keys that aren't exact database grade names (e.g. '7th' vs '7th Grade')
        for key in list(grade_pairs.keys()):
            if key not in active_grades_set:
                parsed = parse_grades_from_database(key, active_grades_set)
                if len(parsed) == 1 and parsed[0] not in grade_pairs:
                    grade_pairs[parsed[0]] = grade_pairs[key]

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

        # Double-period flag: accept either key (requires_double_periods is the
        # subject-level DB column name; is_double is the normalized payload key)
        is_double = bool(
            c.get('is_double') or c.get('isDouble')
            or c.get('requires_double_periods') or c.get('requiresDoublePeriods')
        )

        # Legal pairs for this class = intersection of every covered grade's pairs.
        # A grade missing from grade_block_pairs contributes an empty list (fail
        # closed - we cannot know which pairs avoid that grade's lunch/breaks).
        # Computed for EVERY class: flagged classes MUST pair every meeting;
        # unflagged classes MAY pair a day's two lessons (solver's choice).
        # Legacy requests (no grade_block_pairs) leave this empty for all classes.
        allowed_pairs = []
        if grades_list:
            pair_sets = [set(grade_pairs.get(g, [])) for g in grades_list]
            common = set.intersection(*pair_sets) if pair_sets else set()
            allowed_pairs = sorted(common)

        class_objs.append(ClassEntry(
            teacher=c['teacher'],
            grades=grades_list,
            grade_display=grade_display,
            subject=c['subject'],
            days_per_week=c.get('daysPerWeek', 1),
            is_elective=c.get('isElective', False),
            is_cotaught=c.get('isCotaught', False),
            is_double=is_double,
            allowed_pairs=allowed_pairs,
            available_days=c.get('availableDays') or DAYS.copy(),
            available_blocks=c.get('availableBlocks') or BLOCKS.copy(),
            fixed_slots=[(fs[0], fs[1]) for fs in (c.get('fixedSlots') or [])]
        ))

    full_time_names = [t.name for t in teacher_objs if t.status == 'full-time']

    # Sessions of these classes must never be moved by post-processing:
    # - required double-period classes (the two halves of a double stay together
    #   or don't move at all)
    # - classes with fixed slots (user-pinned; the solver honors the pin as a
    #   hard constraint, so back-to-back redistribution must not undo it)
    frozen_class_entries = {
        (c.teacher, c.grade_display, c.subject)
        for c in class_objs if c.is_double or c.fixed_slots
    } or None

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
        locked_grade_subject_days if is_partial_regen else None,
        teacher_objs,
        grade_teachable_slots
    )

    # Candidate lunch windows per teacher (hard 'teacher_lunch' rule).
    # Only active when per-grade teachable-block masks are provided AND the
    # rule is enabled (missing rule row defaults to enabled). Sessions here
    # already exclude locked teachers, whose schedules we cannot change.
    teacher_lunch_windows = None
    if grade_teachable and is_rule_enabled(rules, 'teacher_lunch'):
        teacher_lunch_windows = compute_teacher_lunch_candidates(sessions, grade_teachable) or None

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

    # Check 0b: Double periods - lesson counts, legal pairs, and fixed-slot pairing
    #
    # Two modes when grade_block_pairs is provided:
    # - Default (unflagged classes): back-to-back is ALLOWED but only used when
    #   the week cannot fit otherwise (the model caps same-day pairs at
    #   max(0, lessons - usable days); pinned fixed pairs are always honored).
    #   A day holds one single or one legal double, so the weekly cap is
    #   2 lessons x days when the class has >=1 legal pair, else
    #   1 x days. Legacy requests (no pairs map) keep the old 1-per-day cap.
    # - Required (is_double classes): every meeting is a legal double (plus one
    #   odd single), meetings on distinct days - unchanged.
    dup_rule_on = is_rule_enabled(rules, 'no_duplicate_subjects')
    for cls in class_objs:
        lessons = len(cls.fixed_slots) if cls.fixed_slots else cls.days_per_week
        label = f"'{cls.teacher} - {cls.subject}' ({cls.grade_display})"

        if not cls.is_double:
            has_pairs = bool(cls.allowed_pairs)
            max_lessons = (2 * len(DAYS)) if has_pairs else len(DAYS)
            if lessons > max_lessons:
                if has_pairs:
                    preflight_errors.append(
                        f"Class {label} needs {lessons} lessons per week, but at most "
                        f"{max_lessons} fit ({len(DAYS)} days × 2 lessons as a double "
                        f"period per day)."
                    )
                elif grade_pairs:
                    grades_str = ', '.join(cls.grades) if cls.grades else '(no grades)'
                    preflight_errors.append(
                        f"Class {label} needs {lessons} lessons per week, but it can "
                        f"meet at most once per day ({len(DAYS)} days): there are no "
                        f"legal consecutive block pairs shared by all of its grades "
                        f"({grades_str}), so double periods are impossible. Check the "
                        f"quarter's timetable for pairable blocks common to these grades."
                    )
                else:
                    preflight_errors.append(
                        f"Class {label} needs {lessons} lessons per week, but a subject "
                        f"without double periods can meet at most once per day "
                        f"({len(DAYS)} days). Enable 'requires double periods' on subject "
                        f"'{cls.subject}' to allow two consecutive blocks per day."
                    )
            # Same-day fixed lessons must form one legal double (at most 2 per day).
            # Only checked when the pairs map was provided (legacy requests keep the
            # old behavior: the solver reports plain infeasibility), the duplicate-
            # subject rule is on (disabled = same-day repeats unrestricted), and the
            # class is not an elective (electives skip the duplicate-subject rule).
            if grade_pairs and dup_rule_on and not cls.is_elective and cls.fixed_slots:
                fixed_by_day: dict[str, list] = {}
                for day, block in cls.fixed_slots:
                    fixed_by_day.setdefault(day, []).append(block)
                pair_set = set(cls.allowed_pairs)
                problems = []
                for day, blist in fixed_by_day.items():
                    if len(blist) == 2:
                        ordered = sorted(blist, key=lambda b: BLOCKS.index(b) if b in BLOCKS else -1)
                        if (ordered[0], ordered[1]) not in pair_set:
                            problems.append(
                                f"{day} blocks {ordered[0]}+{ordered[1]} are not a legal double-period pair"
                            )
                    elif len(blist) > 2:
                        problems.append(
                            f"{day} has {len(blist)} fixed lessons (at most 2, forming one double period)"
                        )
                if problems:
                    preflight_errors.append(
                        f"Class {label} has same-day fixed lessons that don't form a "
                        f"legal double period: " + '; '.join(problems)
                    )
            continue

        num_doubles = lessons // 2
        num_singles = lessons % 2

        # Each meeting (double or single) needs its own day
        if num_doubles + num_singles > len(DAYS):
            preflight_errors.append(
                f"Class {label} needs {num_doubles + num_singles} meetings "
                f"({num_doubles} double + {num_singles} single) for {lessons} lessons, "
                f"but only {len(DAYS)} days are available"
            )

        # A flagged class that needs at least one double must have a legal pair
        # shared by every grade it covers
        if num_doubles > 0 and not cls.allowed_pairs:
            grades_str = ', '.join(cls.grades) if cls.grades else '(no grades)'
            preflight_errors.append(
                f"Class {label} requires double periods, but there are no legal "
                f"consecutive block pairs shared by all of its grades ({grades_str}). "
                f"Check the quarter's timetable for pairable blocks common to these grades."
            )
        elif cls.fixed_slots:
            # Fixed slots pin lessons: they must form same-day legal pairs plus
            # at most one lone single (the odd lesson if L is odd)
            fixed_by_day: dict[str, list] = {}
            for day, block in cls.fixed_slots:
                fixed_by_day.setdefault(day, []).append(block)
            pair_set = set(cls.allowed_pairs)
            problems = []
            lone_days = 0
            for day, blist in fixed_by_day.items():
                if len(blist) == 1:
                    lone_days += 1
                elif len(blist) == 2:
                    ordered = sorted(blist, key=lambda b: BLOCKS.index(b) if b in BLOCKS else -1)
                    if (ordered[0], ordered[1]) not in pair_set:
                        problems.append(
                            f"{day} blocks {ordered[0]}+{ordered[1]} are not a legal double-period pair"
                        )
                else:
                    problems.append(
                        f"{day} has {len(blist)} fixed lessons (at most 2, forming one double)"
                    )
            if lone_days > 1:
                problems.append(
                    f"{lone_days} days have a lone fixed lesson (at most one single meeting is allowed)"
                )
            if problems:
                preflight_errors.append(
                    f"Class {label} requires double periods, but its fixed slots don't "
                    f"form valid doubles: " + '; '.join(problems)
                )

    # Check 1: Teacher overload (more sessions than weekly slots)
    max_teacher_sessions = len(DAYS) * len(BLOCKS)
    teacher_session_count = {}
    for cls in class_objs:
        count = len(cls.fixed_slots) if cls.fixed_slots else cls.days_per_week
        teacher_session_count[cls.teacher] = teacher_session_count.get(cls.teacher, 0) + count

    overloaded_teachers = [(t, c) for t, c in teacher_session_count.items() if c > max_teacher_sessions]
    if overloaded_teachers:
        diagnostics['teacherOverload'] = [{'teacher': t, 'sessions': c} for t, c in overloaded_teachers]
        for t, c in overloaded_teachers:
            preflight_errors.append(
                f"Teacher '{t}' has {c} sessions but max is {max_teacher_sessions} "
                f"({len(DAYS)} days × {len(BLOCKS)} blocks)"
            )

    # Check 2: Grade overload (more sessions than that grade's teachable slots)
    # Note: Elective sessions don't count toward individual grade limits
    # Note: Co-taught classes (same grade+subject, different teachers) only count once
    def grade_max_sessions(grade: str) -> tuple[int, int]:
        """Return (max sessions per week, teachable blocks per day) for a grade."""
        teachable_count = len(grade_teachable.get(grade, BLOCKS))
        return len(DAYS) * teachable_count, teachable_count

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

    overloaded_grades = [(g, c) for g, c in grade_session_count.items() if c > grade_max_sessions(g)[0]]
    if overloaded_grades:
        diagnostics['gradeOverload'] = [{'grade': g, 'sessions': c} for g, c in overloaded_grades]
        for g, c in overloaded_grades:
            g_max, g_blocks = grade_max_sessions(g)
            preflight_errors.append(
                f"Grade '{g}' has {c} sessions but max is {g_max} "
                f"({len(DAYS)} days × {g_blocks} teachable blocks)"
            )

    # Check 2b: Fixed slots that land in a block a covered grade can't use
    # (e.g. an elective pinned to a grade band's lunch block)
    if grade_teachable:
        for cls in class_objs:
            for day, block in cls.fixed_slots:
                for grade in cls.grades:
                    mask = grade_teachable.get(grade)
                    if mask is not None and block not in mask:
                        preflight_errors.append(
                            f"Class '{cls.teacher} - {cls.subject}' is fixed to {day} Block {block}, "
                            f"but Block {block} is not a teachable block for {grade}"
                        )

    # Check 2c: Teacher lunch - fixed slots alone must not fill every candidate
    # lunch window on any day (the teacher would have no possible lunch break)
    if teacher_lunch_windows:
        for lunch_teacher, cand in teacher_lunch_windows.items():
            fixed_windows_by_day: dict[str, set[int]] = {d: set() for d in DAYS}
            for s in sessions:
                if s.teacher != lunch_teacher or not s.is_fixed or not s.valid_slots:
                    continue
                slot = s.valid_slots[0]
                block_num = BLOCKS[slot_to_block(slot)]
                if block_num in cand:
                    fixed_windows_by_day[DAYS[slot_to_day(slot)]].add(block_num)
            for day in DAYS:
                if fixed_windows_by_day[day] >= cand:
                    blocks_str = ', '.join(str(b) for b in sorted(cand))
                    preflight_errors.append(
                        f"Teacher '{lunch_teacher}' has fixed classes filling every possible "
                        f"lunch block ({blocks_str}) on {day} - at least one must stay open "
                        f"for a lunch break"
                    )

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
            active_grades=active_grades,
            teacher_lunch_windows=teacher_lunch_windows
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

            # Add study halls (only if study_hall_distribution rule is enabled and not skipped)
            # skip_study_halls=True means skip entirely (user will reassign after saving)
            if is_rule_enabled(rules, 'study_hall_distribution') and not skip_study_halls:
                sh_assignments = add_study_halls(ts, gs, eligible, preserve_existing=True, rules=rules, grades=active_grades, teacher_availability=teacher_availability, grade_teachable_blocks=grade_teachable or None, teacher_lunch_windows=teacher_lunch_windows)
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
                redistribute_open_blocks(ts, gs, unlocked_full_time, grade_teachable_blocks=grade_teachable or None, teacher_lunch_windows=teacher_lunch_windows, frozen_class_entries=frozen_class_entries)

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
        # For partial regens, try to suggest which locked teachers to unlock
        unlock_suggestions = []
        if is_partial_regen and not _skip_unlock_suggestions:
            elapsed = time.time() - start_time
            remaining = max_time_seconds - elapsed - 10  # Leave buffer
            if remaining > 5:  # Only if we have time
                unlock_suggestions = suggest_teachers_to_unlock(
                    teachers=teachers,
                    classes=classes,
                    rules=rules,
                    locked_teachers=locked_teachers,
                    grades=active_grades,
                    max_suggestions=3,
                    trial_timeout=min(5.0, remaining / len(locked_teacher_names)) if locked_teacher_names else 5.0,
                    blocks=blocks,
                    grade_teachable_blocks=grade_teachable_blocks,
                    grade_block_pairs=grade_block_pairs,
                )
                if unlock_suggestions:
                    diagnostics['unlockSuggestions'] = unlock_suggestions

        message = f'No feasible schedule found after {seeds_completed} attempts.'
        if unlock_suggestions:
            feasible = [s for s in unlock_suggestions if s['feasible']]
            if feasible:
                names = ', '.join(s['teacher'] for s in feasible[:2])
                message += f' Try also selecting: {names}'
            else:
                message += ' Check constraints.'
        else:
            message += ' Check constraints.'

        return {
            'status': 'infeasible',
            'options': [],
            'message': message,
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
