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

const UPPER_GRADES = new Set([
  '6th Grade', '7th Grade', '8th Grade', '9th Grade', '10th Grade', '11th Grade'
]);

const STUDY_HALL_GROUPS = [
  { name: '6th Grade', grades: ['6th Grade'] },
  { name: '7th Grade', grades: ['7th Grade'] },
  { name: '8th Grade', grades: ['8th Grade'] },
  { name: '9th Grade', grades: ['9th Grade'] },
  { name: '10th-11th Grade', grades: ['10th Grade', '11th Grade'] },
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
  if (gradeField.includes('Elective')) return [];
  return GRADE_MAP[gradeField.trim()] || [];
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

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getStudyHallEligible(teachers: Teacher[], classes: ClassEntry[]): string[] {
  const fullTime = new Set(
    teachers.filter(t => t.status === 'full-time').map(t => t.name)
  );

  const teachesUpper = new Set<string>();
  classes.forEach(c => {
    const grades = parseGrades(c.grade);
    if (grades.some(g => UPPER_GRADES.has(g))) {
      teachesUpper.add(c.teacher);
    }
  });

  teachers.forEach(t => {
    if (t.canSuperviseStudyHall) teachesUpper.add(t.name);
  });

  return [...teachesUpper].filter(t => fullTime.has(t));
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

function solveBacktracking(sessions: Session[], randomize: boolean = true): SolveResult {
  const assignment = new Map<number, number>();

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

  // Sort sessions: fixed first, then by constraint level (fewer valid slots first)
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.isFixed && !b.isFixed) return -1;
    if (!a.isFixed && b.isFixed) return 1;
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

  function solve(idx: number): boolean {
    if (idx === sortedSessions.length) return true;

    const session = sortedSessions[idx];
    let slots = session.validSlots.filter(s => isValid(session, s));

    if (randomize) {
      slots = shuffle(slots);
    }

    for (const slot of slots) {
      assign(session, slot);
      if (solve(idx + 1)) return true;
      unassign(session, slot);
    }

    return false;
  }

  const success = solve(0);

  if (success) {
    return { assignment, status: 'Optimal' };
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
  eligibleTeachers: string[]
): StudyHallAssignment[] {
  if (eligibleTeachers.length === 0) {
    return STUDY_HALL_GROUPS.map(g => ({
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

  const sorted = [...eligibleTeachers].sort((a, b) => countTeaching(a) - countTeaching(b));

  const gradeStudyHallDays = new Map<string, Set<string>>();
  ALL_GRADES.forEach(g => gradeStudyHallDays.set(g, new Set()));

  const assignments: StudyHallAssignment[] = [];
  let teacherIdx = 0;

  STUDY_HALL_GROUPS.forEach(group => {
    let placed = false;

    for (let attempt = 0; attempt < sorted.length * 25 && !placed; attempt++) {
      const teacher = sorted[teacherIdx % sorted.length];
      teacherIdx++;

      for (const day of DAYS) {
        if (placed) break;
        if (group.grades.some(g => gradeStudyHallDays.get(g)!.has(day))) continue;

        for (const block of BLOCKS) {
          if (teacherSchedules[teacher]?.[day]?.[block] !== null) continue;

          const allFree = group.grades.every(g =>
            gradeSchedules[g]?.[day]?.[block] === null
          );

          if (allFree) {
            teacherSchedules[teacher][day][block] = [group.name, 'Study Hall'];
            group.grades.forEach(g => {
              gradeSchedules[g][day][block] = [teacher, 'Study Hall'];
              gradeStudyHallDays.get(g)!.add(day);
            });
            assignments.push({ group: group.name, teacher, day, block });
            placed = true;
            break;
          }
        }
      }
    }

    if (!placed) {
      assignments.push({ group: group.name, teacher: null, day: null, block: null });
    }
  });

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
    onProgress
  } = options;

  const fullTime = teachers.filter(t => t.status === 'full-time').map(t => t.name);
  const eligible = getStudyHallEligible(teachers, classes);
  const sessions = buildSessions(classes);

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
  let errorCount = 0;

  for (let attempt = 0; attempt < numAttempts; attempt++) {
    onProgress?.(attempt + 1, numAttempts, `Solving attempt ${attempt + 1}/${numAttempts}...`);

    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 10));

    // Use backtracking solver with randomization for variety
    const result = solveBacktracking(sessions, attempt > 0);

    if (!result.assignment) {
      console.log(`Attempt ${attempt + 1}: ${result.status}`);
      if (result.status === 'Infeasible') {
        infeasibleCount++;
      } else {
        errorCount++;
      }
      continue;
    }

    const { teacherSchedules, gradeSchedules } = buildSchedules(result.assignment, sessions, teachers);

    // Deep copy for processing
    const ts = JSON.parse(JSON.stringify(teacherSchedules));
    const gs = JSON.parse(JSON.stringify(gradeSchedules));

    const shAssignments = addStudyHalls(ts, gs, eligible);
    const shPlaced = shAssignments.filter(sh => sh.teacher !== null).length;

    fillOpenBlocks(ts);
    redistributeOpenBlocks(ts, gs, fullTime);

    const totalBtb = fullTime.reduce((sum, t) => sum + countBackToBack(ts, t), 0);
    const score = (5 - shPlaced) * 100 + totalBtb;

    candidates.push({
      attempt,
      score,
      btb: totalBtb,
      shPlaced,
      teacherSchedules: ts,
      gradeSchedules: gs,
      shAssignments,
    });
  }

  // Sort and dedupe
  candidates.sort((a, b) => a.score - b.score);

  const seen = new Set<string>();
  const unique: typeof candidates = [];

  for (const c of candidates) {
    const hash = JSON.stringify(c.teacherSchedules);
    if (!seen.has(hash)) {
      seen.add(hash);
      unique.push(c);
      if (unique.length >= numOptions) break;
    }
  }

  // Determine result status
  if (unique.length === 0) {
    if (infeasibleCount > 0) {
      return {
        options: [],
        status: 'infeasible',
        message: 'The current class constraints are impossible to satisfy. Check for conflicts like: a teacher assigned to too many classes, a grade with overlapping subjects, or restrictions that leave no valid slots.',
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
