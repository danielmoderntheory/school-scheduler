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
