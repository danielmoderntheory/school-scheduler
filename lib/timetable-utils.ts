import { BLOCKS, TimetableRow, TimetableTemplate } from './types'

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

/**
 * All block numbers defined by a template, sorted ascending.
 * This is the source of truth for a quarter's block count — a 5-block quarter
 * and a 9-block quarter differ only in their template's block rows.
 * Falls back to the legacy 5-block list when no template is available.
 */
export function getTemplateBlocks(
  template: Pick<TimetableTemplate, 'rows'> | null | undefined
): number[] {
  if (!template?.rows?.length) return [...BLOCKS]
  const blocks = new Set<number>()
  for (const row of template.rows) {
    if (row.type === 'block' && typeof row.blockNumber === 'number') {
      blocks.add(row.blockNumber)
    }
  }
  return blocks.size > 0 ? [...blocks].sort((a, b) => a - b) : [...BLOCKS]
}

/**
 * Consecutive block pairs a grade can hold a double period in.
 * Two blocks pair when they are adjacent in the grade's RESOLVED row list with
 * no non-block row (break, lunch, transition) between them — so a pair never
 * straddles the morning break or the grade's own lunch, but blocks separated
 * only by another band's lunch row (scoped away from this grade) do pair.
 * Returns [earlierBlock, laterBlock] tuples sorted by position.
 */
export function getPairableBlocksForGrade(
  template: Pick<TimetableTemplate, 'rows'> | null | undefined,
  gradeId: string
): [number, number][] {
  if (!template?.rows?.length) return []
  const rows = resolveRowsForGrade(template.rows, gradeId)
  const pairs: [number, number][] = []
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]
    const b = rows[i + 1]
    if (
      a.type === 'block' && typeof a.blockNumber === 'number' &&
      b.type === 'block' && typeof b.blockNumber === 'number'
    ) {
      pairs.push([a.blockNumber, b.blockNumber])
    }
  }
  return pairs
}

/**
 * Cross-block conflicts for a grade: [block, conflictingBlock] pairs from the
 * grade's resolved block rows' `conflictsWith` fields. A pair [b, c] means the
 * grade's block b runs at a real time overlapping block c's window, so a
 * teacher teaching this grade at block b must have nothing at block c that
 * day (and vice versa — the solvers enforce it symmetrically). Only conflicts
 * naming real template blocks are emitted.
 */
export function getBlockConflictsForGrade(
  template: Pick<TimetableTemplate, 'rows'> | null | undefined,
  gradeId: string
): [number, number][] {
  if (!template?.rows?.length) return []
  const templateBlocks = new Set(getTemplateBlocks(template))
  const pairs: [number, number][] = []
  for (const row of resolveRowsForGrade(template.rows, gradeId)) {
    if (row.type !== 'block' || typeof row.blockNumber !== 'number') continue
    for (const c of row.conflictsWith ?? []) {
      if (typeof c === 'number' && c !== row.blockNumber && templateBlocks.has(c)) {
        pairs.push([row.blockNumber, c])
      }
    }
  }
  return pairs
}

/**
 * Non-teachable blocks that are the grade's lunch/break windows: block rows
 * scoped away from the grade whose time window coincides with one of the
 * grade's own break rows (time-string equality — paired rows in a template
 * share the exact same time, e.g. Block 5 "11:10-11:50" / K-5 Lunch
 * "11:10-11:50"). A non-teachable block WITHOUT such a break row is simply
 * unavailable to the grade (e.g. a block the grade surrendered), not lunch —
 * callers render those differently. Empty when there is no template.
 */
export function getLunchBlocksForGrade(
  template: Pick<TimetableTemplate, 'rows'> | null | undefined,
  gradeId: string
): number[] {
  if (!template?.rows?.length) return []
  const teachable = new Set(getTeachableBlocksForGrade(template, gradeId))
  const breakTimes = new Set(
    resolveRowsForGrade(template.rows, gradeId)
      .filter(row => row.type === 'break')
      .map(row => row.time)
  )
  const lunch = new Set<number>()
  const masked = new Set<number>()
  for (const row of template.rows) {
    if (row.type !== 'block' || typeof row.blockNumber !== 'number') continue
    if (teachable.has(row.blockNumber)) continue
    masked.add(row.blockNumber)
    if (breakTimes.has(row.time)) lunch.add(row.blockNumber)
  }
  // Fallback: a grade with masked blocks but no time-matched break row (e.g.
  // a band-crossing combined grade like 8th-9th or an elective span, whose
  // Lunch rows are scoped to single bands only) keeps the legacy assumption
  // that every masked block is a lunch window. Without this, such grades
  // would derive NO lunch blocks and silently lose the teacher-lunch
  // constraint (and flip Lunch cells to unavailable dashes). Grades that DO
  // resolve a real lunch row (e.g. K-5 post-restructure: lunch [5], Block 9
  // surrendered) are unaffected — their non-lunch masked blocks stay out.
  if (lunch.size === 0 && masked.size > 0) {
    return [...masked].sort((a, b) => a - b)
  }
  return [...lunch].sort((a, b) => a - b)
}

/**
 * Block numbers a specific grade can be scheduled into.
 * A block row scoped away from a grade (e.g. that band's lunch window) is not
 * teachable for that grade. Falls back to all template blocks when the grade
 * resolves to no block rows (mis-scoped template — callers may warn).
 */
export function getTeachableBlocksForGrade(
  template: Pick<TimetableTemplate, 'rows'> | null | undefined,
  gradeId: string
): number[] {
  if (!template?.rows?.length) return getTemplateBlocks(template)
  const blocks = new Set<number>()
  for (const row of resolveRowsForGrade(template.rows, gradeId)) {
    if (row.type === 'block' && typeof row.blockNumber === 'number') {
      blocks.add(row.blockNumber)
    }
  }
  return blocks.size > 0 ? [...blocks].sort((a, b) => a - b) : getTemplateBlocks(template)
}
