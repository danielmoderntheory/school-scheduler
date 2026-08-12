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
import { BLOCK_TYPE_OPEN, BLOCK_TYPE_STUDY_HALL, isOpenBlock, isStudyHall, isScheduledClass, isOccupiedBlock, getFirstGradeEntry } from './schedule-utils';
import { parseGradeDisplayToNumbers, parseGradeDisplayToNames, gradeNumToDisplay, gradeDisplayIncludesGrade } from './grade-utils';

// Constants
export const DAYS = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri'];
// Legacy 5-block defaults - kept exported for back-compat. Callers that pass no
// block configuration to generateSchedules/reassignStudyHalls get these.
export const BLOCKS = [1, 2, 3, 4, 5];
export const NUM_SLOTS = 25;

// NOTE: Grades now come from the database - no hardcoded grade list

// ============================================================================
// ACTIVE BLOCK CONFIGURATION (module state)
// ============================================================================
// The block format is parameterized per call: the exported entry points
// (generateSchedules, reassignStudyHalls) accept optional `blocks` and
// `teachableBlocksByGrade` arguments and stamp them into this module state
// before doing any work. All internal helpers read the active state.
// generateSchedules re-applies its state after every `await` so interleaved
// calls in the same JS realm cannot corrupt each other's configuration.

interface BlockState {
  /** Ordered list of block numbers in the timetable (e.g. [1..5] or [1..9]) */
  blocks: number[];
  /** Grade name -> set of block numbers that grade can be scheduled in. null = unrestricted */
  gradeBlocks: Map<string, Set<number>> | null;
  /** Grade name -> allowed [earlier, later] block pairs for double periods. null = no pairing */
  gradePairs: Map<string, [number, number][]> | null;
}

let activeBlocks: number[] = [...BLOCKS];
let activeGradeBlocks: Map<string, Set<number>> | null = null;
let activeGradePairs: Map<string, [number, number][]> | null = null;

function resolveBlockState(
  blocks?: number[],
  teachableBlocksByGrade?: Record<string, number[]>,
  gradeBlockPairs?: Record<string, [number, number][]>
): BlockState {
  const resolvedBlocks = blocks && blocks.length > 0 ? [...blocks] : [...BLOCKS];
  let gradeBlocks: Map<string, Set<number>> | null = null;
  if (teachableBlocksByGrade) {
    gradeBlocks = new Map();
    for (const [grade, allowed] of Object.entries(teachableBlocksByGrade)) {
      gradeBlocks.set(grade, new Set(allowed));
    }
  }
  let gradePairs: Map<string, [number, number][]> | null = null;
  if (gradeBlockPairs) {
    gradePairs = new Map();
    for (const [grade, pairs] of Object.entries(gradeBlockPairs)) {
      gradePairs.set(grade, pairs.map(p => [p[0], p[1]] as [number, number]));
    }
  }
  return { blocks: resolvedBlocks, gradeBlocks, gradePairs };
}

function applyBlockState(state: BlockState): void {
  activeBlocks = state.blocks;
  activeGradeBlocks = state.gradeBlocks;
  activeGradePairs = state.gradePairs;
}

/**
 * Compute the set of block numbers teachable by ALL of the given grade names,
 * per the active teachableBlocksByGrade map. A grade absent from the map is
 * unrestricted (all blocks). Returns null when fully unrestricted.
 */
function getTeachableBlocksForGrades(gradeNames: string[]): Set<number> | null {
  if (!activeGradeBlocks) return null;
  let result: Set<number> | null = null;
  for (const g of gradeNames) {
    const allowed = activeGradeBlocks.get(g);
    if (!allowed) continue; // absent grade key = all blocks teachable
    if (result === null) {
      result = new Set(allowed);
    } else {
      const prev: Set<number> = result;
      result = new Set([...prev].filter(b => allowed.has(b)));
    }
  }
  return result;
}

function isBlockTeachableForGrades(gradeNames: string[], block: number): boolean {
  const teachable = getTeachableBlocksForGrades(gradeNames);
  return teachable === null || teachable.has(block);
}

/**
 * Legal double-period block pairs usable by a class covering the given grades:
 * the intersection of the pairs allowed for EVERY covered grade. A grade with
 * no entry in the map has no legal pairs, so the intersection is empty
 * (fail closed). Returns [] when no gradeBlockPairs map is in effect.
 */
function getLegalPairsForGrades(gradeNames: string[]): [number, number][] {
  if (!activeGradePairs || gradeNames.length === 0) return [];
  let result: [number, number][] | null = null;
  for (const g of gradeNames) {
    const pairs = activeGradePairs.get(g) ?? [];
    if (result === null) {
      result = [...pairs];
    } else {
      const prev: [number, number][] = result;
      result = prev.filter(([a, b]) => pairs.some(([pa, pb]) => pa === a && pb === b));
    }
    if (result.length === 0) return [];
  }
  return result ?? [];
}

// ============================================================================
// TEACHER LUNCH CONSTRAINT (hard, rule_key: 'teacher_lunch')
// ============================================================================
// A teacher's CANDIDATE LUNCH WINDOWS are the union, over all grades covered
// by their classes, of (activeBlocks minus that grade's teachable set) — i.e.
// every band lunch block of every band they touch. The hard constraint: on
// every day, at least one candidate window must stay free of the teacher's
// obligations (classes AND study halls). Only active when a
// teachableBlocksByGrade map is in effect and the 'teacher_lunch' rule is
// enabled (missing rule = enabled, matching isRuleEnabled).

interface TeacherLunchInfo {
  /** Candidate lunch window block numbers for this teacher */
  candidates: Set<number>;
  /** Indices into activeBlocks for each candidate block */
  candidateIdxs: number[];
  /**
   * Whether the constraint is enforced for this teacher. False when the
   * candidate set is empty (legacy / unrestricted grades) or when some
   * candidate window can never be occupied by any of the teacher's classes
   * (single-band teacher — the constraint holds vacuously).
   */
  enforced: boolean;
}

function buildTeacherLunchInfo(
  gradeGroupsByTeacher: Map<string, string[][]>
): Map<string, TeacherLunchInfo> {
  const result = new Map<string, TeacherLunchInfo>();
  if (!activeGradeBlocks) return result;

  for (const [teacher, groups] of gradeGroupsByTeacher) {
    // Candidate windows: union over covered grades of (activeBlocks \ teachable)
    const candidates = new Set<number>();
    for (const group of groups) {
      for (const g of group) {
        const allowed = activeGradeBlocks.get(g);
        if (!allowed) continue; // grade absent from map = unrestricted, no lunch window
        for (const b of activeBlocks) {
          if (!allowed.has(b)) candidates.add(b);
        }
      }
    }

    let enforced = candidates.size > 0;
    if (enforced) {
      // Vacuous-satisfaction check: if some candidate window can never be
      // occupied by any of this teacher's classes (per grade teachability),
      // that window is always free — skip enforcement (single-band case).
      const occupiable = new Set<number>();
      let allBlocksOccupiable = false;
      for (const group of groups) {
        const teachable = getTeachableBlocksForGrades(group);
        if (teachable === null) { allBlocksOccupiable = true; break; }
        teachable.forEach(b => occupiable.add(b));
      }
      if (!allBlocksOccupiable) {
        for (const b of candidates) {
          if (!occupiable.has(b)) { enforced = false; break; }
        }
      }
    }

    const candidateIdxs: number[] = [];
    activeBlocks.forEach((b, idx) => {
      if (candidates.has(b)) candidateIdxs.push(idx);
    });

    result.set(teacher, { candidates, candidateIdxs, enforced });
  }

  return result;
}

/** Build teacher lunch info from a class list (generation path). */
function buildTeacherLunchFromClasses(classes: ClassEntry[]): Map<string, TeacherLunchInfo> {
  const byTeacher = new Map<string, string[][]>();
  for (const cls of classes) {
    if (!byTeacher.has(cls.teacher)) byTeacher.set(cls.teacher, []);
    byTeacher.get(cls.teacher)!.push(parseGrades(cls.grade));
  }
  return buildTeacherLunchInfo(byTeacher);
}

/** Build teacher lunch info from placed schedules (reassign path — no class list available). */
function buildTeacherLunchFromSchedules(
  teacherSchedules: Record<string, TeacherSchedule>
): Map<string, TeacherLunchInfo> {
  const byTeacher = new Map<string, string[][]>();
  for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
    const groups: string[][] = [];
    for (const day of DAYS) {
      for (const block of activeBlocks) {
        const entry = schedule?.[day]?.[block];
        if (entry && entry[0] && isScheduledClass(entry[1])) {
          groups.push(parseGrades(entry[0]));
        }
      }
    }
    byTeacher.set(teacher, groups);
  }
  return buildTeacherLunchInfo(byTeacher);
}

/** A candidate window is free when it holds no obligation (class or study hall). */
function isLunchWindowFree(
  teacherSchedules: Record<string, TeacherSchedule>,
  teacher: string,
  day: string,
  block: number
): boolean {
  const entry = teacherSchedules[teacher]?.[day]?.[block];
  return !entry || !isOccupiedBlock(entry[1]);
}

/**
 * Fail-closed preflight: if a teacher's fixed slots alone fill every one of
 * their candidate lunch windows on some day, no schedule can leave them a
 * lunch break — throw rather than silently produce an infeasible/violating
 * result (mirrors the buildSessions fixed-slot-in-lunch-block error).
 */
function assertFixedSlotsLeaveLunch(
  sessions: Session[],
  teacherLunch: Map<string, TeacherLunchInfo>
): void {
  // teacher -> dayIdx -> candidate blocks consumed by fixed slots
  const fixedByTeacherDay = new Map<string, Map<number, Set<number>>>();
  for (const s of sessions) {
    if (!s.isFixed) continue;
    // A fixed single pins one slot; a fixed double meeting pins both slots of
    // its lone placement (same day by construction).
    let slots: number[];
    if (s.placements) {
      if (s.placements.length !== 1) continue;
      slots = [s.placements[0][0], s.placements[0][1]];
    } else {
      if (s.validSlots.length !== 1) continue;
      slots = s.validSlots;
    }
    const info = teacherLunch.get(s.teacher);
    if (!info?.enforced) continue;
    for (const slot of slots) {
      const block = activeBlocks[slotToBlock(slot)];
      if (!info.candidates.has(block)) continue;
      const dayIdx = slotToDay(slot);
      if (!fixedByTeacherDay.has(s.teacher)) fixedByTeacherDay.set(s.teacher, new Map());
      const byDay = fixedByTeacherDay.get(s.teacher)!;
      if (!byDay.has(dayIdx)) byDay.set(dayIdx, new Set());
      byDay.get(dayIdx)!.add(block);
    }
  }

  for (const [teacher, byDay] of fixedByTeacherDay) {
    const info = teacherLunch.get(teacher)!;
    for (const [dayIdx, blocks] of byDay) {
      if (blocks.size >= info.candidates.size) {
        const windows = [...info.candidates].sort((a, b) => a - b).join(', ');
        throw new Error(
          `Teacher '${teacher}' has fixed classes on ${DAYS[dayIdx]} filling every ` +
          `candidate lunch window (blocks ${windows}); no lunch break is possible`
        );
      }
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function slotToDay(slot: number): number {
  return Math.floor(slot / activeBlocks.length);
}

function slotToBlock(slot: number): number {
  return slot % activeBlocks.length;
}

function dayBlockToSlot(dayIdx: number, blockIdx: number): number {
  return dayIdx * activeBlocks.length + blockIdx;
}

/**
 * Parse grade display name to individual grades.
 * Used internally by the solver for constraint checking.
 * Uses shared grade utilities from grade-utils.ts.
 *
 * Note: Electives ARE parsed - they have real grades. The solver handles
 * elective-to-elective slot sharing separately.
 */
function parseGrades(gradeField: string): string[] {
  // Use the shared utility to parse grade numbers, then convert to grade names
  const gradeNumbers = parseGradeDisplayToNumbers(gradeField);
  return gradeNumbers.map(num => gradeNumToDisplay(num));
}

function getValidSlots(availDays: string[], availBlocks: number[]): number[] {
  const slots: number[] = [];
  availDays.forEach(day => {
    const dayIdx = DAYS.indexOf(day);
    if (dayIdx === -1) return;
    availBlocks.forEach(block => {
      const blockIdx = activeBlocks.indexOf(block);
      if (blockIdx === -1) return;
      slots.push(dayBlockToSlot(dayIdx, blockIdx));
    });
  });
  return slots.length > 0 ? slots : Array.from({ length: DAYS.length * activeBlocks.length }, (_, i) => i);
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
  grade: string;           // Grade display string (used for constraint checking via parseGrades)
  subject: string;
  validSlots: number[];
  isFixed: boolean;
  isElective?: boolean;
  isCotaught?: boolean;
  cotaughtGroupId?: string; // Sessions with same grade+subject but different teachers
  /** True for a DOUBLE meeting: occupies both slots of one placement atomically */
  isDoubleMeeting?: boolean;
  /**
   * Double meetings only: legal [firstSlot, secondSlot] placements (same day,
   * consecutive blocks per the gradeBlockPairs config). The solver's assignment
   * value for a double meeting is an INDEX into this array, not a slot number.
   */
  placements?: [number, number][];
  /**
   * Identity of the source class for double-period classes (index into the
   * class list). Used to enforce "each meeting of a flagged class lands on a
   * distinct day" independently of the toggleable no_duplicate_subjects rule.
   */
  classKey?: number;
  /**
   * UNFLAGGED classes only, when the class has >=1 legal block pair: identity
   * of the source class (index into the class list) for OPTIONAL same-day
   * pairing. A second lesson of the class may share a day iff the two blocks
   * form a legal pair (back-to-back allowed, never required); never a third.
   */
  pairClassKey?: number;
  /** Legal [earlier, later] block pairs usable for an optional same-day pair */
  optionalPairs?: [number, number][];
  /**
   * UNFLAGGED classes with legal pairs: HARD budget on same-day pairs — the
   * class pairs only when its week cannot fit as singles. Computed as
   * max(0, lessons - usableDays) where usableDays = distinct days the class
   * can actually use (from its sessions' valid slots, <= 5). For fixed-slot
   * classes the formula equals the number of fixed same-day pairs, so pins
   * are always honored and count toward the budget.
   */
  maxSameDayPairs?: number;
}

/**
 * ClassEntry with the double-period flag. Kept as a local extension so this
 * module compiles whether or not lib/types.ts has gained the field yet;
 * plain ClassEntry[] arguments remain assignable (legacy calls unchanged).
 */
export type SchedulerClassEntry = ClassEntry & { isDouble?: boolean };

function buildSessions(classes: ClassEntry[], teachers?: Teacher[]): Session[] {
  const sessions: Session[] = [];
  let id = 0;

  // Build teacher availability lookup for intersecting with class valid slots
  const teacherValidSlots = new Map<string, Set<number>>();
  if (teachers) {
    for (const t of teachers) {
      if (t.availableDays || t.availableBlocks) {
        const days = t.availableDays || [...DAYS];
        const blocks = t.availableBlocks || [...activeBlocks];
        const slots = new Set<number>();
        for (const day of days) {
          const dayIdx = DAYS.indexOf(day);
          if (dayIdx === -1) continue;
          for (const block of blocks) {
            const blockIdx = activeBlocks.indexOf(block);
            if (blockIdx === -1) continue;
            slots.add(dayIdx * activeBlocks.length + blockIdx);
          }
        }
        teacherValidSlots.set(t.name, slots);
      }
    }
  }

  classes.forEach((cls, clsIdx) => {
    const isDouble = (cls as SchedulerClassEntry).isDouble === true;
    const gradeNames = parseGrades(cls.grade);
    const legalPairs = getLegalPairsForGrades(gradeNames);
    const useDoubles = isDouble && legalPairs.length > 0;
    const L = cls.daysPerWeek;
    // classKey marks sessions of double-period classes so every meeting of the
    // class (double or single) lands on a distinct day.
    const classKey = isDouble ? clsIdx : undefined;
    // Unflagged classes with legal pairs may pair ONLY when the week cannot
    // fit as singles: a second lesson may share a day iff the two blocks form
    // a legal pair AND the class's pair budget (maxSameDayPairs, computed per
    // branch below) allows it; never a third same-day lesson. Flagged classes
    // never get these fields.
    const optionalPairing = !isDouble && legalPairs.length > 0;
    const pairClassKey = optionalPairing ? clsIdx : undefined;
    const optionalPairs = optionalPairing
      ? legalPairs.map(p => [p[0], p[1]] as [number, number])
      : undefined;

    // Preflight: unflagged classes cap at 5 lessons (one per day) when the
    // class has no legal pairs, or 10 (one optional pair per day) when it does.
    if (!isDouble && legalPairs.length === 0 && L > 5) {
      if (!activeGradePairs) {
        // Legacy call (no gradeBlockPairs map): byte-identical behavior
        throw new Error(
          `Class '${cls.teacher} - ${cls.subject}' has ${L} lessons per week, ` +
          `but '${cls.subject}' is not a double-period subject; at most 5 single lessons fit in a week`
        );
      }
      throw new Error(
        `Class '${cls.teacher} - ${cls.subject}' has ${L} lessons per week, ` +
        `but there are no legal consecutive block pairs shared by all of its grades (${cls.grade}); ` +
        `at most 5 single lessons fit in a week`
      );
    }
    if (!isDouble && L > 10) {
      throw new Error(
        `Class '${cls.teacher} - ${cls.subject}' has ${L} lessons per week; ` +
        `even with one double period per day they cannot fit in a 5-day week`
      );
    }
    // Preflight: flagged class with no legal shared pairs fails closed for any
    // lesson count (matches the Python solver) — an empty intersection means a
    // template/config problem that should surface, not silently become singles.
    if (isDouble && !useDoubles) {
      throw new Error(
        `Class '${cls.teacher} - ${cls.subject}' requires double periods, ` +
        `but there are no legal consecutive block pairs shared by all of its grades (${cls.grade})`
      );
    }
    // Preflight: even paired up, meetings must fit on 5 distinct days (L > 10)
    if (useDoubles && Math.floor(L / 2) + (L % 2) > 5) {
      throw new Error(
        `Class '${cls.teacher} - ${cls.subject}' has ${L} lessons per week; ` +
        `even as double periods they cannot fit on 5 distinct days`
      );
    }
    // Fail closed: the co-taught pairing machinery is slot-based and cannot
    // place two teachers' double meetings atomically together.
    if (useDoubles && Math.floor(L / 2) > 0 && cls.isCotaught) {
      throw new Error(
        `Class '${cls.teacher} - ${cls.subject}' is both co-taught and a double-period subject; ` +
        `co-taught double periods are not supported`
      );
    }

    if (cls.fixedSlots && cls.fixedSlots.length > 0) {
      // Fail closed when a fixed slot lands in a block some covered grade
      // can't use (its band's lunch) — mirrors the backend preflight check.
      const fixedTeachable = getTeachableBlocksForGrades(gradeNames);
      cls.fixedSlots.forEach(([day, block]) => {
        if (fixedTeachable !== null && !fixedTeachable.has(block)) {
          throw new Error(
            `Class '${cls.teacher} - ${cls.subject}' is fixed to ${day} Block ${block}, ` +
            `but Block ${block} is not a teachable block for ${cls.grade}`
          );
        }
      });

      if (useDoubles) {
        // Fixed slots on a flagged class must form same-day legal pairs,
        // plus at most one lone single block when L is odd.
        const byDay = new Map<string, number[]>();
        for (const [day, block] of cls.fixedSlots) {
          if (!byDay.has(day)) byDay.set(day, []);
          byDay.get(day)!.push(block);
        }
        let singleCount = 0;
        const maxSingles = L % 2;
        for (const [day, blocksOnDay] of byDay) {
          const dayIdx = DAYS.indexOf(day);
          if (blocksOnDay.length === 1) {
            singleCount++;
            if (singleCount > maxSingles) {
              throw new Error(
                `Class '${cls.teacher} - ${cls.subject}' requires double periods, but its fixed slot ` +
                `on ${day} Block ${blocksOnDay[0]} is a lone single block; fixed slots must form ` +
                `legal same-day pairs${maxSingles === 1 ? ' plus at most one single' : ''}`
              );
            }
            const slot = dayBlockToSlot(dayIdx, activeBlocks.indexOf(blocksOnDay[0]));
            sessions.push({
              id: id++,
              teacher: cls.teacher,
              grade: cls.grade,
              subject: cls.subject,
              validSlots: [slot],
              isFixed: true,
              isElective: cls.isElective,
              isCotaught: cls.isCotaught,
              classKey,
            });
          } else if (blocksOnDay.length === 2) {
            const idxA = activeBlocks.indexOf(blocksOnDay[0]);
            const idxB = activeBlocks.indexOf(blocksOnDay[1]);
            const [first, second] = idxA <= idxB
              ? [blocksOnDay[0], blocksOnDay[1]]
              : [blocksOnDay[1], blocksOnDay[0]];
            if (!legalPairs.some(([a, b]) => a === first && b === second)) {
              throw new Error(
                `Class '${cls.teacher} - ${cls.subject}' requires double periods, but its fixed slots ` +
                `on ${day} (Blocks ${first}, ${second}) do not form an allowed consecutive pair for ${cls.grade}`
              );
            }
            const sA = dayBlockToSlot(dayIdx, activeBlocks.indexOf(first));
            const sB = dayBlockToSlot(dayIdx, activeBlocks.indexOf(second));
            sessions.push({
              id: id++,
              teacher: cls.teacher,
              grade: cls.grade,
              subject: cls.subject,
              validSlots: [],
              isFixed: true,
              isElective: cls.isElective,
              isCotaught: cls.isCotaught,
              isDoubleMeeting: true,
              placements: [[sA, sB]],
              classKey,
            });
          } else {
            throw new Error(
              `Class '${cls.teacher} - ${cls.subject}' requires double periods, but has ` +
              `${blocksOnDay.length} fixed slots on ${day}; only a two-block pair ` +
              `(plus at most one single elsewhere) is allowed`
            );
          }
        }
      } else {
        // Pair budget for a fully-fixed unflagged class: lessons minus distinct
        // fixed days = exactly the number of fixed same-day pairs, so the pins
        // are honored and no additional pairing is possible anyway.
        let maxSameDayPairs: number | undefined;
        if (optionalPairing) {
          const fixedDays = new Set(cls.fixedSlots.map(([day]) => day));
          maxSameDayPairs = Math.max(0, cls.fixedSlots.length - fixedDays.size);
        }
        cls.fixedSlots.forEach(([day, block]) => {
          const dayIdx = DAYS.indexOf(day);
          const blockIdx = activeBlocks.indexOf(block);
          const slot = dayBlockToSlot(dayIdx, blockIdx);
          sessions.push({
            id: id++,
            teacher: cls.teacher,
            grade: cls.grade,
            subject: cls.subject,
            validSlots: [slot],
            isFixed: true,
            isElective: cls.isElective,
            isCotaught: cls.isCotaught,
            classKey,
            pairClassKey,
            optionalPairs,
            maxSameDayPairs,
          });
        });
      }
    } else {
      let validSlots = getValidSlots(
        cls.availableDays || DAYS,
        cls.availableBlocks || activeBlocks
      );

      // Intersect with teacher-level availability (defense-in-depth:
      // frontend also pre-intersects, but solver should be self-contained)
      const tSlots = teacherValidSlots.get(cls.teacher);
      if (tSlots) {
        validSlots = validSlots.filter(s => tSlots.has(s));
      }

      // Restrict to blocks teachable by ALL grades this class covers
      // (multi-grade classes spanning bands must avoid every band's lunch block)
      const teachable = getTeachableBlocksForGrades(gradeNames);
      if (teachable !== null) {
        validSlots = validSlots.filter(s => teachable.has(activeBlocks[slotToBlock(s)]));
      }

      if (useDoubles) {
        // Enumerate legal placements: for each day, each legal pair whose two
        // blocks both survive availability/teachability filtering. A pair
        // touching a lunch-masked block yields no placement (masks eat it).
        const slotSet = new Set(validSlots);
        const placements: [number, number][] = [];
        for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
          for (const [bA, bB] of legalPairs) {
            const idxA = activeBlocks.indexOf(bA);
            const idxB = activeBlocks.indexOf(bB);
            if (idxA === -1 || idxB === -1) continue;
            const sA = dayBlockToSlot(dayIdx, idxA);
            const sB = dayBlockToSlot(dayIdx, idxB);
            if (slotSet.has(sA) && slotSet.has(sB)) {
              placements.push([sA, sB]);
            }
          }
        }

        const numDoubles = Math.floor(L / 2);
        for (let i = 0; i < numDoubles; i++) {
          sessions.push({
            id: id++,
            teacher: cls.teacher,
            grade: cls.grade,
            subject: cls.subject,
            validSlots: [],
            isFixed: false,
            isElective: cls.isElective,
            isCotaught: cls.isCotaught,
            isDoubleMeeting: true,
            placements: placements.map(p => [p[0], p[1]] as [number, number]),
            classKey,
          });
        }
        for (let i = 0; i < L % 2; i++) {
          sessions.push({
            id: id++,
            teacher: cls.teacher,
            grade: cls.grade,
            subject: cls.subject,
            validSlots: [...validSlots],
            isFixed: false,
            isElective: cls.isElective,
            isCotaught: cls.isCotaught,
            classKey,
          });
        }
      } else {
        // Pair budget: pairs are allowed ONLY when the week cannot fit as
        // singles — max(0, L - usableDays), usableDays = distinct days the
        // class can actually use after all availability/teachability filters.
        let maxSameDayPairs: number | undefined;
        if (optionalPairing) {
          const usableDays = new Set(validSlots.map(s => slotToDay(s))).size;
          maxSameDayPairs = Math.max(0, L - usableDays);
        }
        for (let i = 0; i < L; i++) {
          sessions.push({
            id: id++,
            teacher: cls.teacher,
            grade: cls.grade,
            subject: cls.subject,
            validSlots: [...validSlots],
            isFixed: false,
            isElective: cls.isElective,
            isCotaught: cls.isCotaught,
            classKey,
            pairClassKey,
            optionalPairs,
            maxSameDayPairs,
          });
        }
      }
    }
  });

  return sessions;
}

/**
 * Identify co-taught classes and assign group IDs.
 * Co-taught = same grade+subject but different teachers.
 * These sessions must be scheduled at the same time slot.
 *
 * Uses parseGradeDisplayToNumbers to normalize grade displays for comparison,
 * handling different formats like "10th-11th Grade" vs "10th Grade, 11th Grade".
 */
function assignCotaughtGroups(sessions: Session[]): Map<string, Session[]> {
  // Group sessions by normalized grades + subject
  const gradeSubjectGroups = new Map<string, Session[]>();

  for (const session of sessions) {
    // Skip sessions not explicitly marked as co-taught
    if (!session.isCotaught) continue;

    // Create a normalized key using sorted grade numbers (handles format differences)
    const gradeNums = parseGradeDisplayToNumbers(session.grade).sort((a, b) => a - b);
    const normalizedKey = `${gradeNums.join(',')}|${session.subject}`;

    if (!gradeSubjectGroups.has(normalizedKey)) {
      gradeSubjectGroups.set(normalizedKey, []);
    }
    gradeSubjectGroups.get(normalizedKey)!.push(session);
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
  prefilledGradeSlots?: Map<string, Set<number>>,  // Grade names -> occupied slots (non-elective)
  prefilledElectiveGradeSlots?: Map<string, Set<number>>,  // Grade names -> occupied slots (elective)
  maxTimeMs: number = 5000, // 5 second timeout per attempt
  deprioritizeTeachers?: Set<string>, // Teachers to schedule last (for diversity)
  rules?: SchedulingRule[], // Scheduling rules to respect
  cotaughtGroups?: Map<string, Session[]>, // Co-taught class groups
  prefilledGradeSubjectDays?: Map<string, Set<number>>, // "gradeName|subject" -> days already used by locked teachers
  teacherLunch?: Map<string, TeacherLunchInfo> // teacher_lunch hard constraint info
): SolveResult {
  const assignment = new Map<number, number>();
  const startTime = Date.now();
  let iterations = 0;
  const maxIterations = 100000; // Safety limit

  // Track constraints using grade names
  // Separate tracking for electives vs non-electives to handle elective-to-elective sharing
  const teacherSlots = new Map<string, Set<number>>();
  const gradeSlots = new Map<string, Set<number>>();  // gradeName -> occupied slots (non-elective)
  const electiveGradeSlots = new Map<string, Set<number>>();  // gradeName -> occupied slots (elective)
  const gradeSubjectDay = new Map<string, Set<number>>(); // "gradeName|subject" -> set of days
  // classKey -> days already holding a meeting of that double-period class.
  // Enforced unconditionally (not gated on no_duplicate_subjects): every
  // meeting of a flagged class must land on a distinct day.
  const classDayUsed = new Map<number, Set<number>>();
  // pairClassKey -> dayIdx -> slots currently held by that UNFLAGGED class on
  // that day. Supports optional same-day pairing: a second lesson may join a
  // day only as a legal consecutive pair with the existing lone lesson.
  const pairClassDaySlots = new Map<number, Map<number, number[]>>();
  // pairClassKey -> number of days currently holding TWO lessons of the class
  // (its same-day pair count). Checked against session.maxSameDayPairs so a
  // class pairs only when its week cannot fit as singles.
  const pairClassPairCount = new Map<number, number>();

  // Track which co-taught sessions have been assigned (to skip them in main loop)
  const assignedCotaughtSessions = new Set<number>();

  // Initialize tracking - parse grade display strings to get grade names
  sessions.forEach(s => {
    if (!teacherSlots.has(s.teacher)) teacherSlots.set(s.teacher, new Set());
    parseGrades(s.grade).forEach(g => {
      if (!gradeSlots.has(g)) gradeSlots.set(g, new Set());
      if (!electiveGradeSlots.has(g)) electiveGradeSlots.set(g, new Set());
    });
  });

  // Pre-fill grade slots from locked teachers (non-elective)
  if (prefilledGradeSlots) {
    for (const [gradeName, slots] of prefilledGradeSlots) {
      if (!gradeSlots.has(gradeName)) gradeSlots.set(gradeName, new Set());
      slots.forEach(slot => gradeSlots.get(gradeName)!.add(slot));
    }
  }

  // Pre-fill elective grade slots from locked teachers
  if (prefilledElectiveGradeSlots) {
    for (const [gradeName, slots] of prefilledElectiveGradeSlots) {
      if (!electiveGradeSlots.has(gradeName)) electiveGradeSlots.set(gradeName, new Set());
      slots.forEach(slot => electiveGradeSlots.get(gradeName)!.add(slot));
    }
  }

  // Pre-fill grade+subject+day from locked teachers (prevents duplicate subjects per day per grade)
  if (prefilledGradeSubjectDays) {
    for (const [key, days] of prefilledGradeSubjectDays) {
      if (!gradeSubjectDay.has(key)) gradeSubjectDay.set(key, new Set());
      days.forEach(day => gradeSubjectDay.get(key)!.add(day));
    }
  }

  // Domain size for MRV ordering: double meetings choose among placements,
  // singles among valid slots.
  const domainSize = (s: Session): number =>
    s.placements ? s.placements.length : s.validSlots.length;

  // Sort sessions: fixed first, then by constraint level, deprioritized teachers last
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.isFixed && !b.isFixed) return -1;
    if (!a.isFixed && b.isFixed) return 1;
    // Deprioritized teachers go last (to force different solutions)
    const aDepri = deprioritizeTeachers?.has(a.teacher) ? 1 : 0;
    const bDepri = deprioritizeTeachers?.has(b.teacher) ? 1 : 0;
    if (aDepri !== bDepri) return aDepri - bDepri;
    return domainSize(a) - domainSize(b);
  });

  function isValid(session: Session, slot: number): boolean {
    // Check teacher conflict - ALWAYS enforced (teacher can't be in two places)
    if (teacherSlots.get(session.teacher)?.has(slot)) return false;

    // Check grade conflicts
    // Rules:
    // - Non-elective classes conflict with ANY class (elective or non-elective) at same grade/slot
    // - Elective classes only conflict with non-elective classes (electives can share slots)
    const grades = parseGrades(session.grade);
    const isElective = session.isElective === true;

    for (const g of grades) {
      // Always check non-elective slots (both electives and non-electives conflict with these)
      if (gradeSlots.get(g)?.has(slot)) return false;

      // Non-electives also conflict with elective slots
      if (!isElective && electiveGradeSlots.get(g)?.has(slot)) return false;
    }

    // Check subject/day conflict - CAN be toggled via rules.
    // Same subject can't appear twice on same day for same grade, with ONE
    // exception: a second lesson of the SAME unflagged class may join the day
    // iff its block forms a legal consecutive pair with the class's existing
    // lone lesson AND the class still has pair budget (pairs only when the
    // week cannot fit as singles — see maxSameDayPairs). A third same-day
    // lesson, a non-pair block, or another class's lesson still fail.
    if (isRuleEnabled(rules, 'no_duplicate_subjects')) {
      const day = slotToDay(slot);
      let subjectOnDay = false;
      for (const g of grades) {
        const key = `${g}|${session.subject}`;
        if (gradeSubjectDay.get(key)?.has(day)) { subjectOnDay = true; break; }
      }
      if (subjectOnDay) {
        if (session.pairClassKey === undefined || !session.optionalPairs) return false;
        const slotsToday = pairClassDaySlots.get(session.pairClassKey)?.get(day);
        // Exactly one existing lesson, and it must be THIS class's (if the
        // day was marked by another class/locked teacher, slotsToday is empty)
        if (!slotsToday || slotsToday.length !== 1) return false;
        // HARD pair budget: a new pair may only form while the class's pair
        // count is below max(0, lessons - usableDays) — i.e. only when the
        // week cannot fit as singles (fixed same-day pairs are inside budget)
        const budget = session.maxSameDayPairs ?? Infinity;
        if ((pairClassPairCount.get(session.pairClassKey) ?? 0) >= budget) return false;
        const idxExisting = slotToBlock(slotsToday[0]);
        const idxNew = slotToBlock(slot);
        const [firstIdx, secondIdx] = idxExisting <= idxNew
          ? [idxExisting, idxNew]
          : [idxNew, idxExisting];
        const first = activeBlocks[firstIdx];
        const second = activeBlocks[secondIdx];
        if (!session.optionalPairs.some(([a, b]) => a === first && b === second)) return false;
      }
    }

    // Double-period classes: every meeting on a distinct day (always enforced,
    // independent of the no_duplicate_subjects toggle)
    if (session.classKey !== undefined &&
        classDayUsed.get(session.classKey)?.has(slotToDay(slot))) {
      return false;
    }

    // Teacher lunch (HARD): never place a session into the teacher's LAST free
    // candidate lunch window on that day — every day must keep one window open
    if (teacherLunch) {
      const lunch = teacherLunch.get(session.teacher);
      if (lunch?.enforced && lunch.candidates.has(activeBlocks[slotToBlock(slot)])) {
        const dayIdx = slotToDay(slot);
        const occupied = teacherSlots.get(session.teacher);
        let freeWindows = 0;
        for (const bIdx of lunch.candidateIdxs) {
          if (!occupied?.has(dayBlockToSlot(dayIdx, bIdx))) freeWindows++;
        }
        // The target slot itself is free (teacher conflict checked above), so
        // freeWindows >= 1; if it's the only free window, refuse the placement.
        if (freeWindows <= 1) return false;
      }
    }

    return true;
  }

  // Validate an atomic double-meeting placement: BOTH blocks must clear
  // teacher conflicts, grade conflicts, masks (already baked into placements),
  // the subject/day rule, distinct meeting days, and the teacher_lunch guard.
  function isValidDoublePlacement(session: Session, sA: number, sB: number): boolean {
    const occupied = teacherSlots.get(session.teacher);
    if (occupied?.has(sA) || occupied?.has(sB)) return false;

    const grades = parseGrades(session.grade);
    const isElective = session.isElective === true;
    for (const g of grades) {
      const gs = gradeSlots.get(g);
      if (gs?.has(sA) || gs?.has(sB)) return false;
      if (!isElective) {
        const es = electiveGradeSlots.get(g);
        if (es?.has(sA) || es?.has(sB)) return false;
      }
    }

    // Both slots share a day by construction; the duplicate-subject rule is
    // relaxed WITHIN the pair (checked once for the day, before either block
    // is marked) but still blocks any other same-subject session that day.
    const dayIdx = slotToDay(sA);
    if (isRuleEnabled(rules, 'no_duplicate_subjects')) {
      for (const g of grades) {
        if (gradeSubjectDay.get(`${g}|${session.subject}`)?.has(dayIdx)) return false;
      }
    }

    // Each meeting of the class on a distinct day (always enforced)
    if (session.classKey !== undefined &&
        classDayUsed.get(session.classKey)?.has(dayIdx)) {
      return false;
    }

    // Teacher lunch (HARD): the pair may consume up to TWO candidate windows
    // at once — count the windows left free after BOTH blocks are placed.
    if (teacherLunch) {
      const lunch = teacherLunch.get(session.teacher);
      if (lunch?.enforced) {
        const bA = activeBlocks[slotToBlock(sA)];
        const bB = activeBlocks[slotToBlock(sB)];
        if (lunch.candidates.has(bA) || lunch.candidates.has(bB)) {
          let freeWindows = 0;
          for (const bIdx of lunch.candidateIdxs) {
            const s = dayBlockToSlot(dayIdx, bIdx);
            if (s === sA || s === sB) continue; // consumed by this placement
            if (!occupied?.has(s)) freeWindows++;
          }
          if (freeWindows === 0) return false;
        }
      }
    }

    return true;
  }

  function assignDouble(session: Session, placementIdx: number): void {
    const [sA, sB] = session.placements![placementIdx];
    assignment.set(session.id, placementIdx);
    const t = teacherSlots.get(session.teacher)!;
    t.add(sA);
    t.add(sB);

    const grades = parseGrades(session.grade);
    const dayIdx = slotToDay(sA);
    const isElective = session.isElective === true;
    grades.forEach(g => {
      const map = isElective ? electiveGradeSlots : gradeSlots;
      map.get(g)!.add(sA);
      map.get(g)!.add(sB);
      const key = `${g}|${session.subject}`;
      if (!gradeSubjectDay.has(key)) gradeSubjectDay.set(key, new Set());
      gradeSubjectDay.get(key)!.add(dayIdx);
    });

    if (session.classKey !== undefined) {
      if (!classDayUsed.has(session.classKey)) classDayUsed.set(session.classKey, new Set());
      classDayUsed.get(session.classKey)!.add(dayIdx);
    }
  }

  function unassignDouble(session: Session, placementIdx: number): void {
    const [sA, sB] = session.placements![placementIdx];
    assignment.delete(session.id);
    const t = teacherSlots.get(session.teacher)!;
    t.delete(sA);
    t.delete(sB);

    const grades = parseGrades(session.grade);
    const dayIdx = slotToDay(sA);
    const isElective = session.isElective === true;
    grades.forEach(g => {
      const map = isElective ? electiveGradeSlots : gradeSlots;
      map.get(g)!.delete(sA);
      map.get(g)!.delete(sB);
      gradeSubjectDay.get(`${g}|${session.subject}`)?.delete(dayIdx);
    });

    if (session.classKey !== undefined) {
      classDayUsed.get(session.classKey)?.delete(dayIdx);
    }
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
    const isElective = session.isElective === true;

    grades.forEach(g => {
      // Add to appropriate slot map based on elective status
      if (isElective) {
        electiveGradeSlots.get(g)!.add(slot);
      } else {
        gradeSlots.get(g)!.add(slot);
      }
      const key = `${g}|${session.subject}`;
      if (!gradeSubjectDay.has(key)) gradeSubjectDay.set(key, new Set());
      gradeSubjectDay.get(key)!.add(day);
    });

    if (session.classKey !== undefined) {
      if (!classDayUsed.has(session.classKey)) classDayUsed.set(session.classKey, new Set());
      classDayUsed.get(session.classKey)!.add(day);
    }

    if (session.pairClassKey !== undefined) {
      if (!pairClassDaySlots.has(session.pairClassKey)) {
        pairClassDaySlots.set(session.pairClassKey, new Map());
      }
      const byDay = pairClassDaySlots.get(session.pairClassKey)!;
      if (!byDay.has(day)) byDay.set(day, []);
      const slotsToday = byDay.get(day)!;
      slotsToday.push(slot);
      if (slotsToday.length === 2) {
        // A same-day pair just formed
        pairClassPairCount.set(
          session.pairClassKey,
          (pairClassPairCount.get(session.pairClassKey) ?? 0) + 1
        );
      }
    }
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
    const isElective = session.isElective === true;

    // Optionally-paired classes may hold TWO same-day lessons; only clear the
    // subject/day marker once the class's last lesson leaves the day.
    let classStillOnDay = false;
    if (session.pairClassKey !== undefined) {
      const slotsToday = pairClassDaySlots.get(session.pairClassKey)?.get(day);
      if (slotsToday) {
        const i = slotsToday.indexOf(slot);
        if (i !== -1) {
          slotsToday.splice(i, 1);
          if (slotsToday.length === 1) {
            // A same-day pair just dissolved (2 -> 1)
            pairClassPairCount.set(
              session.pairClassKey,
              (pairClassPairCount.get(session.pairClassKey) ?? 1) - 1
            );
          }
        }
        classStillOnDay = slotsToday.length > 0;
      }
    }

    grades.forEach(g => {
      // Remove from appropriate slot map based on elective status
      if (isElective) {
        electiveGradeSlots.get(g)!.delete(slot);
      } else {
        gradeSlots.get(g)!.delete(slot);
      }
      const key = `${g}|${session.subject}`;
      if (!classStillOnDay) gradeSubjectDay.get(key)?.delete(day);
    });

    if (session.classKey !== undefined) {
      classDayUsed.get(session.classKey)?.delete(day);
    }
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

    // Double meetings place BOTH blocks of one placement atomically —
    // either both blocks commit or neither does.
    if (session.isDoubleMeeting && session.placements) {
      const placements = session.placements;
      let placementIdxs = placements
        .map((_, i) => i)
        .filter(i => isValidDoublePlacement(session, placements[i][0], placements[i][1]));

      if (randomize) {
        placementIdxs = shuffle(placementIdxs);
      }

      for (const pi of placementIdxs) {
        assignDouble(session, pi);

        const result = solve(idx + 1);
        if (result === true) return true;
        if (result === 'timeout') return 'timeout';

        unassignDouble(session, pi);
      }

      return false;
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

    // Singles-first bias for optionally-paired classes: try days where the
    // class has no lesson yet BEFORE days where placing would form a pair,
    // so the solver doesn't waste attempts exploring pairings the budget
    // won't let it keep. Stable sort preserves randomization within tiers.
    if (session.pairClassKey !== undefined) {
      const byDay = pairClassDaySlots.get(session.pairClassKey);
      if (byDay && byDay.size > 0) {
        slots.sort((a, b) => {
          const aPairs = (byDay.get(slotToDay(a))?.length ?? 0) > 0 ? 1 : 0;
          const bPairs = (byDay.get(slotToDay(b))?.length ?? 0) > 0 ? 1 : 0;
          return aPairs - bPairs;
        });
      }
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
      activeBlocks.forEach(block => {
        teacherSchedules[t.name][day][block] = null;
      });
    });
  });

  // Use grades from database parameter
  grades.forEach(g => {
    gradeSchedules[g] = {};
    DAYS.forEach(day => {
      gradeSchedules[g][day] = {};
      activeBlocks.forEach(block => {
        gradeSchedules[g][day][block] = null;
      });
    });
  });

  sessions.forEach(s => {
    const value = assignment.get(s.id);
    if (value === undefined) return;

    // For double meetings the assignment value is an index into placements;
    // expand to both occupied slots. Singles carry the slot number directly.
    const slots = s.placements ? s.placements[value] : [value];

    for (const slot of slots) {
      const day = DAYS[slotToDay(slot)];
      const block = activeBlocks[slotToBlock(slot)];

      teacherSchedules[s.teacher][day][block] = [s.grade, s.subject];
      parseGrades(s.grade).forEach(g => {
        if (gradeSchedules[g]) {
          gradeSchedules[g][day][block] = [s.teacher, s.subject];
        }
      });
    }
  });

  return { teacherSchedules, gradeSchedules };
}

/**
 * Parse grade display name to individual grades using DATABASE grades (no hardcoding).
 * Uses shared grade utilities from grade-utils.ts.
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

  // Use the shared utility which handles all grade display formats:
  // - Single grades: "6th Grade"
  // - Ranges: "6th-11th Grade"
  // - Comma-separated: "10th Grade, 11th Grade"
  // - Kindergarten variations
  return parseGradeDisplayToNames(gradeDisplay, Array.from(databaseGrades));
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
      for (const block of activeBlocks) {
        gradeSchedules[g][day][block] = null;
      }
    }
  }

  // Populate from teacher schedules
  // TWO PASSES: First multi-grade (electives), then single-grade (required classes)
  // Electives accumulate into arrays; single-grade classes overwrite (take priority)

  // Pass 1: Multi-grade entries (electives) - accumulate into arrays
  for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
    for (const day of DAYS) {
      for (const block of activeBlocks) {
        const entry = schedule[day]?.[block];
        if (entry && entry[0] && isOccupiedBlock(entry[1])) {
          const gradeDisplay = entry[0];
          const subject = entry[1];

          // Parse grades using DATABASE grades (no hardcoding)
          const parsedGrades = parseGradesFromDatabase(gradeDisplay, databaseGrades);

          // Only process multi-grade entries in this pass (electives)
          if (parsedGrades.length > 1) {
            for (const g of parsedGrades) {
              // Initialize grade if somehow not in the list (safety)
              if (!gradeSchedules[g]) {
                gradeSchedules[g] = {};
                for (const d of DAYS) {
                  gradeSchedules[g][d] = {};
                  for (const b of activeBlocks) {
                    gradeSchedules[g][d][b] = null;
                  }
                }
              }
              const existing = gradeSchedules[g][day][block];
              const newEntry: [string, string] = [teacher, subject];
              if (!existing) {
                // No existing entry - set as single tuple
                gradeSchedules[g][day][block] = newEntry;
              } else if (Array.isArray(existing) && Array.isArray(existing[0])) {
                // Already an array of tuples - append
                (existing as [string, string][]).push(newEntry);
              } else {
                // Single tuple exists - convert to array
                gradeSchedules[g][day][block] = [existing as [string, string], newEntry];
              }
            }
          }
        }
      }
    }
  }

  // Pass 2: Single-grade entries (required classes) - overwrite electives
  for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
    for (const day of DAYS) {
      for (const block of activeBlocks) {
        const entry = schedule[day]?.[block];
        if (entry && entry[0] && isOccupiedBlock(entry[1])) {
          const gradeDisplay = entry[0];
          const subject = entry[1];

          const parsedGrades = parseGradesFromDatabase(gradeDisplay, databaseGrades);

          // Only process single-grade entries in this pass (required classes overwrite)
          if (parsedGrades.length === 1) {
            const g = parsedGrades[0];
            if (!gradeSchedules[g]) {
              gradeSchedules[g] = {};
              for (const d of DAYS) {
                gradeSchedules[g][d] = {};
                for (const b of activeBlocks) {
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
    teacherAvailability?: Map<string, Set<number>>; // Teacher name → set of valid slot numbers
    teacherLunch?: Map<string, TeacherLunchInfo>; // teacher_lunch hard constraint info
  }
): StudyHallAssignment[] {
  const {
    requiredTeachers = [],
    alreadyCoveredGroups = new Set<string>(),
    existingGradeStudyHallDays = new Map<string, Set<string>>(),
    shuffleAssignments = false,
    seed,
    rules,
    teacherAvailability,
    teacherLunch,
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
      activeBlocks.forEach(block => {
        const entry = teacherSchedules[teacher]?.[day]?.[block];
        if (entry && isScheduledClass(entry[1])) {
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

  // Helper to check if a grade is free at a specific slot using teacherSchedules (source of truth)
  // Uses gradeDisplayIncludesGrade from grade-utils.ts
  function isGradeFreeAtSlot(grade: string, day: string, block: number): boolean {
    for (const [, schedule] of Object.entries(teacherSchedules)) {
      const entry = schedule?.[day]?.[block];
      if (entry && entry[1] && isScheduledClass(entry[1])) {
        // Check if this entry includes the target grade
        if (gradeDisplayIncludesGrade(entry[0], grade)) {
          return false; // Grade has a class at this slot
        }
      }
    }
    return true; // No teacher is teaching this grade at this slot
  }

  // Helper to try placing a specific group with a specific teacher
  function tryPlaceGroup(
    group: { name: string; grades: string[] },
    teachers: string[]
  ): boolean {
    // Optionally shuffle the order we try days and blocks
    const daysToTry = shuffleAssignments ? shuffle(DAYS, randomFn) : DAYS;
    const blocksToTry = shuffleAssignments ? shuffle(activeBlocks, randomFn) : activeBlocks;

    for (const teacher of teachers) {
      for (const day of daysToTry) {
        if (group.grades.some(g => gradeStudyHallDays.get(g)?.has(day))) continue;

        for (const block of blocksToTry) {
          if (teacherSchedules[teacher]?.[day]?.[block] !== null) continue;

          // Study halls must respect the grades' teachable blocks
          // (e.g. a 6th grade study hall can't land in the MS lunch block)
          if (!isBlockTeachableForGrades(group.grades, block)) continue;

          // Check teacher availability
          if (teacherAvailability?.has(teacher)) {
            const dayIdx = DAYS.indexOf(day);
            const blockIdx = activeBlocks.indexOf(block);
            const slot = dayIdx * activeBlocks.length + blockIdx;
            if (!teacherAvailability.get(teacher)!.has(slot)) continue;
          }

          // Teacher lunch (HARD): never give a supervisor a study hall in
          // their last free candidate lunch window for that day. Applies even
          // to teachers exempt from the solver constraint (single-band): their
          // classes can't occupy their lunch window, but a cross-band study
          // hall could — matches the Python solver's add_study_halls guard.
          if (teacherLunch) {
            const lunch = teacherLunch.get(teacher);
            if (lunch && lunch.candidates.size > 0 && lunch.candidates.has(block)) {
              let freeWindows = 0;
              for (const b of lunch.candidates) {
                if (isLunchWindowFree(teacherSchedules, teacher, day, b)) freeWindows++;
              }
              // This block itself is free (checked above), so freeWindows >= 1;
              // if it's the only free window, don't place the study hall here.
              if (freeWindows <= 1) continue;
            }
          }

          // Check if all grades are free using teacherSchedules (source of truth)
          const allFree = group.grades.every(g => isGradeFreeAtSlot(g, day, block));

          if (allFree) {
            teacherSchedules[teacher][day][block] = [group.name, BLOCK_TYPE_STUDY_HALL];
            group.grades.forEach(g => {
              gradeSchedules[g][day][block] = [teacher, BLOCK_TYPE_STUDY_HALL];
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

  // Phase 2: Place remaining individual groups.
  // Spread study halls evenly: before each group, prefer teachers with the
  // fewest study halls assigned so far (stable sort keeps the load-based
  // order as the tie-breaker). A fixed order let the lightest teacher
  // absorb nearly every study hall.
  const groupOrder = shuffleAssignments ? shuffle([...groupsToPlace], randomFn) : groupsToPlace;
  for (const group of groupOrder) {
    if (group.grades.some(g => placedGrades.has(g))) continue; // Already placed

    const shCounts = new Map<string, number>();
    for (const a of assignments) {
      if (a.teacher) shCounts.set(a.teacher, (shCounts.get(a.teacher) || 0) + 1);
    }
    const spreadOrder = [...sortedTeachers].sort(
      (a, b) => (shCounts.get(a) || 0) - (shCounts.get(b) || 0)
    );

    if (!tryPlaceGroup(group, spreadOrder)) {
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
      activeBlocks.forEach(block => {
        if (teacherSchedules[teacher][day][block] === null) {
          teacherSchedules[teacher][day][block] = ['', BLOCK_TYPE_OPEN];
        }
      });
    });
  });
}

function countBackToBack(teacherSchedules: Record<string, TeacherSchedule>, teacher: string): number {
  let count = 0;
  DAYS.forEach(day => {
    let prevOpen = false;
    activeBlocks.forEach(block => {
      const entry = teacherSchedules[teacher]?.[day]?.[block];
      const currOpen = !entry || !isScheduledClass(entry[1]);
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
    activeBlocks.forEach(block => {
      const entry = teacherSchedules[teacher]?.[day]?.[block];
      if (!entry || !isScheduledClass(entry[1])) {
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
  fullTimeTeachers: string[],
  teacherLunch?: Map<string, TeacherLunchInfo>,
  immovableClasses?: Set<string> // "teacher|subject" keys that must never be moved (fixed-slot classes)
): void {
  const getBackToBackSlots = (teacher: string) => {
    const pairs: { day: string; block: number }[] = [];
    DAYS.forEach(day => {
      for (let i = 0; i < activeBlocks.length - 1; i++) {
        const entry1 = teacherSchedules[teacher][day][activeBlocks[i]];
        const entry2 = teacherSchedules[teacher][day][activeBlocks[i + 1]];
        const isOpen1 = !entry1 || !isScheduledClass(entry1[1]);
        const isOpen2 = !entry2 || !isScheduledClass(entry2[1]);
        if (isOpen1 && isOpen2) {
          pairs.push({ day, block: activeBlocks[i + 1] });
        }
      }
    });
    return pairs;
  };

  const wouldCreateBTB = (teacher: string, day: string, block: number): boolean => {
    const blockIdx = activeBlocks.indexOf(block);
    if (blockIdx > 0) {
      const prev = teacherSchedules[teacher][day][activeBlocks[blockIdx - 1]];
      if (!prev || !isScheduledClass(prev[1])) return true;
    }
    if (blockIdx < activeBlocks.length - 1) {
      const next = teacherSchedules[teacher][day][activeBlocks[blockIdx + 1]];
      if (!next || !isScheduledClass(next[1])) return true;
    }
    return false;
  };

  // Teacher lunch (HARD): would moving a class into (issueDay, issueBlock)
  // leave the teacher without a free candidate lunch window on that day?
  // The vacated (targetDay, targetBlock) becomes OPEN, which can restore a
  // window when the swap happens within the same day.
  const wouldBreakLunch = (
    teacher: string,
    issueDay: string,
    issueBlock: number,
    targetDay: string,
    targetBlock: number
  ): boolean => {
    if (!teacherLunch) return false;
    const lunch = teacherLunch.get(teacher);
    if (!lunch?.enforced || !lunch.candidates.has(issueBlock)) return false;
    let freeWindows = 0;
    for (const b of lunch.candidates) {
      if (b === issueBlock) continue; // becomes occupied by the moved class
      if (targetDay === issueDay && b === targetBlock) { freeWindows++; continue; } // freed by the swap
      if (isLunchWindowFree(teacherSchedules, teacher, issueDay, b)) freeWindows++;
    }
    return freeWindows === 0;
  };

  // Pair-move lunch guard: would occupying (destDay, p1) and (destDay, p2)
  // leave the teacher without a free candidate lunch window on destDay?
  // Blocks vacated by the pair on the same day count as freed.
  const pairWouldBreakLunch = (
    teacher: string,
    destDay: string,
    p1: number,
    p2: number,
    sourceDay: string,
    sb1: number,
    sb2: number
  ): boolean => {
    if (!teacherLunch) return false;
    const lunch = teacherLunch.get(teacher);
    if (!lunch?.enforced) return false;
    if (!lunch.candidates.has(p1) && !lunch.candidates.has(p2)) return false;
    let freeWindows = 0;
    for (const b of lunch.candidates) {
      if (b === p1 || b === p2) continue; // becomes occupied by the moved pair
      if (destDay === sourceDay && (b === sb1 || b === sb2)) { freeWindows++; continue; } // freed by the move
      if (isLunchWindowFree(teacherSchedules, teacher, destDay, b)) freeWindows++;
    }
    return freeWindows === 0;
  };

  // Move ONE lone single session (no same-day twin) into the open
  // (issueDay, issueBlock) slot. Returns true if a move was made.
  const trySingleMove = (teacher: string, issueDay: string, issueBlock: number): boolean => {
    for (const targetDay of DAYS) {
      for (const targetBlock of activeBlocks) {
        const entry = teacherSchedules[teacher][targetDay][targetBlock];
        if (!entry || !isScheduledClass(entry[1]) || !entry[0]) {
          continue;
        }

        // Never move fixed-slot classes: the solver honors user pins, and
        // post-processing must not undo them.
        if (immovableClasses?.has(`${teacher}|${entry[1]}`)) continue;

        // Never split a same-day pair (optional or required): if this
        // class meets again on targetDay, the two sessions are a legal
        // consecutive pair — it may only relocate atomically (tryPairMove),
        // never one half at a time.
        let hasSameDayTwin = false;
        for (const b of activeBlocks) {
          if (b === targetBlock) continue;
          const twin = teacherSchedules[teacher][targetDay][b];
          if (twin && twin[0] === entry[0] && twin[1] === entry[1]) {
            hasSameDayTwin = true;
            break;
          }
        }
        if (hasSameDayTwin) continue;

        if (wouldCreateBTB(teacher, targetDay, targetBlock)) continue;

        const [gradeDisplay, subject] = entry;
        const grades = parseGrades(gradeDisplay);
        if (grades.length === 0) continue;

        // Moving this class into the issue slot must respect the grades'
        // teachable blocks (can't move a class into a grade's lunch block)
        if (!isBlockTeachableForGrades(grades, issueBlock)) continue;

        // Never swap a class INTO the teacher's last free lunch window
        if (wouldBreakLunch(teacher, issueDay, issueBlock, targetDay, targetBlock)) continue;

        // The destination day must not already hold another meeting of this
        // class (would create an unplanned same-day twin / third session)
        let classMeetsOnIssueDay = false;
        for (const b of activeBlocks) {
          if (b === issueBlock) continue;
          if (issueDay === targetDay && b === targetBlock) continue; // the moving session itself
          const other = teacherSchedules[teacher][issueDay][b];
          if (other && other[0] === gradeDisplay && other[1] === subject) {
            classMeetsOnIssueDay = true;
            break;
          }
        }
        if (classMeetsOnIssueDay) continue;

        // Check conflicts
        let hasConflict = false;
        for (const g of grades) {
          const cell = gradeSchedules[g]?.[issueDay]?.[issueBlock];
          const slot = getFirstGradeEntry(cell);
          if (slot && isOccupiedBlock(slot[1])) {
            hasConflict = true;
            break;
          }
        }
        if (hasConflict) continue;

        // Check subject/day conflict
        for (const g of grades) {
          for (const b of activeBlocks) {
            if (b === issueBlock) continue;
            const cell = gradeSchedules[g]?.[issueDay]?.[b];
            const slot = getFirstGradeEntry(cell);
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
        teacherSchedules[teacher][targetDay][targetBlock] = ['', BLOCK_TYPE_OPEN];

        grades.forEach(g => {
          if (!gradeSchedules[g]) return; // grade not tracked (defensive)
          gradeSchedules[g][targetDay][targetBlock] = null;
          gradeSchedules[g][issueDay][issueBlock] = [teacher, subject];
        });

        return true;
      }
    }
    return false;
  };

  // Atomically relocate one same-day pair (two sessions of one class on one
  // day — by construction a legal consecutive pair) to an OPEN legal pair on
  // a destination day. A candidate move is applied, then kept ONLY if the
  // teacher's BTB-OPEN count strictly decreased (otherwise reverted). The
  // strict-reduction guard keeps pair accounting monotonic: filling two
  // blocks while vacating two can never oscillate, because every accepted
  // move lowers the count and no move can raise it back for free.
  const tryPairMove = (teacher: string): boolean => {
    const btbBefore = countBackToBack(teacherSchedules, teacher);
    if (btbBefore === 0) return false;

    for (const sourceDay of DAYS) {
      // Collect this teacher's same-day class pairs on sourceDay
      const blocksByClass = new Map<string, number[]>();
      for (const b of activeBlocks) {
        const e = teacherSchedules[teacher][sourceDay][b];
        if (e && e[0] && isScheduledClass(e[1])) {
          const key = `${e[0]}|${e[1]}`;
          const list = blocksByClass.get(key) ?? [];
          list.push(b);
          blocksByClass.set(key, list);
        }
      }

      for (const pairBlocks of blocksByClass.values()) {
        if (pairBlocks.length !== 2) continue;
        const [sb1, sb2] = pairBlocks;
        const entry = teacherSchedules[teacher][sourceDay][sb1]!;
        const [gradeDisplay, subject] = entry;

        // Fixed-slot classes stay frozen
        if (immovableClasses?.has(`${teacher}|${subject}`)) continue;

        const grades = parseGrades(gradeDisplay);
        if (grades.length === 0) continue;
        const legalPairs = getLegalPairsForGrades(grades);
        if (legalPairs.length === 0) continue;

        for (const destDay of DAYS) {
          // The destination day must hold no other meeting of this class...
          let classMeetsOnDest = false;
          for (const b of activeBlocks) {
            if (destDay === sourceDay && (b === sb1 || b === sb2)) continue;
            const other = teacherSchedules[teacher][destDay][b];
            if (other && other[0] === gradeDisplay && other[1] === subject) {
              classMeetsOnDest = true;
              break;
            }
          }
          if (classMeetsOnDest) continue;

          // ...nor any meeting of the same grade+subject (mirrors the
          // single-move subject/day conflict check)
          let subjectConflict = false;
          for (const g of grades) {
            for (const b of activeBlocks) {
              if (destDay === sourceDay && (b === sb1 || b === sb2)) continue;
              const slot = getFirstGradeEntry(gradeSchedules[g]?.[destDay]?.[b]);
              if (slot && slot[1] === subject) {
                subjectConflict = true;
                break;
              }
            }
            if (subjectConflict) break;
          }
          if (subjectConflict) continue;

          for (const [p1, p2] of legalPairs) {
            if (destDay === sourceDay && p1 === sb1 && p2 === sb2) continue; // no-op

            // Both destination blocks must be truly OPEN for the teacher
            // (never overwrite a class or study hall)
            const dest1 = teacherSchedules[teacher][destDay][p1];
            const dest2 = teacherSchedules[teacher][destDay][p2];
            if (dest1 && !isOpenBlock(dest1[1])) continue;
            if (dest2 && !isOpenBlock(dest2[1])) continue;

            // ...within every covered grade's teachable set
            if (!isBlockTeachableForGrades(grades, p1)) continue;
            if (!isBlockTeachableForGrades(grades, p2)) continue;

            // ...free for every covered grade (elective-aware first-entry
            // check, mirroring the single-move path)
            let gradeConflict = false;
            for (const g of grades) {
              for (const pb of [p1, p2]) {
                const slot = getFirstGradeEntry(gradeSchedules[g]?.[destDay]?.[pb]);
                if (slot && isOccupiedBlock(slot[1])) {
                  gradeConflict = true;
                  break;
                }
              }
              if (gradeConflict) break;
            }
            if (gradeConflict) continue;

            // ...and must leave the teacher a lunch window on destDay
            if (pairWouldBreakLunch(teacher, destDay, p1, p2, sourceDay, sb1, sb2)) continue;

            // Apply atomically; keep only on strict BTB-OPEN reduction
            const savedGradeCells = grades.map(g => ({
              g,
              src1: gradeSchedules[g]?.[sourceDay]?.[sb1],
              src2: gradeSchedules[g]?.[sourceDay]?.[sb2],
              dst1: gradeSchedules[g]?.[destDay]?.[p1],
              dst2: gradeSchedules[g]?.[destDay]?.[p2],
            }));

            teacherSchedules[teacher][sourceDay][sb1] = ['', BLOCK_TYPE_OPEN];
            teacherSchedules[teacher][sourceDay][sb2] = ['', BLOCK_TYPE_OPEN];
            teacherSchedules[teacher][destDay][p1] = [gradeDisplay, subject];
            teacherSchedules[teacher][destDay][p2] = [gradeDisplay, subject];
            grades.forEach(g => {
              if (!gradeSchedules[g]) return; // grade not tracked (defensive)
              gradeSchedules[g][sourceDay][sb1] = null;
              gradeSchedules[g][sourceDay][sb2] = null;
              gradeSchedules[g][destDay][p1] = [teacher, subject];
              gradeSchedules[g][destDay][p2] = [teacher, subject];
            });

            if (countBackToBack(teacherSchedules, teacher) < btbBefore) {
              return true;
            }

            // Revert: the move did not strictly reduce BTB-OPEN
            teacherSchedules[teacher][sourceDay][sb1] = [gradeDisplay, subject];
            teacherSchedules[teacher][sourceDay][sb2] = [gradeDisplay, subject];
            teacherSchedules[teacher][destDay][p1] = dest1 ?? null;
            teacherSchedules[teacher][destDay][p2] = dest2 ?? null;
            for (const saved of savedGradeCells) {
              if (!gradeSchedules[saved.g]) continue;
              gradeSchedules[saved.g][sourceDay][sb1] = saved.src1 ?? null;
              gradeSchedules[saved.g][sourceDay][sb2] = saved.src2 ?? null;
              gradeSchedules[saved.g][destDay][p1] = saved.dst1 ?? null;
              gradeSchedules[saved.g][destDay][p2] = saved.dst2 ?? null;
            }
          }
        }
      }
    }
    return false;
  };

  for (let iter = 0; iter < 2000; iter++) {
    let madeSwap = false;

    for (const teacher of fullTimeTeachers) {
      const btbSlots = getBackToBackSlots(teacher);
      if (btbSlots.length === 0) continue;

      // Prefer the cheap single-session moves (existing heuristic)...
      for (const { day: issueDay, block: issueBlock } of btbSlots) {
        if (trySingleMove(teacher, issueDay, issueBlock)) {
          madeSwap = true;
          break;
        }
      }

      // ...then fall back to relocating a same-day pair atomically
      if (!madeSwap && tryPairMove(teacher)) {
        madeSwap = true;
      }

      if (madeSwap) break;
    }

    if (!madeSwap) break;
  }
}

/**
 * TEST-ONLY entry point: run the back-to-back redistribution pass directly on
 * prebuilt schedules with an explicit block configuration, so scratch tests
 * can construct exact layouts and observe single/pair-move behavior
 * deterministically. Not used by application code.
 */
export function __testRedistributeOpenBlocks(
  teacherSchedules: Record<string, TeacherSchedule>,
  gradeSchedules: Record<string, GradeSchedule>,
  fullTimeTeachers: string[],
  opts: {
    blocks?: number[];
    teachableBlocksByGrade?: Record<string, number[]>;
    gradeBlockPairs?: Record<string, [number, number][]>;
    immovableClasses?: Set<string>;
    enforceTeacherLunch?: boolean;
  } = {}
): void {
  applyBlockState(resolveBlockState(opts.blocks, opts.teachableBlocksByGrade, opts.gradeBlockPairs));
  const teacherLunch = opts.enforceTeacherLunch
    ? buildTeacherLunchFromSchedules(teacherSchedules)
    : undefined;
  redistributeOpenBlocks(teacherSchedules, gradeSchedules, fullTimeTeachers, teacherLunch, opts.immovableClasses);
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
      activeBlocks.forEach(block => {
        const entry = teacherSchedules[t.name]?.[day]?.[block];
        if (!entry || isOpenBlock(entry[1])) {
          open++;
        } else if (isStudyHall(entry[1])) {
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
  /** If true, skip study hall assignment entirely (reassign after saving) */
  skipStudyHalls?: boolean;
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

/**
 * Generate schedule options.
 *
 * @param blocks - Ordered block numbers of the timetable (default: legacy [1,2,3,4,5]).
 * @param teachableBlocksByGrade - Optional map of grade NAME (as the solver uses
 *   them, e.g. "6th Grade") -> block numbers that grade may be scheduled in.
 *   A grade absent from the map may use all blocks. Classes covering multiple
 *   grades are restricted to the intersection of their grades' teachable blocks.
 * @param gradeBlockPairs - Optional map of grade NAME -> allowed [earlier, later]
 *   block pairs for double periods. A class may only use pairs present for
 *   EVERY grade it covers. When in effect, an unflagged class may hold two
 *   same-day lessons as a legal pair (never a third same-day lesson), raising
 *   its weekly lesson cap from 5 to 10 — but ONLY when its week cannot fit as
 *   singles: same-day pairs are hard-capped at max(0, lessons - usableDays),
 *   where usableDays = distinct days the class can actually use. Fixed slots
 *   already forming a same-day pair are always honored and count toward that
 *   budget. Classes flagged isDouble must pair (atomic pair meetings, odd
 *   lesson as a single, all on distinct days) and fail preflight with no
 *   legal pairs.
 */
export async function generateSchedules(
  teachers: Teacher[],
  classes: SchedulerClassEntry[],
  options: GeneratorOptions = {},
  blocks?: number[],
  teachableBlocksByGrade?: Record<string, number[]>,
  gradeBlockPairs?: Record<string, [number, number][]>
): Promise<GeneratorResult> {
  // Stamp the block configuration into module state. Re-applied after every
  // await below so interleaved calls can't corrupt this call's configuration.
  const blockState = resolveBlockState(blocks, teachableBlocksByGrade, gradeBlockPairs);
  applyBlockState(blockState);

  const {
    numOptions = 3,
    numAttempts = 50,
    onProgress,
    lockedTeachers = {},
    teachersNeedingStudyHalls = [],
    rules = [],
    seed,
    skipStudyHalls = false,
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

  // Build teacher availability lookup for study hall filtering
  const teacherAvailability = new Map<string, Set<number>>();
  for (const t of teachers) {
    if (t.availableDays || t.availableBlocks) {
      const days = t.availableDays || [...DAYS];
      const blocks = t.availableBlocks || [...activeBlocks];
      const validSlots = new Set<number>();
      for (const day of days) {
        const dayIdx = DAYS.indexOf(day);
        if (dayIdx === -1) continue;
        for (const block of blocks) {
          const blockIdx = activeBlocks.indexOf(block);
          if (blockIdx === -1) continue;
          validSlots.add(dayIdx * activeBlocks.length + blockIdx);
        }
      }
      teacherAvailability.set(t.name, validSlots);
    }
  }

  const sessions = buildSessions(classesToSchedule, teachers);

  // Identify co-taught classes (same grade+subject, different teachers)
  // These must be scheduled at the same time slot
  const cotaughtGroups = assignCotaughtGroups(sessions);

  // Teacher lunch hard constraint — only when a teachable-blocks map is in
  // effect AND the 'teacher_lunch' rule is enabled (missing rule = enabled)
  const teacherLunch = activeGradeBlocks && isRuleEnabled(rules, 'teacher_lunch')
    ? buildTeacherLunchFromClasses(classes)
    : undefined;

  // Fail closed: fixed slots alone must not fill every candidate lunch window
  if (teacherLunch) {
    assertFixedSlotsLeaveLunch(sessions, teacherLunch);
  }

  // Fixed-slot classes are pinned during back-to-back redistribution: the
  // solver honors user pins, and post-processing must not undo them.
  // Double-period classes are NOT pinned — redistribution may relocate a
  // same-day pair, but only atomically (both blocks together, to a legal
  // consecutive pair), via the pair-move path in redistributeOpenBlocks.
  const immovableClasses = new Set<string>();
  for (const c of classes) {
    if (c.fixedSlots && c.fixedSlots.length > 0) {
      immovableClasses.add(`${c.teacher}|${c.subject}`);
    }
  }

  // Pre-compute locked grade slots (slots occupied by locked teachers' classes)
  // Separate elective vs non-elective for proper conflict handling
  const lockedGradeSlots = new Map<string, Set<number>>();  // Non-elective
  const lockedElectiveGradeSlots = new Map<string, Set<number>>();  // Elective
  const lockedGradeSubjectDays = new Map<string, Set<number>>();  // "gradeName|subject" -> days
  const databaseGrades = new Set(grades);
  grades.forEach(g => {
    lockedGradeSlots.set(g, new Set());
    lockedElectiveGradeSlots.set(g, new Set());
  });

  // Build a lookup for elective status: "teacher|subject" -> isElective
  const electiveLookup = new Map<string, boolean>();
  classes.forEach(c => {
    const key = `${c.teacher}|${c.subject}`;
    if (c.isElective) {
      electiveLookup.set(key, true);
    }
  });

  if (isRefinementMode) {
    for (const [teacher, schedule] of Object.entries(lockedTeachers)) {
      DAYS.forEach((day, dayIdx) => {
        activeBlocks.forEach((block, blockIdx) => {
          const entry = schedule[day]?.[block];
          if (entry && entry[0] && isScheduledClass(entry[1])) {
            const slot = dayBlockToSlot(dayIdx, blockIdx);
            const subject = entry[1];
            const parsedGrades = parseGradesFromDatabase(entry[0], databaseGrades);

            // Check if this class is an elective
            const isElective = electiveLookup.get(`${teacher}|${subject}`) === true;

            if (parsedGrades.length === 0 && entry[0]) {
            }

            // Add to appropriate map based on elective status
            parsedGrades.forEach(g => {
              if (isElective) {
                lockedElectiveGradeSlots.get(g)?.add(slot);
              } else {
                lockedGradeSlots.get(g)?.add(slot);
              }
              // Track subject+day to prevent duplicate subjects per day per grade
              const subjectDayKey = `${g}|${subject}`;
              if (!lockedGradeSubjectDays.has(subjectDayKey)) {
                lockedGradeSubjectDays.set(subjectDayKey, new Set());
              }
              lockedGradeSubjectDays.get(subjectDayKey)!.add(dayIdx);
            });
          }
        });
      });
    }
    // Log total locked slots per grade
    for (const [grade, slots] of lockedGradeSlots) {
      if (slots.size > 0) {
      }
    }
    for (const [grade, slots] of lockedElectiveGradeSlots) {
      if (slots.size > 0) {
      }
    }
  }

  onProgress?.(0, numAttempts, 'Initializing solver...');
  await new Promise(resolve => setTimeout(resolve, 10));
  applyBlockState(blockState);

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
    applyBlockState(blockState);

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
      isRefinementMode ? lockedElectiveGradeSlots : undefined,
      5000, // 5 second timeout
      deprioritize.size > 0 ? deprioritize : undefined,
      rules,
      cotaughtGroups.size > 0 ? cotaughtGroups : undefined,
      isRefinementMode ? lockedGradeSubjectDays : undefined,
      teacherLunch
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

    // Merge locked teacher schedules back in (skip study halls when skipStudyHalls is true)
    const lockedStudyHallAssignments: StudyHallAssignment[] = [];
    const alreadyCoveredGroups = new Set<string>();
    const existingGradeStudyHallDays = new Map<string, Set<string>>();
    grades.forEach(g => existingGradeStudyHallDays.set(g, new Set()));

    if (isRefinementMode) {
      for (const [teacher, schedule] of Object.entries(lockedTeachers)) {
        ts[teacher] = JSON.parse(JSON.stringify(schedule));
        // Update grade schedules with ALL locked assignments (skip study halls if skipStudyHalls)
        DAYS.forEach(day => {
          activeBlocks.forEach(block => {
            const entry = schedule[day]?.[block];
            if (entry && entry[0] && isOccupiedBlock(entry[1])) {
              if (isStudyHall(entry[1])) {
                // When skipStudyHalls is true, don't preserve locked study halls
                // They'll be cleared and reassigned after saving
                if (!skipStudyHalls) {
                  // Track locked study hall assignments
                  lockedStudyHallAssignments.push({
                    group: entry[0],
                    teacher,
                    day,
                    block
                  });
                  // Mark this group as already covered
                  alreadyCoveredGroups.add(entry[0]);
                  // Update grade schedules for study hall grades (use database grades)
                  const shGrades = parseGradesFromDatabase(entry[0], databaseGrades);
                  shGrades.forEach(g => {
                    if (gs[g]) {
                      gs[g][day][block] = [teacher, BLOCK_TYPE_STUDY_HALL];
                      // Track that this grade has a study hall on this day
                      existingGradeStudyHallDays.get(g)?.add(day);
                    }
                  });
                }
                // When skipStudyHalls is true, the study hall slot becomes available
                // (we don't merge it into grade schedules, will reassign after saving)
              } else {
                // Regular class - always update grade schedules (use database grades)
                const parsedGrades = parseGradesFromDatabase(entry[0], databaseGrades);
                parsedGrades.forEach(g => {
                  // Initialize grade if it doesn't exist (needed for grades only taught by locked teachers)
                  if (!gs[g]) {
                    gs[g] = {};
                    DAYS.forEach(d => {
                      gs[g][d] = {};
                      activeBlocks.forEach(b => {
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

    // Add study halls only if study_hall_distribution rule is enabled and not skipped
    let shAssignments: StudyHallAssignment[];
    let shPlaced: number;

    if (isRuleEnabled(rules, 'study_hall_distribution') && !skipStudyHalls) {
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
        teacherAvailability,
        teacherLunch,
      });

      // Combine locked and new study hall assignments
      shAssignments = [...lockedStudyHallAssignments, ...newShAssignments];
      shPlaced = shAssignments.filter(sh => sh.teacher !== null).length;
    } else {
      // Skipped or rule disabled - no study halls assigned
      shAssignments = [];
      shPlaced = 0;
    }

    fillOpenBlocks(ts);
    // Only redistribute open blocks if the no_btb_open rule is enabled
    if (isRuleEnabled(rules, 'no_btb_open')) {
      redistributeOpenBlocks(
        ts, gs, fullTimeUnlocked, teacherLunch,
        immovableClasses.size > 0 ? immovableClasses : undefined
      );
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
 *
 * @param option - The schedule option to modify
 * @param teachers - ALL teachers (used for stats calculation)
 * @param seed - Random seed for shuffling
 * @param rules - Scheduling rules
 * @param excludedTeachers - Optional set of teacher names to exclude from study hall assignment
 * @param blocks - Ordered block numbers of the timetable (default: legacy [1,2,3,4,5])
 * @param teachableBlocksByGrade - Optional map of grade NAME -> block numbers that
 *   grade may be scheduled in; study halls only land in blocks teachable by their grade
 */
export function reassignStudyHalls(
  option: ScheduleOption,
  teachers: Teacher[],
  seed?: number,
  rules?: SchedulingRule[],
  excludedTeachers?: Set<string>,
  blocks?: number[],
  teachableBlocksByGrade?: Record<string, number[]>
): { success: boolean; newOption?: ScheduleOption; message?: string; noChanges?: boolean } {
  // Stamp the block configuration into module state (this function is fully
  // synchronous, so a single application at entry is deterministic per call)
  applyBlockState(resolveBlockState(blocks, teachableBlocksByGrade));

  // Teacher lunch hard constraint — derived from the placed class schedules
  // (no class list is available here). Same gating as generateSchedules.
  const teacherLunch = activeGradeBlocks && isRuleEnabled(rules, 'teacher_lunch')
    ? buildTeacherLunchFromSchedules(option.teacherSchedules)
    : undefined;

  // Track old study hall assignments for comparison
  const oldAssignments = new Set<string>();
  if (option.studyHallAssignments) {
    for (const sh of option.studyHallAssignments) {
      if (sh.teacher && sh.day && sh.block) {
        oldAssignments.add(`${sh.group}|${sh.teacher}|${sh.day}|${sh.block}`);
      }
    }
  }

  // Get eligible teachers (respecting both rule-based eligibility and UI exclusions)
  let eligible = getStudyHallEligible(teachers, rules);
  if (excludedTeachers && excludedTeachers.size > 0) {
    eligible = eligible.filter(name => !excludedTeachers.has(name));
  }

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

  // Build teacher availability lookup for study hall filtering
  const teacherAvailability = new Map<string, Set<number>>();
  for (const t of teachers) {
    if (t.availableDays || t.availableBlocks) {
      const days = t.availableDays || [...DAYS];
      const blocks = t.availableBlocks || [...activeBlocks];
      const validSlots = new Set<number>();
      for (const day of days) {
        const dayIdx = DAYS.indexOf(day);
        if (dayIdx === -1) continue;
        for (const block of blocks) {
          const blockIdx = activeBlocks.indexOf(block);
          if (blockIdx === -1) continue;
          validSlots.add(dayIdx * activeBlocks.length + blockIdx);
        }
      }
      teacherAvailability.set(t.name, validSlots);
    }
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
        for (const block of activeBlocks) {
          const entry = teacherSchedules[teacher]?.[day]?.[block];
          if (entry && !isScheduledClass(entry[1])) {
            teacherSchedules[teacher][day][block] = null;
          }
        }
      }
    }

    // Clear study halls from grade schedules
    for (const grade of Object.keys(gradeSchedules)) {
      for (const day of DAYS) {
        for (const block of activeBlocks) {
          const cell = gradeSchedules[grade]?.[day]?.[block];
          const entry = getFirstGradeEntry(cell);
          if (entry && isStudyHall(entry[1])) {
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
      teacherAvailability,
      teacherLunch,
    });
    const shPlaced = shAssignments.filter(sh => sh.teacher !== null).length;
    const shTotal = shAssignments.length;

    if (shPlaced < shTotal) {
      const unplaced = shAssignments.filter(sh => sh.teacher === null);

      // Check why each grade couldn't be placed
      for (const sh of unplaced) {
        const grade = sh.group;

        // Check grade's free slots in gradeSchedules
        const gradeSchedule = gradeSchedules[grade];
        const gradeFreeSlots: string[] = [];
        for (const day of DAYS) {
          for (const block of activeBlocks) {
            if (gradeSchedule?.[day]?.[block] === null) {
              gradeFreeSlots.push(`${day} B${block}`);
            }
          }
        }

        // Check eligible teacher open slots
        for (const teacherName of eligible) {
          const teacherOpenSlots: string[] = [];
          const schedule = teacherSchedules[teacherName];
          if (schedule) {
            for (const day of DAYS) {
              for (const block of activeBlocks) {
                if (schedule[day]?.[block] === null) {
                  teacherOpenSlots.push(`${day} B${block}`);
                }
              }
            }
          }
          if (teacherOpenSlots.length > 0) {
            // Check overlap with grade free slots
            const overlap = teacherOpenSlots.filter(s => gradeFreeSlots.includes(s));
          }
        }
      }
    }

    if (shPlaced === 0) {
      continue; // Try next seed
    }

    if (shPlaced < shTotal) {
      continue; // Try next seed for better result
    }

    // Fill any remaining null slots with OPEN
    for (const teacher of Object.keys(teacherSchedules)) {
      for (const day of DAYS) {
        for (const block of activeBlocks) {
          if (teacherSchedules[teacher][day][block] === null) {
            teacherSchedules[teacher][day][block] = ['', BLOCK_TYPE_OPEN];
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
