/**
 * School Schedule Solver - HiGHS MIP Implementation
 *
 * Uses Mixed Integer Programming via HiGHS WebAssembly for reliable solutions.
 * Runs entirely client-side - no server needed!
 */

import type {
  Teacher, ClassEntry, ScheduleOption, TeacherStat, StudyHallAssignment,
  TeacherSchedule, GradeSchedule
} from './types';

// Constants
export const DAYS = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri'];
export const BLOCKS = [1, 2, 3, 4, 5];
export const NUM_SLOTS = 25;

// NOTE: Grades now come from the database - no hardcoded grade list

// Helper to parse grade number from string like "6th" -> 6, "Kindergarten" -> 0
function gradeToNumber(grade: string): number {
  if (grade.toLowerCase().includes('kindergarten')) return 0;
  const match = grade.match(/(\d+)/);
  return match ? parseInt(match[1]) : -1;
}

// Helper to convert number to grade name: 0 -> "Kindergarten", 6 -> "6th Grade"
function numberToGrade(num: number): string {
  if (num === 0) return 'Kindergarten';
  const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th';
  return `${num}${suffix} Grade`;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function slotToDay(slot: number): number {
  return Math.floor(slot / 5);
}

function slotToBlock(slot: number): number {
  return slot % 5;
}

function dayBlockToSlot(dayIdx: number, blockIdx: number): number {
  return dayIdx * 5 + blockIdx;
}

/**
 * Parse grade display name to individual grades.
 * Used internally by the solver for constraint checking.
 * For matching against database grades, use parseGradesFromDatabase instead.
 */
function parseGrades(gradeField: string): string[] {
  // Electives don't block specific grades
  if (gradeField.toLowerCase().includes('elective')) return [];

  const trimmed = gradeField.trim();

  // Try to parse dynamic grade ranges like "6th-8th Grade" or "6th-11th"
  const rangeMatch = trimmed.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]);
    const end = parseInt(rangeMatch[2]);
    if (start > 0 && end > 0 && start <= end) {
      const grades: string[] = [];
      for (let i = start; i <= end; i++) {
        grades.push(numberToGrade(i));
      }
      return grades;
    }
  }

  // Try Kindergarten
  if (trimmed.toLowerCase().includes('kindergarten')) {
    return ['Kindergarten'];
  }

  // Try single grade parsing (e.g., "6th Grade", "6th")
  const singleMatch = trimmed.match(/^(\d+)(?:st|nd|rd|th)/i);
  if (singleMatch) {
    const num = parseInt(singleMatch[1]);
    if (num >= 1) {
      return [numberToGrade(num)];
    }
  }

  // If no pattern matched, return the original as-is (it might be a valid grade name)
  return trimmed ? [trimmed] : [];
}

function getValidSlots(availDays: string[], availBlocks: number[]): number[] {
  const slots: number[] = [];
  availDays.forEach(day => {
    const dayIdx = DAYS.indexOf(day);
    if (dayIdx === -1) return;
    availBlocks.forEach(block => {
      const blockIdx = BLOCKS.indexOf(block);
      if (blockIdx === -1) return;
      slots.push(dayBlockToSlot(dayIdx, blockIdx));
    });
  });
  return slots.length > 0 ? slots : Array.from({ length: 25 }, (_, i) => i);
}

// Seeded random number generator (mulberry32)
function seededRandom(seed: number): () => number {
  return function() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle<T>(array: T[], randomFn?: () => number): T[] {
  const random = randomFn || Math.random;
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getStudyHallEligible(teachers: Teacher[], rules?: SchedulingRule[]): string[] {
  // Get allowed statuses from rules config (default: full-time only)
  const allowedStatuses = getStudyHallEligibleStatuses(rules);

  // Eligible = teachers whose status is allowed AND who are not individually excluded
  // canSuperviseStudyHall: true = eligible, false = excluded, undefined = eligible
  return teachers
    .filter(t => allowedStatuses.has(t.status) && t.canSuperviseStudyHall !== false)
    .map(t => t.name);
}

// ============================================================================
// SESSION BUILDER
// ============================================================================

interface Session {
  id: number;
  teacher: string;
  grade: string;
  subject: string;
  validSlots: number[];
  isFixed: boolean;
  cotaughtGroupId?: string; // Sessions with same grade+subject but different teachers
}

function buildSessions(classes: ClassEntry[]): Session[] {
  const sessions: Session[] = [];
  let id = 0;

  classes.forEach(cls => {
    if (cls.fixedSlots && cls.fixedSlots.length > 0) {
      cls.fixedSlots.forEach(([day, block]) => {
        const dayIdx = DAYS.indexOf(day);
        const blockIdx = BLOCKS.indexOf(block);
        const slot = dayBlockToSlot(dayIdx, blockIdx);
        sessions.push({
          id: id++,
          teacher: cls.teacher,
          grade: cls.grade,
          subject: cls.subject,
          validSlots: [slot],
          isFixed: true,
        });
      });
    } else {
      const validSlots = getValidSlots(
        cls.availableDays || DAYS,
        cls.availableBlocks || BLOCKS
      );
      for (let i = 0; i < cls.daysPerWeek; i++) {
        sessions.push({
          id: id++,
          teacher: cls.teacher,
          grade: cls.grade,
          subject: cls.subject,
          validSlots: [...validSlots],
          isFixed: false,
        });
      }
    }
  });

  return sessions;
}

/**
 * Identify co-taught classes and assign group IDs.
 * Co-taught = same grade+subject but different teachers.
 * These sessions must be scheduled at the same time slot.
 */
function assignCotaughtGroups(sessions: Session[]): Map<string, Session[]> {
  // Group sessions by grade+subject
  const gradeSubjectGroups = new Map<string, Session[]>();

  for (const session of sessions) {
    // Skip electives - they don't have co-taught constraints
    if (session.grade.includes('Elective')) continue;

    const key = `${session.grade}|${session.subject}`;
    if (!gradeSubjectGroups.has(key)) {
      gradeSubjectGroups.set(key, []);
    }
    gradeSubjectGroups.get(key)!.push(session);
  }

  // Find groups with multiple teachers (co-taught)
  const cotaughtGroups = new Map<string, Session[]>();

  for (const [key, groupSessions] of gradeSubjectGroups) {
    const teachers = new Set(groupSessions.map(s => s.teacher));
    if (teachers.size > 1) {
      // This is a co-taught class - multiple teachers for same grade+subject
      // Group sessions by their "instance" (first session of each teacher pairs with first of others, etc.)
      const sessionsByTeacher = new Map<string, Session[]>();
      for (const s of groupSessions) {
        if (!sessionsByTeacher.has(s.teacher)) {
          sessionsByTeacher.set(s.teacher, []);
        }
        sessionsByTeacher.get(s.teacher)!.push(s);
      }

      // Find the minimum number of sessions across all teachers
      const minSessions = Math.min(...Array.from(sessionsByTeacher.values()).map(arr => arr.length));

      // Create co-taught groups by pairing sessions across teachers
      for (let i = 0; i < minSessions; i++) {
        const groupId = `${key}|${i}`;
        const group: Session[] = [];

        for (const [, teacherSessions] of sessionsByTeacher) {
          if (i < teacherSessions.length) {
            teacherSessions[i].cotaughtGroupId = groupId;
            group.push(teacherSessions[i]);
          }
        }

        if (group.length > 1) {
          cotaughtGroups.set(groupId, group);
        }
      }
    }
  }

  return cotaughtGroups;
}

// ============================================================================
// JAVASCRIPT BACKTRACKING SOLVER
// ============================================================================

interface SolveResult {
  assignment: Map<number, number> | null;
  status: string;
}

function solveBacktracking(
  sessions: Session[],
  randomize: boolean = true,
  prefilledGradeSlots?: Map<string, Set<number>>,
  maxTimeMs: number = 5000, // 5 second timeout per attempt
  deprioritizeTeachers?: Set<string>, // Teachers to schedule last (for diversity)
  rules?: SchedulingRule[], // Scheduling rules to respect
  cotaughtGroups?: Map<string, Session[]> // Co-taught class groups
): SolveResult {
  const assignment = new Map<number, number>();
  const startTime = Date.now();
  let iterations = 0;
  const maxIterations = 100000; // Safety limit

  // Track constraints
  const teacherSlots = new Map<string, Set<number>>();
  const gradeSlots = new Map<string, Set<number>>();
  const gradeSubjectDay = new Map<string, Set<number>>(); // "grade|subject" -> set of days

  // Track which co-taught sessions have been assigned (to skip them in main loop)
  const assignedCotaughtSessions = new Set<number>();

  // Initialize tracking
  sessions.forEach(s => {
    if (!teacherSlots.has(s.teacher)) teacherSlots.set(s.teacher, new Set());
    parseGrades(s.grade).forEach(g => {
      if (!gradeSlots.has(g)) gradeSlots.set(g, new Set());
    });
  });

  // Pre-fill grade slots from locked teachers
  if (prefilledGradeSlots) {
    for (const [grade, slots] of prefilledGradeSlots) {
      if (!gradeSlots.has(grade)) gradeSlots.set(grade, new Set());
      slots.forEach(slot => gradeSlots.get(grade)!.add(slot));
    }
  }

  // Sort sessions: fixed first, then by constraint level, deprioritized teachers last
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.isFixed && !b.isFixed) return -1;
    if (!a.isFixed && b.isFixed) return 1;
    // Deprioritized teachers go last (to force different solutions)
    const aDepri = deprioritizeTeachers?.has(a.teacher) ? 1 : 0;
    const bDepri = deprioritizeTeachers?.has(b.teacher) ? 1 : 0;
    if (aDepri !== bDepri) return aDepri - bDepri;
    return a.validSlots.length - b.validSlots.length;
  });

  function isValid(session: Session, slot: number): boolean {
    // Check teacher conflict - ALWAYS enforced (teacher can't be in two places)
    if (teacherSlots.get(session.teacher)?.has(slot)) return false;

    // Check grade conflicts - ALWAYS enforced (grade can't have two classes at once)
    const grades = parseGrades(session.grade);
    for (const g of grades) {
      if (gradeSlots.get(g)?.has(slot)) return false;
    }

    // Check subject/day conflict - CAN be toggled via rules
    // (same subject can't appear twice on same day for same grade)
    if (isRuleEnabled(rules, 'no_duplicate_subjects')) {
      const day = slotToDay(slot);
      for (const g of grades) {
        const key = `${g}|${session.subject}`;
        if (gradeSubjectDay.get(key)?.has(day)) return false;
      }
    }

    return true;
  }

  // Check if a slot is valid for an entire co-taught group (all teachers must be free)
  function isValidForCotaughtGroup(groupId: string, slot: number): boolean {
    const group = cotaughtGroups?.get(groupId);
    if (!group) return true;

    for (const session of group) {
      if (!isValid(session, slot)) return false;
    }
    return true;
  }

  // Get intersection of valid slots across a co-taught group
  function getCotaughtGroupValidSlots(groupId: string, baseSlots: number[]): number[] {
    const group = cotaughtGroups?.get(groupId);
    if (!group || group.length === 0) return baseSlots;

    // Find slots that are valid for ALL sessions in the group
    return baseSlots.filter(slot => {
      for (const session of group) {
        if (!session.validSlots.includes(slot)) return false;
      }
      return true;
    });
  }

  function assign(session: Session, slot: number): void {
    assignment.set(session.id, slot);
    teacherSlots.get(session.teacher)!.add(slot);

    const grades = parseGrades(session.grade);
    const day = slotToDay(slot);

    grades.forEach(g => {
      gradeSlots.get(g)!.add(slot);
      const key = `${g}|${session.subject}`;
      if (!gradeSubjectDay.has(key)) gradeSubjectDay.set(key, new Set());
      gradeSubjectDay.get(key)!.add(day);
    });
  }

  // Assign all sessions in a co-taught group to the same slot
  function assignCotaughtGroup(groupId: string, slot: number): void {
    const group = cotaughtGroups?.get(groupId);
    if (!group) return;

    for (const session of group) {
      assign(session, slot);
      assignedCotaughtSessions.add(session.id);
    }
  }

  function unassign(session: Session, slot: number): void {
    assignment.delete(session.id);
    teacherSlots.get(session.teacher)!.delete(slot);

    const grades = parseGrades(session.grade);
    const day = slotToDay(slot);

    grades.forEach(g => {
      gradeSlots.get(g)!.delete(slot);
      const key = `${g}|${session.subject}`;
      gradeSubjectDay.get(key)?.delete(day);
    });
  }

  // Unassign all sessions in a co-taught group
  function unassignCotaughtGroup(groupId: string, slot: number): void {
    const group = cotaughtGroups?.get(groupId);
    if (!group) return;

    for (const session of group) {
      unassign(session, slot);
      assignedCotaughtSessions.delete(session.id);
    }
  }

  function solve(idx: number): boolean | 'timeout' {
    // Check timeout and iteration limit
    iterations++;
    if (iterations > maxIterations || Date.now() - startTime > maxTimeMs) {
      return 'timeout';
    }

    if (idx === sortedSessions.length) return true;

    const session = sortedSessions[idx];

    // Skip if this session was already assigned as part of a co-taught group
    if (assignedCotaughtSessions.has(session.id)) {
      return solve(idx + 1);
    }

    // Check if this session is part of a co-taught group
    const cotaughtGroupId = session.cotaughtGroupId;
    const isCotaught = cotaughtGroupId && cotaughtGroups?.has(cotaughtGroupId);

    // Get valid slots - for co-taught, must work for ALL teachers in the group
    let slots: number[];
    if (isCotaught) {
      // Get intersection of valid slots and filter by validity for entire group
      slots = getCotaughtGroupValidSlots(cotaughtGroupId, session.validSlots)
        .filter(s => isValidForCotaughtGroup(cotaughtGroupId, s));
    } else {
      slots = session.validSlots.filter(s => isValid(session, s));
    }

    if (randomize) {
      slots = shuffle(slots);
    }

    for (const slot of slots) {
      if (isCotaught) {
        assignCotaughtGroup(cotaughtGroupId, slot);
      } else {
        assign(session, slot);
      }

      const result = solve(idx + 1);
      if (result === true) return true;
      if (result === 'timeout') return 'timeout';

      if (isCotaught) {
        unassignCotaughtGroup(cotaughtGroupId, slot);
      } else {
        unassign(session, slot);
      }
    }

    return false;
  }

  const result = solve(0);

  if (result === true) {
    return { assignment, status: 'Optimal' };
  }
  if (result === 'timeout') {
    return { assignment: null, status: 'Timeout' };
  }
  return { assignment: null, status: 'Infeasible' };
}

// ============================================================================
// SCHEDULE BUILDER
// ============================================================================

function buildSchedules(
  assignment: Map<number, number>,
  sessions: Session[],
  teachers: Teacher[],
  grades: string[]
): { teacherSchedules: Record<string, TeacherSchedule>; gradeSchedules: Record<string, GradeSchedule> } {
  const teacherSchedules: Record<string, TeacherSchedule> = {};
  const gradeSchedules: Record<string, GradeSchedule> = {};

  teachers.forEach(t => {
    teacherSchedules[t.name] = {};
    DAYS.forEach(day => {
      teacherSchedules[t.name][day] = {};
      BLOCKS.forEach(block => {
        teacherSchedules[t.name][day][block] = null;
      });
    });
  });

  // Use grades from database parameter
  grades.forEach(g => {
    gradeSchedules[g] = {};
    DAYS.forEach(day => {
      gradeSchedules[g][day] = {};
      BLOCKS.forEach(block => {
        gradeSchedules[g][day][block] = null;
      });
    });
  });

  sessions.forEach(s => {
    const slot = assignment.get(s.id);
    if (slot === undefined) return;

    const day = DAYS[slotToDay(slot)];
    const block = BLOCKS[slotToBlock(slot)];

    teacherSchedules[s.teacher][day][block] = [s.grade, s.subject];
    parseGrades(s.grade).forEach(g => {
      gradeSchedules[g][day][block] = [s.teacher, s.subject];
    });
  });

  return { teacherSchedules, gradeSchedules };
}

/**
 * Parse grade display name to individual grades using DATABASE grades (no hardcoding).
 *
 * @param gradeDisplay - The display name from a schedule entry (e.g., "6th Grade" or "6th-7th Grade")
 * @param databaseGrades - Set of grade names from the database
 * @returns Array of matching grade names from the database
 */
function parseGradesFromDatabase(gradeDisplay: string, databaseGrades: Set<string>): string[] {
  // Skip electives - they don't map to specific grades
  if (gradeDisplay.toLowerCase().includes('elective')) {
    return [];
  }

  const trimmed = gradeDisplay.trim();

  // 1. Direct match - most common case
  if (databaseGrades.has(trimmed)) {
    return [trimmed];
  }

  // 2. Try to parse as a grade range (e.g., "6th-7th Grade", "6th-11th")
  const rangeMatch = trimmed.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]);
    const end = parseInt(rangeMatch[2]);
    if (start > 0 && end > 0 && start <= end) {
      const matchedGrades: string[] = [];
      // Find database grades that match numbers in this range
      for (const dbGrade of databaseGrades) {
        const gradeNum = gradeToNumber(dbGrade);
        if (gradeNum >= start && gradeNum <= end) {
          matchedGrades.push(dbGrade);
        }
      }
      if (matchedGrades.length > 0) {
        return matchedGrades;
      }
    }
  }

  // 3. Try single grade number parsing and find matching database grade
  const singleMatch = trimmed.match(/(\d+)(?:st|nd|rd|th)/i);
  if (singleMatch) {
    const num = parseInt(singleMatch[1]);
    // Find database grade with this number
    for (const dbGrade of databaseGrades) {
      if (gradeToNumber(dbGrade) === num) {
        return [dbGrade];
      }
    }
  }

  // 4. Handle Kindergarten variations
  if (trimmed.toLowerCase().includes('kindergarten')) {
    for (const dbGrade of databaseGrades) {
      if (dbGrade.toLowerCase().includes('kindergarten')) {
        return [dbGrade];
      }
    }
  }

  // No match found
  return [];
}

/**
 * Rebuild grade schedules entirely from teacher schedules.
 * This is a destructive rebuild that ensures grade schedules always match
 * teacher schedules, avoiding any merge/sync issues.
 *
 * IMPORTANT: Uses database grades dynamically - NO hardcoded grade lists.
 */
function rebuildGradeSchedules(
  teacherSchedules: Record<string, TeacherSchedule>,
  grades: readonly string[] | string[]
): Record<string, GradeSchedule> {
  const gradeSchedules: Record<string, GradeSchedule> = {};
  const databaseGrades = new Set(grades);

  // Initialize empty schedules for all database grades
  for (const g of grades) {
    gradeSchedules[g] = {};
    for (const day of DAYS) {
      gradeSchedules[g][day] = {};
      for (const block of BLOCKS) {
        gradeSchedules[g][day][block] = null;
      }
    }
  }

  // Populate from teacher schedules
  for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
    for (const day of DAYS) {
      for (const block of BLOCKS) {
        const entry = schedule[day]?.[block];
        if (entry && entry[0] && entry[1] !== 'OPEN') {
          const gradeDisplay = entry[0];
          const subject = entry[1];

          // Parse grades using DATABASE grades (no hardcoding)
          const parsedGrades = parseGradesFromDatabase(gradeDisplay, databaseGrades);

          for (const g of parsedGrades) {
            // Initialize grade if somehow not in the list (safety)
            if (!gradeSchedules[g]) {
              gradeSchedules[g] = {};
              for (const d of DAYS) {
                gradeSchedules[g][d] = {};
                for (const b of BLOCKS) {
                  gradeSchedules[g][d][b] = null;
                }
              }
            }
            gradeSchedules[g][day][block] = [teacher, subject];
          }
        }
      }
    }
  }

  return gradeSchedules;
}

// ============================================================================
// POST-PROCESSING
// ============================================================================

function addStudyHalls(
  teacherSchedules: Record<string, TeacherSchedule>,
  gradeSchedules: Record<string, GradeSchedule>,
  eligibleTeachers: string[],
  options?: {
    requiredTeachers?: string[]; // Teachers who must be assigned study halls (had them before regen)
    alreadyCoveredGroups?: Set<string>; // Groups already covered by locked teachers
    existingGradeStudyHallDays?: Map<string, Set<string>>; // Days each grade already has study halls
    shuffleAssignments?: boolean; // Randomize teacher/slot order for variety
    seed?: number; // Seed for reproducible randomization
    rules?: SchedulingRule[]; // Scheduling rules (for study_hall_grades config)
  }
): StudyHallAssignment[] {
  const {
    requiredTeachers = [],
    alreadyCoveredGroups = new Set<string>(),
    existingGradeStudyHallDays = new Map<string, Set<string>>(),
    shuffleAssignments = false,
    seed,
    rules
  } = options || {};

  // Get configured study hall grades from rules
  const studyHallGrades = getStudyHallGrades(rules);

  // If no grades configured (or rule disabled), skip study hall assignment
  if (studyHallGrades.length === 0) {
    return [];
  }

  // Build groups to place based on configured grades
  const studyHallGroups = studyHallGrades.map(g => ({ name: g, grades: [g] }));

  // Create random function - seeded if seed provided, otherwise use Math.random
  const randomFn = seed !== undefined ? seededRandom(seed) : undefined;

  // Filter out groups already covered by locked teachers
  const coveredGrades = new Set<string>();
  alreadyCoveredGroups.forEach(groupName => {
    const group = studyHallGroups.find(g => g.name === groupName);
    if (group) {
      group.grades.forEach(g => coveredGrades.add(g));
    }
  });

  const groupsToPlace = studyHallGroups.filter(g =>
    !alreadyCoveredGroups.has(g.name) && !g.grades.some(grade => coveredGrades.has(grade))
  );

  if (eligibleTeachers.length === 0) {
    return groupsToPlace.map(g => ({
      group: g.name,
      teacher: null,
      day: null,
      block: null
    }));
  }

  const countTeaching = (teacher: string): number => {
    let count = 0;
    DAYS.forEach(day => {
      BLOCKS.forEach(block => {
        const entry = teacherSchedules[teacher]?.[day]?.[block];
        if (entry && entry[1] !== 'OPEN' && entry[1] !== 'Study Hall') {
          count++;
        }
      });
    });
    return count;
  };

  // Initialize with existing study hall days from locked teachers
  const gradeStudyHallDays = new Map<string, Set<string>>();
  studyHallGrades.forEach(g => {
    const existing = existingGradeStudyHallDays.get(g);
    gradeStudyHallDays.set(g, existing ? new Set(existing) : new Set());
  });

  const assignments: StudyHallAssignment[] = [];
  const assignedTeachers = new Set<string>(); // Track teachers who got a study hall
  const placedGrades = new Set<string>(); // Track which grades have study halls
  const failedGroups: { name: string; grades: string[] }[] = []; // Groups that couldn't be placed

  // Helper to try placing a specific group with a specific teacher
  function tryPlaceGroup(
    group: { name: string; grades: string[] },
    teachers: string[]
  ): boolean {
    // Optionally shuffle the order we try days and blocks
    const daysToTry = shuffleAssignments ? shuffle(DAYS, randomFn) : DAYS;
    const blocksToTry = shuffleAssignments ? shuffle(BLOCKS, randomFn) : BLOCKS;

    for (const teacher of teachers) {
      for (const day of daysToTry) {
        if (group.grades.some(g => gradeStudyHallDays.get(g)?.has(day))) continue;

        for (const block of blocksToTry) {
          if (teacherSchedules[teacher]?.[day]?.[block] !== null) continue;

          const allFree = group.grades.every(g =>
            gradeSchedules[g]?.[day]?.[block] === null
          );

          if (allFree) {
            teacherSchedules[teacher][day][block] = [group.name, 'Study Hall'];
            group.grades.forEach(g => {
              gradeSchedules[g][day][block] = [teacher, 'Study Hall'];
              gradeStudyHallDays.get(g)!.add(day);
              placedGrades.add(g);
            });
            assignments.push({ group: group.name, teacher, day, block });
            assignedTeachers.add(teacher);
            return true;
          }
        }
      }
    }
    return false;
  }

  // Sort teachers by teaching load (fewer classes = more availability)
  // When shuffling, use progressively more aggressive strategies based on attempt number
  // The shuffleAttempt is encoded in the seed: attempt = seed % 10
  let sortedTeachers = [...eligibleTeachers].sort((a, b) => countTeaching(a) - countTeaching(b));

  if (shuffleAssignments && randomFn && seed !== undefined) {
    const attempt = seed % 10;

    if (attempt < 3) {
      // Attempts 0-2: Normal load order, shuffle within groups
      const byLoad = new Map<number, string[]>();
      for (const t of sortedTeachers) {
        const load = countTeaching(t);
        if (!byLoad.has(load)) byLoad.set(load, []);
        byLoad.get(load)!.push(t);
      }
      sortedTeachers = [];
      const loads = [...byLoad.keys()].sort((a, b) => a - b);
      for (const load of loads) {
        sortedTeachers.push(...shuffle(byLoad.get(load)!, randomFn));
      }
    } else if (attempt < 5) {
      // Attempts 3-4: Reverse load order (more classes first)
      sortedTeachers = [...eligibleTeachers].sort((a, b) => countTeaching(b) - countTeaching(a));
      const byLoad = new Map<number, string[]>();
      for (const t of sortedTeachers) {
        const load = countTeaching(t);
        if (!byLoad.has(load)) byLoad.set(load, []);
        byLoad.get(load)!.push(t);
      }
      sortedTeachers = [];
      const loads = [...byLoad.keys()].sort((a, b) => b - a);
      for (const load of loads) {
        sortedTeachers.push(...shuffle(byLoad.get(load)!, randomFn));
      }
    } else if (attempt < 7) {
      // Attempts 5-6: Completely random order (ignores load)
      sortedTeachers = shuffle([...eligibleTeachers], randomFn);
    } else {
      // Attempts 7-9: Random order, but also shuffle groups order more aggressively
      sortedTeachers = shuffle([...eligibleTeachers], randomFn);
    }
  } else if (shuffleAssignments) {
    // Fallback: shuffle within load groups
    const byLoad = new Map<number, string[]>();
    for (const t of sortedTeachers) {
      const load = countTeaching(t);
      if (!byLoad.has(load)) byLoad.set(load, []);
      byLoad.get(load)!.push(t);
    }
    sortedTeachers = [];
    const loads = [...byLoad.keys()].sort((a, b) => a - b);
    for (const load of loads) {
      sortedTeachers.push(...shuffle(byLoad.get(load)!));
    }
  }

  // Phase 1: Ensure required teachers get study halls first
  const requiredSet = new Set(requiredTeachers);
  const requiredSorted = sortedTeachers.filter(t => requiredSet.has(t));

  for (const teacher of requiredSorted) {
    // Find any group this teacher can take
    const groupOrder = shuffleAssignments ? shuffle([...groupsToPlace], randomFn) : groupsToPlace;
    for (const group of groupOrder) {
      if (placedGrades.has(group.grades[0])) continue; // Already placed
      if (tryPlaceGroup(group, [teacher])) break;
    }
  }

  // Phase 2: Place remaining individual groups
  const groupOrder = shuffleAssignments ? shuffle([...groupsToPlace], randomFn) : groupsToPlace;
  for (const group of groupOrder) {
    if (group.grades.some(g => placedGrades.has(g))) continue; // Already placed

    if (!tryPlaceGroup(group, sortedTeachers)) {
      failedGroups.push(group);
    }
  }

  // Add failed assignments
  for (const group of failedGroups) {
    assignments.push({ group: group.name, teacher: null, day: null, block: null });
  }

  return assignments;
}

function fillOpenBlocks(teacherSchedules: Record<string, TeacherSchedule>): void {
  Object.keys(teacherSchedules).forEach(teacher => {
    DAYS.forEach(day => {
      BLOCKS.forEach(block => {
        if (teacherSchedules[teacher][day][block] === null) {
          teacherSchedules[teacher][day][block] = ['', 'OPEN'];
        }
      });
    });
  });
}

function countBackToBack(teacherSchedules: Record<string, TeacherSchedule>, teacher: string): number {
  let count = 0;
  DAYS.forEach(day => {
    let prevOpen = false;
    BLOCKS.forEach(block => {
      const entry = teacherSchedules[teacher]?.[day]?.[block];
      const currOpen = !entry || entry[1] === 'OPEN' || entry[1] === 'Study Hall';
      if (prevOpen && currOpen) count++;
      prevOpen = currOpen;
    });
  });
  return count;
}

/**
 * Count days with multiple OPEN blocks for a teacher (spread_open metric).
 * Returns the number of "extra" OPEN blocks per day beyond the first.
 * E.g., if a teacher has 3 OPEN blocks on Monday, that's 2 issues (3-1=2).
 */
function countSameDayOpen(teacherSchedules: Record<string, TeacherSchedule>, teacher: string): number {
  let count = 0;
  DAYS.forEach(day => {
    let openCount = 0;
    BLOCKS.forEach(block => {
      const entry = teacherSchedules[teacher]?.[day]?.[block];
      if (!entry || entry[1] === 'OPEN' || entry[1] === 'Study Hall') {
        openCount++;
      }
    });
    // Penalize having more than 1 OPEN block per day
    if (openCount > 1) {
      count += openCount - 1;
    }
  });
  return count;
}

function redistributeOpenBlocks(
  teacherSchedules: Record<string, TeacherSchedule>,
  gradeSchedules: Record<string, GradeSchedule>,
  fullTimeTeachers: string[]
): void {
  const getBackToBackSlots = (teacher: string) => {
    const pairs: { day: string; block: number }[] = [];
    DAYS.forEach(day => {
      for (let i = 0; i < BLOCKS.length - 1; i++) {
        const entry1 = teacherSchedules[teacher][day][BLOCKS[i]];
        const entry2 = teacherSchedules[teacher][day][BLOCKS[i + 1]];
        const isOpen1 = !entry1 || entry1[1] === 'OPEN' || entry1[1] === 'Study Hall';
        const isOpen2 = !entry2 || entry2[1] === 'OPEN' || entry2[1] === 'Study Hall';
        if (isOpen1 && isOpen2) {
          pairs.push({ day, block: BLOCKS[i + 1] });
        }
      }
    });
    return pairs;
  };

  const wouldCreateBTB = (teacher: string, day: string, block: number): boolean => {
    const blockIdx = BLOCKS.indexOf(block);
    if (blockIdx > 0) {
      const prev = teacherSchedules[teacher][day][BLOCKS[blockIdx - 1]];
      if (!prev || prev[1] === 'OPEN' || prev[1] === 'Study Hall') return true;
    }
    if (blockIdx < 4) {
      const next = teacherSchedules[teacher][day][BLOCKS[blockIdx + 1]];
      if (!next || next[1] === 'OPEN' || next[1] === 'Study Hall') return true;
    }
    return false;
  };

  for (let iter = 0; iter < 2000; iter++) {
    let madeSwap = false;

    for (const teacher of fullTimeTeachers) {
      const btbSlots = getBackToBackSlots(teacher);
      if (btbSlots.length === 0) continue;

      for (const { day: issueDay, block: issueBlock } of btbSlots) {
        if (madeSwap) break;

        for (const targetDay of DAYS) {
          if (madeSwap) break;

          for (const targetBlock of BLOCKS) {
            const entry = teacherSchedules[teacher][targetDay][targetBlock];
            if (!entry || entry[1] === 'OPEN' || entry[1] === 'Study Hall' || !entry[0]) {
              continue;
            }

            if (wouldCreateBTB(teacher, targetDay, targetBlock)) continue;

            const [gradeDisplay, subject] = entry;
            const grades = parseGrades(gradeDisplay);
            if (grades.length === 0) continue;

            // Check conflicts
            let hasConflict = false;
            for (const g of grades) {
              const slot = gradeSchedules[g]?.[issueDay]?.[issueBlock];
              if (slot && slot[1] !== 'OPEN' && slot[1] !== null) {
                hasConflict = true;
                break;
              }
            }
            if (hasConflict) continue;

            // Check subject/day conflict
            for (const g of grades) {
              for (const b of BLOCKS) {
                if (b === issueBlock) continue;
                const slot = gradeSchedules[g]?.[issueDay]?.[b];
                if (slot && slot[1] === subject) {
                  hasConflict = true;
                  break;
                }
              }
              if (hasConflict) break;
            }
            if (hasConflict) continue;

            // Perform swap
            teacherSchedules[teacher][issueDay][issueBlock] = [gradeDisplay, subject];
            teacherSchedules[teacher][targetDay][targetBlock] = ['', 'OPEN'];

            grades.forEach(g => {
              gradeSchedules[g][targetDay][targetBlock] = null;
              gradeSchedules[g][issueDay][issueBlock] = [teacher, subject];
            });

            madeSwap = true;
            break;
          }
        }
        if (madeSwap) break;
      }
      if (madeSwap) break;
    }

    if (!madeSwap) break;
  }
}

function calculateStats(
  teacherSchedules: Record<string, TeacherSchedule>,
  teachers: Teacher[],
  fullTimeTeachers: string[]
): TeacherStat[] {
  const fullTimeSet = new Set(fullTimeTeachers);

  return teachers.map(t => {
    let teaching = 0, studyHall = 0, open = 0;

    DAYS.forEach(day => {
      BLOCKS.forEach(block => {
        const entry = teacherSchedules[t.name]?.[day]?.[block];
        if (!entry || entry[1] === 'OPEN') {
          open++;
        } else if (entry[1] === 'Study Hall') {
          studyHall++;
        } else {
          teaching++;
        }
      });
    });

    return {
      teacher: t.name,
      status: t.status,
      teaching,
      studyHall,
      open,
      totalUsed: teaching + studyHall,
      backToBackIssues: fullTimeSet.has(t.name) ? countBackToBack(teacherSchedules, t.name) : 0,
    };
  }).sort((a, b) => b.totalUsed - a.totalUsed);
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export interface SchedulingRule {
  rule_key: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface GeneratorOptions {
  numOptions?: number;
  numAttempts?: number;
  timeoutPerAttempt?: number;
  onProgress?: (current: number, total: number, message: string) => void;
  /** Locked teacher schedules - these won't be changed */
  lockedTeachers?: Record<string, TeacherSchedule>;
  /** Teachers who must be assigned study halls (had them in original schedule) */
  teachersNeedingStudyHalls?: string[];
  /** Scheduling rules from database - controls which constraints are enforced */
  rules?: SchedulingRule[];
  /** Seed for reproducible randomization */
  seed?: number;
  /** If true, reassign all study halls; if false, preserve locked teacher study halls */
  allowStudyHallReassignment?: boolean;
  /** All grade names from database - used for grade schedule initialization */
  grades?: string[];
}

export interface GeneratorResult {
  options: ScheduleOption[];
  status: 'success' | 'infeasible' | 'error';
  message?: string;
}

// Helper to check if a rule is enabled (defaults to true if rules not provided or rule not found)
function isRuleEnabled(rules: SchedulingRule[] | undefined, ruleKey: string): boolean {
  if (!rules) return true; // Default to enabled if no rules provided
  const rule = rules.find(r => r.rule_key === ruleKey);
  return rule ? rule.enabled : true; // Default to enabled if rule not found
}

// Helper to get rule config
function getRuleConfig(rules: SchedulingRule[] | undefined, ruleKey: string): Record<string, unknown> | undefined {
  if (!rules) return undefined;
  const rule = rules.find(r => r.rule_key === ruleKey);
  return rule?.config;
}

/**
 * Get the list of grades that should have study halls assigned.
 * Reads from study_hall_grades rule config. Returns empty if not configured.
 * All study hall grades must be explicitly configured in the database.
 */
function getStudyHallGrades(rules: SchedulingRule[] | undefined): string[] {
  if (!isRuleEnabled(rules, 'study_hall_grades')) {
    return [];
  }

  const config = getRuleConfig(rules, 'study_hall_grades');
  const grades = config?.grades as string[] | undefined;

  // Return configured grades (no hardcoded defaults)
  return grades && grades.length > 0 ? [...grades] : [];
}

/**
 * Get the set of teacher statuses eligible for study hall supervision.
 * Reads from study_hall_teacher_eligibility rule config.
 * Default is 'full-time' only.
 */
function getStudyHallEligibleStatuses(rules: SchedulingRule[] | undefined): Set<string> {
  if (!isRuleEnabled(rules, 'study_hall_teacher_eligibility')) {
    return new Set(['full-time']); // Default to full-time only
  }

  const config = getRuleConfig(rules, 'study_hall_teacher_eligibility');

  const statuses = new Set<string>();
  // Default allow_full_time to true, allow_part_time to false
  if (config?.allow_full_time !== false) {
    statuses.add('full-time');
  }
  if (config?.allow_part_time === true) {
    statuses.add('part-time');
  }

  // If somehow both are unchecked, default to full-time
  if (statuses.size === 0) {
    statuses.add('full-time');
  }

  return statuses;
}

export async function generateSchedules(
  teachers: Teacher[],
  classes: ClassEntry[],
  options: GeneratorOptions = {}
): Promise<GeneratorResult> {
  const {
    numOptions = 3,
    numAttempts = 50,
    onProgress,
    lockedTeachers = {},
    teachersNeedingStudyHalls = [],
    rules = [],
    seed,
    allowStudyHallReassignment = false,
    grades: inputGrades,
  } = options;

  // Use grades from database (no hardcoded fallback)
  const grades = inputGrades && inputGrades.length > 0 ? inputGrades : [];
  if (grades.length === 0) {
    return {
      options: [],
      status: 'error' as const,
      message: 'No grades provided. Grades must be configured in the database.',
    };
  }

  const lockedTeacherNames = new Set(Object.keys(lockedTeachers));
  const isRefinementMode = lockedTeacherNames.size > 0;

  // Filter out classes for locked teachers
  const classesToSchedule = isRefinementMode
    ? classes.filter(c => !lockedTeacherNames.has(c.teacher))
    : classes;

  // Filter teachers to only include unlocked ones for scheduling
  const teachersToSchedule = isRefinementMode
    ? teachers.filter(t => !lockedTeacherNames.has(t.name))
    : teachers;

  const fullTime = teachers.filter(t => t.status === 'full-time').map(t => t.name);
  const fullTimeUnlocked = fullTime.filter(t => !lockedTeacherNames.has(t));

  // Study hall eligible teachers - only unlocked ones
  // Also include teachers who had study halls before (they were already deemed eligible)
  const baseEligible = getStudyHallEligible(teachers, rules)
    .filter(t => !lockedTeacherNames.has(t));

  // Teachers who had study halls before regeneration are automatically eligible
  const eligible = [...new Set([...baseEligible, ...teachersNeedingStudyHalls])];

  const sessions = buildSessions(classesToSchedule);

  // Identify co-taught classes (same grade+subject, different teachers)
  // These must be scheduled at the same time slot
  const cotaughtGroups = assignCotaughtGroups(sessions);

  // Pre-compute locked grade slots (slots occupied by locked teachers' classes)
  const lockedGradeSlots = new Map<string, Set<number>>();
  const databaseGrades = new Set(grades);
  grades.forEach(g => lockedGradeSlots.set(g, new Set()));

  if (isRefinementMode) {
    for (const [, schedule] of Object.entries(lockedTeachers)) {
      DAYS.forEach((day, dayIdx) => {
        BLOCKS.forEach((block, blockIdx) => {
          const entry = schedule[day]?.[block];
          if (entry && entry[0] && entry[1] !== 'OPEN' && entry[1] !== 'Study Hall') {
            const slot = dayBlockToSlot(dayIdx, blockIdx);
            const parsedGrades = parseGradesFromDatabase(entry[0], databaseGrades);
            parsedGrades.forEach(g => lockedGradeSlots.get(g)?.add(slot));
          }
        });
      });
    }
  }

  onProgress?.(0, numAttempts, 'Initializing solver...');
  await new Promise(resolve => setTimeout(resolve, 10));

  const candidates: {
    attempt: number;
    score: number;
    btb: number;
    shPlaced: number;
    teacherSchedules: Record<string, TeacherSchedule>;
    gradeSchedules: Record<string, GradeSchedule>;
    shAssignments: StudyHallAssignment[];
  }[] = [];

  let infeasibleCount = 0;
  let timeoutCount = 0;
  let successCount = 0;
  const startTime = Date.now();

  // Track teachers from unique solutions to force diversity in subsequent attempts
  const foundSolutionTeachers: Set<string>[] = [];

  for (let attempt = 0; attempt < numAttempts; attempt++) {
    onProgress?.(attempt + 1, numAttempts, `Attempt ${attempt + 1}/${numAttempts} (${successCount} found)...`);

    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 5));

    // Build deprioritize set from previously found unique solutions
    // This forces the solver to explore different regions of the solution space
    const deprioritize = new Set<string>();
    if (foundSolutionTeachers.length > 0) {
      // Pick teachers from a random previous solution to deprioritize
      const prevSolution = foundSolutionTeachers[attempt % foundSolutionTeachers.length];
      // Randomly select ~30% of those teachers to push to the end
      const teacherArray = Array.from(prevSolution);
      const numToDepri = Math.max(2, Math.floor(teacherArray.length * 0.3));
      shuffle(teacherArray).slice(0, numToDepri).forEach(t => deprioritize.add(t));
    }

    // Use backtracking solver with randomization for variety
    const result = solveBacktracking(
      sessions,
      attempt > 0,
      isRefinementMode ? lockedGradeSlots : undefined,
      5000, // 5 second timeout
      deprioritize.size > 0 ? deprioritize : undefined,
      rules,
      cotaughtGroups.size > 0 ? cotaughtGroups : undefined
    );

    if (!result.assignment) {
      if (result.status === 'Timeout') {
        timeoutCount++;
      } else {
        infeasibleCount++;
      }
      continue;
    }

    successCount++;

    const { teacherSchedules, gradeSchedules } = buildSchedules(result.assignment, sessions, teachers, grades);

    // Deep copy for processing
    const ts = JSON.parse(JSON.stringify(teacherSchedules));
    const gs = JSON.parse(JSON.stringify(gradeSchedules));

    // Merge locked teacher schedules back in (including study halls unless allowStudyHallReassignment is true)
    const lockedStudyHallAssignments: StudyHallAssignment[] = [];
    const alreadyCoveredGroups = new Set<string>();
    const existingGradeStudyHallDays = new Map<string, Set<string>>();
    grades.forEach(g => existingGradeStudyHallDays.set(g, new Set()));

    if (isRefinementMode) {
      for (const [teacher, schedule] of Object.entries(lockedTeachers)) {
        ts[teacher] = JSON.parse(JSON.stringify(schedule));
        // Update grade schedules with ALL locked assignments (including study halls)
        DAYS.forEach(day => {
          BLOCKS.forEach(block => {
            const entry = schedule[day]?.[block];
            if (entry && entry[0] && entry[1] !== 'OPEN') {
              if (entry[1] === 'Study Hall') {
                // When allowStudyHallReassignment is true, skip preserving locked study halls
                // This allows study halls to be reassigned to any eligible teacher
                if (!allowStudyHallReassignment) {
                  // Track locked study hall assignments
                  lockedStudyHallAssignments.push({
                    group: entry[0],
                    teacher,
                    day,
                    block: BLOCKS[BLOCKS.indexOf(block)]
                  });
                  // Mark this group as already covered
                  alreadyCoveredGroups.add(entry[0]);
                  // Update grade schedules for study hall grades (use database grades)
                  const shGrades = parseGradesFromDatabase(entry[0], databaseGrades);
                  shGrades.forEach(g => {
                    if (gs[g]) {
                      gs[g][day][block] = [teacher, 'Study Hall'];
                      // Track that this grade has a study hall on this day
                      existingGradeStudyHallDays.get(g)?.add(day);
                    }
                  });
                }
                // When allowStudyHallReassignment is true, the study hall slot becomes available
                // (we don't merge it into grade schedules, allowing it to be reassigned)
              } else {
                // Regular class - always update grade schedules (use database grades)
                const parsedGrades = parseGradesFromDatabase(entry[0], databaseGrades);
                parsedGrades.forEach(g => {
                  // Initialize grade if it doesn't exist (needed for grades only taught by locked teachers)
                  if (!gs[g]) {
                    gs[g] = {};
                    DAYS.forEach(d => {
                      gs[g][d] = {};
                      BLOCKS.forEach(b => {
                        gs[g][d][b] = null;
                      });
                    });
                  }
                  gs[g][day][block] = [teacher, entry[1]];
                });
              }
            }
          });
        });
      }
    }

    // Add study halls only if study_hall_distribution rule is enabled
    let shAssignments: StudyHallAssignment[];
    let shPlaced: number;

    if (isRuleEnabled(rules, 'study_hall_distribution')) {
      // Teachers who need study halls: those specified by the caller (had them before regen)
      // Filter to only include eligible teachers who are being regenerated (not locked)
      const requiredStudyHallTeachers = teachersNeedingStudyHalls.filter(t =>
        eligible.includes(t) && !lockedTeacherNames.has(t)
      );

      const newShAssignments = addStudyHalls(ts, gs, eligible, {
        requiredTeachers: requiredStudyHallTeachers,
        alreadyCoveredGroups,
        existingGradeStudyHallDays,
        rules,
      });

      // Combine locked and new study hall assignments
      shAssignments = [...lockedStudyHallAssignments, ...newShAssignments];
      shPlaced = shAssignments.filter(sh => sh.teacher !== null).length;
    } else {
      shAssignments = [];
      shPlaced = 0;
    }

    fillOpenBlocks(ts);
    // Only redistribute open blocks if the no_btb_open rule is enabled
    if (isRuleEnabled(rules, 'no_btb_open')) {
      redistributeOpenBlocks(ts, gs, fullTimeUnlocked);
    }

    // CRITICAL: Rebuild grade schedules from teacher schedules to ensure consistency.
    // This is a destructive rebuild that ensures gradeSchedules always match teacherSchedules,
    // avoiding any sync issues from the merge logic above.
    const rebuiltGs = rebuildGradeSchedules(ts, grades);

    // Only count back-to-back issues if the rule is enabled
    const totalBtb = isRuleEnabled(rules, 'no_btb_open')
      ? fullTime.reduce((sum, t) => sum + countBackToBack(ts, t), 0)
      : 0;

    // Count spread_open issues (multiple OPEN on same day) if rule is enabled
    const totalSpread = isRuleEnabled(rules, 'spread_open')
      ? fullTime.reduce((sum, t) => sum + countSameDayOpen(ts, t), 0)
      : 0;

    // Score: missing study halls (heavily penalized) + BTB issues + spread issues
    const score = (5 - shPlaced) * 100 + totalBtb + totalSpread;

    const candidate = {
      attempt,
      score,
      btb: totalBtb,
      shPlaced,
      teacherSchedules: ts,
      gradeSchedules: rebuiltGs,
      shAssignments,
    };

    // Check if this is unique compared to candidates we already have
    // (Do this during the loop so we can track for diversity)
    const isDifferentEnough = !candidates.some(existing => {
      let diffCount = 0;
      for (const teacher of Object.keys(ts)) {
        if (JSON.stringify(ts[teacher]) !== JSON.stringify(existing.teacherSchedules[teacher])) {
          diffCount++;
          if (diffCount >= 2) return false; // Different enough
        }
      }
      return true; // Too similar
    });

    candidates.push(candidate);

    if (isDifferentEnough) {
      // Track teachers from this unique solution for diversity forcing
      foundSolutionTeachers.push(new Set(Object.keys(ts)));

      // Early exit if we have enough diverse solutions
      if (foundSolutionTeachers.length >= numOptions) {
        onProgress?.(numAttempts, numAttempts, `Found ${foundSolutionTeachers.length} diverse options`);
        break;
      }
    }
  }

  // Sort by score and pick the best unique options
  candidates.sort((a, b) => a.score - b.score);

  // Helper to check if two schedules are too similar (fewer than 2 teachers differ)
  function areTooSimilar(
    schedA: Record<string, TeacherSchedule>,
    schedB: Record<string, TeacherSchedule>
  ): boolean {
    let diffCount = 0;
    for (const teacher of Object.keys(schedA)) {
      if (JSON.stringify(schedA[teacher]) !== JSON.stringify(schedB[teacher])) {
        diffCount++;
        if (diffCount >= 2) return false; // Different enough
      }
    }
    return true; // Too similar (0 or 1 teacher differs)
  }

  const unique: typeof candidates = [];

  for (const c of candidates) {
    // Check if this candidate is too similar to any already-selected option
    const tooSimilar = unique.some(existing => areTooSimilar(c.teacherSchedules, existing.teacherSchedules));

    if (!tooSimilar) {
      unique.push(c);
      if (unique.length >= numOptions) break;
    }
  }

  const totalTime = Date.now() - startTime;
  if (unique.length === 0) {
    console.log(`[Scheduler] Failed after ${totalTime}ms - ${successCount} solutions found, ${timeoutCount} timeouts, ${infeasibleCount} infeasible`);
  }

  // Determine result status
  if (unique.length === 0) {
    if (sessions.length === 0) {
      return {
        options: [],
        status: 'error',
        message: 'No classes to schedule. If in refinement mode, try unlocking more teachers.',
      };
    }

    const lockedSlotCount = Array.from(lockedGradeSlots.values()).reduce((sum, set) => sum + set.size, 0);

    if (timeoutCount > 0 && infeasibleCount === 0) {
      // All attempts timed out - constraints are very tight
      const message = isRefinementMode
        ? `Search timed out - constraints are very tight. Try unlocking more teachers to give the solver more flexibility. (${lockedTeacherNames.size} locked, ${lockedSlotCount} grade-slots blocked)`
        : 'Search timed out. The constraints may be too tight. Try relaxing some restrictions.';
      return {
        options: [],
        status: 'infeasible',
        message,
      };
    }

    if (infeasibleCount > 0) {
      const message = isRefinementMode
        ? `Could not fit the unlocked teachers' classes around the locked schedules. Try unlocking more teachers or locking fewer. (${lockedTeacherNames.size} teachers locked, ${classesToSchedule.length} classes to schedule, ${lockedSlotCount} grade-slots blocked)`
        : 'The current class constraints are impossible to satisfy. Check for conflicts like: a teacher assigned to too many classes, a grade with overlapping subjects, or restrictions that leave no valid slots.';

      return {
        options: [],
        status: 'infeasible',
        message,
      };
    }
    return {
      options: [],
      status: 'error',
      message: 'Could not generate a schedule. Please try again or adjust constraints.',
    };
  }

  return {
    options: unique.map((c, i) => ({
      optionNumber: i + 1,
      seed: c.attempt,
      backToBackIssues: c.btb,
      studyHallsPlaced: c.shPlaced,
      teacherSchedules: c.teacherSchedules,
      gradeSchedules: c.gradeSchedules,
      studyHallAssignments: c.shAssignments,
      teacherStats: calculateStats(c.teacherSchedules, teachers, fullTime),
    })),
    status: 'success',
  };
}

/**
 * Reassign all study halls for an existing schedule option.
 * Clears existing study halls and attempts to place them fresh.
 */
export function reassignStudyHalls(
  option: ScheduleOption,
  teachers: Teacher[],
  seed?: number,
  rules?: SchedulingRule[]
): { success: boolean; newOption?: ScheduleOption; message?: string; noChanges?: boolean } {
  // Track old study hall assignments for comparison
  const oldAssignments = new Set<string>();
  if (option.studyHallAssignments) {
    for (const sh of option.studyHallAssignments) {
      if (sh.teacher && sh.day && sh.block) {
        oldAssignments.add(`${sh.group}|${sh.teacher}|${sh.day}|${sh.block}`);
      }
    }
  }

  // Get eligible teachers
  const eligible = getStudyHallEligible(teachers, rules);

  if (eligible.length === 0) {
    return {
      success: false,
      message: 'No eligible teachers for study hall supervision',
    };
  }

  // Check if study hall grades are configured
  const studyHallGrades = getStudyHallGrades(rules);
  if (studyHallGrades.length === 0) {
    return {
      success: false,
      message: 'No study hall grades configured',
    };
  }

  // Try multiple seeds to find a different arrangement
  const maxAttempts = 10;
  const baseSeed = seed ?? Math.floor(Math.random() * 2147483647);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const currentSeed = baseSeed + attempt;

    // Deep copy the schedules for each attempt
    const teacherSchedules: Record<string, TeacherSchedule> = JSON.parse(JSON.stringify(option.teacherSchedules));
    const gradeSchedules: Record<string, GradeSchedule> = JSON.parse(JSON.stringify(option.gradeSchedules));

    // Clear all existing study halls and OPEN blocks from teacher schedules
    for (const teacher of Object.keys(teacherSchedules)) {
      for (const day of DAYS) {
        for (const block of BLOCKS) {
          const entry = teacherSchedules[teacher]?.[day]?.[block];
          if (entry && (entry[1] === 'Study Hall' || entry[1] === 'OPEN')) {
            teacherSchedules[teacher][day][block] = null;
          }
        }
      }
    }

    // Clear study halls from grade schedules
    for (const grade of Object.keys(gradeSchedules)) {
      for (const day of DAYS) {
        for (const block of BLOCKS) {
          const entry = gradeSchedules[grade]?.[day]?.[block];
          if (entry && entry[1] === 'Study Hall') {
            gradeSchedules[grade][day][block] = null;
          }
        }
      }
    }

    // Reassign study halls with shuffling
    const shAssignments = addStudyHalls(teacherSchedules, gradeSchedules, eligible, {
      shuffleAssignments: true,
      seed: currentSeed,
      rules,
    });
    const shPlaced = shAssignments.filter(sh => sh.teacher !== null).length;
    const shTotal = shAssignments.length;

    if (shPlaced === 0) {
      continue; // Try next seed
    }

    if (shPlaced < shTotal) {
      continue; // Try next seed for better result
    }

    // Fill any remaining null slots with OPEN
    for (const teacher of Object.keys(teacherSchedules)) {
      for (const day of DAYS) {
        for (const block of BLOCKS) {
          if (teacherSchedules[teacher][day][block] === null) {
            teacherSchedules[teacher][day][block] = ['', 'OPEN'];
          }
        }
      }
    }

    // Check if assignments changed
    const newAssignments = new Set<string>();
    for (const sh of shAssignments) {
      if (sh.teacher && sh.day && sh.block) {
        newAssignments.add(`${sh.group}|${sh.teacher}|${sh.day}|${sh.block}`);
      }
    }

    const assignmentsChanged = oldAssignments.size !== newAssignments.size ||
      [...oldAssignments].some(a => !newAssignments.has(a));

    if (!assignmentsChanged && attempt < maxAttempts - 1) {
      continue; // Try next seed
    }

    if (!assignmentsChanged) {
      return {
        success: true,
        noChanges: true,
        message: 'Study hall assignments unchanged (tried multiple arrangements)',
      };
    }

    // Calculate stats
    const fullTime = teachers.filter(t => t.status === 'full-time').map(t => t.name);
    const totalBtb = fullTime.reduce((sum, t) => sum + countBackToBack(teacherSchedules, t), 0);

    const newOption: ScheduleOption = {
      optionNumber: option.optionNumber,
      seed: option.seed,
      backToBackIssues: totalBtb,
      studyHallsPlaced: shPlaced,
      teacherSchedules,
      gradeSchedules,
      studyHallAssignments: shAssignments,
      teacherStats: calculateStats(teacherSchedules, teachers, fullTime),
    };

    return {
      success: true,
      newOption,
    };
  }

  // All attempts failed
  return {
    success: false,
    message: 'Could not find a valid study hall arrangement',
  };
}
