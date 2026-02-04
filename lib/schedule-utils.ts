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

import type { TeacherSchedule, OpenBlockLabels, ScheduleOption, StudyHallAssignment } from "./types"

const DAYS_ORDER = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
const BLOCKS_ORDER = [1, 2, 3, 4, 5]

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

  for (const day of DAYS_ORDER) {
    for (const block of BLOCKS_ORDER) {
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
// Recomputes teacherStats, backToBackIssues, and studyHallsPlaced from schedule data.
// Use this after ANY modification to a ScheduleOption (regen, swap, freeform, study hall changes).
// -----------------------------------------------------------------------------

export function recalculateOptionStats(option: ScheduleOption): ScheduleOption {
  const teacherStats = option.teacherStats.map(stat => {
    const schedule = option.teacherSchedules[stat.teacher]
    let teaching = 0, studyHall = 0, open = 0, backToBackIssues = 0

    for (const day of DAYS_ORDER) {
      let prevWasOpen = false
      for (const block of BLOCKS_ORDER) {
        const entry = schedule?.[day]?.[block]
        if (!entry || isOpenBlock(entry[1])) {
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
    option.teacherSchedules
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
  teacherSchedules: Record<string, TeacherSchedule>
): StudyHallAssignment[] {
  // Build set of actual study halls from schedule: "group|teacher|day|block"
  const actualStudyHalls = new Map<string, { teacher: string; day: string; block: number }>()
  for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
    for (const day of DAYS_ORDER) {
      for (const block of BLOCKS_ORDER) {
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
