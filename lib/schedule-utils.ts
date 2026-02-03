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
