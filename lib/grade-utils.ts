// =============================================================================
// GRADE HELPER FUNCTIONS
// Shared utilities for parsing and comparing grade displays across the app.
// Grade displays can be: "6th Grade", "6th-11th Grade", "6th Grade, 7th Grade", "Kindergarten"
// =============================================================================

/**
 * Parse a grade display string into an array of grade numbers.
 * Handles: single grades, ranges, comma-separated lists, and Kindergarten.
 *
 * Examples:
 *   "6th Grade" → [6]
 *   "6th-11th Grade" → [6, 7, 8, 9, 10, 11]
 *   "6th Grade, 7th Grade" → [6, 7]
 *   "Kindergarten" → [0]
 *   "K, 1st, 2nd" → [0, 1, 2]
 */
export function parseGradeDisplayToNumbers(display: string): number[] {
  const grades: number[] = []

  // Handle Kindergarten (can appear alone or in comma-separated list)
  if (display.toLowerCase().includes('kindergarten') || display === 'K') {
    grades.push(0)
    // If ONLY kindergarten, return early
    if (!display.includes(',') && !display.match(/\d/)) {
      return grades
    }
  }

  // Handle comma-separated list like "6th Grade, 7th Grade" or "K, 1st, 2nd"
  if (display.includes(',')) {
    const parts = display.split(',').map(p => p.trim())
    for (const part of parts) {
      // Skip if already handled kindergarten
      if (part.toLowerCase().includes('kindergarten') || part === 'K') {
        continue
      }
      const num = part.match(/(\d+)/)
      if (num) {
        const n = parseInt(num[1])
        if (!grades.includes(n)) grades.push(n)
      }
    }
    return grades
  }

  // Handle range pattern like "6th-11th" or "6th-8th Grade"
  const rangeMatch = display.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)/)
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1])
    const end = parseInt(rangeMatch[2])
    for (let i = start; i <= end; i++) {
      if (!grades.includes(i)) grades.push(i)
    }
    return grades
  }

  // Single grade pattern
  const singleMatch = display.match(/(\d+)/)
  if (singleMatch) {
    const n = parseInt(singleMatch[1])
    if (!grades.includes(n)) grades.push(n)
  }

  return grades
}

/**
 * Check if two grade display strings overlap (share any common grades).
 * Use this instead of direct string comparison!
 *
 * Examples:
 *   gradesOverlap("6th Grade", "6th-11th Grade") → true (6th is in both)
 *   gradesOverlap("5th Grade", "6th-11th Grade") → false
 *   gradesOverlap("8th Grade", "8th Grade") → true
 */
export function gradesOverlap(gradeA: string, gradeB: string): boolean {
  // Fast path: exact match
  if (gradeA === gradeB) return true

  const numsA = parseGradeDisplayToNumbers(gradeA)
  const numsB = parseGradeDisplayToNumbers(gradeB)

  return numsA.some(n => numsB.includes(n))
}

/**
 * Check if two grade display strings represent the exact same set of grades.
 * Use this for identity matching (e.g., merging class entries), NOT for conflict detection.
 *
 * Examples:
 *   gradesEqual("6th Grade", "6th Grade") → true
 *   gradesEqual("6th-7th Grade", "6th Grade, 7th Grade") → true (same set, different format)
 *   gradesEqual("6th Grade", "6th-8th Grade") → false (different sets)
 *   gradesEqual("6th-11th Grade", "6th Grade") → false
 */
export function gradesEqual(gradeA: string, gradeB: string): boolean {
  if (gradeA === gradeB) return true

  const numsA = parseGradeDisplayToNumbers(gradeA).sort((a, b) => a - b)
  const numsB = parseGradeDisplayToNumbers(gradeB).sort((a, b) => a - b)

  if (numsA.length !== numsB.length) return false
  return numsA.every((n, i) => n === numsB[i])
}

/**
 * Check if a grade display includes a specific single grade.
 *
 * Examples:
 *   gradeDisplayIncludesGrade("6th-11th Grade", "8th Grade") → true
 *   gradeDisplayIncludesGrade("6th-11th Grade", "5th Grade") → false
 */
export function gradeDisplayIncludesGrade(display: string, singleGrade: string): boolean {
  return gradesOverlap(display, singleGrade)
}

/**
 * Convert a grade number to display name.
 *
 * Examples:
 *   gradeNumToDisplay(0) → "Kindergarten"
 *   gradeNumToDisplay(1) → "1st Grade"
 *   gradeNumToDisplay(6) → "6th Grade"
 */
export function gradeNumToDisplay(num: number): string {
  if (num === 0) return 'Kindergarten'
  const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th'
  return `${num}${suffix} Grade`
}

/**
 * Check if a grade display represents multiple grades (a multi-grade class).
 * Multi-grade classes include ranges like "6th-11th" or comma-separated like "6th, 7th".
 */
export function isMultiGradeDisplay(display: string): boolean {
  return parseGradeDisplayToNumbers(display).length > 1
}

/**
 * Format a grade display for compact display (UI and exports).
 * Converts comma-separated grades to range format when consecutive.
 *
 * Examples:
 *   "6th Grade" → "6th"
 *   "6th-11th Grade" → "6th-11th"
 *   "6th Grade, 7th Grade, 8th Grade" → "6th-8th"
 *   "6th Grade, 8th Grade" → "6th, 8th" (not consecutive)
 *   "Kindergarten" → "K"
 *   "Kindergarten, 1st Grade, 2nd Grade" → "K-2nd"
 *
 * @param display - The grade display string
 * @param includeGradeSuffix - Whether to include "Grade" suffix (default: false for compact)
 */
export function formatGradeDisplayCompact(display: string, includeGradeSuffix: boolean = false): string {
  // Handle empty or invalid input
  if (!display || display.trim() === '') return display

  // Check if already in range format (e.g., "6th-11th Grade")
  const rangeMatch = display.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?/)
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1])
    const end = parseInt(rangeMatch[2])
    const startSuffix = start === 1 ? 'st' : start === 2 ? 'nd' : start === 3 ? 'rd' : 'th'
    const endSuffix = end === 1 ? 'st' : end === 2 ? 'nd' : end === 3 ? 'rd' : 'th'
    return `${start}${startSuffix}-${end}${endSuffix}${includeGradeSuffix ? ' Grade' : ''}`
  }

  // Parse the grades to numbers
  const grades = parseGradeDisplayToNumbers(display)

  // Single grade
  if (grades.length === 1) {
    if (grades[0] === 0) return 'K'
    const suffix = grades[0] === 1 ? 'st' : grades[0] === 2 ? 'nd' : grades[0] === 3 ? 'rd' : 'th'
    return `${grades[0]}${suffix}${includeGradeSuffix ? ' Grade' : ''}`
  }

  // Multiple grades - sort them
  grades.sort((a, b) => a - b)

  // Check if consecutive
  const isConsecutive = grades.every((g, i) => i === 0 || g === grades[i - 1] + 1)

  if (isConsecutive && grades.length > 1) {
    // Format as range
    const start = grades[0]
    const end = grades[grades.length - 1]

    const formatGrade = (n: number) => {
      if (n === 0) return 'K'
      const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
      return `${n}${suffix}`
    }

    return `${formatGrade(start)}-${formatGrade(end)}${includeGradeSuffix ? ' Grade' : ''}`
  }

  // Not consecutive - format as comma-separated
  return grades.map(g => {
    if (g === 0) return 'K'
    const suffix = g === 1 ? 'st' : g === 2 ? 'nd' : g === 3 ? 'rd' : 'th'
    return `${g}${suffix}`
  }).join(', ') + (includeGradeSuffix ? ' Grade' : '')
}

/**
 * Parse a grade display string into an array of grade names.
 * Requires a list of valid grade names to filter against.
 *
 * Examples (with validGradeNames = ["Kindergarten", "1st Grade", ..., "11th Grade"]):
 *   parseGradeDisplayToNames("6th-8th Grade", validGradeNames) → ["6th Grade", "7th Grade", "8th Grade"]
 *   parseGradeDisplayToNames("6th Grade, 7th Grade", validGradeNames) → ["6th Grade", "7th Grade"]
 */
export function parseGradeDisplayToNames(gradeDisplay: string, validGradeNames: string[]): string[] {
  const grades: string[] = []

  // Check for Kindergarten
  if (gradeDisplay.toLowerCase().includes('kindergarten') || gradeDisplay === 'K') {
    const kGrade = validGradeNames.find(g => g.toLowerCase().includes('kindergarten') || g === 'K')
    if (kGrade) {
      grades.push(kGrade)
    }
    // If ONLY kindergarten, return early
    if (!gradeDisplay.includes(',') && !gradeDisplay.match(/\d/)) {
      return grades
    }
  }

  // Handle comma-separated list
  if (gradeDisplay.includes(',')) {
    const parts = gradeDisplay.split(',').map(p => p.trim())
    for (const part of parts) {
      if (part.toLowerCase().includes('kindergarten') || part === 'K') {
        continue
      }
      if (validGradeNames.includes(part)) {
        grades.push(part)
        continue
      }
      const numMatch = part.match(/(\d+)/)
      if (numMatch) {
        const num = parseInt(numMatch[1])
        const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th'
        const gradeName = `${num}${suffix} Grade`
        if (validGradeNames.includes(gradeName) && !grades.includes(gradeName)) {
          grades.push(gradeName)
        }
      }
    }
    return grades
  }

  // Handle range pattern
  const rangeMatch = gradeDisplay.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?/)
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1])
    const end = parseInt(rangeMatch[2])
    for (let i = start; i <= end; i++) {
      const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th'
      const gradeName = `${i}${suffix} Grade`
      if (validGradeNames.includes(gradeName)) {
        grades.push(gradeName)
      }
    }
    return grades
  }

  // Single grade - try exact match first
  if (validGradeNames.includes(gradeDisplay)) {
    grades.push(gradeDisplay)
    return grades
  }

  // Try to find matching grade by number
  const singleMatch = gradeDisplay.match(/(\d+)(?:st|nd|rd|th)/)
  if (singleMatch) {
    const num = parseInt(singleMatch[1])
    const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th'
    const gradeName = `${num}${suffix} Grade`
    if (validGradeNames.includes(gradeName)) {
      grades.push(gradeName)
    }
  }

  return grades
}

// =============================================================================
// ELECTIVE HELPER FUNCTIONS
// Electives are special: multiple electives can run at the same time for the
// same grades because students choose which to attend. Non-elective classes
// cannot share time slots with electives for overlapping grades.
// =============================================================================

/**
 * Type for class snapshot entries (minimal fields needed for elective checks).
 * This is a subset of ClassSnapshot from snapshot-utils.ts - any object with
 * these fields will work, whether from database queries or stored snapshots.
 * Note: teacher_name and subject_name can be null in the actual snapshot data.
 */
export interface ClassSnapshotEntry {
  teacher_name: string | null
  subject_name: string | null
  is_elective?: boolean
  is_cotaught?: boolean
  grade_ids?: string[]
}

/**
 * Check if a class (by teacher + subject) is marked as an elective in the snapshot.
 *
 * @param teacher - Teacher name
 * @param subject - Subject name
 * @param classesSnapshot - Array of class entries from snapshot
 * @returns true if the class is marked as an elective
 */
export function isClassElective(
  teacher: string,
  subject: string,
  classesSnapshot: ClassSnapshotEntry[] | undefined
): boolean {
  if (!classesSnapshot) return false
  return classesSnapshot.some(
    c => c.teacher_name === teacher && c.subject_name === subject && c.is_elective
  )
}

/**
 * Check if a class is co-taught (explicitly flagged with is_cotaught).
 *
 * @param teacher - Teacher name
 * @param subject - Subject name
 * @param classesSnapshot - Array of class entries from snapshot
 * @returns true if the class is explicitly marked as co-taught
 */
export function isClassCotaught(
  teacher: string,
  subject: string,
  classesSnapshot: ClassSnapshotEntry[] | undefined
): boolean {
  if (!classesSnapshot) return false
  return classesSnapshot.some(
    c => c.teacher_name === teacher && c.subject_name === subject && c.is_cotaught
  )
}

/**
 * Check if two classes can share the same time slot without conflict.
 *
 * Rules:
 * - Two electives CAN share a slot (students choose which to attend)
 * - A non-elective and an elective CANNOT share (students must attend the required class)
 * - Two non-electives CANNOT share (obvious conflict)
 *
 * @param teacherA - First class teacher
 * @param subjectA - First class subject
 * @param teacherB - Second class teacher
 * @param subjectB - Second class subject
 * @param classesSnapshot - Array of class entries from snapshot
 * @returns true if both classes can share the same slot
 */
export function canClassesShareSlot(
  teacherA: string,
  subjectA: string,
  teacherB: string,
  subjectB: string,
  classesSnapshot: ClassSnapshotEntry[] | undefined
): boolean {
  const isElectiveA = isClassElective(teacherA, subjectA, classesSnapshot)
  const isElectiveB = isClassElective(teacherB, subjectB, classesSnapshot)

  // Both must be electives to share a slot
  return isElectiveA && isElectiveB
}

/**
 * Check if a grade conflict should be ignored because both classes are electives.
 * Use this when detecting grade conflicts to skip elective-elective conflicts.
 *
 * @param existingTeacher - Teacher of existing class at the slot
 * @param existingSubject - Subject of existing class at the slot
 * @param newTeacher - Teacher of new class being placed
 * @param newSubject - Subject of new class being placed
 * @param classesSnapshot - Array of class entries from snapshot
 * @returns true if the conflict should be ignored (both are electives)
 */
export function shouldIgnoreGradeConflict(
  existingTeacher: string,
  existingSubject: string,
  newTeacher: string,
  newSubject: string,
  classesSnapshot: ClassSnapshotEntry[] | undefined
): boolean {
  return canClassesShareSlot(existingTeacher, existingSubject, newTeacher, newSubject, classesSnapshot)
}
