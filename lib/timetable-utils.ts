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
