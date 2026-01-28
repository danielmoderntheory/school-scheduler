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

export const ALL_GRADES = [
  'Kindergarten', '1st Grade', '2nd Grade', '3rd Grade', '4th Grade', '5th Grade',
  '6th Grade', '7th Grade', '8th Grade', '9th Grade', '10th Grade', '11th Grade'
];

const GRADE_MAP: Record<string, string[]> = {
  'Kindergarten': ['Kindergarten'],
  'Kingergarten': ['Kindergarten'],
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
  '6th-7th Grade': ['6th Grade', '7th Grade'],
  '10th-11th Grade': ['10th Grade', '11th Grade'],
};

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

const UPPER_GRADES = new Set([
  '6th Grade', '7th Grade', '8th Grade', '9th Grade', '10th Grade', '11th Grade'
]);

// Study hall groups - try individual grades first, then combine if needed
const STUDY_HALL_GROUPS = [
  { name: '6th Grade', grades: ['6th Grade'] },
  { name: '7th Grade', grades: ['7th Grade'] },
  { name: '8th Grade', grades: ['8th Grade'] },
  { name: '9th Grade', grades: ['9th Grade'] },
  { name: '10th Grade', grades: ['10th Grade'] },
  { name: '11th Grade', grades: ['11th Grade'] },
];

// Groups that can be combined if individual placement fails
const COMBINABLE_STUDY_HALL_GROUPS = [
  { name: '6th-7th Grade', grades: ['6th Grade', '7th Grade'], replaces: ['6th Grade', '7th Grade'] },
  { name: '10th-11th Grade', grades: ['10th Grade', '11th Grade'], replaces: ['10th Grade', '11th Grade'] },
];

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

function parseGrades(gradeField: string): string[] {
  // Electives don't block specific grades
  if (gradeField.includes('Elective')) return [];

  const trimmed = gradeField.trim();

  // Check if it's in the hardcoded map first
  if (GRADE_MAP[trimmed]) {
    return GRADE_MAP[trimmed];
  }

  // Try to parse dynamic grade ranges like "6th-8th Grade" or "6th-11th"
  const rangeMatch = trimmed.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]);
    const end = parseInt(rangeMatch[2]);
    if (start > 0 && end > 0 && start <= end && end <= 11) {
      const grades: string[] = [];
      for (let i = start; i <= end; i++) {
        grades.push(numberToGrade(i));
      }
      return grades;
    }
  }

  // Try single grade parsing
  if (trimmed.toLowerCase().includes('kindergarten')) {
    return ['Kindergarten'];
  }

  const singleMatch = trimmed.match(/^(\d+)(?:st|nd|rd|th)\s*Grade/i);
  if (singleMatch) {
    const num = parseInt(singleMatch[1]);
    if (num >= 1 && num <= 11) {
      return [numberToGrade(num)];
    }
  }

  return [];
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

function getStudyHallEligible(teachers: Teacher[]): string[] {
  // Eligible = full-time teachers who are not excluded
  // canSuperviseStudyHall: true = eligible, false = excluded, undefined = eligible
  return teachers
    .filter(t => t.status === 'full-time' && t.canSuperviseStudyHall !== false)
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
  deprioritizeTeachers?: Set<string> // Teachers to schedule last (for diversity)
): SolveResult {
  const assignment = new Map<number, number>();
  const startTime = Date.now();
  let iterations = 0;
  const maxIterations = 100000; // Safety limit

  // Track constraints
  const teacherSlots = new Map<string, Set<number>>();
  const gradeSlots = new Map<string, Set<number>>();
  const gradeSubjectDay = new Map<string, Set<number>>(); // "grade|subject" -> set of days

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
    // Check teacher conflict
    if (teacherSlots.get(session.teacher)?.has(slot)) return false;

    // Check grade conflicts
    const grades = parseGrades(session.grade);
    for (const g of grades) {
      if (gradeSlots.get(g)?.has(slot)) return false;
    }

    // Check subject/day conflict (same subject can't appear twice on same day for same grade)
    const day = slotToDay(slot);
    for (const g of grades) {
      const key = `${g}|${session.subject}`;
      if (gradeSubjectDay.get(key)?.has(day)) return false;
    }

    return true;
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

  function solve(idx: number): boolean | 'timeout' {
    // Check timeout and iteration limit
    iterations++;
    if (iterations > maxIterations || Date.now() - startTime > maxTimeMs) {
      return 'timeout';
    }

    if (idx === sortedSessions.length) return true;

    const session = sortedSessions[idx];
    let slots = session.validSlots.filter(s => isValid(session, s));

    if (randomize) {
      slots = shuffle(slots);
    }

    for (const slot of slots) {
      assign(session, slot);
      const result = solve(idx + 1);
      if (result === true) return true;
      if (result === 'timeout') return 'timeout';
      unassign(session, slot);
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
  teachers: Teacher[]
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

  ALL_GRADES.forEach(g => {
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
  }
): StudyHallAssignment[] {
  const {
    requiredTeachers = [],
    alreadyCoveredGroups = new Set<string>(),
    existingGradeStudyHallDays = new Map<string, Set<string>>(),
    shuffleAssignments = false,
    seed
  } = options || {};

  // Create random function - seeded if seed provided, otherwise use Math.random
  const randomFn = seed !== undefined ? seededRandom(seed) : undefined;

  // Filter out groups already covered by locked teachers
  // Also check for combined groups (e.g., if "6th-7th Grade" is covered, skip both "6th Grade" and "7th Grade")
  const coveredGrades = new Set<string>();
  alreadyCoveredGroups.forEach(groupName => {
    const group = STUDY_HALL_GROUPS.find(g => g.name === groupName);
    if (group) {
      group.grades.forEach(g => coveredGrades.add(g));
    }
    // Also check combined groups
    const combined = COMBINABLE_STUDY_HALL_GROUPS.find(g => g.name === groupName);
    if (combined) {
      combined.grades.forEach(g => coveredGrades.add(g));
    }
  });

  const groupsToPlace = STUDY_HALL_GROUPS.filter(g =>
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
  ALL_GRADES.forEach(g => {
    const existing = existingGradeStudyHallDays.get(g);
    gradeStudyHallDays.set(g, existing ? new Set(existing) : new Set());
  });

  const assignments: StudyHallAssignment[] = [];
  const assignedTeachers = new Set<string>(); // Track teachers who got a study hall
  const placedGrades = new Set<string>(); // Track which grades have study halls
  const failedGroups: typeof STUDY_HALL_GROUPS = []; // Groups that couldn't be placed

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

  // Phase 3: For failed groups, try combining (6th+7th, 10th+11th)
  for (const combined of COMBINABLE_STUDY_HALL_GROUPS) {
    // Check if both grades in this combined group failed
    const bothFailed = combined.replaces.every(gradeName =>
      failedGroups.some(g => g.name === gradeName)
    );

    if (bothFailed) {
      // Try placing the combined group
      if (tryPlaceGroup(combined, sortedTeachers)) {
        // Remove the individual grades from failed list
        combined.replaces.forEach(gradeName => {
          const idx = failedGroups.findIndex(g => g.name === gradeName);
          if (idx !== -1) failedGroups.splice(idx, 1);
        });
      }
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

export interface GeneratorOptions {
  numOptions?: number;
  numAttempts?: number;
  timeoutPerAttempt?: number;
  onProgress?: (current: number, total: number, message: string) => void;
  /** Locked teacher schedules - these won't be changed */
  lockedTeachers?: Record<string, TeacherSchedule>;
  /** Teachers who must be assigned study halls (had them in original schedule) */
  teachersNeedingStudyHalls?: string[];
}

export interface GeneratorResult {
  options: ScheduleOption[];
  status: 'success' | 'infeasible' | 'error';
  message?: string;
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
    teachersNeedingStudyHalls = []
  } = options;

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
  const baseEligible = getStudyHallEligible(teachers)
    .filter(t => !lockedTeacherNames.has(t));

  // Teachers who had study halls before regeneration are automatically eligible
  const eligible = [...new Set([...baseEligible, ...teachersNeedingStudyHalls])];

  const sessions = buildSessions(classesToSchedule);

  if (isRefinementMode && sessions.length === 0) {
    console.log('[Scheduler] No sessions to schedule - all teachers locked?');
  }

  // Pre-compute locked grade slots (slots occupied by locked teachers' classes)
  const lockedGradeSlots = new Map<string, Set<number>>();
  ALL_GRADES.forEach(g => lockedGradeSlots.set(g, new Set()));

  if (isRefinementMode) {
    for (const [, schedule] of Object.entries(lockedTeachers)) {
      DAYS.forEach((day, dayIdx) => {
        BLOCKS.forEach((block, blockIdx) => {
          const entry = schedule[day]?.[block];
          if (entry && entry[0] && entry[1] !== 'OPEN' && entry[1] !== 'Study Hall') {
            const slot = dayBlockToSlot(dayIdx, blockIdx);
            const grades = parseGrades(entry[0]);
            grades.forEach(g => lockedGradeSlots.get(g)?.add(slot));
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
      deprioritize.size > 0 ? deprioritize : undefined
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

    const { teacherSchedules, gradeSchedules } = buildSchedules(result.assignment, sessions, teachers);

    // Deep copy for processing
    const ts = JSON.parse(JSON.stringify(teacherSchedules));
    const gs = JSON.parse(JSON.stringify(gradeSchedules));

    // Merge locked teacher schedules back in (including study halls)
    const lockedStudyHallAssignments: StudyHallAssignment[] = [];
    const alreadyCoveredGroups = new Set<string>();
    const existingGradeStudyHallDays = new Map<string, Set<string>>();
    ALL_GRADES.forEach(g => existingGradeStudyHallDays.set(g, new Set()));

    if (isRefinementMode) {
      for (const [teacher, schedule] of Object.entries(lockedTeachers)) {
        ts[teacher] = JSON.parse(JSON.stringify(schedule));
        // Update grade schedules with ALL locked assignments (including study halls)
        DAYS.forEach(day => {
          BLOCKS.forEach(block => {
            const entry = schedule[day]?.[block];
            if (entry && entry[0] && entry[1] !== 'OPEN') {
              if (entry[1] === 'Study Hall') {
                // Track locked study hall assignments
                lockedStudyHallAssignments.push({
                  group: entry[0],
                  teacher,
                  day,
                  block: BLOCKS[BLOCKS.indexOf(block)]
                });
                // Mark this group as already covered
                alreadyCoveredGroups.add(entry[0]);
                // Update grade schedules for study hall grades
                const shGroup = STUDY_HALL_GROUPS.find(g => g.name === entry[0]);
                if (shGroup) {
                  shGroup.grades.forEach(g => {
                    if (gs[g]) {
                      gs[g][day][block] = [teacher, 'Study Hall'];
                      // Track that this grade has a study hall on this day
                      existingGradeStudyHallDays.get(g)!.add(day);
                    }
                  });
                }
              } else {
                // Regular class - update grade schedules
                const grades = parseGrades(entry[0]);
                grades.forEach(g => {
                  if (gs[g]) {
                    gs[g][day][block] = [teacher, entry[1]];
                  }
                });
              }
            }
          });
        });
      }
    }

    // Teachers who need study halls: those specified by the caller (had them before regen)
    // Filter to only include eligible teachers who are being regenerated (not locked)
    const requiredStudyHallTeachers = teachersNeedingStudyHalls.filter(t =>
      eligible.includes(t) && !lockedTeacherNames.has(t)
    );

    const newShAssignments = addStudyHalls(ts, gs, eligible, {
      requiredTeachers: requiredStudyHallTeachers,
      alreadyCoveredGroups,
      existingGradeStudyHallDays,
    });

    // Combine locked and new study hall assignments
    const shAssignments = [...lockedStudyHallAssignments, ...newShAssignments];
    const shPlaced = shAssignments.filter(sh => sh.teacher !== null).length;

    fillOpenBlocks(ts);
    // Only redistribute open blocks for unlocked full-time teachers
    redistributeOpenBlocks(ts, gs, fullTimeUnlocked);

    const totalBtb = fullTime.reduce((sum, t) => sum + countBackToBack(ts, t), 0);
    const score = (5 - shPlaced) * 100 + totalBtb;

    const candidate = {
      attempt,
      score,
      btb: totalBtb,
      shPlaced,
      teacherSchedules: ts,
      gradeSchedules: gs,
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
  seed?: number
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
  const eligible = getStudyHallEligible(teachers);

  if (eligible.length === 0) {
    return {
      success: false,
      message: 'No eligible teachers for study hall supervision',
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
      seed: currentSeed
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
