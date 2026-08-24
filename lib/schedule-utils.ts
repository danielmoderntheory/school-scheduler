// =============================================================================
// SCHEDULE UTILITY FUNCTIONS
// Shared utilities for working with schedule blocks, entries, and display.
//
// IMPORTANT CONCEPTS:
// - Block types (OPEN, Study Hall, <subject>) are the underlying truth used for ALL logic
// - Display labels are optional overlays that ONLY affect what's shown to users
// - Logic/comparisons ALWAYS use block types, NEVER display labels
// =============================================================================

// -----------------------------------------------------------------------------
// BLOCK TYPE CONSTANTS
// These are the canonical values stored in schedule entries.
// All logic should compare against these constants, not hardcoded strings.
// -----------------------------------------------------------------------------

/** Unassigned block - teacher has no scheduled class or responsibility */
export const BLOCK_TYPE_OPEN = "OPEN"

/** Study Hall - teacher is supervising a study hall (assigned during post-processing) */
export const BLOCK_TYPE_STUDY_HALL = "Study Hall"

// -----------------------------------------------------------------------------
// TEACHER STATUS CONSTANTS
// These are the canonical values for teacher employment status.
// -----------------------------------------------------------------------------

/** Full-time teacher - can supervise study halls, tracked for back-to-back issues */
export const TEACHER_STATUS_FULL_TIME = "full-time"

/** Part-time teacher - cannot supervise study halls */
export const TEACHER_STATUS_PART_TIME = "part-time"

/** Teacher status type */
export type TeacherStatus = typeof TEACHER_STATUS_FULL_TIME | typeof TEACHER_STATUS_PART_TIME

// -----------------------------------------------------------------------------
// TEACHER STATUS CHECKS
// Use these functions for logic that depends on teacher employment status.
// -----------------------------------------------------------------------------

/**
 * Check if a teacher is full-time.
 * Full-time teachers can supervise study halls and are tracked for back-to-back issues.
 */
export function isFullTime(status: string | null | undefined): boolean {
  return status === TEACHER_STATUS_FULL_TIME
}

/**
 * Check if a teacher is part-time.
 * Part-time teachers cannot supervise study halls.
 */
export function isPartTime(status: string | null | undefined): boolean {
  return status === TEACHER_STATUS_PART_TIME
}

// -----------------------------------------------------------------------------
// BLOCK TYPE CHECKS
// Use these functions for ALL logic that needs to know what type a block is.
// These check the underlying type, ignoring any display labels.
// -----------------------------------------------------------------------------

/**
 * Check if a subject represents an unassigned/open block.
 * OPEN blocks have no scheduled class or responsibility.
 */
export function isOpenBlock(subject: string | null | undefined): boolean {
  return subject === BLOCK_TYPE_OPEN
}

/**
 * Check if a subject represents a Study Hall.
 * Study Halls are assigned during post-processing and occupy the block.
 * In freeform mode, they must be treated like classes (can move, cannot drop).
 */
export function isStudyHall(subject: string | null | undefined): boolean {
  return subject === BLOCK_TYPE_STUDY_HALL
}

/**
 * Check if a subject represents an actual scheduled class.
 * This excludes OPEN blocks and Study Halls.
 */
export function isScheduledClass(subject: string | null | undefined): boolean {
  return !!subject && subject !== BLOCK_TYPE_OPEN && subject !== BLOCK_TYPE_STUDY_HALL
}

/**
 * Check if a block is "occupied" - has something scheduled that should be preserved.
 * This includes both classes AND Study Halls (but not OPEN).
 * Use this when determining if a block can be overwritten or needs to be moved.
 */
export function isOccupiedBlock(subject: string | null | undefined): boolean {
  return !!subject && subject !== BLOCK_TYPE_OPEN
}

/**
 * Check if a block is "available" - can have something scheduled into it.
 * Only OPEN blocks are available.
 */
export function isAvailableBlock(subject: string | null | undefined): boolean {
  return subject === BLOCK_TYPE_OPEN
}

// -----------------------------------------------------------------------------
// SCHEDULE ENTRY CHECKS
// Schedule entries are [grade, subject] tuples. These helpers work with them directly.
// -----------------------------------------------------------------------------

/** Schedule entry type - [grade_display, subject] */
export type ScheduleEntry = [string, string] | undefined | null

/**
 * Check if a schedule entry is an open/unassigned block.
 */
export function entryIsOpen(entry: ScheduleEntry): boolean {
  return !entry || isOpenBlock(entry[1])
}

/**
 * Check if a schedule entry is a Study Hall.
 */
export function entryIsStudyHall(entry: ScheduleEntry): boolean {
  return !!entry && isStudyHall(entry[1])
}

/**
 * Check if a schedule entry is an actual scheduled class (not OPEN or Study Hall).
 */
export function entryIsScheduledClass(entry: ScheduleEntry): boolean {
  return !!entry && isScheduledClass(entry[1])
}

/**
 * Check if a schedule entry is occupied (has class or Study Hall - not OPEN).
 * Use this when checking if a slot has something that needs to be preserved/moved.
 */
export function entryIsOccupied(entry: ScheduleEntry): boolean {
  return !!entry && isOccupiedBlock(entry[1])
}

/**
 * Check if a schedule entry is available for scheduling.
 */
export function entryIsAvailable(entry: ScheduleEntry): boolean {
  return entryIsOpen(entry)
}

// -----------------------------------------------------------------------------
// GRADE SCHEDULE CELL HELPERS
// Grade schedule cells can now be:
// - null (empty)
// - [string, string] (single class: [teacher, subject])
// - [string, string][] (multiple electives: [[teacher1, subject1], [teacher2, subject2], ...])
// These helpers safely extract data from grade schedule cells.
// -----------------------------------------------------------------------------

/** Grade schedule cell type - can be single tuple, array of tuples, or null */
export type GradeScheduleCell = [string, string] | [string, string][] | null

/**
 * Check if a grade schedule cell contains multiple entries (electives).
 */
export function isMultipleEntryCell(cell: GradeScheduleCell): cell is [string, string][] {
  return Array.isArray(cell) && cell.length > 0 && Array.isArray(cell[0])
}

/**
 * Extract a single entry from a grade schedule cell.
 * Returns the first entry if multiple, or the single entry, or null.
 * Use this when you only need one representative entry (e.g., for display or type checking).
 */
export function getFirstGradeEntry(cell: GradeScheduleCell): [string, string] | null {
  if (!cell) return null
  if (isMultipleEntryCell(cell)) {
    return cell[0] || null
  }
  return cell
}

/**
 * Get all entries from a grade schedule cell as an array.
 * Normalizes single entries to an array for consistent handling.
 */
export function getAllGradeEntries(cell: GradeScheduleCell): [string, string][] {
  if (!cell) return []
  if (isMultipleEntryCell(cell)) {
    return cell
  }
  return [cell]
}

/**
 * What a grade-view cell should DISPLAY for one block on one day.
 *
 * Collapses the three shapes a grade cell can take into one answer:
 * - several different subjects at once  -> "Elective" (no single teacher)
 * - several teachers, ONE subject       -> that subject, teachers joined " / "
 *                                         (a co-taught class, e.g. K/1 Science
 *                                          with two teachers — never an elective)
 * - a single entry                      -> the subject, or Study Hall
 * - empty / OPEN                        -> null (grades have no "OPEN")
 *
 * Shared by the timetable view and the poster export so both read a cell the
 * same way; callers that only want the subject can ignore `teacher`.
 */
export function resolveGradeCellDisplay(
  cell: GradeScheduleCell
): { subject: string; teacher: string } | null {
  if (!cell) return null

  if (isMultipleEntryCell(cell)) {
    const classEntries = cell.filter(
      ([, subject]) => subject && !isOpenBlock(subject) && !isStudyHall(subject)
    )
    if (classEntries.length > 1) {
      const subjects = new Set(classEntries.map(([, subject]) => subject))
      if (subjects.size === 1) {
        const teacher = classEntries.map(([t]) => t).filter(Boolean).join(" / ")
        return { subject: classEntries[0][1], teacher }
      }
      return { subject: "Elective", teacher: "" }
    }
    if (cell.length === 0) return null
    const [teacher, subject] = cell[0]
    if (!subject || isOpenBlock(subject)) return null
    if (isStudyHall(subject)) return { subject: BLOCK_TYPE_STUDY_HALL, teacher }
    return { subject, teacher }
  }

  const [teacher, subject] = cell
  if (!subject || isOpenBlock(subject)) return null
  if (isStudyHall(subject)) return { subject: BLOCK_TYPE_STUDY_HALL, teacher }
  return { subject, teacher }
}

// -----------------------------------------------------------------------------
// DISPLAY LABELS (Future Feature)
// Display labels allow renaming what OPEN blocks show as in exports/public views.
// The underlying block type remains OPEN - labels are purely cosmetic.
//
// Structure (to be implemented when needed):
// - Labels stored separately from schedule data (e.g., in generation metadata)
// - Key: "teacher|day|block" -> display label
// - Only affects export/display, never logic
// -----------------------------------------------------------------------------

/**
 * Type for display label overrides.
 * Maps "teacher|day|block" to custom display text.
 * Only applies to OPEN blocks - classes and Study Halls keep their names.
 */
export type DisplayLabelMap = Map<string, string>

/**
 * Create a key for looking up display labels.
 */
export function makeDisplayLabelKey(teacher: string, day: string, block: number): string {
  return `${teacher}|${day}|${block}`
}

/**
 * Get the display text for a schedule entry.
 * Checks for custom display label first (for OPEN blocks only),
 * falls back to the actual subject.
 *
 * @param entry - The schedule entry [grade, subject]
 * @param teacher - Teacher name (for label lookup)
 * @param day - Day of week (for label lookup)
 * @param block - Block number (for label lookup)
 * @param displayLabels - Optional map of custom display labels
 * @returns Display text to show the user
 */
export function getEntryDisplayText(
  entry: ScheduleEntry,
  teacher: string,
  day: string,
  block: number,
  displayLabels?: DisplayLabelMap
): string {
  if (!entry) return BLOCK_TYPE_OPEN

  const subject = entry[1]

  // Only OPEN blocks can have custom display labels
  // Study Halls and classes always show their actual subject
  if (isOpenBlock(subject) && displayLabels) {
    const key = makeDisplayLabelKey(teacher, day, block)
    const customLabel = displayLabels.get(key)
    if (customLabel) return customLabel
  }

  return subject
}

/**
 * Get the block type for logic purposes, ignoring any display labels.
 * Use this when you need to know what a block actually IS, not what it displays as.
 */
export function getBlockType(entry: ScheduleEntry): typeof BLOCK_TYPE_OPEN | typeof BLOCK_TYPE_STUDY_HALL | string {
  if (!entry) return BLOCK_TYPE_OPEN
  return entry[1]
}

// -----------------------------------------------------------------------------
// OPEN BLOCK LABEL UTILITIES
// For assigning custom display labels to OPEN blocks.
// Labels are indexed by "Nth open block" (counting both OPEN and Study Hall),
// but only OPEN blocks can have labels (Study Halls always show their grade).
// -----------------------------------------------------------------------------

import type { TeacherSchedule, GradeSchedule, OpenBlockLabels, ScheduleOption, StudyHallAssignment } from "./types"
import { BLOCKS } from "./types"
import { parseGradeDisplayToNames } from "./grade-utils"

const DAYS_ORDER = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
/** Legacy 5-block fallback, used only when schedule data contains no block keys. */
const LEGACY_BLOCKS_ORDER: number[] = [...BLOCKS]

// -----------------------------------------------------------------------------
// BLOCK LIST DERIVATION
// Saved schedules carry whatever block numbers the solver used (5-block legacy,
// 9-block 26/27, ...). Deriving the block list from the data itself keeps stats
// and open-block indexing correct for any format without threading a template.
// -----------------------------------------------------------------------------

/** Minimal structural type matching both TeacherSchedule and GradeSchedule. */
type AnySchedule = { [day: string]: { [block: number]: unknown } }

/**
 * Sorted union of block numbers actually present in the given schedule maps
 * (e.g. an option's teacherSchedules and gradeSchedules).
 * Falls back to the legacy 5-block list when no block keys exist at all.
 */
export function getScheduleBlockNumbers(
  ...scheduleMaps: Array<Record<string, TeacherSchedule | GradeSchedule> | undefined | null>
): number[] {
  const blocks = new Set<number>()
  for (const map of scheduleMaps) {
    if (!map) continue
    for (const schedule of Object.values(map)) {
      collectBlockKeys(schedule as AnySchedule, blocks)
    }
  }
  return blocks.size > 0 ? [...blocks].sort((a, b) => a - b) : [...LEGACY_BLOCKS_ORDER]
}

/** Sorted block numbers present in a single schedule, with legacy fallback. */
function getBlocksForSchedule(schedule: TeacherSchedule | null | undefined): number[] {
  const blocks = new Set<number>()
  collectBlockKeys(schedule as AnySchedule | null | undefined, blocks)
  return blocks.size > 0 ? [...blocks].sort((a, b) => a - b) : [...LEGACY_BLOCKS_ORDER]
}

function collectBlockKeys(schedule: AnySchedule | null | undefined, out: Set<number>): void {
  if (!schedule) return
  for (const day of Object.values(schedule)) {
    if (!day) continue
    for (const key of Object.keys(day)) {
      const n = Number(key)
      if (Number.isFinite(n)) out.add(n)
    }
  }
}

export interface OpenBlockInfo {
  day: string
  block: number
  type: "open" | "study-hall"
}

/**
 * Get all open blocks (OPEN + Study Hall) for a teacher in reading order (Mon B1 → Fri B5).
 * Both types count toward the index, but only OPEN blocks can have custom labels.
 */
export function getTeacherOpenBlocks(schedule: TeacherSchedule): OpenBlockInfo[] {
  const openBlocks: OpenBlockInfo[] = []
  const blocksOrder = getBlocksForSchedule(schedule)

  for (const day of DAYS_ORDER) {
    for (const block of blocksOrder) {
      const entry = schedule[day]?.[block]
      if (!entry) {
        // null entry = OPEN
        openBlocks.push({ day, block, type: "open" })
      } else if (isOpenBlock(entry[1])) {
        openBlocks.push({ day, block, type: "open" })
      } else if (isStudyHall(entry[1])) {
        openBlocks.push({ day, block, type: "study-hall" })
      }
    }
  }

  return openBlocks
}

/**
 * Find the openIndex (0-based) for a specific cell.
 * Returns the index if this is an OPEN or Study Hall block, null otherwise.
 * Index counts BOTH OPEN and Study Hall blocks in reading order.
 */
export function getOpenBlockIndex(schedule: TeacherSchedule, day: string, block: number): number | null {
  const openBlocks = getTeacherOpenBlocks(schedule)
  const idx = openBlocks.findIndex(b => b.day === day && b.block === block)
  return idx >= 0 ? idx : null
}

/**
 * Get the open block info at a specific cell.
 * Returns the info including type, or null if not an open block.
 */
export function getOpenBlockAt(schedule: TeacherSchedule, day: string, block: number): (OpenBlockInfo & { openIndex: number }) | null {
  const openBlocks = getTeacherOpenBlocks(schedule)
  const idx = openBlocks.findIndex(b => b.day === day && b.block === block)
  if (idx >= 0) {
    return { ...openBlocks[idx], openIndex: idx }
  }
  return null
}

/**
 * Get label for a teacher's Nth open block.
 * Returns undefined if no label is set, or if the block is a Study Hall (Study Halls can't have custom labels).
 */
export function getOpenBlockLabel(
  labels: OpenBlockLabels | undefined,
  teacher: string,
  openIndex: number,
  blockType: "open" | "study-hall"
): string | undefined {
  // Study Halls always show their grade, never custom labels
  if (blockType === "study-hall") return undefined
  if (!labels) return undefined
  return labels.assignments[teacher]?.[openIndex]
}

/**
 * Set a label for a teacher's Nth open block.
 * Returns a new OpenBlockLabels object with the label set.
 * If label is undefined or empty, removes the assignment.
 */
export function setOpenBlockLabel(
  labels: OpenBlockLabels | undefined,
  teacher: string,
  openIndex: number,
  label: string | undefined
): OpenBlockLabels {
  const result: OpenBlockLabels = labels
    ? { availableLabels: [...labels.availableLabels], assignments: { ...labels.assignments } }
    : { availableLabels: [], assignments: {} }

  // Ensure teacher entry exists
  if (!result.assignments[teacher]) {
    result.assignments[teacher] = {}
  } else {
    result.assignments[teacher] = { ...result.assignments[teacher] }
  }

  if (label && label.trim()) {
    // Set the label
    result.assignments[teacher][openIndex] = label.trim()

    // Add to available labels if not already present
    if (!result.availableLabels.includes(label.trim())) {
      result.availableLabels = [...result.availableLabels, label.trim()]
    }
  } else {
    // Remove the label
    delete result.assignments[teacher][openIndex]

    // Clean up empty teacher entry
    if (Object.keys(result.assignments[teacher]).length === 0) {
      delete result.assignments[teacher]
    }
  }

  return result
}

// -----------------------------------------------------------------------------
// SCHEDULE OPTION STATS RECALCULATION
// Counts grade-sessions (blocks used per grade), correctly handling co-taught dedup
// and elective slot dedup. Shared between classes page and generate page.
// -----------------------------------------------------------------------------

export interface BlockCountClass {
  gradeKey: string        // Unique key per grade (id or display_name)
  subjectKey: string      // Unique key per subject (id or name)
  daysPerWeek: number
  isElective: boolean
  isCotaught: boolean
  fixedSlots?: Array<{ day: string; block: number }>
}

/**
 * Calculate per-grade block counts from a list of classes.
 *
 * Co-taught classes (is_cotaught=true) sharing the same grade+subject only count once.
 * Electives count per unique fixed slot per grade (multiple electives at the same
 * time slot only count once for a given grade).
 *
 * Returns a Map of gradeKey → block count.
 */
export function calculateGradeBlocks(classes: BlockCountClass[]): Map<string, number> {
  const gradeCapacity = new Map<string, number>()
  const seenCotaughtGradeSubject = new Set<string>()
  const seenElectiveSlots = new Set<string>()

  for (const cls of classes) {
    if (cls.isElective) {
      // Electives: count each unique time slot once per grade
      for (const slot of (cls.fixedSlots || [])) {
        const slotKey = `${cls.gradeKey}:${slot.day}:${slot.block}`
        if (seenElectiveSlots.has(slotKey)) continue
        seenElectiveSlots.add(slotKey)
        gradeCapacity.set(cls.gradeKey, (gradeCapacity.get(cls.gradeKey) || 0) + 1)
      }
    } else if (cls.isCotaught) {
      // Co-taught: only count the first occurrence of this grade+subject
      const key = `${cls.gradeKey}:${cls.subjectKey}`
      if (seenCotaughtGradeSubject.has(key)) continue
      seenCotaughtGradeSubject.add(key)
      gradeCapacity.set(cls.gradeKey, (gradeCapacity.get(cls.gradeKey) || 0) + cls.daysPerWeek)
    } else {
      // Regular class: always counts
      gradeCapacity.set(cls.gradeKey, (gradeCapacity.get(cls.gradeKey) || 0) + cls.daysPerWeek)
    }
  }

  return gradeCapacity
}

// -----------------------------------------------------------------------------
// Co-taught display groups — shared between classes page and generate page.
// Only includes classes explicitly flagged is_cotaught.
// -----------------------------------------------------------------------------

export interface CotaughtDisplayClass {
  teacherName: string
  gradeKey: string       // For grouping (e.g., sorted grade IDs or names)
  gradeDisplay: string   // For display (e.g., "5th Grade" or "6th-11th")
  subjectKey: string     // For grouping (e.g., subject ID or name)
  subjectName: string    // For display
  isCotaught: boolean
}

export interface CotaughtGroup {
  gradeDisplay: string
  subjectName: string
  teacherNames: string[]
}

/**
 * Build co-taught display groups from a list of classes.
 * Only includes classes explicitly flagged is_cotaught, grouped by grade+subject.
 */
export function buildCotaughtGroups(classes: CotaughtDisplayClass[]): CotaughtGroup[] {
  const groupMap = new Map<string, { teachers: Set<string>; gradeDisplay: string; subjectName: string }>()

  for (const c of classes) {
    if (!c.isCotaught) continue

    const key = `${c.gradeKey}|${c.subjectKey}`
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        teachers: new Set([c.teacherName]),
        gradeDisplay: c.gradeDisplay,
        subjectName: c.subjectName,
      })
    } else {
      groupMap.get(key)!.teachers.add(c.teacherName)
    }
  }

  const groups: CotaughtGroup[] = []
  for (const { teachers, gradeDisplay, subjectName } of groupMap.values()) {
    if (teachers.size > 1) {
      groups.push({
        gradeDisplay,
        subjectName,
        teacherNames: Array.from(teachers),
      })
    }
  }
  return groups
}

// -----------------------------------------------------------------------------
// TEACHER LUNCH DESIGNATION
// School decision: a teacher's daily lunch is NOT an OPEN block. On quarters
// whose timetable template masks per-grade blocks (each band's lunch window),
// the solvers guarantee every teacher at least one free block among their
// candidate lunch windows each day, and designate EXACTLY ONE of them as
// Lunch. Lunch-aware stats (open counts, back-to-back OPEN) exclude the
// designated block. The designation rule below is locked to match both
// solvers (backend/solver.py designate_teacher_lunch and the JS fallback).
// -----------------------------------------------------------------------------

export interface LunchContext {
  /**
   * Teachable blocks per grade, keyed by grade DISPLAY NAME (the same key
   * convention as schedule entries). A template block missing from a grade's
   * list is that band's lunch window.
   */
  teachableBlocksByGrade: Record<string, number[]>
  /** Full block list of the quarter's timetable template. */
  blocks: number[]
  /**
   * The grades' TRUE lunch blocks (template-derived: a masked block paired
   * with a break row in the same time window), keyed by grade DISPLAY NAME.
   * When present it wins over the masked-block approximation — required once
   * a grade has masked blocks that are NOT lunch (e.g. a surrendered
   * afternoon block). Absent = legacy derivation from teachableBlocksByGrade.
   */
  lunchBlocksByGrade?: Record<string, number[]>
  /**
   * Blocks each teacher could ever hold a CLASS in (per class: intersection
   * of its grades' teachable blocks; per teacher: union over their classes),
   * keyed by teacher name. An idle (empty/OPEN) cell at a block OUTSIDE the
   * teacher's set is not schedulable free time — e.g. a K-5-only teacher
   * during Block 9 after K-5 surrendered it — so it is not counted as open
   * and never forms a back-to-back pair, exactly like the designated lunch.
   * Study halls at such blocks still count normally (supervision is real).
   * A teacher missing from the map gets no filtering. Both solvers apply the
   * same rule internally; this keeps page-recalculated stats in parity.
   */
  usableBlocksByTeacher?: Record<string, number[]>
}

/**
 * A teacher's candidate lunch windows, derived from the grades they actually
 * teach in this schedule: the union, over those grades, of template blocks
 * NOT teachable for the grade. Mirrors the history page's no-lunch validation
 * (taught grades are parsed from scheduled-class entries' grade displays;
 * OPEN blocks and study halls don't establish taught grades). Returns []
 * when nothing can be derived (teacher teaches no classes, or none of their
 * grades are masked) — callers then skip lunch designation entirely,
 * preserving legacy behavior for that teacher.
 */
export function getTeacherLunchCandidates(
  schedule: TeacherSchedule | undefined | null,
  lunchContext: LunchContext
): number[] {
  if (!schedule) return []
  const gradeNames = Object.keys(lunchContext.teachableBlocksByGrade)
  if (gradeNames.length === 0) return []

  const taughtGrades = new Set<string>()
  for (const day of DAYS_ORDER) {
    for (const block of lunchContext.blocks) {
      const entry = schedule[day]?.[block]
      if (!entry || !isScheduledClass(entry[1])) continue
      for (const g of parseGradeDisplayToNames(entry[0], gradeNames)) {
        taughtGrades.add(g)
      }
    }
  }

  const candidates = new Set<number>()
  for (const grade of taughtGrades) {
    if (lunchContext.lunchBlocksByGrade && grade in lunchContext.lunchBlocksByGrade) {
      // Explicit template-derived lunch blocks win (they distinguish lunch
      // from other masked blocks, e.g. a surrendered afternoon block).
      // A grade MISSING from the map falls through to the masked-complement
      // path below — defense in depth so an incomplete map can only ever
      // over-approximate lunch, never drop a teacher's windows entirely.
      for (const block of lunchContext.lunchBlocksByGrade[grade] ?? []) {
        if (lunchContext.blocks.includes(block)) candidates.add(block)
      }
      continue
    }
    const teachable = lunchContext.teachableBlocksByGrade[grade]
    if (!teachable) continue
    for (const block of lunchContext.blocks) {
      if (!teachable.includes(block)) candidates.add(block)
    }
  }
  return [...candidates].sort((a, b) => a - b)
}

/**
 * Pick the teacher's designated Lunch block for ONE day.
 *
 * Rule (locked, matches both solvers): among the day's FREE candidate
 * windows (cell empty or OPEN; Study Hall counts as occupied), pick the
 * block whose exclusion from the day's "open" pattern minimizes that day's
 * back-to-back-OPEN count, ties broken by lowest block number. For the
 * pattern, empty/OPEN/Study Hall all count as open (a study hall is "open"
 * for back-to-back purposes but not free for lunch). Adjacency is positional
 * in blocksOrder.
 *
 * Returns null when no candidate window is free that day (guaranteed not to
 * happen for solver output, but manual edits can occupy all windows) — then
 * nothing is designated and the day's stats count exactly as before.
 */
export function designateTeacherLunch(
  daySchedule: { [block: number]: [string, string] | null } | undefined | null,
  candidates: number[],
  blocksOrder: number[]
): number | null {
  if (!candidates || candidates.length === 0) return null
  const sched = daySchedule || {}

  const free = candidates
    .filter(b => {
      if (!blocksOrder.includes(b)) return false
      const entry = sched[b]
      return !entry || isOpenBlock(entry[1])
    })
    .sort((a, b) => a - b)
  if (free.length === 0) return null

  // Day "open" pattern: empty, OPEN, and Study Hall all count as open
  const openFlags = blocksOrder.map(b => {
    const entry = sched[b]
    return !entry || isOpenBlock(entry[1]) || isStudyHall(entry[1])
  })

  const dayBtbExcluding = (excludeIdx: number): number => {
    let count = 0
    for (let i = 0; i < blocksOrder.length - 1; i++) {
      if (openFlags[i] && i !== excludeIdx && openFlags[i + 1] && i + 1 !== excludeIdx) {
        count++
      }
    }
    return count
  }

  let best: number | null = null
  let bestCount: number | null = null
  for (const b of free) {
    const c = dayBtbExcluding(blocksOrder.indexOf(b))
    if (bestCount === null || c < bestCount) {
      best = b
      bestCount = c
    }
  }
  return best
}

// -----------------------------------------------------------------------------
// Recomputes teacherStats, backToBackIssues, and studyHallsPlaced from schedule data.
// Use this after ANY modification to a ScheduleOption (regen, swap, freeform, study hall changes).
//
// lunchContext (optional): pass on template-driven quarters with per-grade
// block masking so each teacher-day's designated Lunch block (see
// designateTeacherLunch) is excluded from `open` and back-to-back counts,
// keeping post-edit stats aligned with the solvers' lunch-aware stats.
// Omitting it preserves the exact legacy behavior (save paths, legacy quarters).
// -----------------------------------------------------------------------------

export function recalculateOptionStats(option: ScheduleOption, lunchContext?: LunchContext): ScheduleOption {
  // Derive the block list from the option's own data so stats are correct for
  // any block format (5-block legacy, 9-block, ...). Iterating the sorted list
  // positionally means two blocks are "back-to-back" only when they are
  // adjacent in this list, regardless of numeric gaps.
  const blocksOrder = getScheduleBlockNumbers(option.teacherSchedules, option.gradeSchedules)

  const teacherStats = option.teacherStats.map(stat => {
    const schedule = option.teacherSchedules[stat.teacher]
    // Candidate lunch windows for this teacher; [] disables lunch handling
    // for this teacher (legacy callers and legacy quarters stay byte-identical).
    const lunchCandidates = lunchContext ? getTeacherLunchCandidates(schedule, lunchContext) : []
    // Blocks this teacher could ever hold a class in; null = no filtering
    // (legacy callers, or teacher missing from the map).
    const usableList = lunchContext?.usableBlocksByTeacher?.[stat.teacher]
    const usable = usableList ? new Set(usableList) : null
    let teaching = 0, studyHall = 0, open = 0, backToBackIssues = 0

    for (const day of DAYS_ORDER) {
      const lunchBlock = lunchCandidates.length > 0
        ? designateTeacherLunch(schedule?.[day], lunchCandidates, blocksOrder)
        : null
      let prevWasOpen = false
      for (const block of blocksOrder) {
        const entry = schedule?.[day]?.[block]
        if (block === lunchBlock) {
          // Designated lunch: neither open nor used, and it breaks OPEN chains
          prevWasOpen = false
        } else if ((!entry || isOpenBlock(entry[1])) && usable && !usable.has(block)) {
          // Idle cell at a class-unusable block: not schedulable free time —
          // neither open nor part of a back-to-back pair (mirrors both solvers)
          prevWasOpen = false
        } else if (!entry || isOpenBlock(entry[1])) {
          open++
          if (prevWasOpen && isFullTime(stat.status)) backToBackIssues++
          prevWasOpen = true
        } else if (isStudyHall(entry[1])) {
          studyHall++
          prevWasOpen = true
        } else {
          teaching++
          prevWasOpen = false
        }
      }
    }

    return { ...stat, teaching, studyHall, open, totalUsed: teaching + studyHall, backToBackIssues }
  })

  // Reconcile studyHallAssignments against actual schedule data.
  // This catches stale entries from regen, freeform, swap, or any other modification
  // that moved/removed study halls without updating the assignments array.
  const reconciledAssignments = reconcileStudyHallAssignments(
    option.studyHallAssignments,
    option.teacherSchedules,
    blocksOrder
  )

  return {
    ...option,
    teacherStats,
    studyHallAssignments: reconciledAssignments,
    backToBackIssues: teacherStats.reduce((sum, s) => sum + s.backToBackIssues, 0),
    studyHallsPlaced: teacherStats.reduce((sum, s) => sum + s.studyHall, 0),
  }
}

/**
 * Reconcile studyHallAssignments against the actual teacher schedules.
 * - Stale entries (assignment says placed, but schedule disagrees) → marked unplaced
 * - Study halls in schedule but missing from assignments → added
 * - Correct entries → kept as-is
 */
function reconcileStudyHallAssignments(
  assignments: StudyHallAssignment[],
  teacherSchedules: Record<string, TeacherSchedule>,
  blocksOrder: number[]
): StudyHallAssignment[] {
  // Build set of actual study halls from schedule: "group|teacher|day|block"
  const actualStudyHalls = new Map<string, { teacher: string; day: string; block: number }>()
  for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
    for (const day of DAYS_ORDER) {
      for (const block of blocksOrder) {
        const entry = schedule?.[day]?.[block]
        if (entry && isStudyHall(entry[1])) {
          const group = entry[0] // grade display name is the group
          actualStudyHalls.set(`${group}|${teacher}|${day}|${block}`, { teacher, day, block })
        }
      }
    }
  }

  // Track which actual study halls are accounted for by assignments
  const matchedActuals = new Set<string>()

  // Reconcile existing assignments
  const reconciled: StudyHallAssignment[] = assignments.map(sh => {
    if (sh.teacher && sh.day && sh.block != null) {
      const key = `${sh.group}|${sh.teacher}|${sh.day}|${sh.block}`
      if (actualStudyHalls.has(key)) {
        // Assignment matches schedule — keep it
        matchedActuals.add(key)
        return sh
      }
      // Assignment is stale — study hall not in schedule at claimed location
      // Check if this group exists elsewhere in the schedule
      for (const [actualKey, loc] of actualStudyHalls) {
        if (actualKey.startsWith(`${sh.group}|`) && !matchedActuals.has(actualKey)) {
          matchedActuals.add(actualKey)
          return { ...sh, teacher: loc.teacher, day: loc.day, block: loc.block }
        }
      }
      // Group not found anywhere — mark as unplaced
      return { ...sh, teacher: null, day: null, block: null }
    }
    // Already unplaced — check if it was placed since (e.g., manual placement)
    for (const [actualKey, loc] of actualStudyHalls) {
      if (actualKey.startsWith(`${sh.group}|`) && !matchedActuals.has(actualKey)) {
        matchedActuals.add(actualKey)
        return { ...sh, teacher: loc.teacher, day: loc.day, block: loc.block }
      }
    }
    return sh
  })

  // Add any study halls found in schedule but not in assignments at all
  for (const [key, loc] of actualStudyHalls) {
    if (!matchedActuals.has(key)) {
      const group = key.split('|')[0]
      reconciled.push({ group, teacher: loc.teacher, day: loc.day, block: loc.block })
    }
  }

  return reconciled
}
