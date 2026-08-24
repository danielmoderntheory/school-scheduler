// =============================================================================
// POSTER EXPORT — data model
//
// Builds the row/cell model behind the printable "poster" PNGs (the Canva-style
// blue schedule cards): one landscape card per grade or per teacher, showing the
// week as a bell-time table with full-width bands for the non-teaching rows
// (Morning Meeting, Break, Lunch, End of Day).
//
// This module is pure data — no DOM, no React. `components/SchedulePoster.tsx`
// renders a PosterData; `lib/poster-export.ts` captures and zips them.
// =============================================================================

import {
  DAYS,
  GradeSchedule,
  TeacherSchedule,
  TimetableRow,
  TimetableTemplate,
} from "./types"
import {
  BLOCK_TYPE_STUDY_HALL,
  designateTeacherLunch,
  getOpenBlockAt,
  getOpenBlockLabel,
  getTeacherLunchCandidates,
  isOpenBlock,
  isPartTime,
  isScheduledClass,
  isStudyHall,
  resolveGradeCellDisplay,
  type LunchContext,
} from "./schedule-utils"
import type { OpenBlockLabels } from "./types"
import { parseGradeDisplayToNames } from "./grade-utils"
import {
  getBlockTimesForGrade,
  getSharedBlockTimes,
  getTemplateBlocks,
  parseTimeRange,
  resolveRowsForGrade,
} from "./timetable-utils"

/** One day's content in a block row. `sub` is a smaller second line. */
export interface PosterCell {
  main: string
  sub?: string
}

/**
 * A poster row is either a full-width band (`merged` — Morning Meeting, Break,
 * Lunch, End of Day: one label spanning all five days) or a `block` row with
 * one cell per day. Both carry the bell time shown in the left column.
 */
export type PosterRow =
  | { kind: "merged"; time: string; label: string }
  | { kind: "block"; time: string; cells: (PosterCell | null)[] }

export interface PosterData {
  /** Rendered as the big white heading, e.g. "6TH GRADE SCHEDULE". */
  title: string
  rows: PosterRow[]
  /** Basename (no extension) for the file inside the export zip. */
  fileName: string
}

/** "8:12-8:52" -> "8:12 - 8:52" (the reference cards space the dash). */
function formatTime(time: string | undefined): string {
  if (!time) return ""
  const m = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(time)
  return m ? `${m[1]} - ${m[2]}` : time.trim()
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Unnamed"
}

/**
 * Subject display name -> the short form printed on a card, from
 * subjects.short_name. Subjects without one are simply absent.
 */
export type SubjectLabels = Record<string, string>

/**
 * The label a card prints for a subject: its short name when the school has set
 * one (Settings -> Subjects), otherwise the subject name itself. Non-subject
 * cell text — Open, Lunch, Study Hall, Elective — never matches a key and so
 * passes through untouched.
 */
function label(subject: string, labels: SubjectLabels | undefined): string {
  return labels?.[subject] || subject
}

/** Minutes of overlap between two template time strings (0 if none/unparseable). */
function overlapMinutes(a: string | undefined, b: string | undefined): number {
  const ra = parseTimeRange(a)
  const rb = parseTimeRange(b)
  if (!ra || !rb) return 0
  return Math.max(0, Math.min(ra[1], rb[1]) - Math.max(ra[0], rb[0]))
}

// -----------------------------------------------------------------------------
// GRADE POSTER
// -----------------------------------------------------------------------------

/**
 * Grade names that read as a bare ordinal ("6th", "10th-11th") take the word
 * "Grade" in the heading — "6TH GRADE SCHEDULE". Names that already carry a
 * letter ("K/1", "PreK") do not: "K/1 SCHEDULE".
 */
const ORDINAL_GRADE = /^\d+(st|nd|rd|th)(\s*[-\/]\s*\d+(st|nd|rd|th))?$/i

/**
 * One poster for one grade, straight from the grade's RESOLVED template rows:
 * the grade's own bell times, its own lunch band, its own end-of-day row. Cells
 * show the subject only (matching the printed cards handed to students) — the
 * teacher name lives in the on-screen timetable view, not here.
 *
 * Blocks the grade resolves no row for are simply absent, so a grade never sees
 * another band's window.
 */
export function buildGradePoster(
  gradeName: string,
  gradeId: string,
  gradeSchedule: GradeSchedule,
  template: Pick<TimetableTemplate, "rows"> | null | undefined,
  subjectLabels?: SubjectLabels
): PosterData {
  const rows: PosterRow[] = []
  const templateRows: TimetableRow[] = template?.rows?.length
    ? resolveRowsForGrade(template.rows, gradeId)
    : []

  for (const row of templateRows) {
    if (row.type !== "block" || typeof row.blockNumber !== "number") {
      rows.push({ kind: "merged", time: formatTime(row.time), label: row.label })
      continue
    }
    const cells = DAYS.map(day => {
      const content = resolveGradeCellDisplay(gradeSchedule[day]?.[row.blockNumber!] ?? null)
      return content ? { main: label(content.subject, subjectLabels) } : null
    })
    rows.push({ kind: "block", time: formatTime(row.time), cells })
  }

  return {
    title: `${gradeName}${ORDINAL_GRADE.test(gradeName) ? " Grade" : ""} Schedule`,
    rows,
    fileName: `Grade_${safeFileName(gradeName)}`,
  }
}

// -----------------------------------------------------------------------------
// TEACHER POSTER
// -----------------------------------------------------------------------------

/**
 * Grades a teacher actually teaches this week, as display names present in the
 * template's grade set. Mirrors getTeacherLunchCandidates: only scheduled
 * classes establish a taught grade (OPEN and study halls do not).
 */
function taughtGradeNames(
  schedule: TeacherSchedule,
  blocks: number[],
  knownGradeNames: string[]
): Set<string> {
  const taught = new Set<string>()
  for (const day of DAYS) {
    for (const block of blocks) {
      const entry = schedule[day]?.[block]
      if (!entry || !isScheduledClass(entry[1])) continue
      for (const g of parseGradeDisplayToNames(entry[0], knownGradeNames)) taught.add(g)
    }
  }
  return taught
}

export interface TeacherPosterContext {
  template: Pick<TimetableTemplate, "rows"> | null | undefined
  /** Grade display name -> grade UUID, for scoping the template's banded rows. */
  gradeIdsByName: Record<string, string>
  /** Same lunch context the grids use, so the poster's Lunch matches the app's. */
  lunchContext?: LunchContext
  /** Short subject names from the DB; absent subjects print in full. */
  subjectLabels?: SubjectLabels
  /**
   * Annotations put on OPEN blocks in the teacher view ("Annotate Open
   * Blocks"). The school's hand-made cards fill these slots with the duties
   * the schedule does not model — "K/1 ENG PUSH IN", "PUSH 4/5" — so the
   * poster prints the annotation instead of a bare OPEN wherever one is set.
   */
  openBlockLabels?: OpenBlockLabels
  /**
   * The teacher's employment status from teacherStats. A part-time teacher's
   * free periods are simply not their working day, and the school's own cards
   * leave those cells EMPTY rather than writing OPEN across them — a card like
   * Katrin's is nearly all blank by design. Absent = treated as full-time.
   */
  status?: string
}

/**
 * One poster for one teacher.
 *
 * A teacher row spans grades, so the poster cannot use a single grade's row
 * list. Instead:
 *  - unscoped template rows (Morning Meeting, the shared Break) are always
 *    full-width bands;
 *  - every template block becomes a block row, timed by the window this
 *    teacher's own grades agree on (the shared window when they span bands);
 *  - a block the teacher is never scheduled in becomes a full-width band when a
 *    banded row of THEIR grades covers that window (their lunch, their band's
 *    end-of-day meeting) — otherwise it stays a block row;
 *  - a banded row of theirs that no block collapsed into, and that doesn't run
 *    through a window they teach in, is emitted as a band in its own right.
 *
 * Lunch only collapses to a band when the teacher's designated lunch block is
 * the same on all five days; a teacher whose lunch moves day to day gets a
 * normal block row with LUNCH in the cells that hold it, because a single
 * full-width band would be a lie for them.
 */
export function buildTeacherPoster(
  teacherName: string,
  schedule: TeacherSchedule,
  ctx: TeacherPosterContext
): PosterData {
  const {
    template,
    gradeIdsByName,
    lunchContext,
    subjectLabels,
    openBlockLabels,
    status,
  } = ctx
  const blocks = getTemplateBlocks(template)
  const sharedTimes = getSharedBlockTimes(template)
  const templateRows = (template?.rows ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)

  const knownGradeNames = Object.keys(gradeIdsByName)
  const taughtNames = taughtGradeNames(schedule, blocks, knownGradeNames)
  const taughtGradeIds = new Set(
    [...taughtNames].map(n => gradeIdsByName[n]).filter(Boolean)
  )

  // Per-day designated lunch (same rule the grids and stats use).
  const lunchCandidates = lunchContext ? getTeacherLunchCandidates(schedule, lunchContext) : []
  const lunchByDay: Record<string, number | null> = {}
  for (const day of DAYS) {
    lunchByDay[day] = lunchContext
      ? designateTeacherLunch(schedule[day], lunchCandidates, blocks)
      : null
  }
  const lunchBlocks = new Set(Object.values(lunchByDay).filter((b): b is number => b !== null))
  const uniformLunchBlock =
    lunchBlocks.size === 1 && DAYS.every(d => lunchByDay[d] !== null)
      ? [...lunchBlocks][0]
      : null

  const usable = lunchContext?.usableBlocksByTeacher?.[teacherName]
  const usableSet = usable ? new Set(usable) : null

  /**
   * The bell time to print for a block on THIS teacher's card.
   *
   * getSharedBlockTimes answers "the window that covers the most grades", which
   * is right for the on-screen teacher grid (one row, every band) but wrong on a
   * personal card: a K-5-only teacher's Block 8 really does run 1:40-2:25, not
   * the shared 1:20-2:00. So when every grade this teacher teaches agrees on a
   * window, that window wins; a teacher spanning bands falls back to the shared
   * one, since no single time is true for them.
   */
  const gradeBlockTimes = new Map<string, Record<number, string>>()
  for (const name of taughtNames) {
    const id = gradeIdsByName[name]
    if (id) gradeBlockTimes.set(name, getBlockTimesForGrade(template, id))
  }
  function blockTime(block: number, fallback: string): string {
    const seen = new Set<string>()
    for (const times of Array.from(gradeBlockTimes.values())) {
      const t = times[block]
      if (t) seen.add(t)
    }
    if (seen.size === 1) return Array.from(seen)[0]
    return sharedTimes[block] ?? fallback
  }

  /** True when the teacher has no class and no study hall in this block all week. */
  function blockIsEmptyAllWeek(block: number): boolean {
    return DAYS.every(day => {
      const entry = schedule[day]?.[block]
      return !entry || isOpenBlock(entry[1])
    })
  }

  const teachesThisBand = (row: TimetableRow): boolean =>
    taughtGradeIds.size > 0 && (row.grade_ids ?? []).some(id => taughtGradeIds.has(id))

  // Resolve every block's row and printed time up front, so the banded rows can
  // be tested against the windows this teacher is actually busy in.
  const blockOrder: { block: number; time: string }[] = []
  const seenBlocks = new Set<number>()
  for (const row of templateRows) {
    if (row.type !== "block" || typeof row.blockNumber !== "number") continue
    if (seenBlocks.has(row.blockNumber)) continue
    seenBlocks.add(row.blockNumber)
    blockOrder.push({ block: row.blockNumber, time: blockTime(row.blockNumber, row.time) })
  }
  const busyWindows = blockOrder
    .filter(b => !blockIsEmptyAllWeek(b.block))
    .map(b => b.time)

  // A block the teacher never uses collapses into the banded row of THEIR band
  // covering that window — their lunch, their band's end-of-day meeting. Each
  // banded row is consumed at most once, so it can't also be emitted on its own.
  const collapsedInto = new Map<number, TimetableRow>()
  const consumed = new Set<TimetableRow>()
  for (const { block, time } of blockOrder) {
    if (!blockIsEmptyAllWeek(block)) continue
    let best: { row: TimetableRow; overlap: number } | null = null
    for (const row of templateRows) {
      if (row.type === "block" || consumed.has(row)) continue
      if (!row.grade_ids || row.grade_ids.length === 0) continue
      if (!teachesThisBand(row)) continue
      const overlap = overlapMinutes(time, row.time)
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { row, overlap }
    }
    if (best) {
      collapsedInto.set(block, best.row)
      consumed.add(best.row)
    }
  }

  const rows: PosterRow[] = []
  const emittedBlocks = new Set<number>()

  for (const row of templateRows) {
    if (row.type !== "block" || typeof row.blockNumber !== "number") {
      if (!row.grade_ids || row.grade_ids.length === 0) {
        // School-wide band (Morning Meeting, the shared Break).
        rows.push({ kind: "merged", time: formatTime(row.time), label: row.label })
      } else if (
        !consumed.has(row) &&
        teachesThisBand(row) &&
        !busyWindows.some(w => overlapMinutes(w, row.time) > 0)
      ) {
        // A band of the teacher's own that no block of theirs collapsed into and
        // that doesn't run through a window they teach in — e.g. K-5's 1:17-1:37
        // Break, which sits between their Block 7 and their 1:40 Block 8.
        rows.push({ kind: "merged", time: formatTime(row.time), label: row.label })
      }
      continue
    }

    const block = row.blockNumber
    if (emittedBlocks.has(block)) continue
    emittedBlocks.add(block)

    const time = blockOrder.find(b => b.block === block)?.time ?? row.time

    if (blockIsEmptyAllWeek(block)) {
      if (block === uniformLunchBlock && !collapsedInto.has(block)) {
        rows.push({ kind: "merged", time: formatTime(time), label: "Lunch" })
        continue
      }
      const band = collapsedInto.get(block)
      if (band) {
        rows.push({ kind: "merged", time: formatTime(band.time), label: band.label })
        continue
      }
    }

    const cells = DAYS.map(day => {
      const entry = schedule[day]?.[block]
      if (entry && isStudyHall(entry[1])) return { main: BLOCK_TYPE_STUDY_HALL }
      if (entry && isScheduledClass(entry[1])) {
        const sub = taughtNames.size > 1 ? entry[0] : undefined
        return { main: label(entry[1], subjectLabels), sub }
      }
      // Free cell. An annotation the school put on this OPEN block wins over
      // everything else — it is a real duty someone typed in, and it is the
      // only thing here that is not derived. The open-block index comes from
      // the shared helper so it matches the grid's numbering exactly; get it
      // wrong and labels land on the wrong cells.
      const open = getOpenBlockAt(schedule, day, block)
      const annotation = open
        ? getOpenBlockLabel(openBlockLabels, teacherName, open.openIndex, open.type)
        : undefined
      if (annotation) return { main: annotation }
      // Otherwise: the day's designated lunch, a block outside this teacher's
      // reach (blank rather than a false "OPEN"), or genuine open time.
      if (lunchByDay[day] === block) return { main: "Lunch" }
      if (usableSet && !usableSet.has(block)) return null
      // Part-timers get a blank rather than OPEN — see `status` above.
      if (isPartTime(status)) return null
      return { main: "Open" }
    })

    rows.push({ kind: "block", time: formatTime(time), cells })
  }

  // Template sort_order interleaves the bands (K-5's 1:17 Break sits between the
  // MS/HS 1:20 Block 8 row and the K-5 1:40 one), so once a teacher's rows are
  // timed to THEIR band the list can be out of sequence. The card is a bell-time
  // table, so put it back in clock order; rows with an unreadable time inherit
  // their predecessor's slot and stay where the template put them.
  let lastStart = 0
  const ordered = rows
    .map((row, index) => {
      const start = parseTimeRange(row.time)?.[0] ?? lastStart
      lastStart = start
      return { row, start, index }
    })
    .sort((a, b) => a.start - b.start || a.index - b.index)
    .map(entry => entry.row)

  return {
    title: teacherName,
    rows: ordered,
    fileName: `Teacher_${safeFileName(teacherName)}`,
  }
}
