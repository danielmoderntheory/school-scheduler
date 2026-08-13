"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { RefreshCw, AlertTriangle, Check, Ban, X, ArrowLeftRight, Pencil } from "lucide-react"
import type { TeacherSchedule, GradeSchedule, FloatingBlock, PendingPlacement, ValidationError, CellLocation, OpenBlockLabels } from "@/lib/types"
import { BLOCKS } from "@/lib/types"
import { BLOCK_TYPE_OPEN, isOpenBlock, isStudyHall, isScheduledClass, isFullTime, getOpenBlockAt, getOpenBlockLabel, getTeacherLunchCandidates, designateTeacherLunch, type LunchContext } from "@/lib/schedule-utils"
import { formatGradeDisplayCompact, parseGradeDisplayToNames, isClassElective, isClassCotaught, type ClassSnapshotEntry } from "@/lib/grade-utils"

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
// Legacy 5-block default — call sites that don't pass `blocks` render 5-block data
const LEGACY_BLOCKS: number[] = [...BLOCKS]

export type { CellLocation }

interface ScheduleGridProps {
  schedule: TeacherSchedule | GradeSchedule
  type: "teacher" | "grade"
  name: string
  status?: string
  // Block numbers to render as rows (from the quarter's timetable template).
  // Defaults to the legacy 5-block list for existing call sites.
  blocks?: number[]
  // Grade view only: per-grade lunch blocks (grade display name -> block numbers
  // that are NOT teachable for that grade, i.e. its band's lunch window). Cells
  // at these blocks render as a muted "Lunch" cell instead of empty/OPEN.
  // Absent (legacy 5-block schedules) = exactly the current behavior.
  lunchBlocksByGrade?: Record<string, number[]>
  // Grade view only: per-grade teachable blocks (grade display name -> block
  // numbers the grade CAN be scheduled into, positively resolved from the
  // timetable template). A rendered block absent from the grade's list — and
  // not a lunch cell (lunch wins) — is unavailable to the grade (e.g. a block
  // the grade surrendered, like K-5's Block 9) and renders as a muted, inert
  // dash. Absent prop, or a grade missing from the map = current behavior.
  teachableBlocksByGrade?: Record<string, number[]>
  // Grade view only: labels for unavailable cells (grade display name ->
  // block number -> what the grade does in that window per its template rows,
  // e.g. K-5's Block 9 -> "End of Day Meeting / SEL"). A labeled unavailable
  // cell shows the label instead of the plain dash; still muted and inert.
  unavailableLabelsByGrade?: Record<string, Record<number, string>>
  // Teacher view only: per-grade cross-block conflicts from the timetable
  // template (grade display name -> [block, conflictingBlock] pairs; real-time
  // window overlaps, e.g. K-5's shifted last class at Block 8 running into the
  // shared Block 9). An OPEN/empty cell at conflictingBlock while the teacher
  // has a class covering that grade at block (same day) renders muted and
  // inert — the teacher is still mid-class then, not free. Absent = current
  // behavior.
  blockConflictsByGrade?: Record<string, [number, number][]>
  // Teacher view only: block time strings per grade (grade display name ->
  // block number -> the grade's template row time, e.g. K-5's Block 8 ->
  // "1:40-2:25"). Used to render a straddling class's true time range on its
  // source cell and the "B8 until 2:25" label on the continuation cell.
  // Absent = generic fallback labels.
  blockTimesByGrade?: Record<string, Record<number, string>>
  // Teacher view only: blocks each teacher could ever hold a class in
  // (teacher name -> union over their classes of the intersection of each
  // class's grades' teachable blocks). An idle cell OUTSIDE the teacher's
  // set — e.g. a K-5-only teacher at Block 9 after K-5 surrendered it — is
  // not schedulable free time: it renders as an inert muted "N/A" instead of
  // OPEN. Scheduled content (incl. study halls) always wins. Absent, or a
  // teacher missing from the map = current behavior.
  usableBlocksByTeacher?: Record<string, number[]>
  // Teacher view only: lunch context for the quarter (per-grade teachable
  // blocks + template block list). When present, each teacher-day's designated
  // Lunch block (the same designation the stats layer uses) renders with the
  // grade-view Lunch styling instead of OPEN — but stays fully interactive,
  // behaving exactly like an OPEN cell in swap/freeform/study-hall modes.
  // Absent, or legacy quarters with no candidates = exactly current rendering.
  lunchContext?: LunchContext
  // Change indicator: 'pending' = changes will be applied, 'applied' = changes have been applied in preview
  changeStatus?: 'pending' | 'applied'
  // Selection mode props (regen mode)
  showCheckbox?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
  // Exclude mode props (study hall mode)
  showExcludeCheckbox?: boolean
  isExcluded?: boolean
  isExclusionLocked?: boolean // Can't be un-excluded (ineligible by rule)
  onToggleExclude?: () => void
  // Swap mode props
  swapMode?: boolean
  manualStudyHallMode?: boolean // Manual study hall placement - enables cell clicking
  selectedCell?: CellLocation | null
  validTargets?: CellLocation[]
  highlightedCells?: CellLocation[]
  onCellClick?: (location: CellLocation, cellType: "study-hall" | "open" | "class") => void
  // Freeform mode props
  freeformMode?: boolean
  floatingBlocks?: FloatingBlock[]
  pendingPlacements?: PendingPlacement[]
  selectedFloatingBlock?: string | null
  validationErrors?: ValidationError[]
  autoFixedBlockIds?: string[]  // Our placements that have conflicts (amber)
  movedBlockerCells?: Array<{ teacher: string; day: string; block: number }>  // Cells where blockers were moved to (cyan)
  classesSnapshot?: ClassSnapshotEntry[]  // For elective detection
  onPickUp?: (location: CellLocation) => void
  onPlace?: (location: CellLocation) => void
  onUnplace?: (blockId: string) => void
  onDeselect?: () => void
  // OPEN block label props
  openBlockLabels?: OpenBlockLabels  // Custom labels for OPEN blocks
  showOpenLabels?: boolean  // Whether to display labels on OPEN blocks
  onOpenLabelChange?: (teacher: string, openIndex: number, label: string | undefined) => void  // Callback when label changes
}

export function ScheduleGrid({
  schedule,
  type,
  name,
  status,
  blocks = LEGACY_BLOCKS,
  lunchBlocksByGrade,
  teachableBlocksByGrade,
  unavailableLabelsByGrade,
  blockConflictsByGrade,
  blockTimesByGrade,
  usableBlocksByTeacher,
  lunchContext,
  changeStatus,
  showCheckbox,
  isSelected,
  onToggleSelect,
  showExcludeCheckbox,
  isExcluded,
  isExclusionLocked,
  onToggleExclude,
  swapMode,
  manualStudyHallMode,
  selectedCell,
  validTargets = [],
  highlightedCells = [],
  onCellClick,
  freeformMode,
  floatingBlocks = [],
  pendingPlacements = [],
  selectedFloatingBlock,
  validationErrors = [],
  autoFixedBlockIds = [],
  movedBlockerCells = [],
  classesSnapshot,
  onPickUp,
  onPlace,
  onUnplace,
  onDeselect,
  openBlockLabels,
  showOpenLabels,
  onOpenLabelChange,
}: ScheduleGridProps) {
  // State for OPEN block label editing dropdown
  const [labelDropdownCell, setLabelDropdownCell] = useState<{ day: string; block: number; openIndex: number } | null>(null)
  const [labelDropdownPos, setLabelDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const [labelSearch, setLabelSearch] = useState("")
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)

  // Close label dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(event.target as Node)) {
        setLabelDropdownCell(null)
        setLabelDropdownPos(null)
        setLabelSearch("")
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Focus input when dropdown opens
  useEffect(() => {
    if (labelDropdownCell && labelInputRef.current) {
      labelInputRef.current.focus()
    }
  }, [labelDropdownCell])
  // Returns [primary, secondary, isMultiple] where isMultiple indicates multiple entries (electives)
  function getCellContent(day: string, block: number): { entry: [string, string] | null; isMultiple: boolean } {
    const raw = schedule[day]?.[block]
    if (!raw) return { entry: null, isMultiple: false }

    // Handle array format for grade schedules (electives): [[teacher, subject], ...]
    if (Array.isArray(raw) && raw.length > 0) {
      if (Array.isArray(raw[0])) {
        // New format: array of arrays
        const entries = raw as unknown as [string, string][]
        // Filter to actual classes (not OPEN or Study Hall)
        const classEntries = entries.filter(([, subject]) => isScheduledClass(subject))
        if (classEntries.length > 1) {
          // Multiple classes at same time = Elective period
          return { entry: ["", "Elective"], isMultiple: true }
        }
        // Single entry or only OPEN/Study Hall - return first
        return { entry: entries[0], isMultiple: false }
      }
      // Old format: single tuple [string, string]
      return { entry: raw as [string, string], isMultiple: false }
    }

    return { entry: null, isMultiple: false }
  }

  function getCellType(entry: [string, string] | null): "study-hall" | "open" | "class" | "empty" {
    if (!entry) return "empty"
    const [, subject] = entry
    if (isOpenBlock(subject)) return "open"
    if (isStudyHall(subject)) return "study-hall"
    return "class"
  }

  // Teacher-view designated lunch, derived from the CURRENT schedule prop on
  // every render (deliberately NOT memoized) so any edit — swap, freeform
  // placement, regen preview — immediately recomputes the designation, keeping
  // the display in lockstep with recalculateOptionStats. Empty candidates
  // (prop absent, legacy quarter, or teacher with no parseable taught grades)
  // leaves the map empty and rendering identical to today.
  const teacherLunchByDay: Record<string, number | null> = {}
  let teacherLunchCandidates: number[] = []
  if (type === "teacher" && lunchContext) {
    teacherLunchCandidates = getTeacherLunchCandidates(schedule as TeacherSchedule, lunchContext)
    if (teacherLunchCandidates.length > 0) {
      for (const day of DAYS) {
        teacherLunchByDay[day] = designateTeacherLunch((schedule as TeacherSchedule)[day], teacherLunchCandidates, blocks)
      }
    }
  }

  // Teacher-view lunch cells: the day's designated Lunch block, only while it
  // holds no scheduled content (OPEN/empty). Unlike grade-view lunch cells,
  // these are NOT inert — they only swap the idle label/background.
  function isTeacherLunchCell(day: string, block: number): boolean {
    if (type !== "teacher") return false
    if (teacherLunchByDay[day] !== block) return false
    const { entry } = getCellContent(day, block)
    const cellType = getCellType(entry)
    if (cellType !== "empty" && cellType !== "open") return false
    // An explicit custom open-block label ("Prep Time", ...) wins over the
    // inferred Lunch label — human-entered beats computed, and the cell keeps
    // its label-editing affordance.
    if (cellType === "open" && openBlockLabels) {
      const info = getOpenBlockAt(schedule as TeacherSchedule, day, block)
      if (info && getOpenBlockLabel(openBlockLabels, name, info.openIndex, info.type)) {
        return false
      }
    }
    return true
  }

  // Grade-view lunch cells: the block is not teachable for this grade (its
  // band's lunch window). Only replaces cells with no scheduled content — if a
  // real class somehow sits at a lunch block (data anomaly / manual edit), it
  // still renders so it stays visible.
  function isLunchCell(day: string, block: number): boolean {
    if (type !== "grade" || !lunchBlocksByGrade) return false
    const lunchBlocks = lunchBlocksByGrade[name]
    if (!lunchBlocks || !lunchBlocks.includes(block)) return false
    const { entry } = getCellContent(day, block)
    const cellType = getCellType(entry)
    return cellType === "empty" || cellType === "open"
  }

  // Grade-view unavailable cells: the block is not teachable for this grade
  // AND is not its lunch window (lunch styling wins) — e.g. a block the grade
  // surrendered (K-5's Block 9 under the afternoon-restructure template).
  // Only replaces cells with no scheduled content: a real class somehow
  // sitting there (data anomaly / manual edit) still renders so it stays
  // visible. No positive teachable list for the grade = never unavailable.
  function isUnavailableCell(day: string, block: number): boolean {
    if (type !== "grade" || !teachableBlocksByGrade) return false
    const teachable = teachableBlocksByGrade[name]
    if (!teachable || teachable.length === 0 || teachable.includes(block)) return false
    if (isLunchCell(day, block)) return false
    const { entry } = getCellContent(day, block)
    const cellType = getCellType(entry)
    return cellType === "empty" || cellType === "open"
  }

  // Teacher-view conflict-blocked cells: this OPEN/empty cell's window is
  // consumed by the teacher's class in another block the same day (template
  // cross-block conflict — the class runs past its block into this one, e.g.
  // K-5's shifted last class at Block 8 running into Block 9). Returns the
  // blocking [grade, subject] entry, or null. A blocking class that was picked
  // up in freeform mode no longer blocks (its window is being vacated).
  // Display-level only — solvers and save-time validation enforce the rule;
  // stats treatment of blocked windows is deliberately unchanged here.
  function getConflictBlockerAt(
    day: string,
    block: number
  ): { entry: [string, string]; grade: string; sourceBlock: number } | null {
    if (type !== "teacher" || !blockConflictsByGrade) return null
    const { entry } = getCellContent(day, block)
    const cellType = getCellType(entry)
    if (cellType !== "empty" && cellType !== "open") return null
    const gradeNames = Object.keys(blockConflictsByGrade)
    for (const g of gradeNames) {
      for (const [a, b] of blockConflictsByGrade[g] || []) {
        if (b !== block || a === block) continue
        const { entry: src } = getCellContent(day, a)
        if (!src || !isScheduledClass(src[1])) continue
        if (freeformMode && isPickedUpCell(day, a)) continue
        if (parseGradeDisplayToNames(src[0], gradeNames).includes(g)) {
          return { entry: src, grade: g, sourceBlock: a }
        }
      }
    }
    return null
  }

  // The grade-scoped template time of a straddling class, and its end time.
  // e.g. blockTimesByGrade["4th Grade"][8] = "1:40-2:25" -> end "2:25".
  // Returns nulls when the map/time is absent — callers fall back to generic
  // wording ("B8 continues" / "runs into this block").
  function getStraddleTime(grade: string, block: number): { range: string | null; end: string | null } {
    const raw = blockTimesByGrade?.[grade]?.[block]
    if (!raw) return { range: null, end: null }
    const parts = raw.split("-")
    const end = parts.length === 2 ? parts[1].trim() : null
    return { range: raw.replace(/\s*-\s*/, "–"), end: end || null }
  }

  // Teacher-view straddle SOURCE cell: this class triggers a conflict pair
  // today (its continuation cell below is currently idle and rendering the
  // "B8 until 2:25" state). Returns the class's true time range for subtext.
  function getStraddleSourceRange(day: string, block: number): string | null {
    if (type !== "teacher" || !blockConflictsByGrade) return null
    const { entry } = getCellContent(day, block)
    if (!entry || !isScheduledClass(entry[1])) return null
    if (freeformMode && isPickedUpCell(day, block)) return null
    const gradeNames = Object.keys(blockConflictsByGrade)
    for (const g of parseGradeDisplayToNames(entry[0], gradeNames)) {
      for (const [a, b] of blockConflictsByGrade[g] || []) {
        if (a !== block) continue
        const blocker = getConflictBlockerAt(day, b)
        if (blocker && blocker.sourceBlock === block) {
          return getStraddleTime(g, block).range
        }
      }
    }
    return null
  }

  // Teacher-view class-unusable cells: no class this teacher teaches can ever
  // meet at this block (e.g. a K-5-only teacher at Block 9 after K-5
  // surrendered it). Idle cells only — scheduled content (incl. study halls,
  // which may legitimately sit at such blocks) and pending freeform
  // placements always win. Lunch designation and conflict-blocked states take
  // precedence (both are more specific). No usable-blocks entry = never.
  function isTeacherUnavailableCell(day: string, block: number): boolean {
    if (type !== "teacher" || !usableBlocksByTeacher) return false
    const usable = usableBlocksByTeacher[name]
    if (!usable || usable.length === 0 || usable.includes(block)) return false
    // A lunch-candidate window is free time by design (e.g. a K-5-only
    // teacher's Block 5): it renders as Lunch/labeled-OPEN, never N/A.
    if (teacherLunchCandidates.includes(block)) return false
    if (freeformMode && hasPendingPlacement(day, block)) return false
    const { entry } = getCellContent(day, block)
    const cellType = getCellType(entry)
    if (cellType !== "empty" && cellType !== "open") return false
    return !isConflictBlockedCell(day, block)
  }

  // Inert variant of the above for styling/click guards: a pending freeform
  // placement on the cell must stay visible (never blotted out by the muted
  // treatment), even though placing there is normally prevented.
  function isConflictBlockedCell(day: string, block: number): boolean {
    if (freeformMode && hasPendingPlacement(day, block)) return false
    return getConflictBlockerAt(day, block) !== null
  }

  function isValidTarget(day: string, block: number): boolean {
    if (type === "grade") {
      return validTargets.some(t => t.grade === name && t.day === day && t.block === block)
    }
    return validTargets.some(t => t.teacher === name && t.day === day && t.block === block)
  }

  function isSelectedCell(day: string, block: number): boolean {
    if (type === "grade") {
      return selectedCell?.grade === name && selectedCell?.day === day && selectedCell?.block === block
    }
    return selectedCell?.teacher === name && selectedCell?.day === day && selectedCell?.block === block
  }

  function isHighlightedCell(day: string, block: number): boolean {
    if (type === "grade") {
      return highlightedCells.some(c => c.grade === name && c.day === day && c.block === block)
    }
    return highlightedCells.some(c => c.teacher === name && c.day === day && c.block === block)
  }

  // Freeform mode helpers
  function isPickedUpCell(day: string, block: number): boolean {
    if (type !== "teacher") return false
    return floatingBlocks.some(b =>
      b.sourceTeacher === name && b.sourceDay === day && b.sourceBlock === block
    )
  }

  function hasPendingPlacement(day: string, block: number): PendingPlacement | undefined {
    if (type !== "teacher") return undefined
    return pendingPlacements.find(p =>
      p.teacher === name && p.day === day && p.block === block
    )
  }

  function hasValidationError(day: string, block: number): ValidationError | undefined {
    if (type !== "teacher") return undefined
    return validationErrors.find(e =>
      e.cells.some(c => c.teacher === name && c.day === day && c.block === block)
    )
  }

  function isMovedBlockerCell(day: string, block: number): boolean {
    if (type !== "teacher") return false
    return movedBlockerCells.some(c =>
      c.teacher === name && c.day === day && c.block === block
    )
  }

  function isValidFreeformTarget(day: string, block: number): boolean {
    if (!freeformMode || !selectedFloatingBlock) return false
    if (type !== "teacher") return false
    // A conflict-blocked window is not a target: the teacher is still in class
    if (isConflictBlockedCell(day, block)) return false
    // A class-unusable window is not a target: nothing can ever meet there
    if (isTeacherUnavailableCell(day, block)) return false
    // Picked-up cells are valid targets (they're essentially empty now)
    if (isPickedUpCell(day, block)) return true
    const { entry } = getCellContent(day, block)
    const cellType = getCellType(entry)
    // Can place on OPEN cells or swap with classes/study halls
    return cellType === "open" || cellType === "empty" || cellType === "class" || cellType === "study-hall"
  }

  function getCellClass(entry: [string, string] | null, day: string, block: number): string {
    // Lunch cells (grade view) are inert: no mode styling, no hover, no cursor.
    if (isLunchCell(day, block)) {
      return "bg-amber-50/70"
    }
    // Unavailable cells (grade view) are inert: block not on this grade's timetable.
    if (isUnavailableCell(day, block)) {
      return "bg-slate-100/60"
    }
    // Conflict-blocked cells (teacher view) are inert: still teaching a class
    // whose window runs into this block. Tinted like the class cell above so
    // the pair reads as one continuous engagement. Pending freeform placements
    // are excluded above so they keep their normal styling and stay visible.
    if (isConflictBlockedCell(day, block)) {
      return "bg-green-50/70"
    }
    // Class-unusable cells (teacher view) are inert: no class this teacher
    // teaches can ever meet at this block — not schedulable free time. One
    // exception: a STUDY HALL may legitimately sit here (supervision is not
    // teaching one of their classes), so a valid manual-study-hall target
    // keeps its target affordance instead of the muted treatment.
    if (isTeacherUnavailableCell(day, block)) {
      if (manualStudyHallMode && isValidTarget(day, block)) {
        return "ring-2 ring-inset ring-emerald-500 bg-emerald-100 cursor-pointer hover:bg-emerald-200"
      }
      return "bg-slate-100/60"
    }

    const baseClass = (() => {
      // Teacher-view designated lunch: amber idle background like grade view,
      // but only as the BASE — all mode affordances below (rings, hovers,
      // cursors) still layer on top and win visually via twMerge.
      if (isTeacherLunchCell(day, block)) return "bg-amber-50/70"
      if (!entry) return "bg-muted/30"
      const [, subject] = entry
      if (isOpenBlock(subject)) return "bg-gray-100 text-gray-500"
      if (isStudyHall(subject)) return "bg-blue-100 text-blue-800"
      if (subject === "Elective") return "bg-purple-50"
      return "bg-green-50"
    })()

    // Add highlight animation for cells that just received swapped content
    if (isHighlightedCell(day, block)) {
      return cn(baseClass, "ring-2 ring-inset ring-violet-500 animate-pulse-highlight")
    }

    // Freeform mode styling
    if (freeformMode && type === "teacher") {
      const error = hasValidationError(day, block)
      const placement = hasPendingPlacement(day, block)
      const pickedUp = isPickedUpCell(day, block)

      // Error styling — placed blocks keep the green ring (placed) + red background (conflict)
      if (error) {
        if (placement) {
          return cn("bg-red-100 ring-2 ring-inset ring-green-400 cursor-pointer")
        }
        return cn(baseClass, "ring-2 ring-inset ring-red-500 bg-red-100")
      }

      // Pending placement styling - use the block's natural color with a ring
      if (placement) {
        const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
        const placedBlockIsStudyHall = isStudyHall(placedBlock?.subject)
        const placementBg = placedBlockIsStudyHall ? "bg-blue-100" : "bg-green-50"
        const isAutoFixed = autoFixedBlockIds.includes(placement.blockId)
        // If a block is selected, this is a valid target
        if (selectedFloatingBlock) {
          return cn(placementBg, "ring-2 ring-inset ring-emerald-400 cursor-pointer hover:ring-emerald-500")
        }
        // Auto-fixed blocks get amber ring to distinguish from manual placements
        if (isAutoFixed) {
          return cn(placementBg, "ring-2 ring-inset ring-amber-400 cursor-pointer")
        }
        return cn(placementBg, "ring-2 ring-inset ring-green-400 cursor-pointer")
      }

      // Moved blocker cell styling - amber with pulse to show auto-moved classes
      if (isMovedBlockerCell(day, block)) {
        return cn(baseClass, "ring-2 ring-inset ring-amber-400 animate-pulse")
      }

      // Picked-up cell ghost styling - light indigo dashed
      if (pickedUp) {
        // If a block is selected, show as valid target
        if (selectedFloatingBlock) {
          return cn("bg-emerald-50 border-2 border-dashed border-emerald-400 cursor-pointer hover:bg-emerald-100")
        }
        return cn("bg-indigo-50 border-2 border-dashed border-indigo-300")
      }

      // Clickable cells - classes, study halls, and OPEN slots (when block selected)
      const cellType = getCellType(entry)
      if (cellType === "class" || cellType === "study-hall") {
        return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-300")
      }
      if (selectedFloatingBlock && (cellType === "open" || cellType === "empty")) {
        return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-300")
      }

      return baseClass
    }

    // Add swap mode styling
    if (swapMode) {
      if (isSelectedCell(day, block)) {
        return cn(baseClass, "ring-2 ring-inset ring-amber-500 bg-amber-100")
      }
      if (isValidTarget(day, block)) {
        return cn(baseClass, "ring-2 ring-inset ring-emerald-500 bg-emerald-100 cursor-pointer hover:bg-emerald-200")
      }
      // Clickable cells depend on view type
      const cellType = getCellType(entry)
      if (type === "teacher") {
        // Teacher view: can click study halls, open blocks, and classes
        if (cellType === "study-hall" || cellType === "open" || cellType === "class") {
          return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-slate-300")
        }
      } else if (type === "grade") {
        // Grade view: can click classes and study halls
        if (cellType === "class" || cellType === "study-hall") {
          return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-slate-300")
        }
      }
    }

    // Manual study hall placement styling
    if (manualStudyHallMode && type === "teacher") {
      // Valid placement targets (when a group is selected)
      if (isValidTarget(day, block)) {
        return cn(baseClass, "ring-2 ring-inset ring-emerald-500 bg-emerald-100 cursor-pointer hover:bg-emerald-200")
      }
      // Placed study halls are clickable to remove
      if (entry && isStudyHall(entry[1])) {
        return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-300")
      }
    }

    return baseClass
  }

  function handleCellClick(day: string, block: number) {
    // Conflict-blocked windows (teacher view) are never clickable: the teacher
    // is still mid-class there. (Cells holding a pending placement are not
    // "blocked" — clicking them still unplaces as usual.)
    if (isConflictBlockedCell(day, block)) return
    // Class-unusable windows (teacher view) are not clickable: no class of
    // this teacher's can meet there, so there is nothing to place, swap, or
    // label. Exception: a study hall CAN sit there, so a valid manual-study-
    // hall target stays clickable. (Pending placements unplace as usual.)
    if (isTeacherUnavailableCell(day, block)
        && !(manualStudyHallMode && isValidTarget(day, block))) return

    // Handle freeform mode
    if (freeformMode && type === "teacher") {
      const { entry } = getCellContent(day, block)
      const cellType = getCellType(entry)
      const [grade, subject] = entry || ["", ""]
      const placement = hasPendingPlacement(day, block)

      // If clicking on a placed block (and no floating block selected), unplace it
      if (placement && !selectedFloatingBlock && onUnplace) {
        onUnplace(placement.blockId)
        return
      }

      // If a floating block is selected
      if (selectedFloatingBlock) {
        // Clicking a placed block - unplace it first, then place selected there
        if (placement && onUnplace && onPlace) {
          onUnplace(placement.blockId)
          onPlace({ teacher: name, day, block, grade, subject })
          return
        }

        // Clicking a picked-up cell or OPEN slot - place the block there
        if (isPickedUpCell(day, block) || cellType === "open" || cellType === "empty") {
          if (onPlace) {
            onPlace({ teacher: name, day, block, grade, subject })
          }
          return
        }

        // Clicking a class or study hall - place selected block there, pick up what's there
        if ((cellType === "class" || cellType === "study-hall") && onPlace && onPickUp) {
          // First place the floating block here
          onPlace({ teacher: name, day, block, grade, subject })
          // Then pick up what was there (this will be handled by the parent)
          return
        }

        return
      }

      // No block selected - clicking a class or study hall picks it up
      if ((cellType === "class" || cellType === "study-hall") && onPickUp) {
        onPickUp({ teacher: name, day, block, grade, subject })
        return
      }

      return
    }

    if (!(swapMode || manualStudyHallMode) || !onCellClick) return

    // Lunch and unavailable cells (grade view) are never clickable/assignable
    if (isLunchCell(day, block)) return
    if (isUnavailableCell(day, block)) return

    const { entry, isMultiple } = getCellContent(day, block)
    const cellType = getCellType(entry)

    if (type === "teacher") {
      // Teacher view: can click study halls, open blocks, classes, or valid targets
      if (cellType === "study-hall" || cellType === "open" || cellType === "class" || isValidTarget(day, block)) {
        const [grade, subject] = entry || ["", ""]
        onCellClick({ teacher: name, day, block, grade, subject }, cellType === "empty" ? "open" : cellType)
      }
    } else if (type === "grade") {
      // Grade view: can click classes, study halls, or valid targets
      // Skip multi-entry cells (electives with multiple classes) - they can't be swapped individually
      if (isMultiple) return
      if (cellType === "class" || cellType === "study-hall" || isValidTarget(day, block)) {
        const [teacher, subject] = entry || ["", ""]
        onCellClick({ grade: name, day, block, teacher, subject }, cellType === "empty" ? "open" : cellType)
      }
    }
  }

  return (
    <div
      data-card-name={name}
      className={cn(
        "border rounded-lg overflow-hidden bg-white shadow-sm transition-all schedule-card",
        isSelected && "ring-2 ring-sky-500 border-sky-500"
      )}
    >
      <div
        className={cn(
          "px-3 py-2 font-medium border-b flex items-center justify-between",
          isSelected ? "bg-sky-50" : changeStatus === 'pending' ? "bg-amber-50" : changeStatus === 'applied' ? "bg-emerald-50" : "bg-slate-50"
        )}
      >
        <div className="flex items-center gap-2">
          {changeStatus === 'pending' && (
            <div className="flex items-center gap-1 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Changed</span>
            </div>
          )}
          {changeStatus === 'applied' && (
            <div className="flex items-center gap-1 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-xs font-medium">
              <Check className="h-3.5 w-3.5" />
              <span>Updated</span>
            </div>
          )}
          <span>{name}</span>
          {status && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                isFullTime(status)
                  ? "border-sky-400 text-sky-700 bg-sky-50"
                  : "border-slate-300 text-slate-500"
              )}
            >
              {status}
            </Badge>
          )}
        </div>
        {showCheckbox && type === "teacher" && (
          <label className="flex items-center gap-1.5 cursor-pointer no-print">
            <RefreshCw className={cn("h-3 w-3", isSelected ? "text-sky-600" : "text-muted-foreground")} />
            <span className={cn("text-xs", isSelected ? "text-sky-600" : "text-muted-foreground")}>Regenerate</span>
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelect}
              className="data-[state=checked]:bg-sky-600 data-[state=checked]:border-sky-600"
            />
          </label>
        )}
        {showExcludeCheckbox && type === "teacher" && (
          <label
            className={cn(
              "flex items-center gap-1.5 no-print",
              isExclusionLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            )}
            title={isExclusionLocked ? "Ineligible for study hall supervision (by rule or teacher setting)" : undefined}
          >
            <Ban className={cn("h-3 w-3", isExcluded ? "text-violet-600" : "text-muted-foreground")} />
            <span className={cn("text-xs", isExcluded ? "text-violet-600" : "text-muted-foreground")}>Exclude</span>
            <Checkbox
              checked={isExcluded}
              onCheckedChange={isExclusionLocked ? undefined : onToggleExclude}
              disabled={isExclusionLocked}
              className="data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600"
            />
          </label>
        )}
      </div>
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-1.5 text-left w-8 text-xs"></th>
            {DAYS.map((day) => (
              <th key={day} className="p-1.5 text-center font-medium text-xs">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <tr key={block} className="border-b last:border-b-0">
              <td className="p-1.5 font-medium text-muted-foreground bg-muted/30 whitespace-nowrap text-xs">
                B{block}
                {/* Grade view: this grade's true bell time for the block from
                    its resolved template row — K-5's B8 reads 1:40–2:25 while
                    6th-12th read 1:20–2:00. No resolved row (e.g. K-5's
                    surrendered B9) or no template = bare header (legacy). */}
                {type === "grade" && blockTimesByGrade?.[name]?.[block] && (
                  <div className="text-[9px] font-normal leading-tight text-muted-foreground/70">
                    {blockTimesByGrade[name][block].replace(/\s*-\s*/, "–")}
                  </div>
                )}
              </td>
              {DAYS.map((day) => {
                const { entry, isMultiple } = getCellContent(day, block)
                const [primary, secondary] = entry || ["", ""]

                // In freeform mode, check for pending placements or picked-up state
                const placement = freeformMode && type === "teacher" ? hasPendingPlacement(day, block) : undefined
                const pickedUp = freeformMode && type === "teacher" && isPickedUpCell(day, block)
                const error = freeformMode && type === "teacher" ? hasValidationError(day, block) : undefined

                // Get display content - show placed block's content if there's a placement
                let displayPrimary = primary
                let displaySecondary = secondary
                let hasContent = !!entry

                if (placement) {
                  const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
                  if (placedBlock) {
                    displayPrimary = placedBlock.grade
                    displaySecondary = placedBlock.subject
                    hasContent = true
                  }
                }

                return (
                  <td
                    key={day}
                    onClick={() => handleCellClick(day, block)}
                    className={cn(
                      "p-1 text-center border-l overflow-hidden transition-all",
                      getCellClass(entry, day, block)
                    )}
                    title={error ? error.message : undefined}
                  >
                    {(() => {
                      // Check if this class is an elective or co-taught
                      // Teacher view: name=teacher, displayPrimary=grade, displaySecondary=subject
                      // Grade view: name=grade, displayPrimary=teacher, displaySecondary=subject
                      const teacherName = type === "teacher" ? name : displayPrimary
                      const subjectName = displaySecondary
                      const isRegularClass = isScheduledClass(subjectName) && !isStudyHall(subjectName)
                      const isElective = isRegularClass && isClassElective(teacherName, subjectName, classesSnapshot)
                      const isCotaught = isRegularClass && isClassCotaught(teacherName, subjectName, classesSnapshot)

                      if (placement) {
                        // Show the placed block's content
                        const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
                        const isTransferredPlacement = placedBlock?.transferredTo || (placedBlock && placement.teacher !== placedBlock.sourceTeacher)
                        // Use source teacher for elective/cotaught lookup (class properties don't change when moved)
                        const sourceTeacher = placedBlock?.sourceTeacher || teacherName
                        const placedIsElective = isRegularClass && isClassElective(sourceTeacher, subjectName, classesSnapshot)
                        const placedIsCotaught = isRegularClass && isClassCotaught(sourceTeacher, subjectName, classesSnapshot)
                        return (
                          <div className="max-w-full overflow-visible relative">
                            {isTransferredPlacement && <ArrowLeftRight className="absolute top-0 left-0 h-2.5 w-2.5 text-teal-500 z-10" />}
                            <div className="font-medium text-xs leading-tight truncate flex items-center justify-center" title={displayPrimary}>
                              <span className="truncate">{formatGradeDisplayCompact(displayPrimary)}</span>
                              {placedIsElective && <span className="text-purple-500 ml-1 text-[10px] flex-shrink-0">EL</span>}
                            </div>
                            <div className="text-[10px] leading-tight text-muted-foreground truncate flex items-center justify-center" title={displaySecondary}>
                              <span className="truncate">{displaySecondary}</span>
                              {placedIsCotaught && <span className="text-teal-500 ml-1 flex-shrink-0">CO</span>}
                            </div>
                          </div>
                        )
                      }
                      if (pickedUp) {
                        return (
                          <div className="text-[10px] text-indigo-400 italic">
                            moved
                          </div>
                        )
                      }
                      if (isLunchCell(day, block)) {
                        // Grade-view lunch cell (block not teachable for this grade)
                        return (
                          <span className="text-[10px] italic text-amber-700/70">
                            Lunch
                          </span>
                        )
                      }
                      if (isUnavailableCell(day, block)) {
                        // Grade-view unavailable cell: block not on this grade's
                        // timetable. When the template says what the grade does
                        // in this window (break/SEL/meeting row), show that
                        // label; otherwise a plain dash.
                        const unavailableLabel = unavailableLabelsByGrade?.[name]?.[block]
                        if (unavailableLabel) {
                          return (
                            <span
                              className="block max-w-full truncate px-1 text-[10px] italic text-slate-500"
                              title={unavailableLabel}
                            >
                              {unavailableLabel}
                            </span>
                          )
                        }
                        return (
                          <span
                            className="text-[10px] text-slate-400"
                            title="Not on this grade's timetable"
                          >
                            —
                          </span>
                        )
                      }
                      if (isTeacherLunchCell(day, block)) {
                        // Teacher-view designated lunch label. Replaces only
                        // the OPEN/empty idle content — the cell's td keeps
                        // its onClick and mode styling, so swap/freeform/
                        // study-hall interactions treat it exactly as OPEN.
                        return (
                          <span className="text-[10px] italic text-amber-700/70">
                            Lunch
                          </span>
                        )
                      }
                      {
                        // Teacher-view conflict-blocked cell: still teaching a
                        // class whose window runs into this block ("B8 until
                        // 2:25"). Checked before the N/A and OPEN branches so
                        // no editable OPEN affordance appears on a window the
                        // teacher isn't actually free in.
                        const blocker = !placement && !pickedUp ? getConflictBlockerAt(day, block) : null
                        if (blocker) {
                          const { end } = getStraddleTime(blocker.grade, blocker.sourceBlock)
                          const label = end
                            ? `B${blocker.sourceBlock} until ${end}`
                            : `B${blocker.sourceBlock} continues`
                          const title = end
                            ? `${formatGradeDisplayCompact(blocker.entry[0])} ${blocker.entry[1]} runs until ${end}`
                            : `${formatGradeDisplayCompact(blocker.entry[0])} ${blocker.entry[1]} runs into this block`
                          return (
                            <span
                              className="block max-w-full truncate px-0.5 text-[10px] italic text-green-800/60"
                              title={title}
                            >
                              {label}
                            </span>
                          )
                        }
                      }
                      if (isTeacherUnavailableCell(day, block)) {
                        // Teacher-view class-unusable cell: nothing this
                        // teacher teaches can ever meet at this block, so it
                        // is not real free time — inert, not OPEN.
                        return (
                          <span
                            className="text-[10px] italic text-slate-400"
                            title="No classes this teacher teaches can meet in this block"
                          >
                            N/A
                          </span>
                        )
                      }
                      if (isOpenBlock(displaySecondary)) {
                        // OPEN cells - check for custom label
                        const openBlockInfo = type === "teacher" ? getOpenBlockAt(schedule as TeacherSchedule, day, block) : null
                        const label = openBlockInfo && showOpenLabels
                          ? getOpenBlockLabel(openBlockLabels, name, openBlockInfo.openIndex, openBlockInfo.type)
                          : undefined
                        const displayText = label || BLOCK_TYPE_OPEN
                        const isDropdownOpen = labelDropdownCell?.day === day && labelDropdownCell?.block === block

                        // If label editing is enabled, show clickable cell with dropdown
                        if (type === "teacher" && onOpenLabelChange && openBlockInfo) {
                          return (
                            <div className="relative">
                              <span
                                className={cn(
                                  "cursor-pointer hover:underline text-center inline-flex items-center gap-1",
                                  label
                                    ? "text-[11px] text-slate-700 font-semibold leading-[1.2]"
                                    : "text-xs text-muted-foreground"
                                )}
                                style={label ? { maxWidth: '100%', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden', wordBreak: 'break-word' } : undefined}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  setLabelDropdownPos({
                                    top: rect.bottom + 4,
                                    left: rect.left + rect.width / 2
                                  })
                                  setLabelDropdownCell({ day, block, openIndex: openBlockInfo.openIndex })
                                  setLabelSearch("")
                                }}
                              >
                                {displayText}
                                {!label && <Pencil className="h-2.5 w-2.5 text-muted-foreground/50" />}
                              </span>
                              {isDropdownOpen && labelDropdownPos && (
                                <div
                                  ref={labelDropdownRef}
                                  className="fixed z-[100] bg-popover border rounded-lg shadow-xl w-[240px] -translate-x-1/2"
                                  style={{
                                    top: labelDropdownPos.top,
                                    left: labelDropdownPos.left,
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* Header with X button */}
                                  <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 rounded-t-lg">
                                    <span className="text-xs font-medium text-muted-foreground">Label</span>
                                    <button
                                      onClick={() => {
                                        setLabelDropdownCell(null)
                                        setLabelDropdownPos(null)
                                        setLabelSearch("")
                                      }}
                                      className="p-0.5 rounded hover:bg-muted"
                                    >
                                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                                    </button>
                                  </div>
                                  {/* Input */}
                                  <div className="p-2">
                                    <Input
                                      ref={labelInputRef}
                                      value={labelSearch}
                                      onChange={(e) => setLabelSearch(e.target.value)}
                                      placeholder="Type or select..."
                                      className="h-8 text-sm"
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && labelSearch.trim()) {
                                          onOpenLabelChange(name, openBlockInfo.openIndex, labelSearch.trim())
                                          setLabelDropdownCell(null)
                                          setLabelDropdownPos(null)
                                          setLabelSearch("")
                                        } else if (e.key === "Escape") {
                                          setLabelDropdownCell(null)
                                          setLabelDropdownPos(null)
                                          setLabelSearch("")
                                        }
                                      }}
                                    />
                                  </div>
                                  {/* Options */}
                                  <div className="max-h-40 overflow-auto border-t">
                                    {/* Available labels */}
                                    {(openBlockLabels?.availableLabels || [])
                                      .filter(l => l.toLowerCase().includes(labelSearch.toLowerCase()))
                                      .map((availLabel) => (
                                        <div
                                          key={availLabel}
                                          onClick={() => {
                                            onOpenLabelChange(name, openBlockInfo.openIndex, availLabel)
                                            setLabelDropdownCell(null)
                                            setLabelDropdownPos(null)
                                            setLabelSearch("")
                                          }}
                                          className={cn(
                                            "px-3 py-1.5 cursor-pointer hover:bg-accent text-sm flex items-center gap-2",
                                            label === availLabel && "bg-accent"
                                          )}
                                        >
                                          <div className={cn(
                                            "w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                                            label === availLabel ? "border-primary" : "border-muted-foreground/40"
                                          )}>
                                            {label === availLabel && (
                                              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                            )}
                                          </div>
                                          <span>{availLabel}</span>
                                        </div>
                                      ))}
                                    {/* Create new option */}
                                    {labelSearch.trim() && !openBlockLabels?.availableLabels?.some(
                                      l => l.toLowerCase() === labelSearch.toLowerCase()
                                    ) && (
                                      <div
                                        onClick={() => {
                                          onOpenLabelChange(name, openBlockInfo.openIndex, labelSearch.trim())
                                          setLabelDropdownCell(null)
                                          setLabelDropdownPos(null)
                                          setLabelSearch("")
                                        }}
                                        className="px-3 py-1.5 cursor-pointer hover:bg-accent text-sm text-primary border-t flex items-center gap-2"
                                      >
                                        <div className="w-3.5 h-3.5 rounded-full border-2 border-primary/40 flex-shrink-0" />
                                        <span>Create &quot;{labelSearch.trim()}&quot;</span>
                                      </div>
                                    )}
                                    {/* No labels yet message */}
                                    {(!openBlockLabels?.availableLabels || openBlockLabels.availableLabels.length === 0) && !labelSearch.trim() && (
                                      <div className="px-3 py-2 text-xs text-muted-foreground">
                                        Type to create a label
                                      </div>
                                    )}
                                  </div>
                                  {/* Clear option at bottom - only show if there's a label set */}
                                  {label && (
                                    <div
                                      onClick={() => {
                                        onOpenLabelChange(name, openBlockInfo.openIndex, undefined)
                                        setLabelDropdownCell(null)
                                        setLabelDropdownPos(null)
                                        setLabelSearch("")
                                      }}
                                      className="px-3 py-1.5 cursor-pointer hover:bg-red-50 text-xs text-muted-foreground border-t"
                                    >
                                      Clear label
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        }

                        // Read-only display (or grade view)
                        return (
                          <span
                            className={cn(
                              "text-center",
                              label
                                ? "text-[11px] text-slate-700 font-semibold leading-[1.2]"
                                : "text-xs text-muted-foreground"
                            )}
                            style={label ? { maxWidth: '100%', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden', wordBreak: 'break-word' } : undefined}
                          >
                            {displayText}
                          </span>
                        )
                      }
                      if (isMultiple) {
                        // Multiple entries (electives) - show just "Elective" or "Multiple"
                        return (
                          <div className="max-w-full overflow-hidden">
                            <div className="font-medium text-xs leading-tight text-purple-700">
                              {displaySecondary}
                            </div>
                          </div>
                        )
                      }
                      if (hasContent) {
                        // Straddling class (teacher view): show its true time
                        // range so the cell + its "B8 until 2:25" continuation
                        // below read as one engagement. Only when the class
                        // actually triggers a conflict pair today.
                        const straddleRange = !placement ? getStraddleSourceRange(day, block) : null
                        return (
                          <div className="max-w-full overflow-hidden">
                            <div className="font-medium text-xs leading-tight truncate flex items-center justify-center" title={type === "teacher" ? displayPrimary : displaySecondary}>
                              <span className="truncate">{type === "teacher" ? formatGradeDisplayCompact(displayPrimary) : displaySecondary}</span>
                              {isElective && <span className="text-purple-500 ml-1 text-[10px] flex-shrink-0">EL</span>}
                            </div>
                            <div className="text-[10px] leading-tight text-muted-foreground truncate flex items-center justify-center" title={type === "teacher" ? displaySecondary : displayPrimary}>
                              <span className="truncate">{type === "teacher" ? displaySecondary : displayPrimary}</span>
                              {isCotaught && <span className="text-teal-500 ml-1 flex-shrink-0">CO</span>}
                            </div>
                            {straddleRange && (
                              <div className="text-[9px] leading-tight text-green-800/60 truncate">
                                {straddleRange}
                              </div>
                            )}
                          </div>
                        )
                      }
                      return <span className="text-xs text-muted-foreground">-</span>
                    })()}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
