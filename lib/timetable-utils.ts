import { TimetableRow } from './types'

/**
 * Filter template rows for a specific grade.
 * Returns rows where grade_ids is empty/absent (all grades) OR includes the grade.
 * Sorted by sort_order.
 */
export function resolveRowsForGrade(
  rows: TimetableRow[],
  gradeId: string
): TimetableRow[] {
  return rows
    .filter(row => !row.grade_ids || row.grade_ids.length === 0 || row.grade_ids.includes(gradeId))
    .sort((a, b) => a.sort_order - b.sort_order)
}
