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
 * Parse a template time string ("8:00-8:20", "12:35-1:20", "2:05-2:45") into
 * minutes-since-midnight [start, end]. Times carry no am/pm marker; the school
 * day runs ~7:00-18:00, so hours 1-6 are PM (add 12) and 7-12 are AM (12 stays
 * 12 = noon). Returns null for anything malformed or inverted.
 */
export function parseTimeRange(time: string | undefined): [number, number] | null {
  if (!time) return null
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(time)
  if (!m) return null
  const toMinutes = (h: number, min: number): number | null => {
    if (h < 1 || h > 12 || min < 0 || min > 59) return null
    if (h >= 1 && h <= 6) h += 12 // afternoon
    return h * 60 + min
  }
  const start = toMinutes(parseInt(m[1], 10), parseInt(m[2], 10))
  const end = toMinutes(parseInt(m[3], 10), parseInt(m[4], 10))
  if (start === null || end === null || end <= start) return null
  return [start, end]
}

/**
 * Display labels for a grade's UNAVAILABLE blocks (non-teachable and not
 * lunch), derived from what the grade actually does during that window: the
 * grade's own break/transition row with the largest time overlap. E.g. after
 * the K-5 afternoon restructure, K-5 grades map Block 9 (2:05-2:45) to their
 * "End of Day Meeting / SEL" row (2:30-2:45). Blocks with no overlapping row
 * (or unparseable times) get no entry — callers fall back to a plain dash.
 * The label comes straight from the template row, so renaming it in
 * Settings → Timetable (e.g. to just "SEL") flows through everywhere.
 */
export function getUnavailableBlockLabelsForGrade(
  template: Pick<TimetableTemplate, 'rows'> | null | undefined,
  gradeId: string
): Record<number, string> {
  if (!template?.rows?.length) return {}
  const teachable = new Set(getTeachableBlocksForGrade(template, gradeId))
  const lunch = new Set(getLunchBlocksForGrade(template, gradeId))
  const resolved = resolveRowsForGrade(template.rows, gradeId)
  const resolvedSet = new Set(resolved)

  const labels: Record<number, string> = {}
  for (const block of getTemplateBlocks(template)) {
    if (teachable.has(block) || lunch.has(block)) continue
    // The grade resolves no row for this block, so take the window from any
    // block row carrying this number — preferring one scoped to OTHER grades
    // (that is the actual bell window the grade sits outside of).
    const blockRows = template.rows.filter(
      row => row.type === 'block' && row.blockNumber === block
    )
    const sourceRow = blockRows.find(row => !resolvedSet.has(row)) ?? blockRows[0]
    const blockRange = parseTimeRange(sourceRow?.time)
    if (!blockRange) continue

    let best: { label: string; overlap: number } | null = null
    for (const row of resolved) {
      if (row.type !== 'break' && row.type !== 'transition') continue
      const range = parseTimeRange(row.time)
      if (!range) continue
      const overlap = Math.min(blockRange[1], range[1]) - Math.max(blockRange[0], range[0])
      if (overlap > 0 && (!best || overlap > best.overlap)) {
        best = { label: row.label, overlap }
      }
    }
    if (best?.label) labels[block] = best.label
  }
  return labels
}

/**
 * A grade's true bell time for each of its blocks, from its RESOLVED template
 * block rows (e.g. post-restructure K-5: Block 8 -> "1:40-2:25" while
 * 6th-12th resolve "1:20-2:00"). Only rows with parseable times are included;
 * blocks the grade resolves no row for (e.g. K-5's surrendered Block 9) get
 * no entry. Callers use this for grade-view row-header times and for the
 * straddling-class time labels in teacher views. Empty without a template.
 */
export function getBlockTimesForGrade(
  template: Pick<TimetableTemplate, 'rows'> | null | undefined,
  gradeId: string
): Record<number, string> {
  if (!template?.rows?.length) return {}
  const times: Record<number, string> = {}
  const resolved = resolveRowsForGrade(template.rows, gradeId)
  const resolvedSet = new Set(resolved)
  for (const row of resolved) {
    if (row.type !== 'block' || typeof row.blockNumber !== 'number') continue
    if (row.time && parseTimeRange(row.time)) {
      times[row.blockNumber] = row.time
    }
  }
  // Blocks the grade doesn't teach (its lunch, a surrendered block): show the
  // time of what the grade actually does in that window — its overlapping
  // break/transition row (Lunch 11:10-11:50, SEL 2:30-2:45) — so grade-view
  // row headers keep a truthful time even without a block row.
  for (const block of getTemplateBlocks(template)) {
    if (times[block] !== undefined) continue
    const blockRows = template.rows.filter(
      row => row.type === 'block' && row.blockNumber === block
    )
    const sourceRow = blockRows.find(row => !resolvedSet.has(row)) ?? blockRows[0]
    const blockRange = parseTimeRange(sourceRow?.time)
    if (!blockRange) continue
    let best: { time: string; overlap: number } | null = null
    for (const row of resolved) {
      if (row.type !== 'break' && row.type !== 'transition') continue
      const range = parseTimeRange(row.time)
      if (!range) continue
      const overlap = Math.min(blockRange[1], range[1]) - Math.max(blockRange[0], range[0])
      if (overlap > 0 && (!best || overlap > best.overlap)) {
        best = { time: row.time, overlap }
      }
    }
    if (best) times[block] = best.time
  }
  return times
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

/**
 * The canonical bell time for each template block, for grids that are NOT
 * grade-scoped (the teacher view, where one row spans every grade the teacher
 * covers). Most blocks are defined by a single row and so have a single time.
 * Where a block is defined by several grade-scoped rows with DIFFERENT times —
 * e.g. Block 8's "1:20-2:00" for MS/HS alongside K-5's straddling "1:40-2:25" —
 * the window covering the most grades wins, ties broken by the earlier start.
 * The teacher grid pairs this header time with the existing per-cell straddle
 * label ("B8 until 2:25"), which carries the other window's truth, so the
 * header is the shared window rather than a lie for one band.
 *
 * Deliberately NOT grade-relative: a teacher row cannot use the grade view's
 * P1..N numbering, because P counts each grade's OWN teachable blocks (Block 6
 * is P5 for K-3rd but P6 for high school, and grade-P7 is Block 8 for every
 * band). Time is the only label that means the same thing on every row.
 *
 * Rows with unparseable times are ignored. Empty without a template.
 */
export function getSharedBlockTimes(
  template: Pick<TimetableTemplate, 'rows'> | null | undefined
): Record<number, string> {
  if (!template?.rows?.length) return {}
  const best = new Map<number, { time: string; grades: number; start: number }>()
  for (const row of template.rows) {
    if (row.type !== 'block' || typeof row.blockNumber !== 'number') continue
    const range = parseTimeRange(row.time)
    if (!range || !row.time) continue
    // No grade_ids = the row applies to every grade, so it always outranks a
    // scoped row (Infinity rather than a count of the grades we can't see).
    const grades = row.grade_ids?.length ?? Number.POSITIVE_INFINITY
    const prev = best.get(row.blockNumber)
    if (
      !prev ||
      grades > prev.grades ||
      (grades === prev.grades && range[0] < prev.start)
    ) {
      best.set(row.blockNumber, { time: row.time, grades, start: range[0] })
    }
  }
  const times: Record<number, string> = {}
  for (const [block, v] of best) times[block] = v.time
  return times
}
