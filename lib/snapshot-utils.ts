/**
 * Utilities for working with schedule snapshots
 *
 * Snapshots are stored in schedule_generations.stats and contain
 * the classes, teachers, rules, and grades as they were at generation time.
 */

import type { ClassEntry, Teacher } from './types'

// Snapshot types (as stored in stats column)
export interface ClassSnapshot {
  teacher_id: string | null
  teacher_name: string | null
  grade_id: string | null
  grade_ids: string[]
  grades: Array<{
    id: string
    name: string
    display_name: string
  }>
  is_elective: boolean
  subject_id: string | null
  subject_name: string | null
  days_per_week: number
  restrictions: Array<{
    restriction_type: 'fixed_slot' | 'available_days' | 'available_blocks'
    value: unknown
  }>
}

export interface TeacherSnapshot {
  id: string
  name: string
  status: 'full-time' | 'part-time'
  canSuperviseStudyHall: boolean
}

export interface RuleSnapshot {
  rule_key: string
  enabled: boolean
  config: Record<string, unknown> | null
}

export interface GradeSnapshot {
  id: string
  name: string
  display_name: string
}

export interface GenerationStats {
  backToBackIssues?: number
  studyHallsPlaced?: number
  quarter_name?: string | null
  classes_snapshot?: ClassSnapshot[]
  teachers_snapshot?: TeacherSnapshot[]
  rules_snapshot?: RuleSnapshot[]
  grades_snapshot?: GradeSnapshot[]
  allSolutions?: unknown[]
  snapshotVersion?: number // Timestamp when snapshot was last updated
}

/**
 * Check if a schedule has valid snapshots for all required data
 */
export function hasValidSnapshots(stats: GenerationStats | null | undefined): boolean {
  if (!stats) return false

  return (
    Array.isArray(stats.classes_snapshot) &&
    stats.classes_snapshot.length > 0 &&
    Array.isArray(stats.teachers_snapshot) &&
    stats.teachers_snapshot.length > 0
  )
}

/**
 * Parse classes from snapshot into the format expected by the scheduler
 */
export function parseClassesFromSnapshot(snapshot: ClassSnapshot[]): ClassEntry[] {
  return snapshot.map((c) => {
    // Parse restrictions into separate fields
    const fixedSlots: [string, number][] = []
    let availableDays = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']
    let availableBlocks = [1, 2, 3, 4, 5]

    for (const r of c.restrictions || []) {
      if (r.restriction_type === 'fixed_slot') {
        const v = r.value as { day: string; block: number }
        fixedSlots.push([v.day, v.block])
      } else if (r.restriction_type === 'available_days') {
        availableDays = r.value as string[]
      } else if (r.restriction_type === 'available_blocks') {
        availableBlocks = r.value as number[]
      }
    }

    // Build grade display string
    const gradeNames = c.grades?.map(g => g.display_name) || []
    const gradeDisplay = gradeNames.length > 1
      ? gradeNames.join(', ')
      : gradeNames[0] || ''

    return {
      teacher: c.teacher_name || '',
      grade: gradeDisplay, // Primary grade display (legacy compat)
      grades: gradeNames,
      gradeDisplay,
      subject: c.subject_name || '',
      daysPerWeek: c.days_per_week,
      isElective: c.is_elective || false,
      availableDays,
      availableBlocks,
      fixedSlots: fixedSlots.length > 0 ? fixedSlots : undefined,
    }
  })
}

/**
 * Parse teachers from snapshot into the format expected by the scheduler
 */
export function parseTeachersFromSnapshot(snapshot: TeacherSnapshot[]): Teacher[] {
  return snapshot.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    canSuperviseStudyHall: t.canSuperviseStudyHall,
  }))
}

/**
 * Parse rules from snapshot into the format expected by the scheduler
 */
export function parseRulesFromSnapshot(snapshot: RuleSnapshot[]): Array<{
  rule_key: string
  enabled: boolean
  config?: Record<string, unknown>
}> {
  return snapshot.map((r) => ({
    rule_key: r.rule_key,
    enabled: r.enabled,
    config: r.config || undefined,
  }))
}

// Types for current classes from the API
export interface CurrentClass {
  teacher: { id: string; name: string } | null
  grade: { id: string; name: string; display_name: string } | null
  grades?: Array<{ id: string; name: string; display_name: string }>
  grade_ids?: string[]
  subject: { id: string; name: string } | null
  days_per_week: number
  is_elective?: boolean
  restrictions?: Array<{
    restriction_type: string
    value: unknown
  }>
}

export interface ClassChange {
  type: 'added' | 'removed' | 'modified'
  teacherName: string
  gradeName: string
  subjectName: string
  details?: string // e.g., "days_per_week changed from 3 to 4"
}

export interface ChangeDetectionResult {
  hasChanges: boolean
  affectedTeachers: string[]
  changes: ClassChange[]
  summary: string // e.g., "3 teachers affected: Sarah (2 changes), Mike (1 change)"
}

/**
 * Create a unique key for a class based on teacher + grades + subject
 */
function classKey(teacherName: string, gradeIds: string[] | null | undefined, subjectName: string): string {
  const grades = gradeIds || []
  const sortedGrades = [...grades].sort()
  return `${teacherName}|${sortedGrades.join(',')}|${subjectName}`
}

/**
 * Compare restrictions for equality (only comparing restriction_type and value)
 */
function restrictionsEqual(
  a: Array<{ restriction_type: string; value: unknown }> | undefined,
  b: Array<{ restriction_type: string; value: unknown }> | undefined
): boolean {
  const aArr = a || []
  const bArr = b || []
  if (aArr.length !== bArr.length) return false

  // Extract only the fields we care about and sort by type
  const normalize = (arr: Array<{ restriction_type: string; value: unknown }>) =>
    arr
      .map(r => ({ restriction_type: r.restriction_type, value: r.value }))
      .sort((x, y) => x.restriction_type.localeCompare(y.restriction_type))

  return JSON.stringify(normalize(aArr)) === JSON.stringify(normalize(bArr))
}

/**
 * Detect changes between snapshot classes and current classes from the database
 */
export function detectClassChanges(
  snapshot: ClassSnapshot[],
  currentClasses: CurrentClass[]
): ChangeDetectionResult {
  const changes: ClassChange[] = []
  const affectedTeachersSet = new Set<string>()

  // Build maps for comparison
  const snapshotMap = new Map<string, ClassSnapshot>()
  for (const cls of snapshot) {
    const key = classKey(
      cls.teacher_name || '',
      cls.grade_ids || [],
      cls.subject_name || ''
    )
    snapshotMap.set(key, cls)
  }

  const currentMap = new Map<string, CurrentClass>()
  for (const cls of currentClasses) {
    // Get grade_ids from the class - handle both single grade and multi-grade
    const gradeIds = cls.grade_ids?.length
      ? cls.grade_ids
      : (cls.grade?.id ? [cls.grade.id] : [])

    const key = classKey(
      cls.teacher?.name || '',
      gradeIds,
      cls.subject?.name || ''
    )
    currentMap.set(key, cls)
  }

  // Find added and modified classes
  for (const [key, current] of currentMap) {
    const teacherName = current.teacher?.name || 'Unknown'
    const gradeName = current.grades?.map(g => g.display_name).join(', ')
      || current.grade?.display_name
      || 'Unknown'
    const subjectName = current.subject?.name || 'Unknown'

    const snapshotClass = snapshotMap.get(key)

    if (!snapshotClass) {
      // Class was added
      changes.push({
        type: 'added',
        teacherName,
        gradeName,
        subjectName,
      })
      affectedTeachersSet.add(teacherName)
    } else {
      // Check for modifications
      const modifications: string[] = []

      if (snapshotClass.days_per_week !== current.days_per_week) {
        modifications.push(`days/week: ${snapshotClass.days_per_week} → ${current.days_per_week}`)
      }

      if (!restrictionsEqual(snapshotClass.restrictions, current.restrictions)) {
        modifications.push('restrictions changed')
      }

      if (modifications.length > 0) {
        changes.push({
          type: 'modified',
          teacherName,
          gradeName,
          subjectName,
          details: modifications.join(', '),
        })
        affectedTeachersSet.add(teacherName)
      }
    }
  }

  // Find removed classes
  for (const [key, snapshotClass] of snapshotMap) {
    if (!currentMap.has(key)) {
      const teacherName = snapshotClass.teacher_name || 'Unknown'
      const gradeName = snapshotClass.grades?.map(g => g.display_name).join(', ') || 'Unknown'
      const subjectName = snapshotClass.subject_name || 'Unknown'

      changes.push({
        type: 'removed',
        teacherName,
        gradeName,
        subjectName,
      })
      affectedTeachersSet.add(teacherName)
    }
  }

  const affectedTeachers = Array.from(affectedTeachersSet).sort()

  // Build summary
  let summary = ''
  if (affectedTeachers.length > 0) {
    const teacherChangeCounts = new Map<string, number>()
    for (const change of changes) {
      teacherChangeCounts.set(
        change.teacherName,
        (teacherChangeCounts.get(change.teacherName) || 0) + 1
      )
    }

    const parts = affectedTeachers.map(t => {
      const count = teacherChangeCounts.get(t) || 0
      return `${t} (${count})`
    })

    summary = `${affectedTeachers.length} teacher${affectedTeachers.length !== 1 ? 's' : ''} affected: ${parts.join(', ')}`
  }

  return {
    hasChanges: changes.length > 0,
    affectedTeachers,
    changes,
    summary,
  }
}

/**
 * Check if a revision's schedules match what the classes_snapshot expects.
 * This helps detect if a revision has had updated classes applied or not.
 *
 * Returns true if the revision's schedules match the snapshot (changes applied),
 * false if they don't match (changes not yet applied to this revision).
 */
export function revisionMatchesSnapshot(
  teacherSchedules: Record<string, Record<string, Record<number, [string, string] | null>>>,
  classesSnapshot: ClassSnapshot[]
): boolean {
  // Count expected class sessions per teacher+subject from snapshot
  const expectedCounts = new Map<string, number>()
  for (const cls of classesSnapshot) {
    if (!cls.teacher_name || !cls.subject_name) continue
    const key = `${cls.teacher_name}|${cls.subject_name}`
    expectedCounts.set(key, (expectedCounts.get(key) || 0) + cls.days_per_week)
  }

  // Count actual class sessions in the revision's schedules
  const actualCounts = new Map<string, number>()
  for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
    for (const day of Object.values(schedule)) {
      for (const entry of Object.values(day)) {
        if (entry && entry[1] && entry[1] !== 'OPEN' && entry[1] !== 'Study Hall') {
          const subject = entry[1]
          const key = `${teacher}|${subject}`
          actualCounts.set(key, (actualCounts.get(key) || 0) + 1)
        }
      }
    }
  }

  // Compare: check if all expected classes are present with correct counts
  for (const [key, expectedCount] of expectedCounts) {
    const actualCount = actualCounts.get(key) || 0
    if (actualCount !== expectedCount) {
      return false // Mismatch found - revision doesn't match snapshot
    }
  }

  // Also check for classes in actual that aren't in expected (extra classes)
  for (const [key] of actualCounts) {
    if (!expectedCounts.has(key)) {
      return false // Extra class found - revision doesn't match snapshot
    }
  }

  return true // All counts match
}
