"use client"

import { useState, useEffect, useRef, useMemo, Fragment } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ScheduleGrid } from "@/components/ScheduleGrid"
import { ScheduleStats } from "@/components/ScheduleStats"
import { GradeTimetable } from "@/components/GradeTimetable"
import { Loader2, Download, ArrowLeft, Check, RefreshCw, Shuffle, Trash2, Star, MoreVertical, Users, GraduationCap, Printer, ArrowLeftRight, X, Hand, Pencil, Copy, ChevronDown, ChevronUp, AlertTriangle, Minus, Info, Crosshair, Clock, ImageDown, Globe } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import type { ScheduleOption, TeacherSchedule, GradeSchedule, Teacher, FloatingBlock, PendingPlacement, ValidationError, CellLocation, ClassEntry, OpenBlockLabels, PendingTransfer, TimetableTemplate } from "@/lib/types"
import { resolveRowsForGrade } from "@/lib/timetable-utils"
import { parseClassesFromSnapshot, parseTeachersFromSnapshot, parseRulesFromSnapshot, hasValidSnapshots, detectClassChanges, computeExpectedTeachingSessions, type GenerationStats, type ChangeDetectionResult, type CurrentClass, type ClassSnapshot, type TeacherSnapshot } from "@/lib/snapshot-utils"
import { parseGradeDisplayToNumbers, parseGradeDisplayToNames, gradesOverlap, gradesEqual, gradeNumToDisplay, isClassElective, shouldIgnoreGradeConflict } from "@/lib/grade-utils"
import { BLOCK_TYPE_OPEN, BLOCK_TYPE_STUDY_HALL, isOpenBlock, isStudyHall, isScheduledClass, isOccupiedBlock, entryIsOpen, entryIsOccupied, entryIsScheduledClass, isFullTime, setOpenBlockLabel, recalculateOptionStats, getFirstGradeEntry, isMultipleEntryCell } from "@/lib/schedule-utils"
import toast, { successIcon, errorIcon, warningIcon } from "@/lib/toast"
import { generateSchedules, reassignStudyHalls } from "@/lib/scheduler"
import { generateSchedulesRemote } from "@/lib/scheduler-remote"
import { useGeneration } from "@/lib/generation-context"

// Note: Helper functions are imported from shared modules:
// - @/lib/grade-utils: parseGradeDisplayToNumbers, gradesOverlap, gradeNumToDisplay, isClassElective, shouldIgnoreGradeConflict
// - @/lib/schedule-utils: BLOCK_TYPE_OPEN, BLOCK_TYPE_STUDY_HALL, isOpenBlock, isStudyHall, isScheduledClass, isOccupiedBlock, entryIsOpen, entryIsOccupied, entryIsScheduledClass

// Sort grades: Kindergarten first, then by grade number
function gradeSort(a: string, b: string): number {
  if (a.includes("Kindergarten")) return -1
  if (b.includes("Kindergarten")) return 1
  const aNum = parseInt(a.match(/(\d+)/)?.[1] || "99")
  const bNum = parseInt(b.match(/(\d+)/)?.[1] || "99")
  return aNum - bNum
}

/**
 * Rebuild gradeSchedules from teacherSchedules to ensure consistency.
 * TeacherSchedules is the source of truth - this derives gradeSchedules from it.
 * Handles multi-grade classes by parsing grade display strings (e.g., "6th-8th Grade").
 *
 * @param gradesSnapshot - Array of valid grades from the snapshot (source of truth for grade names)
 */
function rebuildGradeSchedules(
  teacherSchedules: Record<string, TeacherSchedule>,
  gradesSnapshot: Array<{ id: string; name: string; display_name: string }> | undefined,
  existingGradeSchedules: Record<string, GradeSchedule>
): Record<string, GradeSchedule> {
  const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

  // Use grades_snapshot as the source of truth for valid grade names
  // Fall back to filtering existingGradeSchedules if snapshot not available
  let gradeNames: string[]
  if (gradesSnapshot && gradesSnapshot.length > 0) {
    gradeNames = gradesSnapshot.map(g => g.display_name)
  } else {
    // Fallback: filter out phantom grade keys (like "6th-7th Grade")
    gradeNames = Object.keys(existingGradeSchedules).filter(grade => {
      const hasRangePattern = /\d+(?:st|nd|rd|th)?[-–]\d+/.test(grade)
      return !hasRangePattern
    })
  }

  // Helper to parse grade names from grade_display string (e.g., "6th-11th Grade" -> ["6th Grade", "7th Grade", ...])
  // Same logic as ScheduleStats.tsx - handles: Kindergarten, comma-separated lists, range patterns, single grades
  const parseGradeDisplay = (gradeDisplay: string): string[] => {
    const grades: string[] = []

    // Check for Kindergarten (can appear alone or in a comma-separated list)
    if (gradeDisplay.toLowerCase().includes('kindergarten') || gradeDisplay === 'K') {
      const kGrade = gradeNames.find(g => g.toLowerCase().includes('kindergarten') || g === 'K')
      if (kGrade) {
        grades.push(kGrade)
      }
      // If ONLY kindergarten, return early
      if (!gradeDisplay.includes(',')) {
        return grades
      }
    }

    // Check for comma-separated list like "6th Grade, 7th Grade" or "K, 1st, 2nd"
    if (gradeDisplay.includes(',')) {
      const parts = gradeDisplay.split(',').map(p => p.trim())
      for (const part of parts) {
        // Skip if already handled kindergarten
        if (part.toLowerCase().includes('kindergarten') || part === 'K') {
          continue
        }
        // Try exact match first
        if (gradeNames.includes(part)) {
          grades.push(part)
          continue
        }
        // Extract grade number and build standard format
        const numMatch = part.match(/(\d+)/)
        if (numMatch) {
          const num = parseInt(numMatch[1])
          const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th'
          const gradeName = `${num}${suffix} Grade`
          if (gradeNames.includes(gradeName) && !grades.includes(gradeName)) {
            grades.push(gradeName)
          }
        }
      }
      return grades
    }

    // Check for range pattern like "6th-11th" or "6th-8th"
    const rangeMatch = gradeDisplay.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1])
      const end = parseInt(rangeMatch[2])
      for (let i = start; i <= end; i++) {
        const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th'
        const gradeName = `${i}${suffix} Grade`
        if (gradeNames.includes(gradeName)) {
          grades.push(gradeName)
        }
      }
      return grades
    }

    // Single grade pattern - try exact match first
    if (gradeNames.includes(gradeDisplay)) {
      grades.push(gradeDisplay)
      return grades
    }

    // Try to find matching grade by number
    const singleMatch = gradeDisplay.match(/(\d+)(?:st|nd|rd|th)/)
    if (singleMatch) {
      const num = parseInt(singleMatch[1])
      const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th'
      const gradeName = `${num}${suffix} Grade`
      if (gradeNames.includes(gradeName)) {
        grades.push(gradeName)
      }
    }

    return grades
  }

  // Initialize empty schedules for each grade
  const newGradeSchedules: Record<string, GradeSchedule> = {}
  for (const grade of gradeNames) {
    newGradeSchedules[grade] = {}
    for (const day of DAYS) {
      newGradeSchedules[grade][day] = {}
    }
  }

  // Scan all teacher schedules and populate grade schedules
  // TWO PASSES: First multi-grade (electives), then single-grade (required classes)
  // This ensures required single-grade classes take priority over electives

  // Pass 1: Multi-grade entries (electives) - accumulate into arrays when multiple share a cell
  for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
    for (const day of DAYS) {
      for (let block = 1; block <= 5; block++) {
        const entry = schedule[day]?.[block]
        if (!entry || isOpenBlock(entry[1])) continue

        const gradeDisplay = entry[0]
        const subject = entry[1]
        const targetGrades = parseGradeDisplay(gradeDisplay)

        // Only process multi-grade entries in this pass
        if (targetGrades.length > 1) {
          for (const grade of targetGrades) {
            const existing = newGradeSchedules[grade][day][block]
            const newEntry: [string, string] = [teacher, subject]
            if (!existing) {
              // No existing entry - set as single tuple
              newGradeSchedules[grade][day][block] = newEntry
            } else if (Array.isArray(existing) && Array.isArray(existing[0])) {
              // Already an array of tuples - append
              (existing as [string, string][]).push(newEntry)
            } else {
              // Single tuple exists - convert to array
              newGradeSchedules[grade][day][block] = [existing as [string, string], newEntry]
            }
          }
        }
      }
    }
  }

  // Pass 2: Single-grade entries (required classes) - these take priority
  for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
    for (const day of DAYS) {
      for (let block = 1; block <= 5; block++) {
        const entry = schedule[day]?.[block]
        if (!entry || isOpenBlock(entry[1])) continue

        const gradeDisplay = entry[0]
        const subject = entry[1]
        const targetGrades = parseGradeDisplay(gradeDisplay)

        // Only process single-grade entries in this pass (overwrites electives)
        if (targetGrades.length === 1) {
          for (const grade of targetGrades) {
            newGradeSchedules[grade][day][block] = [teacher, subject]
          }
        }
      }
    }
  }

  return newGradeSchedules
}

// Convert grade string to number for sorting (K=0, 1st=1, etc.)
function gradeToNum(grade: string): number {
  if (grade.toLowerCase().includes("kindergarten") || grade === "K") return 0
  const match = grade.match(/(\d+)/)
  return match ? parseInt(match[1]) : 99
}

// Analyze a teacher's schedule to find their primary teaching grade(s)
// Primary = grades they teach more than 30% of the time
function analyzeTeacherGrades(schedule: TeacherSchedule): { primaryGrade: number; hasPrimary: boolean; gradeSpread: number } {
  const gradeCounts = new Map<number, number>()
  let totalTeaching = 0

  for (const day of Object.values(schedule)) {
    for (const entry of Object.values(day)) {
      if (entry && entry[0] && isScheduledClass(entry[1])) {
        totalTeaching++
        const gradeStr = entry[0]

        // Parse grades from the entry
        const grades: number[] = []
        const rangeMatch = gradeStr.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)/)
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1])
          const end = parseInt(rangeMatch[2])
          for (let i = start; i <= end; i++) grades.push(i)
        } else {
          grades.push(gradeToNum(gradeStr))
        }

        // Count each grade (split credit for multi-grade classes)
        const creditPerGrade = 1 / grades.length
        for (const g of grades) {
          if (g < 99) {
            gradeCounts.set(g, (gradeCounts.get(g) || 0) + creditPerGrade)
          }
        }
      }
    }
  }

  if (totalTeaching === 0) {
    return { primaryGrade: 99, hasPrimary: false, gradeSpread: 0 }
  }

  // Find grades that make up >30% of teaching
  const primaryGrades: number[] = []
  for (const [grade, count] of gradeCounts) {
    if (count / totalTeaching >= 0.30) {
      primaryGrades.push(grade)
    }
  }

  // Sort primary grades to get the lowest
  primaryGrades.sort((a, b) => a - b)

  return {
    primaryGrade: primaryGrades.length > 0 ? primaryGrades[0] : 99,
    hasPrimary: primaryGrades.length > 0,
    gradeSpread: gradeCounts.size
  }
}

/** Format a date as short relative/absolute: "2h ago", "3d ago", "Jan 28" */
function formatShortDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${Math.max(1, diffMins)}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Get the next available letter label (A, B, C...) given existing options */
function getNextLabel(options: ScheduleOption[]): string {
  const existingLabels = new Set(options.map(o => o.label).filter(Boolean))
  let charCode = 65 // 'A'
  while (existingLabels.has(String.fromCharCode(charCode))) {
    charCode++
  }
  return String.fromCharCode(charCode)
}

interface Generation {
  id: string
  quarter_id: string
  generated_at: string
  selected_option: number | null
  notes: string | null
  is_starred: boolean
  options: ScheduleOption[]
  stats?: GenerationStats
  quarter: { id: string; name: string }
}


export default function HistoryDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = params.id as string
  const isNewGeneration = searchParams.get('new') === 'true'
  const initialView = searchParams.get('view')
  const { setIsGenerating: setGlobalGenerating } = useGeneration()
  const [generation, setGeneration] = useState<Generation | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewingOption, setViewingOption] = useState("1")
  const [viewMode, setViewMode] = useState<"teacher" | "grade" | "timetable">(
    initialView === "timetable" || initialView === "grade" ? initialView : "teacher"
  )
  const [timetableTemplate, setTimetableTemplate] = useState<TimetableTemplate | null>(null)
  const [gradesData, setGradesData] = useState<{ id: string; display_name: string; sort_order: number; homeroom_teachers?: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [isPublicView, setIsPublicView] = useState<boolean | null>(null) // null = checking, true = public, false = authenticated
  const [userRole, setUserRole] = useState<"admin" | "readonly" | null>(null) // User's auth role
  const [isCapturingPng, setIsCapturingPng] = useState(false)

  // Regeneration state - teachers selected for regeneration
  const [regenMode, setRegenMode] = useState(false)
  const [selectedForRegen, setSelectedForRegen] = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, message: "" })
  const [regenSeed, setRegenSeed] = useState(0) // Increment to get different results on each regenerate

  // Preview state - holds unsaved regenerated option for review
  const [previewOption, setPreviewOption] = useState<ScheduleOption | null>(null)
  const [showingPreview, setShowingPreview] = useState(true) // Toggle between preview and original
  const [previewTeachers, setPreviewTeachers] = useState<Set<string>>(new Set()) // Teachers that were regenerated
  const [previewType, setPreviewType] = useState<"regen" | "study-hall" | null>(null) // Type of preview
  const [previewStrategy, setPreviewStrategy] = useState<"normal" | "deep" | "suboptimal" | "randomized" | "js">("normal") // Strategy used for this preview
  const [studyHallMode, setStudyHallMode] = useState(false) // Whether we're in study hall reassignment mode
  const [studyHallSeed, setStudyHallSeed] = useState<number | null>(null) // Seed for study hall shuffling
  const [excludedFromStudyHalls, setExcludedFromStudyHalls] = useState<Set<string>>(new Set()) // Teachers excluded from study hall assignment
  const [manualStudyHallMode, setManualStudyHallMode] = useState(false) // Whether manual placement sub-mode is active
  const [selectedStudyHallGroup, setSelectedStudyHallGroup] = useState<string | null>(null) // Which unplaced group is selected for manual placement
  const [lockedExclusions, setLockedExclusions] = useState<Set<string>>(new Set()) // Teachers that can't be un-excluded (ineligible by rule)
  const [forceCreateNew, setForceCreateNew] = useState<boolean | null>(null) // null = auto (create if 1 revision), true = always create new, false = always update

  // Repair mode state - diagnose and fix schedule issues
  type RepairIssue = {
    type: 'orphan_entry' | 'missing_session' | 'grade_mismatch' | 'phantom_grade' | 'unknown_class' | 'grade_gap' | 'elective_slot_conflict'
    severity: 'error' | 'warning' | 'info'
    teacher: string
    day?: string
    block?: number
    gradeDisplay?: string
    subject?: string
    expected?: string
    found?: string
    description: string
    canFix: boolean
    fix?: () => void
  }
  const [repairMode, setRepairMode] = useState(false)
  const [repairAnalysis, setRepairAnalysis] = useState<{
    issues: RepairIssue[]
    classesInSnapshot: number
    classesFoundInSchedule: number
    orphanEntries: number
    phantomGrades: string[]
    summary: string
    // Orphan correlation analysis
    totalMissingSessions: number
    orphanAnalysis: 'extra' | 'possibly_unlinked' | 'none'
    orphanGuidance: string
    // Elective slot conflicts
    electiveSlotConflicts: number
  } | null>(null)
  const [repairPreview, setRepairPreview] = useState<{
    teacherSchedules: Record<string, TeacherSchedule>
    gradeSchedules: Record<string, GradeSchedule>
    fixesApplied: string[]
  } | null>(null)

  // Swap mode state
  const [swapMode, setSwapMode] = useState(false)
  const [selectedCell, setSelectedCell] = useState<CellLocation | null>(null)
  const [validTargets, setValidTargets] = useState<CellLocation[]>([])
  const [highlightedCells, setHighlightedCells] = useState<CellLocation[]>([])
  const [highlightTimeout, setHighlightTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [swapWorkingSchedules, setSwapWorkingSchedules] = useState<{
    teacherSchedules: Record<string, TeacherSchedule>
    gradeSchedules: Record<string, GradeSchedule>
    studyHallAssignments: Array<{ group: string; teacher: string | null; day: string | null; block: number | null }>
  } | null>(null)
  const [swapCount, setSwapCount] = useState(0)
  const undoToastId = useRef<string | null>(null)

  // Freeform mode state
  const [freeformMode, setFreeformMode] = useState(false)
  const [floatingBlocks, setFloatingBlocks] = useState<FloatingBlock[]>([])
  const [pendingPlacements, setPendingPlacements] = useState<PendingPlacement[]>([])
  const [selectedFloatingBlock, setSelectedFloatingBlock] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [validationModal, setValidationModal] = useState<{
    isOpen: boolean
    checks: Array<{ name: string; status: 'pending' | 'checking' | 'passed' | 'failed' | 'skipped'; errorCount?: number; errors?: string[] }>
    onComplete?: () => void
    mode: 'save' | 'review'  // 'save' auto-closes on success, 'review' stays open
    expandedChecks: Set<number>  // Which check indices are expanded
  } | null>(null)
  const [workingSchedules, setWorkingSchedules] = useState<{
    teacherSchedules: Record<string, TeacherSchedule>
    gradeSchedules: Record<string, GradeSchedule>
  } | null>(null)
  const [freeformClasses, setFreeformClasses] = useState<ClassEntry[] | null>(null)
  const [pendingTransfers, setPendingTransfers] = useState<PendingTransfer[]>([])
  const [transferModal, setTransferModal] = useState<{
    block: FloatingBlock
    location: CellLocation
    totalBlocks: number
  } | null>(null)
  const [reviewTransfersModal, setReviewTransfersModal] = useState<{
    isOpen: boolean
    updateDB: boolean
    onConfirm: (updateDB: boolean) => void
  } | null>(null)
  const [returnTransferModal, setReturnTransferModal] = useState<{
    block: FloatingBlock
    totalBlocks: number  // How many blocks of this class are floating/placed on the target teacher
  } | null>(null)

  // Study Hall stripping state - temporarily removes study halls for easier editing
  const [studyHallsStripped, setStudyHallsStripped] = useState(false)
  const [strippedStudyHalls, setStrippedStudyHalls] = useState<Array<{
    teacher: string
    day: string
    block: number
    grade: string  // The grade display (e.g., "7th Grade")
  }>>([])

  // Conflict resolution state - tracks blockers that were moved to accommodate our placements
  const [conflictResolution, setConflictResolution] = useState<{
    movedBlockers: Array<{
      from: { teacher: string; day: string; block: number }
      to: { teacher: string; day: string; block: number }
      grade: string
      subject: string
    }>
    blockersList: Array<{
      blocker: { teacher: string; day: string; block: number; grade: string; subject: string; entry: [string, string] }
      blockedPlacement: PendingPlacement
      reason: string
    }>  // Original blockers for retry
    schedules: {
      teacherSchedules: Record<string, TeacherSchedule>
      gradeSchedules: Record<string, GradeSchedule>
    }
    attemptIndex: number
  } | null>(null)

  // Star dialog state
  const [showStarDialog, setShowStarDialog] = useState(false)
  const [starNote, setStarNote] = useState("")
  const [isEditingNote, setIsEditingNote] = useState(false)

  // Change detection state
  const [classChanges, setClassChanges] = useState<ChangeDetectionResult | null>(null)
  // Track dismissed state per option/revision (so dismissing for Rev 1 doesn't affect Rev 2)
  const [dismissedForOptions, setDismissedForOptions] = useState<Set<string>>(new Set())
  const [showChangesDialog, setShowChangesDialog] = useState(false)
  const [pendingModeEntry, setPendingModeEntry] = useState<'regen' | 'swap' | 'freeform' | 'studyHall' | null>(null)
  const [useCurrentClasses, setUseCurrentClasses] = useState(false) // When true, regen uses current DB classes instead of snapshot
  const [changesExpanded, setChangesExpanded] = useState(false) // Expandable changes list in regen banner
  const [skipStudyHalls, setSkipStudyHalls] = useState(false) // Skip study hall assignment during regen (can reassign after)
  const [showOpenLabels, setShowOpenLabels] = useState(false) // Show custom labels on OPEN blocks

  // Effective freeform classes — applies pending transfers so all validation/logic sees the transferred state
  const effectiveFreeformClasses = useMemo(() => {
    if (!freeformClasses) return null
    if (pendingTransfers.length === 0) return freeformClasses

    const updated = JSON.parse(JSON.stringify(freeformClasses)) as ClassEntry[]

    for (const r of pendingTransfers) {
      if (r.moveType === 'all') {
        // Move all sessions to target teacher — merge if target already has this class
        const entry = updated.find(c =>
          c.teacher === r.fromTeacher && c.subject === r.subject && gradesEqual(c.gradeDisplay || c.grade, r.grade)
        )
        if (entry) {
          const existing = updated.find(c =>
            c.teacher === r.toTeacher && c.subject === r.subject && gradesEqual(c.gradeDisplay || c.grade, r.grade)
          )
          if (existing) {
            // Merge: add sessions to existing target entry, remove source
            existing.daysPerWeek += entry.daysPerWeek
            const idx = updated.indexOf(entry)
            updated.splice(idx, 1)
          } else {
            // No existing target — just reassign teacher
            entry.teacher = r.toTeacher
          }
        }
      } else {
        // Split: decrement source, create/increment target
        const entry = updated.find(c =>
          c.teacher === r.fromTeacher && c.subject === r.subject && gradesEqual(c.gradeDisplay || c.grade, r.grade)
        )
        if (entry) {
          entry.daysPerWeek -= 1
          if (entry.daysPerWeek <= 0) {
            const idx = updated.indexOf(entry)
            updated.splice(idx, 1)
          }
          const existing = updated.find(c =>
            c.teacher === r.toTeacher && c.subject === r.subject && gradesEqual(c.gradeDisplay || c.grade, r.grade)
          )
          if (existing) {
            existing.daysPerWeek += 1
          } else {
            updated.push({
              ...JSON.parse(JSON.stringify(entry)),
              teacher: r.toTeacher,
              daysPerWeek: 1,
            })
          }
        }
      }
    }

    return updated
  }, [freeformClasses, pendingTransfers])

  // Compute expected teaching sessions from snapshot (for Classes metric in ScheduleStats)
  const expectedTeachingSessions = useMemo(() => {
    const snapshot = generation?.stats?.classes_snapshot
    if (!snapshot || snapshot.length === 0) return undefined
    return computeExpectedTeachingSessions(snapshot)
  }, [generation?.stats?.classes_snapshot])

  // Compute which placements have conflicts and detailed info for validation errors
  const placementConflicts = useMemo(() => {
    if (!workingSchedules || pendingPlacements.length === 0 || conflictResolution) return []

    const conflicts: Array<{
      blockId: string
      placement: PendingPlacement
      block: FloatingBlock
      reason: string
      conflictingTeacher: string
      conflictingBlock: number
      conflictingEntry: [string, string]
    }> = []

    // Check each placed block for conflicts
    for (const placement of pendingPlacements) {
      const block = floatingBlocks.find(b => b.id === placement.blockId)
      if (!block) continue

      const { day, block: blockNum } = placement

      // Check grade conflict - is this grade scheduled elsewhere at the same time?
      // Use gradesOverlap() to handle multi-grade classes like "6th-11th Grade"
      // In freeform mode, Study Halls are legitimate blocks that cannot be ignored
      // Exception: Two electives CAN share the same slot (students choose which to attend)
      const classesSnapshot = generation?.stats?.classes_snapshot
      for (const [teacher, sched] of Object.entries(workingSchedules.teacherSchedules)) {
        if (teacher === placement.teacher) continue
        const entry = (sched as TeacherSchedule)[day]?.[blockNum]
        if (entry && gradesOverlap(entry[0], block.grade) && isOccupiedBlock(entry[1])) {
          // Skip conflict if both classes are electives (they can share the slot)
          if (shouldIgnoreGradeConflict(teacher, entry[1], block.sourceTeacher || placement.teacher, block.subject, classesSnapshot)) {
            continue
          }
          conflicts.push({
            blockId: block.id,
            placement,
            block,
            reason: `Placed ${block.grade} ${block.subject} → ${placement.teacher} ${day} B${blockNum} conflicts with ${entry[1]} (${teacher} ${day} B${blockNum}) — same grade, same time`,
            conflictingTeacher: teacher,
            conflictingBlock: blockNum,
            conflictingEntry: entry
          })
          break
        }
      }

      // Check subject conflict - same subject on same day for same grade
      // Use gradesOverlap() to handle multi-grade classes
      for (const [teacher, sched] of Object.entries(workingSchedules.teacherSchedules)) {
        for (let b = 1; b <= 5; b++) {
          if (teacher === placement.teacher && b === blockNum) continue
          const entry = (sched as TeacherSchedule)[day]?.[b]
          if (entry && gradesOverlap(entry[0], block.grade) && entry[1] === block.subject) {
            // Only add if not already added for grade conflict
            if (!conflicts.some(c => c.blockId === block.id)) {
              conflicts.push({
                blockId: block.id,
                placement,
                block,
                reason: `Placed ${block.grade} ${block.subject} → ${placement.teacher} ${day} B${blockNum} conflicts with ${block.subject} (${teacher} ${day} B${b}) — same subject, same day`,
                conflictingTeacher: teacher,
                conflictingBlock: b,
                conflictingEntry: entry
              })
            }
            break
          }
        }
      }
    }

    return conflicts
  }, [workingSchedules, pendingPlacements, floatingBlocks, conflictResolution])

  // Extract just the IDs for highlighting
  const conflictingBlockIds = useMemo(() =>
    placementConflicts.map(c => c.blockId),
    [placementConflicts]
  )

  // Compute validation issues for the saved schedule (shown in ScheduleStats)
  // Only computes when not in edit modes and when we have a saved schedule
  const savedScheduleValidationIssues = useMemo(() => {
    if (!generation?.options || !generation.stats) return []

    const savedOpt = generation.options[parseInt(viewingOption) - 1]
    if (!savedOpt) return []

    // Run validation on the saved schedule
    const errors = validateFullSchedule(savedOpt, generation.stats)

    // Extract only hard errors (grade conflicts, subject conflicts) for display
    // Skip soft warnings like back-to-back issues
    return errors
      .filter(e => e.type === 'grade_conflict' || e.type === 'subject_conflict')
      .map(e => ({
        type: e.type as 'grade_conflict' | 'subject_conflict' | 'other',
        message: e.message
      }))
  }, [generation?.options, generation?.stats, viewingOption])

  // Compute health status for each revision tab
  // Returns 'green' (perfect), 'yellow' (incomplete), or 'red' (conflicts)
  const optionHealthStatuses = useMemo(() => {
    if (!generation?.options || !generation.stats) return []

    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    return generation.options.map((opt) => {
      // 1. Check for conflicts (red)
      const errors = validateFullSchedule(opt, generation.stats)
      const hasConflicts = errors.some(
        e => e.type === 'grade_conflict' || e.type === 'subject_conflict'
      )
      if (hasConflicts) {
        return 'red'
      }

      // 2. Check study halls
      const shPlaced = opt?.studyHallsPlaced ?? 0
      const shTotal = opt?.studyHallAssignments?.length || 6
      const allStudyHallsPlaced = shPlaced >= shTotal

      // 3. Count scheduled blocks vs expected (grade capacity)
      // Uses same logic as ScheduleStats - iterate through teacher schedules with proper grade parsing
      const BLOCKS_PER_WEEK = 25
      const optGradeNames = Object.keys(opt.gradeSchedules || {})
      const totalGrades = optGradeNames.length
      const expectedBlocks = totalGrades * BLOCKS_PER_WEEK

      // Build a set of filled slots per grade from teacher schedules (same as ScheduleStats)
      const filledSlots: Record<string, Set<string>> = {}
      for (const grade of optGradeNames) {
        filledSlots[grade] = new Set()
      }

      // Iterate through all teacher schedules (same logic as ScheduleStats)
      for (const teacher of Object.keys(opt.teacherSchedules)) {
        const schedule = opt.teacherSchedules[teacher]
        for (const day of DAYS) {
          for (let block = 1; block <= 5; block++) {
            const entry = schedule?.[day]?.[block]
            if (entry && entry[1] && isOccupiedBlock(entry[1])) {
              const gradeDisplay = entry[0]
              // Parse which grades this entry applies to (handles multi-grade like "6th-7th Grade")
              const targetGrades = parseGradeDisplayToNames(gradeDisplay, optGradeNames)
              // Mark slot as filled for each target grade
              for (const grade of targetGrades) {
                if (filledSlots[grade]) {
                  const slotKey = `${day}|${block}`
                  filledSlots[grade].add(slotKey)
                }
              }
            }
          }
        }
      }

      // Count total filled slots and grades that are full
      let scheduledBlocks = 0
      let gradesFullCount = 0
      for (const grade of optGradeNames) {
        const filledCount = filledSlots[grade].size
        scheduledBlocks += filledCount
        if (filledCount >= BLOCKS_PER_WEEK) {
          gradesFullCount++
        }
      }

      // Yellow if any incompleteness
      const allGradesFull = gradesFullCount >= totalGrades
      const isComplete = allStudyHallsPlaced && allGradesFull

      return isComplete ? 'green' : 'yellow'
    })
  }, [generation?.options, generation?.stats])

  // Set validation errors when conflicts are detected
  useEffect(() => {
    if (placementConflicts.length > 0 && !conflictResolution) {
      setValidationErrors(placementConflicts.map(c => ({
        type: 'grade_conflict' as const,
        message: c.reason,
        cells: [{ teacher: c.placement.teacher, day: c.placement.day, block: c.placement.block }],
        blockId: c.blockId
      })))
    } else if (placementConflicts.length === 0 && !conflictResolution) {
      // Only clear errors that came from placement conflicts (have a blockId)
      // Preserve initial validation errors (no blockId) set when entering freeform mode
      setValidationErrors(prev => prev.filter(e => e.type !== 'grade_conflict' || !e.blockId))
    }
  }, [placementConflicts, conflictResolution])

  useEffect(() => {
    loadGeneration()
  }, [id])

  // Load timetable template + grades data for timetable view
  useEffect(() => {
    async function loadTimetableData() {
      try {
        const [templatesRes, gradesRes] = await Promise.all([
          fetch('/api/timetable-templates'),
          fetch('/api/grades'),
        ])
        const templates = await templatesRes.json()
        const gradesRawData = await gradesRes.json()
        if (templates.length > 0) setTimetableTemplate(templates[0])
        setGradesData(gradesRawData.map((g: { id: string; display_name: string; sort_order: number; homeroom_teachers?: string }) => ({
          id: g.id,
          display_name: g.display_name,
          sort_order: g.sort_order,
          homeroom_teachers: g.homeroom_teachers,
        })))
      } catch {
        // Non-critical: timetable view just won't be available
      }
    }
    loadTimetableData()
  }, [])

  // Remove 'new' query param after initial view so shared URLs don't include it
  // Wait for generation to load so the UI has applied defaultExpanded first
  useEffect(() => {
    if (isNewGeneration && generation) {
      const timer = setTimeout(() => {
        router.replace(`/history/${id}`, { scroll: false })
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isNewGeneration, generation, id, router])

  // Check if user is admin (only admins see full view, everyone else sees public view)
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth')
        const data = await res.json()
        // Only admin users see full view, readonly and unauthenticated see public view
        setIsPublicView(data.role !== 'admin')
        setUserRole(data.role || null)
      } catch {
        // On error, assume public view for safety
        setIsPublicView(true)
        setUserRole(null)
      }
    }
    checkAuth()
  }, [])

  // Prevent accidental navigation away during generation
  useEffect(() => {
    setGlobalGenerating(isGenerating)
    if (isGenerating) {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault()
        e.returnValue = ''
      }
      window.addEventListener('beforeunload', handleBeforeUnload)
      return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [isGenerating, setGlobalGenerating])

  // Clear selections when switching options
  useEffect(() => {
    setRegenMode(false)
    setSelectedForRegen(new Set())
    setSwapMode(false)
    setSelectedCell(null)
    setValidTargets([])
    setPreviewOption(null)
    setShowingPreview(true)
    setPreviewTeachers(new Set())
    setPreviewType(null)
    // Clear study hall mode state
    setStudyHallMode(false)
    setStudyHallSeed(null)
    // Clear freeform mode state
    setFreeformMode(false)
    setFloatingBlocks([])
    setPendingPlacements([])
    setSelectedFloatingBlock(null)
    setValidationErrors([])
    setWorkingSchedules(null)
    setPendingTransfers([])
  }, [viewingOption])

  async function loadGeneration() {
    try {
      const res = await fetch(`/api/history/${id}`)
      if (res.ok) {
        const data = await res.json()

        // Auto-assign stable letter labels to options that lack them
        if (data.options?.length > 0) {
          let needsSave = false
          const existingLabels = new Set(data.options.map((o: ScheduleOption) => o.label).filter(Boolean))
          let nextCharCode = 65 // 'A'
          for (const opt of data.options) {
            if (!opt.label) {
              while (existingLabels.has(String.fromCharCode(nextCharCode))) {
                nextCharCode++
              }
              opt.label = String.fromCharCode(nextCharCode)
              existingLabels.add(opt.label)
              nextCharCode++
              needsSave = true
            }
            // Backfill updatedAt for legacy options
            if (!opt.updatedAt) {
              opt.updatedAt = data.generated_at
              needsSave = true
            }
          }
          if (needsSave) {
            // Persist labels so they're stable on next load
            fetch(`/api/history/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ options: data.options }),
            }).catch(() => {}) // Fire and forget
          }
        }

        setGeneration(data)

        // Check URL hash for version label (e.g., #b for Version B)
        // Also supports legacy numeric hashes (e.g., #2)
        const hash = window.location.hash.replace('#', '').toLowerCase()

        if (hash) {
          // Try matching by label (e.g., "b" → Version B)
          const labelIndex = data.options?.findIndex((o: ScheduleOption) => o.label?.toLowerCase() === hash)
          if (labelIndex !== undefined && labelIndex >= 0) {
            setViewingOption((labelIndex + 1).toString())
          } else {
            // Fallback: try legacy numeric hash
            const hashNum = parseInt(hash)
            if (!isNaN(hashNum) && hashNum >= 1 && hashNum <= (data.options?.length || 1)) {
              setViewingOption(hashNum.toString())
            } else if (data.selected_option) {
              setViewingOption(data.selected_option.toString())
            }
          }
        } else if (data.selected_option) {
          // Fall back to published option
          setViewingOption(data.selected_option.toString())
        }
      } else {
        toast.error("Schedule not found")
      }
    } catch (error) {
      toast.error("Failed to load schedule")
    } finally {
      setLoading(false)
    }
  }

  // Update document title for better PDF naming
  useEffect(() => {
    if (generation) {
      const shortId = generation.id.slice(0, 8)
      const optIndex = parseInt(viewingOption) - 1
      const isPrimary = generation.selected_option === parseInt(viewingOption) || (!generation.selected_option && viewingOption === "1")
      const optLabel = generation.options?.[optIndex]?.label || viewingOption
      const titleSuffix = isPrimary ? 'Published' : `Version ${optLabel}`
      document.title = `${generation.quarter?.name || 'Schedule'} ${titleSuffix} - ${shortId}`
    }
  }, [generation, viewingOption])

  // Update URL hash when viewing option changes (e.g., #a, #b)
  // Skip for public view since only published version is shown
  useEffect(() => {
    if (generation && viewingOption && isPublicView === false) {
      const optIndex = parseInt(viewingOption) - 1
      const label = generation.options?.[optIndex]?.label?.toLowerCase() || viewingOption
      const newUrl = `${window.location.pathname}#${label}`
      window.history.replaceState(null, '', newUrl)
    }
  }, [generation, viewingOption, isPublicView])

  // Detect class changes when generation loads (admin only)
  useEffect(() => {
    async function checkForChanges() {
      if (!generation || !hasValidSnapshots(generation.stats) || isPublicView) {
        setClassChanges(null)
        return
      }

      try {
        // Fetch current classes for this quarter
        const res = await fetch(`/api/classes?quarter_id=${generation.quarter_id}`)
        if (!res.ok) {
          console.error('Failed to fetch current classes for change detection')
          return
        }

        const currentClasses: CurrentClass[] = await res.json()
        const result = detectClassChanges(generation.stats!.classes_snapshot!, currentClasses)
        setClassChanges(result)
        setDismissedForOptions(new Set()) // Reset dismissed state when generation changes
      } catch (error) {
        console.error('Error detecting class changes:', error)
      }
    }

    checkForChanges()
  }, [generation?.id, generation?.quarter_id, generation?.stats?.snapshotVersion, isPublicView])

  async function handleDownloadPng() {
    setIsCapturingPng(true)
    try {
      const { downloadSchedulesAsPng } = await import("@/lib/png-export")
      await downloadSchedulesAsPng({ viewMode })
    } catch (err) {
      console.error("PNG capture failed:", err)
      toast.error("Failed to capture schedules as PNG")
    } finally {
      setIsCapturingPng(false)
    }
  }

  function openStarDialog(editMode: boolean = false) {
    setStarNote(generation?.notes || "")
    setIsEditingNote(editMode)
    setShowStarDialog(true)
  }

  async function handleStar() {
    if (!generation) return
    setSaving(true)
    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_starred: true,
          notes: starNote.trim() || null
        }),
      })
      if (res.ok) {
        setGeneration({ ...generation, is_starred: true, notes: starNote.trim() || null })
        setShowStarDialog(false)
        toast("Schedule starred", { icon: successIcon })
      } else {
        toast.error("Failed to star schedule")
      }
    } catch (error) {
      toast.error("Failed to star schedule")
    } finally {
      setSaving(false)
    }
  }

  async function handleUnstar() {
    if (!generation) return
    setSaving(true)
    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_starred: false }),
      })
      if (res.ok) {
        setGeneration({ ...generation, is_starred: false })
        toast("Schedule unstarred", { icon: successIcon })
      } else {
        toast.error("Failed to unstar schedule")
      }
    } catch (error) {
      toast.error("Failed to unstar schedule")
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateNote() {
    if (!generation) return
    setSaving(true)
    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: starNote.trim() || null }),
      })
      if (res.ok) {
        setGeneration({ ...generation, notes: starNote.trim() || null })
        setShowStarDialog(false)
        toast("Note updated", { icon: successIcon })
      } else {
        toast.error("Failed to update note")
      }
    } catch (error) {
      toast.error("Failed to update note")
    } finally {
      setSaving(false)
    }
  }

  function enterRegenMode(skipChangesCheck = false) {
    if (!selectedResult || !generation) return
    // If changes detected and not dismissed, show dialog first
    if (!skipChangesCheck && optionNeedsChanges && !dismissedForOptions.has(viewingOption)) {
      setPendingModeEntry('regen')
      setShowChangesDialog(true)
      return
    }
    setRegenMode(true)
    setSelectedForRegen(new Set())
    setRegenSeed(0) // Reset seed for fresh regeneration session

    // Run validation to show existing conflicts
    const existingErrors = validateFullSchedule(selectedResult, generation.stats)
    const conflicts = existingErrors.filter(
      e => e.type === 'grade_conflict' || e.type === 'subject_conflict'
    )
    setValidationErrors(conflicts)
  }

  function exitRegenMode() {
    setRegenMode(false)
    setSelectedForRegen(new Set())
    setPreviewOption(null)
    setPreviewType(null)
    setUseCurrentClasses(false)
    setValidationErrors([])
    setForceCreateNew(null)
  }

  function toggleTeacherSelection(teacher: string) {
    setSelectedForRegen(prev => {
      const next = new Set(prev)
      if (next.has(teacher)) {
        next.delete(teacher)
      } else {
        next.add(teacher)
      }
      return next
    })
  }

  function clearSelections() {
    setSelectedForRegen(new Set())
  }

  // Extract affected teachers from validation errors (for "select affected" feature)
  function getAffectedTeachersFromErrors(errors: ValidationError[]): Set<string> {
    const teachers = new Set<string>()
    for (const error of errors) {
      if (error.cells && error.cells.length > 0) {
        for (const cell of error.cells) {
          if (cell.teacher) {
            teachers.add(cell.teacher)
          }
        }
      }
    }
    return teachers
  }

  function selectAffectedTeachers() {
    const affected = getAffectedTeachersFromErrors(validationErrors)
    setSelectedForRegen(affected)
  }

  async function handleRegenerate() {
    if (!generation || !generation.options || generation.options.length === 0) return

    if (selectedForRegen.size === 0) {
      toast.error("Select at least one teacher to regenerate")
      return
    }

    // Use snapshot data (not live DB) unless useCurrentClasses is set
    if (!useCurrentClasses && !hasValidSnapshots(generation.stats)) {
      toast.error("This schedule is missing snapshot data and cannot be regenerated")
      return
    }

    setIsGenerating(true)

    try {
      let teachers: Teacher[]
      let classes: ClassEntry[]
      let grades: string[] = [] // All grade names from database - initialize to empty
      // Rules ALWAYS come from snapshot - they are locked to what was used when schedule was generated
      const rules = parseRulesFromSnapshot(generation.stats!.rules_snapshot || [])
      // Stats for validation - use updated snapshots when using current classes
      let statsForRegenValidation = generation.stats

      if (useCurrentClasses) {
        // Fetch current teachers, classes, and grades from database (but NOT rules - those stay from snapshot)
        const [teachersRes, classesRes, gradesRes] = await Promise.all([
          fetch('/api/teachers'),
          fetch(`/api/classes?quarter_id=${generation.quarter_id}`),
          fetch('/api/grades'),
        ])

        const teachersRaw = await teachersRes.json()
        const classesRaw = await classesRes.json()
        const gradesRaw = await gradesRes.json()

        teachers = teachersRaw.map((t: { id: string; name: string; status: string; can_supervise_study_hall: boolean }) => ({
          id: t.id,
          name: t.name,
          status: t.status as 'full-time' | 'part-time',
          canSuperviseStudyHall: t.can_supervise_study_hall,
        }))

        // Get grade display names from database
        grades = gradesRaw.map((g: { display_name: string }) => g.display_name)

        classes = classesRaw.map((c: CurrentClass) => {
          const restrictions = c.restrictions || []
          const fixedSlots: [string, number][] = []
          let availableDays = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']
          let availableBlocks = [1, 2, 3, 4, 5]

          restrictions.forEach((r) => {
            if (r.restriction_type === 'fixed_slot') {
              const v = r.value as { day: string; block: number }
              fixedSlots.push([v.day, v.block])
            } else if (r.restriction_type === 'available_days') {
              availableDays = r.value as string[]
            } else if (r.restriction_type === 'available_blocks') {
              availableBlocks = r.value as number[]
            }
          })

          const gradeNames = c.grades?.map(g => g.display_name) || (c.grade ? [c.grade.display_name] : [])

          return {
            teacher: c.teacher?.name || '',
            grade: gradeNames[0] || '',
            grades: gradeNames,
            subject: c.subject?.name || '',
            daysPerWeek: c.days_per_week,
            isElective: c.is_elective || false,
            isCotaught: c.is_cotaught || false,
            availableDays,
            availableBlocks,
            fixedSlots: fixedSlots.length > 0 ? fixedSlots : undefined,
          }
        })

        // Build updated stats for validation with current class configuration
        const gradesMap = new Map(gradesRaw.map((g: { id: string; name: string; display_name: string }) => [g.id, g]))
        const classesSnapshot = classesRaw.map((c: CurrentClass & { grade_ids?: string[] }) => {
          const gradeIds = c.grade_ids?.length ? c.grade_ids : (c.grade?.id ? [c.grade.id] : [])
          const gradesArray = gradeIds.map((gid: string) => {
            const g = gradesMap.get(gid) as { id: string; name: string; display_name: string } | undefined
            return g ? { id: g.id, name: g.name, display_name: g.display_name } : null
          }).filter(Boolean)
          return {
            teacher_id: c.teacher?.id || null,
            teacher_name: c.teacher?.name || null,
            grade_id: c.grade?.id || null,
            grade_ids: gradeIds,
            grades: gradesArray,
            is_elective: c.is_elective || false,
            is_cotaught: c.is_cotaught || false,
            subject_id: c.subject?.id || null,
            subject_name: c.subject?.name || null,
            days_per_week: c.days_per_week,
            restrictions: (c.restrictions || []).map((r) => ({
              restriction_type: r.restriction_type,
              value: r.value,
            })),
          }
        })
        const teachersSnapshot = teachersRaw.map((t: { id: string; name: string; status: string; can_supervise_study_hall: boolean }) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          canSuperviseStudyHall: t.can_supervise_study_hall,
        }))
        const gradesSnapshot = gradesRaw.map((g: { id: string; name: string; display_name: string }) => ({
          id: g.id,
          name: g.name,
          display_name: g.display_name,
        }))
        statsForRegenValidation = {
          ...generation.stats,
          classes_snapshot: classesSnapshot,
          teachers_snapshot: teachersSnapshot,
          grades_snapshot: gradesSnapshot,
        }
      } else {
        // Parse data from snapshots
        teachers = parseTeachersFromSnapshot(generation.stats!.teachers_snapshot!)
        classes = parseClassesFromSnapshot(generation.stats!.classes_snapshot!)
        // Parse grades from snapshot (grades_snapshot contains display_name)
        grades = (generation.stats!.grades_snapshot || []).map((g: { display_name: string }) => g.display_name)
      }

      // Get the ACTUAL original schedule from generation.options (NOT selectedResult which could be a preview)
      const actualOriginalSchedule = generation.options[parseInt(viewingOption) - 1]
      if (!actualOriginalSchedule) {
        toast.error("Could not find original schedule")
        return
      }

      // Build locked teacher schedules (all teachers EXCEPT those selected for regen)
      // IMPORTANT: Deep copy to prevent mutation of the original schedule
      // IMPORTANT: Use actualOriginalSchedule, NOT selectedResult (which could be a previous preview)
      const lockedSchedules: Record<string, TeacherSchedule> = {}
      for (const teacher of Object.keys(actualOriginalSchedule.teacherSchedules)) {
        if (!selectedForRegen.has(teacher)) {
          lockedSchedules[teacher] = JSON.parse(JSON.stringify(actualOriginalSchedule.teacherSchedules[teacher]))
        }
      }

      // Find which regenerated teachers had study halls in the original schedule
      // These teachers must be assigned study halls again
      const teachersNeedingStudyHalls = (actualOriginalSchedule.studyHallAssignments || [])
        .filter(sh => sh.teacher && selectedForRegen.has(sh.teacher))
        .map(sh => sh.teacher as string)

      // Generate new schedule with locked teachers
      // Try OR-Tools solver first, fall back to JS solver if it fails
      // Increment seed to get different results on subsequent regenerations
      const currentSeed = regenSeed + 1
      setRegenSeed(currentSeed)

      setGenerationProgress({ current: 0, total: 100, message: "Starting OR-Tools solver..." })

      // Helper to compare schedules for selected teachers
      const schedulesMatch = (
        scheduleA: Record<string, TeacherSchedule>,
        scheduleB: Record<string, TeacherSchedule>
      ): boolean => {
        for (const teacher of selectedForRegen) {
          const a = scheduleA[teacher]
          const b = scheduleB[teacher]
          if (!a || !b) continue

          for (const day of ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']) {
            for (const block of [1, 2, 3, 4, 5]) {
              if (JSON.stringify(a[day]?.[block]) !== JSON.stringify(b[day]?.[block])) {
                return false
              }
            }
          }
        }
        return true
      }

      // Helper to check if result matches preview or original
      const checkForMatches = (schedules: Record<string, TeacherSchedule>) => {
        const matchesOriginal = schedulesMatch(schedules, actualOriginalSchedule.teacherSchedules)
        const matchesPreview = previewOption && schedulesMatch(schedules, previewOption.teacherSchedules)
        return { matchesOriginal, matchesPreview }
      }

      // Strategy rotation based on attempt number:
      // 1st press: OR-Tools normal (50 seeds) → JS fallback
      // 2nd press: OR-Tools deep (15 seeds, more time each) → JS fallback
      // 3rd press: Suboptimal → randomized fallback → JS fallback
      // 4th press: Randomized → JS fallback
      // 5th+ press: JS solver
      const seedOffset = currentSeed % 2 === 1 ? 1 : 0
      let remoteResult: Awaited<ReturnType<typeof generateSchedulesRemote>> | null = null
      let result: { status: string; options: ScheduleOption[]; message?: string } | null = null
      let usedJsFallback = false
      let usedStrategy: "normal" | "deep" | "suboptimal" | "randomized" | "js" = "normal"

      // Determine starting strategy based on attempt number
      const useNormalOrTools = currentSeed === 1
      const useDeepOrTools = currentSeed === 2
      const useSuboptimal = currentSeed === 3
      const useRandomized = currentSeed === 4
      const useJs = currentSeed >= 5

      // Step 1: OR-Tools normal (1st press) - more seeds, less time each
      // Use startSeed=0 for first press to get the same quality as initial generation
      if (useNormalOrTools) {
        setGenerationProgress({ current: 0, total: 100, message: "Starting OR-Tools solver..." })
        remoteResult = await generateSchedulesRemote(teachers, classes, {
          numOptions: 1,
          numAttempts: 50, // More seeds, less time each
          maxTimeSeconds: 120,
          lockedTeachers: lockedSchedules,
          teachersNeedingStudyHalls,
          rules,
          startSeed: 0, // Use 0 for optimal results on first press
          skipStudyHalls,
          grades,
          onProgress: (current, total, message) => {
            setGenerationProgress({ current, total, message: `[OR-Tools] ${message}` })
          }
        })
        result = remoteResult
        usedStrategy = "normal"
      }

      // Step 2: OR-Tools deep (2nd press) - fewer seeds, more time each for deeper exploration
      if (useDeepOrTools) {
                setGenerationProgress({ current: 0, total: 100, message: "Trying OR-Tools with deeper exploration..." })

        remoteResult = await generateSchedulesRemote(teachers, classes, {
          numOptions: 1,
          numAttempts: 15, // Fewer seeds = more time per seed
          maxTimeSeconds: 120,
          lockedTeachers: lockedSchedules,
          teachersNeedingStudyHalls,
          rules,
          startSeed: currentSeed * 100 + seedOffset,
          skipStudyHalls,
          grades,
          onProgress: (current, total, message) => {
            setGenerationProgress({ current, total, message: `[OR-Tools Deep] ${message}` })
          }
        })
        result = remoteResult
        usedStrategy = "deep"
      }

      // Step 3: OR-Tools with suboptimal solutions (3rd press) → randomized fallback
      if (useSuboptimal) {
                setGenerationProgress({ current: 0, total: 100, message: "Trying OR-Tools with suboptimal solutions..." })

        remoteResult = await generateSchedulesRemote(teachers, classes, {
          numOptions: 1,
          numAttempts: 15,
          maxTimeSeconds: 120,
          lockedTeachers: lockedSchedules,
          teachersNeedingStudyHalls,
          rules,
          startSeed: currentSeed * 100 + seedOffset,
          skipTopSolutions: 3,
          skipStudyHalls,
          grades,
          onProgress: (current, total, message) => {
            setGenerationProgress({ current, total, message: `[OR-Tools Suboptimal] ${message}` })
          }
        })
        result = remoteResult
        usedStrategy = "suboptimal"

        // Fallback to randomized if still matches preview
        if (remoteResult.status === 'success' && remoteResult.options.length > 0) {
          const { matchesPreview } = checkForMatches(remoteResult.options[0].teacherSchedules)
          if (matchesPreview) {
                        setGenerationProgress({ current: 0, total: 100, message: "Trying OR-Tools with randomized scoring..." })

            remoteResult = await generateSchedulesRemote(teachers, classes, {
              numOptions: 1,
              numAttempts: 15,
              maxTimeSeconds: 45,
              lockedTeachers: lockedSchedules,
              teachersNeedingStudyHalls,
              rules,
              startSeed: currentSeed * 100 + seedOffset + 50,
              randomizeScoring: true,
              skipStudyHalls,
              grades,
              onProgress: (current, total, message) => {
                setGenerationProgress({ current, total, message: `[OR-Tools Randomized] ${message}` })
              }
            })
            result = remoteResult
            usedStrategy = "randomized"
          }
        }
      }

      // Step 4: OR-Tools with randomized scoring (4th press)
      if (useRandomized) {
                setGenerationProgress({ current: 0, total: 100, message: "Trying OR-Tools with randomized scoring..." })

        remoteResult = await generateSchedulesRemote(teachers, classes, {
          numOptions: 1,
          numAttempts: 15,
          maxTimeSeconds: 120,
          lockedTeachers: lockedSchedules,
          teachersNeedingStudyHalls,
          rules,
          startSeed: currentSeed * 100 + seedOffset + 50,
          randomizeScoring: true,
          skipStudyHalls,
          grades,
          onProgress: (current, total, message) => {
            setGenerationProgress({ current, total, message: `[OR-Tools Randomized] ${message}` })
          }
        })
        result = remoteResult
        usedStrategy = "randomized"
      }

      // Step 5: Check if we should fall back to JS solver
      let shouldFallbackToJs = useJs || !remoteResult || remoteResult.status !== 'success' || remoteResult.options.length === 0

      if (!shouldFallbackToJs && remoteResult && remoteResult.options.length > 0) {
        const { matchesOriginal, matchesPreview } = checkForMatches(remoteResult.options[0].teacherSchedules)

        if (matchesOriginal) {
          shouldFallbackToJs = true
        } else if (matchesPreview) {
          shouldFallbackToJs = true
        }
      }

      // Final: JS solver (start here on 5th+ press, or fallback)
      if (shouldFallbackToJs) {
        setGenerationProgress({ current: 0, total: 100, message: useJs ? "Using JS solver..." : "Trying JS solver for variety..." })

        const jsResult = await generateSchedules(teachers, classes, {
          numOptions: 1,
          numAttempts: 100,
          lockedTeachers: lockedSchedules,
          teachersNeedingStudyHalls,
          seed: currentSeed * 12345,
          rules,
          skipStudyHalls,
          grades,
          onProgress: (current, total, message) => {
            setGenerationProgress({ current, total, message: `[JS] ${message}` })
          }
        })
        result = jsResult
        usedJsFallback = true
        usedStrategy = "js"
      }

      if (!result || result.status !== 'success' || result.options.length === 0) {
        toast.error(result?.message || "Could not generate a valid schedule with these constraints", { icon: errorIcon })
        setIsGenerating(false)
        return
      }

      // Set as preview (not saved yet)
      const newOption = {
        ...result.options[0],
        optionNumber: generation.options.length + 1,
      }

      // Validate the full schedule to catch any logic errors
      // Use statsForRegenValidation which has updated class config when using current classes

      const electiveClasses = statsForRegenValidation?.classes_snapshot?.filter(c => c.is_elective) || []

      const selectedTeacherSnapshotClasses = statsForRegenValidation?.classes_snapshot?.filter(
        c => selectedForRegen.has(c.teacher_name || '')
      ) || []
      const scheduleErrors = validateFullSchedule(newOption, statsForRegenValidation)

      // CRITICAL: Validate that locked teachers were preserved correctly
      const lockedTeacherErrors: ValidationError[] = []
      for (const [teacher, originalSchedule] of Object.entries(lockedSchedules)) {
        const newSchedule = newOption.teacherSchedules[teacher]
        if (!newSchedule) {
          lockedTeacherErrors.push({
            type: 'locked_teacher_missing',
            message: `[Locked Teacher Missing] ${teacher} is missing from the result`,
            cells: [{ teacher, day: '', block: 0 }]
          })
          continue
        }

        // Compare each slot
        for (const day of ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']) {
          for (let block = 1; block <= 5; block++) {
            const originalEntry = originalSchedule[day]?.[block]
            const newEntry = newSchedule[day]?.[block]

            // Compare entries (both could be null/undefined or [grade, subject])
            const originalStr = JSON.stringify(originalEntry)
            const newStr = JSON.stringify(newEntry)

            if (originalStr !== newStr) {
              console.error(`[Locked Teacher Modified] ${teacher} ${day} B${block}: was ${originalStr}, now ${newStr}`)
              lockedTeacherErrors.push({
                type: 'locked_teacher_modified',
                message: `[Locked Teacher Modified] ${teacher} ${day} B${block}: was ${originalEntry?.[1] || 'empty'}, now ${newEntry?.[1] || 'empty'}`,
                cells: [{ teacher, day, block, grade: originalEntry?.[0] || '', subject: originalEntry?.[1] || '' }]
              })
            }
          }
        }
      }

      if (lockedTeacherErrors.length > 0) {
        console.error(`[Regen] CRITICAL: ${lockedTeacherErrors.length} locked teacher modifications detected!`, lockedTeacherErrors)
      }

      // Filter errors to only show those involving regenerated teachers
      // (locked teachers' errors already existed and aren't relevant to this preview)
      const relevantScheduleErrors = scheduleErrors.filter(error => {
        // Check if any cell involves a regenerated teacher
        if (error.cells && error.cells.length > 0) {
          return error.cells.some(cell => selectedForRegen.has(cell.teacher))
        }
        // For session_count errors, parse teacher from message format: "[Session Count] Teacher/Grade/Subject: ..."
        if (error.type === 'session_count') {
          const match = error.message.match(/\[Session Count\] ([^/]+)\//)
          if (match) {
            return selectedForRegen.has(match[1])
          }
        }
        // For study_hall_coverage, include it (it's a global concern)
        if (error.type === 'study_hall_coverage') {
          return true
        }
        // For back_to_back, parse teacher from message
        if (error.type === 'back_to_back') {
          const match = error.message.match(/\[Back-to-Back\] ([^:]+):/)
          if (match) {
            return selectedForRegen.has(match[1])
          }
        }
        return false
      })

      const allErrors = [...relevantScheduleErrors, ...lockedTeacherErrors]

      // Log session count errors specifically for debugging
      const sessionErrors = relevantScheduleErrors.filter(e => e.type === 'session_count')
      if (sessionErrors.length > 0) {
      }

      if (allErrors.length > 0) {
        setValidationErrors(allErrors)
        const { hard, soft } = splitValidationErrors(allErrors)

        if (hard.length > 0) {
          toast.error(`${hard.length} validation issue${hard.length !== 1 ? 's' : ''} detected - review before applying`, { icon: errorIcon })
        } else if (soft.length > 0) {
          toast(`${soft.length} warning${soft.length !== 1 ? 's' : ''}`, { icon: warningIcon })
        }
      } else {
        setValidationErrors([])
      }

      // Save which teachers were regenerated
      setPreviewTeachers(new Set(selectedForRegen))
      setPreviewOption(newOption)
      setPreviewType("regen")
      setPreviewStrategy(usedStrategy)
      toast(usedJsFallback ? "Schedules regenerated (JS solver)" : "Schedules regenerated (OR-Tools)", { icon: successIcon })
    } catch (error) {
      console.error('Regeneration error:', error)
      toast.error("Failed to generate variation", { icon: errorIcon })
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleKeepPreview(saveAsNew: boolean = false) {

    if (!generation || !previewOption || !selectedResult) {
      return
    }

    // For regen mode, build a merged option that ONLY takes selected teachers from preview
    // and keeps EVERYTHING ELSE from the original (safeguard against solver bugs)
    let optionToSave: ScheduleOption = previewOption

    try {

    if (previewType === 'regen' && previewTeachers.size > 0) {
      const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

      // Get the ACTUAL original option from the database (not selectedResult which could be preview)
      const actualOriginal = generation.options[parseInt(viewingOption) - 1]
      if (!actualOriginal) {
        return
      }

      // Start with a COMPLETE deep copy of the original option
      const originalOption: ScheduleOption = JSON.parse(JSON.stringify(actualOriginal))

      // CUT only the selected teachers' schedules from the preview
      const selectedTeacherSchedules: Record<string, TeacherSchedule> = {}
      for (const teacher of previewTeachers) {
        if (previewOption.teacherSchedules[teacher]) {
          selectedTeacherSchedules[teacher] = JSON.parse(
            JSON.stringify(previewOption.teacherSchedules[teacher])
          )
        }
      }

      // Merge: original + selected teachers from preview
      const mergedTeacherSchedules: Record<string, TeacherSchedule> = {
        ...originalOption.teacherSchedules,
        ...selectedTeacherSchedules,  // Overwrite only selected teachers
      }

      // DON'T rebuild grade schedules from scratch - that loses multi-grade elective mappings
      // Instead: start with ORIGINAL grade schedules, then surgically update only selected teachers' slots
      const allGrades = Object.keys(originalOption.gradeSchedules)
      const mergedGradeSchedules: Record<string, GradeSchedule> = JSON.parse(
        JSON.stringify(originalOption.gradeSchedules)
      )

      // Step 1: Remove selected teachers from grade schedules (clear their old slots)
      for (const grade of allGrades) {
        for (const day of DAYS) {
          for (let block = 1; block <= 5; block++) {
            const cell = mergedGradeSchedules[grade]?.[day]?.[block]
            const entry = getFirstGradeEntry(cell)
            if (entry && previewTeachers.has(entry[0])) {
              // This slot was taught by a selected teacher - clear it
              mergedGradeSchedules[grade][day][block] = null
            }
          }
        }
      }

      // Step 2: Add selected teachers' NEW slots from preview grade schedules
      const previewGradeSchedules = previewOption.gradeSchedules
      for (const grade of allGrades) {
        for (const day of DAYS) {
          for (let block = 1; block <= 5; block++) {
            const previewCell = previewGradeSchedules[grade]?.[day]?.[block]
            const previewEntry = getFirstGradeEntry(previewCell)
            if (previewEntry && previewTeachers.has(previewEntry[0])) {
              // This slot is taught by a selected teacher in preview - add it
              mergedGradeSchedules[grade][day][block] = previewCell
            }
          }
        }
      }

      // Merge study hall assignments: keep original, update only if teacher was selected
      // Note: reconciliation in recalculateOptionStats will catch any stale entries
      const mergedStudyHalls = originalOption.studyHallAssignments.map(sh => {
        if (sh.teacher && previewTeachers.has(sh.teacher)) {
          // Find the updated study hall for this group from preview
          const previewSh = previewOption.studyHallAssignments.find(
            psh => psh.group === sh.group && previewTeachers.has(psh.teacher || '')
          )
          return previewSh || sh
        }
        return sh
      })

      // Build merged option starting from ORIGINAL, replacing only what changed
      // recalculateOptionStats recomputes teacherStats, backToBackIssues, and studyHallsPlaced
      optionToSave = recalculateOptionStats({
        ...originalOption,
        teacherSchedules: mergedTeacherSchedules,
        gradeSchedules: mergedGradeSchedules,
        studyHallAssignments: mergedStudyHalls,
      })

      const allTeachers = Object.keys(originalOption.teacherSchedules)
      const lockedTeacherNames = allTeachers.filter(t => !previewTeachers.has(t))

      let allIdentical = true
      const changedTeachers: string[] = []

      for (const teacher of lockedTeacherNames) {
        const originalSchedule = JSON.stringify(originalOption.teacherSchedules[teacher])
        const mergedSchedule = JSON.stringify(mergedTeacherSchedules[teacher])
        const isIdentical = originalSchedule === mergedSchedule

        if (!isIdentical) {
          allIdentical = false
          changedTeachers.push(teacher)
        }
      }

      if (allIdentical) {
      } else {
      }

      // Also check grade schedules
      const allGradeNames = Object.keys(originalOption.gradeSchedules)
      let gradesIdentical = true
      const changedGrades: string[] = []

      for (const grade of allGradeNames) {
        const originalGS = JSON.stringify(originalOption.gradeSchedules[grade])
        const mergedGS = JSON.stringify(mergedGradeSchedules[grade])
        if (originalGS !== mergedGS) {
          gradesIdentical = false
          changedGrades.push(grade)
        }
      }

      if (gradesIdentical) {
      } else {
      }
    }

    // If using current classes for regen, build updated stats BEFORE validation
    // so validation checks against the new class configuration
    let statsForValidation = generation.stats
    if (useCurrentClasses && previewType === 'regen') {
      try {
        // Fetch current data to create new snapshots (excluding rules - those stay from original)
        const [classesRes, teachersRes, gradesRes] = await Promise.all([
          fetch(`/api/classes?quarter_id=${generation.quarter_id}`),
          fetch('/api/teachers'),
          fetch('/api/grades'),
        ])

        const classesRaw = await classesRes.json()
        const teachersRaw = await teachersRes.json()
        const gradesRaw = await gradesRes.json()

        // Build new snapshots
        const gradesMap = new Map(gradesRaw.map((g: { id: string; name: string; display_name: string }) => [g.id, g]))

        const classesSnapshot = classesRaw.map((c: CurrentClass & { grade_ids?: string[] }) => {
          const gradeIds = c.grade_ids?.length ? c.grade_ids : (c.grade?.id ? [c.grade.id] : [])
          const gradesArray = gradeIds.map((gid: string) => {
            const g = gradesMap.get(gid) as { id: string; name: string; display_name: string } | undefined
            return g ? { id: g.id, name: g.name, display_name: g.display_name } : null
          }).filter(Boolean)

          return {
            teacher_id: c.teacher?.id || null,
            teacher_name: c.teacher?.name || null,
            grade_id: c.grade?.id || null,
            grade_ids: gradeIds,
            grades: gradesArray,
            is_elective: c.is_elective || false,
            is_cotaught: c.is_cotaught || false,
            subject_id: c.subject?.id || null,
            subject_name: c.subject?.name || null,
            days_per_week: c.days_per_week,
            restrictions: (c.restrictions || []).map((r) => ({
              restriction_type: r.restriction_type,
              value: r.value,
            })),
          }
        })

        const teachersSnapshot = teachersRaw.map((t: { id: string; name: string; status: string; can_supervise_study_hall: boolean }) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          canSuperviseStudyHall: t.can_supervise_study_hall,
        }))

        const gradesSnapshot = gradesRaw.map((g: { id: string; name: string; display_name: string }) => ({
          id: g.id,
          name: g.name,
          display_name: g.display_name,
        }))

        // Update class/teacher/grade snapshots but keep rules_snapshot unchanged
        // Only bump snapshotVersion when snapshot content actually changes (DB differs from snapshot).
        // Pure alignment regens (DB already matches snapshot) keep existing version to avoid
        // cascading re-alignment of already-aligned revisions.
        const snapshotContentChanging = classChanges?.hasChanges || false
        statsForValidation = {
          ...generation.stats,
          classes_snapshot: classesSnapshot,
          teachers_snapshot: teachersSnapshot,
          grades_snapshot: gradesSnapshot,
          snapshotVersion: snapshotContentChanging
            ? Date.now()
            : (generation.stats?.snapshotVersion || Date.now()),
          snapshotAffectedTeachers: snapshotContentChanging
            ? (classChanges?.affectedTeachers || [])
            : (generation.stats?.snapshotAffectedTeachers || []),
          // rules_snapshot intentionally NOT updated - stays from original generation
        }
      } catch (error) {
        console.error('Failed to build updated snapshots for validation:', error)
        // Continue with original stats
      }
    }

    // Always rebuild gradeSchedules from teacherSchedules before saving
    // teacherSchedules is the source of truth - this ensures consistency and fixes any corruption
    const rebuiltGradeSchedules = rebuildGradeSchedules(
      optionToSave.teacherSchedules,
      statsForValidation?.grades_snapshot,
      selectedResult.gradeSchedules // Fallback for grade keys
    )
    optionToSave = {
      ...optionToSave,
      gradeSchedules: rebuiltGradeSchedules,
    }

    // Store previous state for undo
    const previousOptions: ScheduleOption[] = JSON.parse(JSON.stringify(generation.options))
    const previousSelectedOption = viewingOption
    const previousStats = generation.stats

    // Define the save logic
    const doSave = async () => {
      let updatedOptions: ScheduleOption[]
      let successMessage: string

      // Stamp option with the current snapshot version so alignment detection works:
      // - useCurrentClasses: version comes from the freshly rebuilt snapshot (statsForValidation)
      // - alignment regen: version comes from existing generation stats
      // - no version exists: undefined, nothing stamped
      const snapshotVersion = statsForValidation?.snapshotVersion || generation.stats?.snapshotVersion

      if (!saveAsNew) {
        // Update current option in place
        const optionIndex = parseInt(viewingOption) - 1
        const currentLabel = generation.options[optionIndex]?.label
        const isPrimary = (generation.selected_option || 1) === optionIndex + 1
        const displayName = isPrimary ? 'Published' : `Version ${currentLabel}`
        updatedOptions = [...generation.options]
        updatedOptions[optionIndex] = {
          ...optionToSave,
          optionNumber: optionIndex + 1,
          label: currentLabel,
          updatedAt: new Date().toISOString(),
          ...(snapshotVersion && { builtWithSnapshotVersion: snapshotVersion }),
        }
        successMessage = previewType === "study-hall"
          ? `Study halls reassigned for ${displayName}`
          : `${displayName} updated`
      } else {
        // Save as new option
        const newOptionNumber = generation.options.length + 1
        const newLabel = getNextLabel(generation.options)
        updatedOptions = [...generation.options, {
          ...optionToSave,
          optionNumber: newOptionNumber,
          label: newLabel,
          updatedAt: new Date().toISOString(),
          ...(snapshotVersion && { builtWithSnapshotVersion: snapshotVersion }),
        }]
        successMessage = `Saved as Version ${newLabel}`
      }

      // Use the pre-built stats (with updated snapshots if using current classes)
      const updatedStats = statsForValidation

      const newOptionNumber = saveAsNew ? generation.options.length + 1 : null
      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          options: updatedOptions,
          ...(newOptionNumber && { selected_option: newOptionNumber }),
          ...(updatedStats !== generation.stats && { stats: updatedStats }),
        }),
      })

      if (updateRes.ok) {
        setGeneration({
          ...generation,
          options: updatedOptions,
          stats: updatedStats,
          ...(newOptionNumber && { selected_option: newOptionNumber }),
        })
        if (saveAsNew) {
          setViewingOption(newOptionNumber!.toString())
        }
        setPreviewOption(null)
        setPreviewType(null)
        setStudyHallMode(false)
        setStudyHallSeed(null)
        setRegenMode(false)
        setSelectedForRegen(new Set())
        setUseCurrentClasses(false)
        // Remove from dismissed set since changes were actually applied
        if (useCurrentClasses) {
          setDismissedForOptions(prev => {
            const next = new Set(prev)
            next.delete(viewingOption)
            return next
          })
        }

        // Dismiss any existing undo toast
        if (undoToastId.current) toast.dismiss(undoToastId.current)

        // Show success toast with undo option (60 seconds)
        const toastId = toast(
          (t) => (
            <div className="flex items-center gap-3">
              <span className="text-sm">{successMessage}</span>
              <button
                onClick={async () => {
                  toast.dismiss(t.id)
                  undoToastId.current = null
                  try {
                    const undoRes = await fetch(`/api/history/${id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        options: previousOptions,
                        ...(previousStats !== generation.stats && { stats: previousStats }),
                      }),
                    })
                    if (undoRes.ok) {
                      setGeneration((prev) => prev ? {
                        ...prev,
                        options: previousOptions,
                        stats: previousStats,
                      } : prev)
                      if (saveAsNew) {
                        setViewingOption(previousSelectedOption)
                      }
                      toast("Changes undone", { icon: successIcon })
                    } else {
                      toast.error("Failed to undo changes")
                    }
                  } catch (error) {
                    console.error('Undo error:', error)
                    toast.error("Failed to undo changes")
                  }
                }}
                className="px-2 py-1 text-sm font-medium text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded transition-colors"
              >
                Undo
              </button>
            </div>
          ),
          {
            duration: 60000,
            icon: successIcon,
          }
        )
        undoToastId.current = toastId
      } else {
        toast.error("Failed to save changes")
      }
    }

    // Run validation with visual modal on the MERGED option, then save if passed
    // Use statsForValidation which has updated class snapshots when using current classes
    // Skip study hall check if user chose to skip study halls during regen
    runValidationWithModal(optionToSave, statsForValidation, doSave, 'save', {
      skipStudyHallCheck: skipStudyHalls
    })

    } catch (error) {
      console.error('[Save] ERROR in handleKeepPreview:', error)
    }
  }

  function handleDiscardPreview() {
    setPreviewOption(null)
    setPreviewType(null)
    setStudyHallMode(false)
    setStudyHallSeed(null)
    setRegenMode(false)
    setSelectedForRegen(new Set())
    setUseCurrentClasses(false)
    toast("Preview discarded", { icon: <Trash2 className="h-4 w-4 text-gray-500" /> })
  }

  // Handle OPEN block label changes - updates the current option and saves to database
  async function handleOpenLabelChange(teacher: string, openIndex: number, label: string | undefined) {
    if (!generation) return

    const optionIndex = parseInt(viewingOption) - 1
    const currentOption = generation.options[optionIndex]
    if (!currentOption) return

    // Update the labels
    const newLabels = setOpenBlockLabel(currentOption.openBlockLabels, teacher, openIndex, label)

    // Build updated option
    const updatedOption: ScheduleOption = {
      ...currentOption,
      openBlockLabels: newLabels
    }

    // Build updated options array
    const updatedOptions = [...generation.options]
    updatedOptions[optionIndex] = updatedOption

    // Optimistically update UI
    setGeneration({
      ...generation,
      options: updatedOptions
    })

    // Save to database
    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: updatedOptions })
      })

      if (!res.ok) {
        // Revert on error
        setGeneration(generation)
        toast.error("Failed to save label")
      }
    } catch (error) {
      console.error('Failed to save open block label:', error)
      setGeneration(generation)
      toast.error("Failed to save label")
    }
  }

  function enterStudyHallMode(skipChangesCheck = false) {
    if (!selectedResult || !generation) return
    // If changes detected and not dismissed, show dialog first
    if (!skipChangesCheck && optionNeedsChanges && !dismissedForOptions.has(viewingOption)) {
      setPendingModeEntry('studyHall')
      setShowChangesDialog(true)
      return
    }
    setStudyHallMode(true)

    // Initialize excluded teachers based on:
    // 1. Rule: study_hall_teacher_eligibility (which statuses can supervise)
    // 2. Individual: canSuperviseStudyHall = false
    const teachersSnapshot = generation.stats?.teachers_snapshot
    const rulesSnapshot = generation.stats?.rules_snapshot

    if (teachersSnapshot) {
      const excluded = new Set<string>()
      const locked = new Set<string>() // Can't be un-excluded (ineligible by rule)

      // Check eligibility rule - which statuses are allowed
      // Logic must match solver's getStudyHallEligibleStatuses():
      // - Rule disabled or not found → full-time only (default)
      // - Rule enabled → use config (allow_full_time defaults true, allow_part_time defaults false)
      // - If somehow both unchecked → full-time only
      const eligibilityRule = rulesSnapshot?.find(r => r.rule_key === 'study_hall_teacher_eligibility')
      const ruleEnabled = eligibilityRule?.enabled !== false // default true if not found

      let allowFullTime: boolean
      let allowPartTime: boolean

      if (!ruleEnabled) {
        // Rule disabled → default to full-time only
        allowFullTime = true
        allowPartTime = false
      } else {
        // Rule enabled → use config
        const config = eligibilityRule?.config as { allow_full_time?: boolean; allow_part_time?: boolean } | undefined
        allowFullTime = config?.allow_full_time !== false // default true
        allowPartTime = config?.allow_part_time === true // default false

        // If somehow both are unchecked, default to full-time
        if (!allowFullTime && !allowPartTime) {
          allowFullTime = true
        }
      }

      for (const t of teachersSnapshot) {
        // Exclude if individual setting says no (locked - can't change)
        if (t.canSuperviseStudyHall === false) {
          excluded.add(t.name)
          locked.add(t.name)
          continue
        }
        // Exclude if status not allowed (locked - can't change)
        if (t.status === 'full-time' && !allowFullTime) {
          excluded.add(t.name)
          locked.add(t.name)
        } else if (t.status === 'part-time' && !allowPartTime) {
          excluded.add(t.name)
          locked.add(t.name)
        }
      }
      setExcludedFromStudyHalls(excluded)
      setLockedExclusions(locked)
    } else {
      setExcludedFromStudyHalls(new Set())
      setLockedExclusions(new Set())
    }
    // Note: No validation here - Study Hall mode only assigns to OPEN blocks,
    // so it can't fix grade/subject conflicts. Showing them would just be confusing.

    // Auto-activate manual placement if there are unplaced study halls
    // Uses unplacedStudyHalls which cross-references assignments against actual schedule
    if (unplacedStudyHalls.length > 0) {
      setManualStudyHallMode(true)
    }
  }

  function exitStudyHallMode() {
    setStudyHallMode(false)
    setPreviewOption(null)
    setPreviewType(null)
    setStudyHallSeed(null)
    setExcludedFromStudyHalls(new Set())
    setLockedExclusions(new Set())
    setValidationErrors([])
    setForceCreateNew(null)
    setManualStudyHallMode(false)
    setSelectedStudyHallGroup(null)
  }

  function toggleStudyHallExclusion(teacher: string) {
    setExcludedFromStudyHalls(prev => {
      const next = new Set(prev)
      if (next.has(teacher)) {
        next.delete(teacher)
      } else {
        next.add(teacher)
      }
      return next
    })
  }

  /**
   * Clear all study halls from the schedule, converting them to OPEN.
   * Creates a preview (not saved) so the user can then randomize, manually place, or save.
   */
  function clearAllStudyHalls() {
    const currentOption = previewOption || generation?.options?.[parseInt(viewingOption) - 1]
    if (!generation || !currentOption) return

    const DAYS_LIST = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']

    // Deep copy the current option
    const newTeacherSchedules = JSON.parse(JSON.stringify(currentOption.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(currentOption.gradeSchedules))
    let clearedCount = 0

    // Remove all study halls from teacher schedules
    for (const [, schedule] of Object.entries(newTeacherSchedules) as [string, TeacherSchedule][]) {
      for (const day of DAYS_LIST) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (entry && isStudyHall(entry[1])) {
            schedule[day][block] = ['', 'OPEN']
            clearedCount++
          }
        }
      }
    }

    // Remove study halls from grade schedules too
    for (const [, schedule] of Object.entries(newGradeSchedules) as [string, GradeSchedule][]) {
      for (const day of DAYS_LIST) {
        for (let block = 1; block <= 5; block++) {
          const cell = schedule[day]?.[block]
          const entry = getFirstGradeEntry(cell)
          if (entry && isStudyHall(entry[1])) {
            schedule[day][block] = null
          }
        }
      }
    }

    // Mark all study hall assignments as unplaced
    const newAssignments = currentOption.studyHallAssignments?.map(sh => ({
      ...sh,
      teacher: null,
      day: null,
      block: null
    })) || []

    // Build preview option with recalculated stats
    const clearedOption = recalculateOptionStats({
      ...currentOption,
      teacherSchedules: newTeacherSchedules,
      gradeSchedules: newGradeSchedules,
      studyHallAssignments: newAssignments,
    })

    if (clearedCount === 0) {
      toast("No study halls to clear")
      return
    }

    setPreviewOption(clearedOption)
    setPreviewType("study-hall")
    setShowingPreview(true)
    setManualStudyHallMode(true)
    setSelectedStudyHallGroup(null)
    toast(`Cleared ${clearedCount} study hall${clearedCount !== 1 ? 's' : ''}`, { icon: successIcon })
  }

  function generateStudyHallArrangement() {
    // Always use the current saved option, not a previous preview
    const currentOption = generation?.options?.[parseInt(viewingOption) - 1]
    if (!generation || !currentOption) return

    // Use snapshot teachers (not live DB)
    if (!hasValidSnapshots(generation.stats)) {
      toast.error("This schedule is missing snapshot data")
      return
    }

    const teachers = parseTeachersFromSnapshot(generation.stats!.teachers_snapshot!)
    const rules = parseRulesFromSnapshot(generation.stats!.rules_snapshot!)

    // Generate a new random seed each time
    const seed = Math.floor(Math.random() * 2147483647)
    setStudyHallSeed(seed)

    const DAYS = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']
    const beforeStudyHalls: string[] = []
    for (const [teacher, schedule] of Object.entries(currentOption.teacherSchedules)) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (entry && entry[1] === 'Study Hall') {
            beforeStudyHalls.push(`${teacher} @ ${day} B${block}: ${entry[0]} / Study Hall`)
          }
        }
      }
    }

    // Pass all teachers for stats, but exclude UI-selected teachers from study hall assignment
    const result = reassignStudyHalls(currentOption, teachers, seed, rules, excludedFromStudyHalls)

    if (!result.success) {
      toast.error(result.message || "Could not reassign study halls")
      return
    }

    // Check if no changes were made
    if (result.noChanges) {
      toast(result.message || "No changes made", { icon: <Info className="h-4 w-4 text-blue-500" /> })
      return
    }

    if (!result.newOption) {
      toast.error("Could not reassign study halls")
      return
    }

    const afterStudyHalls: string[] = []
    for (const [teacher, schedule] of Object.entries(result.newOption.teacherSchedules)) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (entry && entry[1] === 'Study Hall') {
            afterStudyHalls.push(`${teacher} @ ${day} B${block}: ${entry[0]} / Study Hall`)
          }
        }
      }
    }

    // Check for conflicts in the new study hall assignments
    const gradesSnapshot = generation.stats?.grades_snapshot || []
    const validGradeNames = gradesSnapshot.map((g: { display_name: string }) => g.display_name)
    let conflictsFound = 0
    for (const sh of afterStudyHalls) {
      // Parse the study hall entry
      const match = sh.match(/(\w+) @ (\w+) B(\d+): "([^"]+)" \/ Study Hall/)
      if (!match) continue
      const [, shTeacher, day, blockStr, gradeDisplay] = match
      const block = parseInt(blockStr)

      // Check if any other teacher has a class for this grade at this time
      for (const [teacher, schedule] of Object.entries(result.newOption.teacherSchedules)) {
        if (teacher === shTeacher) continue
        const entry = schedule[day]?.[block]
        if (entry && entry[1] && entry[1] !== 'OPEN' && entry[1] !== 'Study Hall') {
          // Check grade overlap
          const entryGrade = entry[0]
          if (entryGrade.includes(gradeDisplay.replace(' Grade', '')) || gradeDisplay.includes(entryGrade.replace(' Grade', ''))) {
            conflictsFound++
          }
        }
      }
    }
    if (conflictsFound === 0) {
    } else {
    }

    // Validate the full schedule
    const scheduleErrors = validateFullSchedule(result.newOption, generation?.stats)
    if (scheduleErrors.length > 0) {
      setValidationErrors(scheduleErrors)
      console.warn('[Study Hall] Validation errors found:', scheduleErrors)
      toast.error(`${scheduleErrors.length} validation issue${scheduleErrors.length !== 1 ? 's' : ''} detected`, { icon: errorIcon })
    } else {
      setValidationErrors([])
    }

    // Set as preview (not saved yet)
    setPreviewOption(result.newOption)
    setPreviewType("study-hall")
    setShowingPreview(true)
    setManualStudyHallMode(false)
    setSelectedStudyHallGroup(null)
    toast("Study halls randomized", { icon: successIcon })
  }

  // Compute unplaced study hall groups for manual placement mode
  // Cross-references studyHallAssignments against the actual schedule to detect
  // stale entries (e.g., study hall was removed by regen/freeform but assignment wasn't updated)
  const unplacedStudyHalls = useMemo(() => {
    const option = previewOption || generation?.options?.[parseInt(viewingOption) - 1]
    if (!option?.studyHallAssignments) return []

    const gradeNum = (g: string) => {
      if (g.toLowerCase().includes("kindergarten") || g === "K") return 0
      const m = g.match(/(\d+)/)
      return m ? parseInt(m[1]) : 99
    }

    return option.studyHallAssignments.filter(sh => {
      // Explicitly unplaced
      if (sh.teacher === null) return true
      // Verify the assignment actually exists in the schedule
      if (sh.teacher && sh.day && sh.block != null) {
        const entry = option.teacherSchedules[sh.teacher]?.[sh.day]?.[sh.block]
        if (!entry || !isStudyHall(entry[1])) {
          return true // Assignment is stale — study hall no longer in schedule
        }
        return false
      }
      return true
    }).sort((a, b) => gradeNum(a.group) - gradeNum(b.group))
  }, [previewOption, generation?.options, viewingOption])

  // Compute valid placement targets when a study hall group is selected
  useEffect(() => {
    if (!manualStudyHallMode || !selectedStudyHallGroup) {
      // Only clear if we're in study hall mode (don't clobber swap mode targets)
      if (studyHallMode) setValidTargets([])
      return
    }

    const option = previewOption || generation?.options?.[parseInt(viewingOption) - 1]
    if (!option) { setValidTargets([]); return }

    const grade = selectedStudyHallGroup
    const DAYS_LIST = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
    const BLOCKS_LIST = [1, 2, 3, 4, 5]
    const targets: CellLocation[] = []

    // Pre-compute: days where this grade already has a study hall
    const gradeStudyHallDays = new Set<string>()
    for (const [, schedule] of Object.entries(option.teacherSchedules)) {
      for (const day of DAYS_LIST) {
        for (const block of BLOCKS_LIST) {
          const entry = schedule?.[day]?.[block]
          if (entry && isStudyHall(entry[1]) && gradesOverlap(entry[0], grade)) {
            gradeStudyHallDays.add(day)
          }
        }
      }
    }

    // Pre-compute: slots where this grade has a class (busy)
    const gradeBusySlots = new Set<string>()
    for (const [, schedule] of Object.entries(option.teacherSchedules)) {
      for (const day of DAYS_LIST) {
        for (const block of BLOCKS_LIST) {
          const entry = schedule?.[day]?.[block]
          if (entry && entry[1] && isScheduledClass(entry[1]) && gradesOverlap(entry[0], grade)) {
            gradeBusySlots.add(`${day}|${block}`)
          }
        }
      }
    }

    for (const [teacher, schedule] of Object.entries(option.teacherSchedules)) {
      // Skip excluded teachers
      if (excludedFromStudyHalls.has(teacher)) continue

      for (const day of DAYS_LIST) {
        // Skip days where grade already has a study hall
        if (gradeStudyHallDays.has(day)) continue

        for (const block of BLOCKS_LIST) {
          const entry = schedule?.[day]?.[block]
          // Slot must be OPEN or null
          if (entry && !isOpenBlock(entry[1])) continue
          // Grade must be free at this slot
          if (gradeBusySlots.has(`${day}|${block}`)) continue

          targets.push({ teacher, day, block, grade: '', subject: '' })
        }
      }
    }

    setValidTargets(targets)
    if (targets.length === 0) {
      toast("No valid targets found", { icon: <Info className="h-4 w-4 text-blue-500" /> })
    } else {
      toast(`${targets.length} valid target${targets.length !== 1 ? 's' : ''} found`, { icon: <Crosshair className="h-4 w-4 text-violet-500" /> })
    }
  }, [manualStudyHallMode, selectedStudyHallGroup, previewOption, generation?.options, viewingOption, excludedFromStudyHalls, studyHallMode])

  function handleManualStudyHallPlace(teacher: string, day: string, block: number) {
    if (!selectedStudyHallGroup || !manualStudyHallMode) return

    const option = previewOption || generation?.options?.[parseInt(viewingOption) - 1]
    if (!option) return

    // Deep copy schedules
    const newTeacherSchedules = JSON.parse(JSON.stringify(option.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(option.gradeSchedules))

    // Validate: slot must be OPEN/null
    const currentEntry = newTeacherSchedules[teacher]?.[day]?.[block]
    if (currentEntry && currentEntry[1] !== 'OPEN') return

    // Validate: teacher must be eligible (not excluded)
    if (excludedFromStudyHalls.has(teacher)) return

    // Find the study hall group info — match using same criteria as unplacedStudyHalls
    // (includes stale entries where teacher is set but schedule disagrees)
    const shAssignment = option.studyHallAssignments.find(
      (sh: { group: string; teacher: string | null; day: string | null; block: number | null }) => {
        if (sh.group !== selectedStudyHallGroup) return false
        if (sh.teacher === null) return true
        // Stale entry: assignment claims placed but schedule disagrees
        if (sh.teacher && sh.day && sh.block != null) {
          const entry = option.teacherSchedules[sh.teacher]?.[sh.day]?.[sh.block]
          if (!entry || !isStudyHall(entry[1])) return true
        }
        return false
      }
    )
    if (!shAssignment) return

    const grade = shAssignment.group

    // Validate: grade must be free at this slot (no grade conflict)
    for (const [, schedule] of Object.entries(newTeacherSchedules) as [string, TeacherSchedule][]) {
      for (const b of Object.keys(schedule[day] || {})) {
        const entry = schedule[day][Number(b)]
        if (Number(b) === block && entry && entry[1] && isScheduledClass(entry[1])) {
          if (gradesOverlap(entry[0], grade)) {
            toast.error(`${grade} already has a class at this time`)
            return
          }
        }
      }
    }

    // Validate: grade shouldn't already have a study hall on this day
    for (const [, schedule] of Object.entries(newTeacherSchedules) as [string, TeacherSchedule][]) {
      const daySchedule = schedule?.[day]
      if (!daySchedule) continue
      for (const b of Object.keys(daySchedule)) {
        const cell = daySchedule[Number(b)]
        if (cell && isStudyHall(cell[1]) && gradesOverlap(cell[0], grade)) {
          toast.error(`${grade} already has a study hall on ${day}`)
          return
        }
      }
    }

    // Place it
    if (!newTeacherSchedules[teacher][day]) newTeacherSchedules[teacher][day] = {}
    newTeacherSchedules[teacher][day][block] = [grade, BLOCK_TYPE_STUDY_HALL]
    if (newGradeSchedules[grade]) {
      if (!newGradeSchedules[grade][day]) newGradeSchedules[grade][day] = {}
      newGradeSchedules[grade][day][block] = [teacher, BLOCK_TYPE_STUDY_HALL]
    }

    // Update study hall assignments - only update the first unplaced/stale match
    let placed = false
    const newAssignments = option.studyHallAssignments.map((sh: { group: string; teacher: string | null; day: string | null; block: number | null }) => {
      if (!placed && sh.group === selectedStudyHallGroup) {
        // Match unplaced or stale entries (same logic as the find above)
        const isUnplaced = sh.teacher === null
        const isStale = sh.teacher && sh.day && sh.block != null &&
          (() => {
            const entry = option.teacherSchedules[sh.teacher!]?.[sh.day!]?.[sh.block!]
            return !entry || !isStudyHall(entry[1])
          })()
        if (isUnplaced || isStale) {
          placed = true
          return { ...sh, teacher, day, block }
        }
      }
      return sh
    })

    // Build updated option and recalculate stats
    const updatedOption = recalculateOptionStats({
      ...option,
      teacherSchedules: newTeacherSchedules,
      gradeSchedules: newGradeSchedules,
      studyHallAssignments: newAssignments,
    })

    setPreviewOption(updatedOption)
    setPreviewType("study-hall")
    setShowingPreview(true)
    setSelectedStudyHallGroup(null)

    // Check if all study halls are now placed
    const remaining = newAssignments.filter((sh: { teacher: string | null }) => sh.teacher === null)
    if (remaining.length === 0) {
      toast("All study halls placed!", { icon: successIcon })
    } else {
      toast(`${grade} study hall placed with ${teacher}`, { icon: successIcon })
    }
  }

  function handleManualStudyHallRemove(teacher: string, day: string, block: number) {
    if (!manualStudyHallMode) return

    const option = previewOption || generation?.options?.[parseInt(viewingOption) - 1]
    if (!option) return

    // Deep copy schedules
    const newTeacherSchedules = JSON.parse(JSON.stringify(option.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(option.gradeSchedules))

    // Verify the cell is actually a study hall
    const currentEntry = newTeacherSchedules[teacher]?.[day]?.[block]
    if (!currentEntry || !isStudyHall(currentEntry[1])) return

    const grade = currentEntry[0]

    // Remove from teacher schedule
    newTeacherSchedules[teacher][day][block] = ['', 'OPEN']

    // Remove from grade schedule
    if (newGradeSchedules[grade]?.[day]?.[block]) {
      newGradeSchedules[grade][day][block] = null
    }

    // Mark the matching assignment as unplaced
    let removed = false
    const newAssignments = option.studyHallAssignments.map((sh: { group: string; teacher: string | null; day: string | null; block: number | null }) => {
      if (!removed && sh.group === grade && sh.teacher === teacher && sh.day === day && sh.block === block) {
        removed = true
        return { ...sh, teacher: null, day: null, block: null }
      }
      return sh
    })

    const updatedOption = recalculateOptionStats({
      ...option,
      teacherSchedules: newTeacherSchedules,
      gradeSchedules: newGradeSchedules,
      studyHallAssignments: newAssignments,
    })

    setPreviewOption(updatedOption)
    setPreviewType("study-hall")
    setShowingPreview(true)
    setSelectedStudyHallGroup(null)
    toast(`${grade} study hall removed from ${teacher}`, { icon: successIcon })
  }

  async function handleDeleteOption(optionIndex: number) {
    if (!generation) return

    // Don't allow deleting if only 1 option remains
    if (generation.options.length <= 1) {
      toast.error("Cannot delete the last option")
      return
    }

    const optionNum = optionIndex + 1
    const deletedLabel = generation.options[optionIndex]?.label || String.fromCharCode(65 + optionIndex)
    const isPrimary = (generation.selected_option || 1) === optionNum
    const deleteLabel = isPrimary ? 'Published' : `Version ${deletedLabel}`
    if (!confirm(`Delete ${deleteLabel}? This cannot be undone.`)) {
      return
    }

    try {
      // Remove the option — keep labels intact (no renumbering)
      const updatedOptions = generation.options
        .filter((_, i) => i !== optionIndex)

      // Check if we're deleting the PRIMARY revision (generation.selected_option)
      const primaryRevision = generation.selected_option || 1
      let newPrimaryRevision: number | undefined = undefined

      if (primaryRevision === optionNum) {
        // Deleting the primary - pick a new one (prefer previous, fall back to first)
        if (optionIndex > 0) {
          newPrimaryRevision = optionIndex // Previous option (now at this index)
        } else {
          newPrimaryRevision = 1 // First remaining option
        }
      } else if (primaryRevision > optionNum) {
        // Primary is after deleted option - adjust the number
        newPrimaryRevision = primaryRevision - 1
      }

      // Save to the server (include selected_option if it changed)
      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          options: updatedOptions,
          ...(newPrimaryRevision !== undefined && { selected_option: newPrimaryRevision }),
        }),
      })

      if (updateRes.ok) {
        setGeneration({
          ...generation,
          options: updatedOptions,
          ...(newPrimaryRevision !== undefined && { selected_option: newPrimaryRevision }),
        })
        const currentSelection = parseInt(viewingOption)
        if (currentSelection === optionNum) {
          // Deleted the viewed tab - switch to nearest revision
          let newSelection: string
          if (optionIndex > 0) {
            newSelection = optionIndex.toString()
          } else {
            newSelection = "1"
          }
          setViewingOption(newSelection)
        } else if (currentSelection > optionNum) {
          const newSelection = (currentSelection - 1).toString()
          setViewingOption(newSelection)
        }
        toast(`Deleted ${deleteLabel}`, { icon: successIcon })
      } else {
        toast.error("Failed to delete option")
      }
    } catch (error) {
      console.error('Delete option error:', error)
      toast.error("Failed to delete option")
    }
  }

  function handleValidateSchedule() {
    if (!selectedResult || !generation) return

    // Run validation with modal in review mode (stays open to show results)
    runValidationWithModal(selectedResult, generation.stats, () => {}, 'review')
  }

  /**
   * Run validation with a visual modal showing each check as it runs.
   * @param mode - 'save' auto-closes on success and calls onComplete, 'review' stays open to show results
   * @param options.skipStudyHallCheck - Skip study hall coverage validation (for stripped study halls mode)
   * Returns true if validation passed (only soft warnings), false if hard errors.
   */
  async function runValidationWithModal(
    option: ScheduleOption,
    stats: GenerationStats | undefined,
    onComplete: () => void,
    mode: 'save' | 'review' = 'save',
    options?: { skipStudyHallCheck?: boolean }
  ): Promise<boolean> {
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
    const softWarningTypes = ['back_to_back', 'study_hall_coverage']

    // Define all checks
    const checkDefinitions = [
      { name: 'Teacher conflicts', key: 'teacher_conflict' },
      { name: 'Grade conflicts', key: 'grade_conflict' },
      { name: 'Subject conflicts', key: 'subject_conflict' },
      { name: 'Schedule consistency', key: 'consistency' },
      { name: 'Session counts', key: 'session_count' },
      { name: 'Unknown classes', key: 'unknown_class' },
      { name: 'Study hall coverage', key: 'study_hall_coverage' },
      { name: 'Fixed slot constraints', key: 'fixed_slot_violation' },
      { name: 'Availability constraints', key: 'availability_violation' },
      { name: 'Back-to-back blocks', key: 'back_to_back' },
    ]

    // Initialize modal with all checks pending (mark study hall as skipped if applicable)
    type CheckStatus = 'pending' | 'checking' | 'passed' | 'failed' | 'skipped'
    const initialChecks: Array<{ name: string; status: CheckStatus; errorCount: number; errors?: string[] }> =
      checkDefinitions.map(c => ({
        name: c.name,
        status: (options?.skipStudyHallCheck && c.key === 'study_hall_coverage') ? 'skipped' as CheckStatus : 'pending' as CheckStatus,
        errorCount: 0
      }))

    setValidationModal({ isOpen: true, checks: initialChecks, onComplete, mode, expandedChecks: new Set() })

    // Run full validation
    const allErrors = validateFullSchedule(option, stats, options)

    // Animate through checks
    const updatedChecks = [...initialChecks]
    let hasHardErrors = false

    for (let i = 0; i < checkDefinitions.length; i++) {
      // Skip checks that are already marked as skipped
      if (updatedChecks[i].status === 'skipped') {
        continue
      }

      // Mark current check as "checking"
      updatedChecks[i] = { ...updatedChecks[i], status: 'checking' as CheckStatus }
      setValidationModal(prev => prev ? { ...prev, checks: [...updatedChecks] } : null)

      // Small delay for visual effect
      await new Promise(resolve => setTimeout(resolve, 150))

      // Count errors for this check type
      const checkKey = checkDefinitions[i].key
      const errorsForCheck = allErrors.filter(e => {
        if (checkKey === 'consistency') {
          return e.type === 'grade_conflict' && e.message.includes('Data Mismatch')
        }
        return e.type === checkKey
      })

      const errorCount = errorsForCheck.length
      const isSoftWarning = softWarningTypes.includes(checkKey)

      if (errorCount > 0 && !isSoftWarning) {
        hasHardErrors = true
      }

      // Mark check as passed or failed, include error messages for review mode
      updatedChecks[i] = {
        ...updatedChecks[i],
        status: (errorCount > 0 ? 'failed' : 'passed') as CheckStatus,
        errorCount,
        errors: errorsForCheck.map(e => e.message)
      }
      setValidationModal(prev => prev ? { ...prev, checks: [...updatedChecks] } : null)
    }

    // Final delay to show completed checklist
    await new Promise(resolve => setTimeout(resolve, 800))

    // In review mode, always keep modal open to show results
    if (mode === 'review') {
      // Modal stays open, user closes it manually
      return !hasHardErrors
    }

    if (hasHardErrors) {
      // Keep modal open, set errors
      setValidationErrors(allErrors)
      return false
    }

    // Close modal and proceed (save mode only)
    setValidationModal(null)
    setValidationErrors(allErrors) // May have soft warnings

    if (allErrors.length > 0) {
      toast(`${allErrors.length} warning${allErrors.length !== 1 ? 's' : ''} (suboptimal but valid)`, { icon: warningIcon })
    }

    onComplete()
    return true
  }

  async function handleDuplicateRevision() {
    if (!generation || !selectedResult) return

    try {
      // Deep copy the current revision
      const duplicatedOption = JSON.parse(JSON.stringify(selectedResult))
      duplicatedOption.optionNumber = generation.options.length + 1
      duplicatedOption.label = getNextLabel(generation.options)
      duplicatedOption.updatedAt = new Date().toISOString()

      const updatedOptions = [...generation.options, duplicatedOption]

      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: updatedOptions }),
      })

      if (updateRes.ok) {
        setGeneration({ ...generation, options: updatedOptions })
        // Switch to the new revision
        setViewingOption(updatedOptions.length.toString())
        toast(`Created Version ${duplicatedOption.label}`, { icon: successIcon })
      } else {
        toast.error("Failed to duplicate version")
      }
    } catch (error) {
      console.error('Duplicate version error:', error)
      toast.error("Failed to duplicate version")
    }
  }

  async function handleMarkAsSelected() {
    if (!generation) return

    const optionNum = parseInt(viewingOption)

    try {
      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_option: optionNum }),
      })

      if (updateRes.ok) {
        setGeneration({ ...generation, selected_option: optionNum })
        const optLabel = generation.options[optionNum - 1]?.label || String.fromCharCode(64 + optionNum)
        toast(`Version ${optLabel} published`, { icon: successIcon })
      } else {
        toast.error("Failed to update selection")
      }
    } catch (error) {
      console.error('Mark as selected error:', error)
      toast.error("Failed to update selection")
    }
  }

  // Swap mode functions
  function findValidSwapTargets(source: CellLocation, cellType: "study-hall" | "open"): CellLocation[] {
    if (!selectedResult) return []

    const targets: CellLocation[] = []
    const schedules = swapWorkingSchedules?.teacherSchedules || selectedResult.teacherSchedules

    // For study hall: find OPEN blocks on eligible teachers at the SAME day/block
    // (the grade needs the study hall at this specific time, we're just changing the teacher)
    // For open: find all OPEN blocks (can swap OPEN with OPEN on any slot)
    for (const [teacher, schedule] of Object.entries(schedules)) {
      // Skip the source teacher
      if (teacher === source.teacher) continue

      // For study hall swaps, only allow full-time teachers who can supervise
      if (cellType === "study-hall") {
        const stat = selectedResult.teacherStats.find(s => s.teacher === teacher)
        if (!isFullTime(stat?.status)) continue

        // Must be same day and block (grade needs study hall at this time)
        const entry = schedule[source.day]?.[source.block]
        if (entry && isOpenBlock(entry[1])) {
          targets.push({ teacher, day: source.day, block: source.block })
        }
      } else {
        // For OPEN blocks, can swap to any other OPEN block
        const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
        const BLOCKS = [1, 2, 3, 4, 5]
        for (const day of DAYS) {
          for (const block of BLOCKS) {
            const entry = schedule[day]?.[block]
            if (entry && isOpenBlock(entry[1])) {
              targets.push({ teacher, day, block })
            }
          }
        }
      }
    }

    return targets
  }

  // Find valid swap targets for teacher view class moves
  function findValidTeacherClassSwapTargets(source: CellLocation): CellLocation[] {
    if (!selectedResult || !source.teacher || !source.grade || !source.subject) return []

    const targets: CellLocation[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
    const BLOCKS = [1, 2, 3, 4, 5]

    const teacher = source.teacher
    const grade = source.grade
    const subject = source.subject

    const teacherSchedules = swapWorkingSchedules?.teacherSchedules || selectedResult.teacherSchedules
    const gradeSchedules = swapWorkingSchedules?.gradeSchedules || selectedResult.gradeSchedules

    const teacherSchedule = teacherSchedules[teacher]
    const gradeSchedule = gradeSchedules[grade]
    if (!teacherSchedule || !gradeSchedule) return []

    // Get subjects already scheduled on each day for this grade (excluding source)
    const subjectsByDay: Record<string, Set<string>> = {}
    for (const day of DAYS) {
      subjectsByDay[day] = new Set()
      for (const block of BLOCKS) {
        const cell = gradeSchedule[day]?.[block]
        const entry = getFirstGradeEntry(cell)
        if (entry && isScheduledClass(entry[1])) {
          if (!(day === source.day && block === source.block)) {
            subjectsByDay[day].add(entry[1])
          }
        }
      }
    }

    // Option 1: Find OPEN slots for this teacher where the grade is also free
    for (const day of DAYS) {
      for (const block of BLOCKS) {
        // Skip source cell
        if (day === source.day && block === source.block) continue

        const teacherEntry = teacherSchedule[day]?.[block]
        const gradeCell = gradeSchedule[day]?.[block]
        const gradeEntry = getFirstGradeEntry(gradeCell)

        // Teacher must have OPEN at this slot
        if (!teacherEntry || !isOpenBlock(teacherEntry[1])) continue

        // Grade must be free (no class) - skip multi-entry elective cells too
        if (gradeEntry && isScheduledClass(gradeEntry[1])) continue

        // No subject conflict - source subject can't already be on this day
        if (subjectsByDay[day].has(subject)) continue

        targets.push({ teacher, day, block, grade, subject })
      }
    }

    // Option 2: Find other classes (same grade) that can swap times
    // This allows swapping with classes taught by OTHER teachers
    for (const day of DAYS) {
      for (const block of BLOCKS) {
        // Skip source cell
        if (day === source.day && block === source.block) continue

        const gradeCell = gradeSchedule[day]?.[block]

        // Skip multi-entry elective cells - can't swap with those
        if (isMultipleEntryCell(gradeCell)) continue

        const gradeEntry = getFirstGradeEntry(gradeCell)

        // Must be a class (not OPEN, Study Hall, or empty)
        if (!gradeEntry || !isScheduledClass(gradeEntry[1])) continue

        const [otherTeacher, otherSubject] = gradeEntry

        // Skip if same teacher (that's Option 1)
        if (otherTeacher === teacher) continue

        const otherTeacherSchedule = teacherSchedules[otherTeacher]
        if (!otherTeacherSchedule) continue

        // Check: source teacher must have OPEN at the other class's time
        const sourceTeacherAtOtherTime = teacherSchedule[day]?.[block]
        if (!sourceTeacherAtOtherTime || !isOpenBlock(sourceTeacherAtOtherTime[1])) continue

        // Check: other teacher must have OPEN at source's time
        const otherTeacherAtSourceTime = otherTeacherSchedule[source.day]?.[source.block]
        if (!otherTeacherAtSourceTime || !isOpenBlock(otherTeacherAtSourceTime[1])) continue

        // Check subject conflicts after swap
        const targetDaySubjects = new Set(subjectsByDay[day])
        targetDaySubjects.delete(otherSubject)
        if (targetDaySubjects.has(subject)) continue

        const sourceDaySubjects = new Set(subjectsByDay[source.day])
        if (sourceDaySubjects.has(otherSubject)) continue

        // Target is in the OTHER teacher's schedule (where the swap target class is)
        targets.push({ teacher: otherTeacher, day, block, grade, subject: otherSubject })
      }
    }

    return targets
  }

  // Find valid swap targets for grade view (class swaps)
  function findValidGradeSwapTargets(source: CellLocation): CellLocation[] {
    if (!selectedResult || !source.grade || !source.teacher || !source.subject) return []

    const targets: CellLocation[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
    const BLOCKS = [1, 2, 3, 4, 5]

    const teacherSchedules = swapWorkingSchedules?.teacherSchedules || selectedResult.teacherSchedules
    const gradeSchedules = swapWorkingSchedules?.gradeSchedules || selectedResult.gradeSchedules

    const gradeSchedule = gradeSchedules[source.grade]
    const teacherSchedule = teacherSchedules[source.teacher]
    if (!gradeSchedule || !teacherSchedule) return []

    // Get subjects already scheduled on each day for this grade (excluding source)
    const subjectsByDay: Record<string, Set<string>> = {}
    for (const day of DAYS) {
      subjectsByDay[day] = new Set()
      for (const block of BLOCKS) {
        const cell = gradeSchedule[day]?.[block]
        const entry = getFirstGradeEntry(cell)
        if (entry && isScheduledClass(entry[1])) {
          // Don't count the source cell's subject
          if (!(day === source.day && block === source.block)) {
            subjectsByDay[day].add(entry[1])
          }
        }
      }
    }

    // Option 1: Find OPEN slots where this class can move
    // Requirements: teacher has OPEN, grade has no class, no subject conflict on that day
    for (const day of DAYS) {
      for (const block of BLOCKS) {
        // Skip source cell
        if (day === source.day && block === source.block) continue

        const teacherEntry = teacherSchedule[day]?.[block]
        const gradeCell = gradeSchedule[day]?.[block]
        const gradeEntry = getFirstGradeEntry(gradeCell)

        // Teacher must have OPEN at this slot
        if (!teacherEntry || !isOpenBlock(teacherEntry[1])) continue

        // Grade must be free (no class) - skip multi-entry elective cells too
        if (gradeEntry && isScheduledClass(gradeEntry[1])) continue

        // No subject conflict - source subject can't already be on this day
        if (subjectsByDay[day].has(source.subject)) continue

        targets.push({ grade: source.grade, day, block, teacher: source.teacher, subject: source.subject })
      }
    }

    // Option 2: Find other classes that can swap times
    // Requirements: both teachers have OPEN at each other's time, no subject conflicts
    for (const day of DAYS) {
      for (const block of BLOCKS) {
        // Skip source cell
        if (day === source.day && block === source.block) continue

        const gradeCell = gradeSchedule[day]?.[block]

        // Skip multi-entry elective cells - can't swap with those
        if (isMultipleEntryCell(gradeCell)) continue

        const gradeEntry = getFirstGradeEntry(gradeCell)

        // Must be a class (not OPEN, Study Hall, or empty)
        if (!gradeEntry || !isScheduledClass(gradeEntry[1])) continue

        const [otherTeacher, otherSubject] = gradeEntry

        // Can't swap with same teacher's class (that's just Option 1)
        if (otherTeacher === source.teacher) continue

        const otherTeacherSchedule = teacherSchedules[otherTeacher]
        if (!otherTeacherSchedule) continue

        // Check: source teacher must have OPEN at the other class's time
        const sourceTeacherAtOtherTime = teacherSchedule[day]?.[block]
        if (!sourceTeacherAtOtherTime || !isOpenBlock(sourceTeacherAtOtherTime[1])) continue

        // Check: other teacher must have OPEN at source's time
        const otherTeacherAtSourceTime = otherTeacherSchedule[source.day]?.[source.block]
        if (!otherTeacherAtSourceTime || !isOpenBlock(otherTeacherAtSourceTime[1])) continue

        // Check subject conflicts after swap:
        // - Source subject moving to target day: can't have duplicate
        // - Other subject moving to source day: can't have duplicate
        const targetDaySubjects = new Set(subjectsByDay[day])
        targetDaySubjects.delete(otherSubject) // Remove the class we're swapping out
        if (targetDaySubjects.has(source.subject)) continue

        const sourceDaySubjects = new Set(subjectsByDay[source.day])
        // sourceDaySubjects already excludes source.subject
        if (sourceDaySubjects.has(otherSubject)) continue

        targets.push({ grade: source.grade, day, block, teacher: otherTeacher, subject: otherSubject })
      }
    }

    return targets
  }

  function handleCellClick(location: CellLocation, cellType: "study-hall" | "open" | "class") {
    // Manual study hall mode intercept
    if (studyHallMode && manualStudyHallMode && location.teacher) {
      if (selectedStudyHallGroup) {
        // Placing: a group is selected, click a valid target
        handleManualStudyHallPlace(location.teacher, location.day, location.block)
      } else if (cellType === "study-hall") {
        // Removing: no group selected, click a placed study hall to unplace it
        handleManualStudyHallRemove(location.teacher, location.day, location.block)
      }
      return
    }

    if (!swapMode || !selectedResult) return

    // Handle grade view
    if (viewMode === "grade") {
      // If clicking on a valid target, perform the swap
      if (selectedCell && validTargets.some(t =>
        t.grade === location.grade && t.day === location.day && t.block === location.block
      )) {
        // Determine which type of swap based on what was selected
        if (selectedCell.subject && !isStudyHall(selectedCell.subject)) {
          performGradeSwap(selectedCell, location)
        } else {
          // Study hall swap in grade view - use the teacher swap logic
          performSwap(
            { teacher: selectedCell.teacher!, day: selectedCell.day, block: selectedCell.block },
            { teacher: location.teacher!, day: location.day, block: location.block }
          )
        }
        return
      }

      // If clicking on the same cell, deselect
      if (selectedCell?.grade === location.grade &&
          selectedCell?.day === location.day &&
          selectedCell?.block === location.block) {
        setSelectedCell(null)
        setValidTargets([])
        return
      }

      // Allow selecting classes or study halls in grade view
      if (cellType !== "class" && cellType !== "study-hall") {
        toast.error("Select a class or study hall to move")
        return
      }

      // Select the cell and find valid targets
      setSelectedCell(location)
      let targets: CellLocation[]
      if (cellType === "study-hall") {
        // For study hall in grade view, find other teachers who can take it
        const teacherTargets = findValidSwapTargets(
          { teacher: location.teacher!, day: location.day, block: location.block },
          "study-hall"
        )
        // Convert to grade view format
        targets = teacherTargets.map(t => ({ ...t, grade: location.grade }))
      } else {
        targets = findValidGradeSwapTargets(location)
      }
      setValidTargets(targets)

      if (targets.length === 0) {
        toast("No valid move/swap targets found", { icon: <Info className="h-4 w-4 text-blue-500" /> })
      } else {
        toast(`${targets.length} valid target${targets.length !== 1 ? 's' : ''} found`, { icon: <Crosshair className="h-4 w-4 text-violet-500" /> })
      }
      return
    }

    // Handle teacher view
    // If clicking on a valid target, perform the swap
    if (selectedCell && validTargets.some(t =>
      t.teacher === location.teacher && t.day === location.day && t.block === location.block
    )) {
      // Determine which type of swap based on what was selected
      const selectedCellType = isStudyHall(selectedCell.subject) ? "study-hall"
        : isOpenBlock(selectedCell.subject) ? "open"
        : "class"

      if (selectedCellType === "class") {
        // Check if swapping within same teacher (Option 1) or with another teacher (Option 2)
        if (selectedCell.teacher === location.teacher) {
          performTeacherClassSwap(selectedCell, location)
        } else {
          // Option 2: Swap with another teacher's class - use grade swap logic
          performGradeSwap(
            { ...selectedCell, grade: selectedCell.grade! },
            { ...location, grade: selectedCell.grade! }
          )
        }
      } else {
        performSwap(selectedCell, location)
      }
      return
    }

    // If clicking on the same cell, deselect
    if (selectedCell?.teacher === location.teacher &&
        selectedCell?.day === location.day &&
        selectedCell?.block === location.block) {
      setSelectedCell(null)
      setValidTargets([])
      return
    }

    // Allow selecting study halls, open blocks, or classes in teacher view
    if (cellType !== "study-hall" && cellType !== "open" && cellType !== "class") {
      toast.error("Select a class, Study Hall, or OPEN block")
      return
    }

    // Select the cell and find valid targets
    setSelectedCell(location)
    let targets: CellLocation[]
    if (cellType === "class") {
      targets = findValidTeacherClassSwapTargets(location)
    } else {
      targets = findValidSwapTargets(location, cellType)
    }
    setValidTargets(targets)

    if (targets.length === 0) {
      toast("No valid swap targets found", { icon: <Info className="h-4 w-4 text-blue-500" /> })
    } else {
      toast(`${targets.length} valid target${targets.length !== 1 ? 's' : ''} found`, { icon: <Crosshair className="h-4 w-4 text-violet-500" /> })
    }
  }

  function performSwap(source: CellLocation, target: CellLocation) {
    if (!swapWorkingSchedules) return

    // Get the cell contents from working schedules
    const sourceEntry = swapWorkingSchedules.teacherSchedules[source.teacher]?.[source.day]?.[source.block]
    const targetEntry = swapWorkingSchedules.teacherSchedules[target.teacher]?.[target.day]?.[target.block]

    if (!sourceEntry || !targetEntry) {
      toast.error("Invalid swap")
      return
    }

    // Create deep copy of the working schedules
    const newTeacherSchedules = JSON.parse(JSON.stringify(swapWorkingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(swapWorkingSchedules.gradeSchedules))
    let newStudyHallAssignments = [...swapWorkingSchedules.studyHallAssignments]

    // Perform the swap in teacher schedules
    newTeacherSchedules[source.teacher][source.day][source.block] = targetEntry
    newTeacherSchedules[target.teacher][target.day][target.block] = sourceEntry

    // Update grade schedules if it's a study hall
    if (isStudyHall(sourceEntry[1])) {
      const gradeGroup = sourceEntry[0] // e.g., "6th Grade" or "6th-7th"

      // Update study hall assignments
      newStudyHallAssignments = newStudyHallAssignments.map(sh => {
        if (sh.teacher === source.teacher && sh.day === source.day && sh.block === source.block) {
          return { ...sh, teacher: target.teacher, day: target.day, block: target.block }
        }
        return sh
      })

      // Update the grade schedule - remove from old slot, add to new
      if (newGradeSchedules[gradeGroup]) {
        if (newGradeSchedules[gradeGroup][source.day]?.[source.block]) {
          newGradeSchedules[gradeGroup][source.day][source.block] = null
        }
        if (!newGradeSchedules[gradeGroup][target.day]) {
          newGradeSchedules[gradeGroup][target.day] = {}
        }
        newGradeSchedules[gradeGroup][target.day][target.block] = [target.teacher, BLOCK_TYPE_STUDY_HALL]
      }

      toast(`Study Hall reassigned: ${source.teacher} → ${target.teacher} (${target.day} B${target.block})`, { icon: successIcon })
    }

    // Update working schedules
    setSwapWorkingSchedules({
      teacherSchedules: newTeacherSchedules,
      gradeSchedules: newGradeSchedules,
      studyHallAssignments: newStudyHallAssignments
    })
    setSwapCount(prev => prev + 1)

    // Highlight the swapped cells
    highlightCells([
      { teacher: target.teacher, day: target.day, block: target.block },
      { teacher: source.teacher, day: source.day, block: source.block },
    ])

    // Clear selection state
    setSelectedCell(null)
    setValidTargets([])
  }

  function performTeacherClassSwap(source: CellLocation, target: CellLocation) {
    if (!swapWorkingSchedules || !source.teacher || !source.grade || !source.subject) return

    const teacher = source.teacher
    const grade = source.grade
    const subject = source.subject

    // Create deep copy of the working schedules
    const newTeacherSchedules = JSON.parse(JSON.stringify(swapWorkingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(swapWorkingSchedules.gradeSchedules))

    // Get the source class info from working schedules
    const sourceTeacherEntry = swapWorkingSchedules.teacherSchedules[teacher]?.[source.day]?.[source.block]
    const sourceGradeEntry = swapWorkingSchedules.gradeSchedules[grade]?.[source.day]?.[source.block]

    if (!sourceTeacherEntry || !sourceGradeEntry) {
      toast.error("Invalid swap - source not found")
      setSelectedCell(null)
      setValidTargets([])
      return
    }

    // Move class: source slot becomes OPEN, target slot gets the class
    newTeacherSchedules[teacher][source.day][source.block] = [grade, BLOCK_TYPE_OPEN]
    newTeacherSchedules[teacher][target.day][target.block] = sourceTeacherEntry

    // Update grade schedule
    newGradeSchedules[grade][source.day][source.block] = null
    if (!newGradeSchedules[grade][target.day]) {
      newGradeSchedules[grade][target.day] = {}
    }
    newGradeSchedules[grade][target.day][target.block] = sourceGradeEntry

    // Update working schedules
    setSwapWorkingSchedules({
      ...swapWorkingSchedules,
      teacherSchedules: newTeacherSchedules,
      gradeSchedules: newGradeSchedules,
    })
    setSwapCount(prev => prev + 1)

    toast(`Moved ${grade} ${subject}: ${source.day} B${source.block} → ${target.day} B${target.block}`, { icon: successIcon })

    // Highlight the destination cell
    highlightCells([
      { teacher, day: target.day, block: target.block, grade, subject },
    ])

    // Clear swap state
    setSelectedCell(null)
    setValidTargets([])
  }

  function performGradeSwap(source: CellLocation, target: CellLocation) {
    if (!swapWorkingSchedules || !source.grade) return

    const grade = source.grade

    // Create deep copy of the working schedules
    const newTeacherSchedules = JSON.parse(JSON.stringify(swapWorkingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(swapWorkingSchedules.gradeSchedules))

    // Get the source class info from working schedules
    const sourceTeacher = source.teacher!
    const sourceSubject = source.subject!
    const sourceGradeCell = swapWorkingSchedules.gradeSchedules[grade]?.[source.day]?.[source.block]
    const sourceGradeEntry = getFirstGradeEntry(sourceGradeCell)
    const sourceTeacherEntry = swapWorkingSchedules.teacherSchedules[sourceTeacher]?.[source.day]?.[source.block]

    if (!sourceGradeEntry || !sourceTeacherEntry) {
      toast.error("Invalid swap - source not found")
      setSelectedCell(null)
      setValidTargets([])
      return
    }

    // Check if this is Option 1 (move to OPEN) or Option 2 (swap with another class)
    const targetGradeCell = swapWorkingSchedules.gradeSchedules[grade]?.[target.day]?.[target.block]
    const targetGradeEntry = getFirstGradeEntry(targetGradeCell)
    const isOption1 = !targetGradeEntry || !isScheduledClass(targetGradeEntry[1])

    let successMessage = ""
    let destinationCells: CellLocation[] = []

    if (isOption1) {
      // Option 1: Move class to an OPEN slot
      const targetTeacherEntry = newTeacherSchedules[sourceTeacher]?.[target.day]?.[target.block]
      if (!targetTeacherEntry || !isOpenBlock(targetTeacherEntry[1])) {
        toast.error("Invalid swap - teacher not available at target time")
        setSelectedCell(null)
        setValidTargets([])
        return
      }

      // Update teacher schedule: source slot becomes OPEN, target slot gets the class
      newTeacherSchedules[sourceTeacher][source.day][source.block] = [grade, BLOCK_TYPE_OPEN]
      newTeacherSchedules[sourceTeacher][target.day][target.block] = sourceTeacherEntry

      // Update grade schedule: source slot becomes empty/null, target slot gets the class
      newGradeSchedules[grade][source.day][source.block] = null
      if (!newGradeSchedules[grade][target.day]) {
        newGradeSchedules[grade][target.day] = {}
      }
      newGradeSchedules[grade][target.day][target.block] = sourceGradeEntry

      successMessage = `Moved ${grade} ${sourceSubject}: ${source.day} B${source.block} → ${target.day} B${target.block}`
      destinationCells = [
        { teacher: sourceTeacher, day: target.day, block: target.block, grade, subject: sourceSubject },
      ]
    } else {
      // Option 2: Exchange times between two classes
      const targetTeacher = target.teacher!
      const targetSubject = target.subject!
      const targetTeacherSchedule = swapWorkingSchedules.teacherSchedules[targetTeacher]
      const targetTeacherEntry = targetTeacherSchedule?.[target.day]?.[target.block]

      if (!targetGradeEntry || !targetTeacherEntry) {
        toast.error("Invalid swap - target not found")
        setSelectedCell(null)
        setValidTargets([])
        return
      }

      // Swap in teacher schedules
      newTeacherSchedules[sourceTeacher][source.day][source.block] = [grade, BLOCK_TYPE_OPEN]
      newTeacherSchedules[sourceTeacher][target.day][target.block] = sourceTeacherEntry

      newTeacherSchedules[targetTeacher][target.day][target.block] = [grade, BLOCK_TYPE_OPEN]
      newTeacherSchedules[targetTeacher][source.day][source.block] = targetTeacherEntry

      // Swap in grade schedule
      newGradeSchedules[grade][source.day][source.block] = [targetTeacher, targetSubject]
      newGradeSchedules[grade][target.day][target.block] = [sourceTeacher, sourceSubject]

      successMessage = `Exchanged times: ${sourceTeacher}'s ${sourceSubject} → ${target.day} B${target.block}, ${targetTeacher}'s ${targetSubject} → ${source.day} B${source.block}`
      destinationCells = [
        { teacher: sourceTeacher, day: target.day, block: target.block, grade, subject: sourceSubject },
        { teacher: targetTeacher, day: source.day, block: source.block, grade, subject: targetSubject },
      ]
    }

    // Update working schedules
    setSwapWorkingSchedules({
      ...swapWorkingSchedules,
      teacherSchedules: newTeacherSchedules,
      gradeSchedules: newGradeSchedules,
    })
    setSwapCount(prev => prev + 1)

    toast(successMessage, { icon: successIcon })
    highlightCells(destinationCells)

    // Clear swap state
    setSelectedCell(null)
    setValidTargets([])
  }

  function enterSwapMode(skipChangesCheck = false) {
    if (!selectedResult || !generation) return
    // If changes detected and not dismissed, show dialog first
    if (!skipChangesCheck && optionNeedsChanges && !dismissedForOptions.has(viewingOption)) {
      setPendingModeEntry('swap')
      setShowChangesDialog(true)
      return
    }
    setSwapMode(true)
    setFreeformMode(false)
    setShowingPreview(true)
    setSwapWorkingSchedules(JSON.parse(JSON.stringify({
      teacherSchedules: selectedResult.teacherSchedules,
      gradeSchedules: selectedResult.gradeSchedules,
      studyHallAssignments: selectedResult.studyHallAssignments || []
    })))
    setSwapCount(0)
    setSelectedCell(null)
    setValidTargets([])

    // Run validation to show existing conflicts
    const existingErrors = validateFullSchedule(selectedResult, generation.stats)
    const conflicts = existingErrors.filter(
      e => e.type === 'grade_conflict' || e.type === 'subject_conflict'
    )
    setValidationErrors(conflicts)
  }

  function exitSwapMode() {
    setSwapMode(false)
    setSelectedCell(null)
    setValidTargets([])
    setHighlightedCells([])
    setSwapWorkingSchedules(null)
    setSwapCount(0)
    setValidationErrors([])
    setForceCreateNew(null)
    if (highlightTimeout) clearTimeout(highlightTimeout)
  }

  async function handleApplySwap(createNew: boolean = false) {
    if (!generation || !selectedResult || !swapWorkingSchedules || swapCount === 0) return

    const optionIndex = parseInt(viewingOption) - 1

    // Save current state for undo
    const previousOptions: ScheduleOption[] = JSON.parse(JSON.stringify(generation.options))
    const previousSelectedOption = viewingOption

    // Rebuild gradeSchedules from teacherSchedules to ensure consistency
    // This also fixes any previously corrupted data with phantom grade keys
    const rebuiltGradeSchedules = rebuildGradeSchedules(
      swapWorkingSchedules.teacherSchedules,
      generation.stats?.grades_snapshot,
      selectedResult.gradeSchedules
    )

    const updatedOption: ScheduleOption = recalculateOptionStats({
      ...selectedResult,
      teacherSchedules: swapWorkingSchedules.teacherSchedules,
      gradeSchedules: rebuiltGradeSchedules,
      studyHallAssignments: swapWorkingSchedules.studyHallAssignments,
    })

    // Define the save function to pass to validation modal
    const doSave = async () => {
      let updatedOptions: ScheduleOption[]
      let successMessage: string
      let newOptionNumber: string | null = null

      updatedOption.updatedAt = new Date().toISOString()
      if (createNew) {
        const newLabel = getNextLabel(generation.options)
        updatedOption.label = newLabel
        updatedOptions = [...generation.options, updatedOption]
        successMessage = `Saved ${swapCount} swap${swapCount !== 1 ? 's' : ''} as Version ${newLabel}`
        newOptionNumber = (generation.options.length + 1).toString()
      } else {
        updatedOptions = [...generation.options]
        updatedOptions[optionIndex] = updatedOption
        const isPrimary = (generation.selected_option || 1) === optionIndex + 1
        const displayName = isPrimary ? 'Published' : `Version ${generation.options[optionIndex]?.label || viewingOption}`
        successMessage = `Applied ${swapCount} swap${swapCount !== 1 ? 's' : ''} to ${displayName}`
      }

      try {
        const newOptionNum = newOptionNumber ? parseInt(newOptionNumber) : null
        const updateRes = await fetch(`/api/history/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            options: updatedOptions,
            ...(newOptionNum && { selected_option: newOptionNum }),
          }),
        })

        if (updateRes.ok) {
          setGeneration({
            ...generation,
            options: updatedOptions,
            ...(newOptionNum && { selected_option: newOptionNum }),
          })
          if (newOptionNumber) {
            setViewingOption(newOptionNumber)
          }
          exitSwapMode()

          // Dismiss previous undo toast
          if (undoToastId.current) toast.dismiss(undoToastId.current)

          const toastId = toast(
            (t) => (
              <div className="flex items-center gap-3">
                <span className="text-sm">{successMessage}</span>
                <button
                  onClick={async () => {
                    toast.dismiss(t.id)
                    undoToastId.current = null
                    try {
                      const undoRes = await fetch(`/api/history/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ options: previousOptions }),
                      })
                      if (undoRes.ok) {
                        setGeneration((prev) => prev ? { ...prev, options: previousOptions } : prev)
                        setViewingOption(previousSelectedOption)
                        toast("Changes undone", { icon: successIcon })
                      } else {
                        toast.error("Failed to undo")
                      }
                    } catch {
                      toast.error("Failed to undo")
                    }
                  }}
                  className="px-2 py-1 text-sm font-medium text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded transition-colors"
                >
                  Undo
                </button>
              </div>
            ),
            {
              duration: 60000,
              icon: successIcon,
            }
          )
          undoToastId.current = toastId
        } else {
          toast.error("Failed to save swaps")
        }
      } catch (error) {
        console.error('Apply swap error:', error)
        toast.error("Failed to save swaps")
      }
    }

    // Run validation with visual modal, then save if passed
    runValidationWithModal(updatedOption, generation.stats, doSave)
  }

  // Highlight cells after a successful swap to show where things landed
  function highlightCells(cells: CellLocation[]) {
    // Clear any existing timeout
    if (highlightTimeout) clearTimeout(highlightTimeout)

    setHighlightedCells(cells)

    // Clear highlights after 3 seconds
    const timeout = setTimeout(() => {
      setHighlightedCells([])
    }, 3000)
    setHighlightTimeout(timeout)
  }

  // Show swap success toast with undo option
  // Pass previousOptions directly to avoid React closure issues with state
  function showSwapSuccessToast(message: string, destinationCells: CellLocation[], previousOptions: ScheduleOption[]) {
    highlightCells(destinationCells)

    // Dismiss previous undo toast
    if (undoToastId.current) toast.dismiss(undoToastId.current)

    const toastId = toast(
      (t) => (
        <div className="flex items-center gap-3">
          <span className="text-sm">{message}</span>
          <button
            onClick={async () => {
              toast.dismiss(t.id)
              undoToastId.current = null
              // Undo inline using the captured previousOptions
              try {
                const updateRes = await fetch(`/api/history/${id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ options: previousOptions }),
                })

                if (updateRes.ok) {
                  setGeneration((prev) => prev ? { ...prev, options: previousOptions } : prev)
                  setHighlightedCells([])
                  toast("Swap undone", { icon: successIcon })
                } else {
                  toast.error("Failed to undo swap")
                }
              } catch (error) {
                console.error('Undo error:', error)
                toast.error("Failed to undo swap")
              }
            }}
            className="px-2 py-1 text-sm font-medium text-violet-600 hover:text-violet-800 hover:bg-violet-50 rounded transition-colors"
          >
            Undo
          </button>
        </div>
      ),
      {
        duration: 60000,
        icon: successIcon,
      }
    )
    undoToastId.current = toastId
  }

  // Freeform mode functions
  function enterFreeformMode(skipChangesCheck = false) {
    if (!selectedResult || !generation) return

    // If changes detected and not dismissed, show dialog first
    if (!skipChangesCheck && optionNeedsChanges && !dismissedForOptions.has(viewingOption)) {
      setPendingModeEntry('freeform')
      setShowChangesDialog(true)
      return
    }

    // Use snapshot classes for validation (not live DB)
    if (!hasValidSnapshots(generation.stats)) {
      toast.error("This schedule is missing snapshot data and cannot be edited")
      return
    }

    setFreeformMode(true)
    setSwapMode(false)
    setShowingPreview(true)
    setWorkingSchedules(JSON.parse(JSON.stringify({
      teacherSchedules: selectedResult.teacherSchedules,
      gradeSchedules: selectedResult.gradeSchedules
    })))
    setFloatingBlocks([])
    setPendingPlacements([])
    setSelectedFloatingBlock(null)
    setPendingTransfers([])

    // Parse classes from snapshot for validation
    const classes = parseClassesFromSnapshot(generation.stats!.classes_snapshot!)
    setFreeformClasses(classes)

    // Run validation on the current schedule to show any existing conflicts
    // This helps users know what issues exist when entering freeform mode
    const existingErrors = validateFullSchedule(selectedResult, generation.stats)
    // Filter to only show grade/subject conflicts (the actionable ones in freeform)
    const conflicts = existingErrors.filter(
      e => e.type === 'grade_conflict' || e.type === 'subject_conflict'
    )
    setValidationErrors(conflicts)
  }

  function exitFreeformMode() {
    setFreeformMode(false)
    setFloatingBlocks([])
    setPendingPlacements([])
    setSelectedFloatingBlock(null)
    setValidationErrors([])
    setWorkingSchedules(null)
    setFreeformClasses(null)
    setPendingTransfers([])
    setConflictResolution(null)
    // Reset study hall stripping state
    setStudyHallsStripped(false)
    setStrippedStudyHalls([])
    setForceCreateNew(null)
  }

  /**
   * Strip all Study Halls from the working schedule, converting them to OPEN.
   * Stores the original positions so they can be restored later.
   */
  function handleStripStudyHalls() {
    if (!workingSchedules) return

    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
    const stripped: typeof strippedStudyHalls = []
    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))

    for (const [teacher, schedule] of Object.entries(newTeacherSchedules) as [string, TeacherSchedule][]) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (entry && isStudyHall(entry[1])) {
            // Store the position and grade
            stripped.push({
              teacher,
              day,
              block,
              grade: entry[0]
            })
            // Convert to OPEN
            schedule[day][block] = ["", "OPEN"]
          }
        }
      }
    }

    // Rebuild grade schedules from the modified teacher schedules
    const newGradeSchedules = rebuildGradeSchedules(
      newTeacherSchedules,
      generation?.stats?.grades_snapshot,
      workingSchedules.gradeSchedules
    )

    setStrippedStudyHalls(stripped)
    setStudyHallsStripped(true)
    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })
    setValidationErrors([])
    toast(`Stripped ${stripped.length} Study Hall${stripped.length !== 1 ? 's' : ''} (will be reassigned on save)`, { icon: successIcon })
  }

  /**
   * Restore stripped Study Halls to their original positions.
   */
  function handleRestoreStudyHalls() {
    if (!workingSchedules || strippedStudyHalls.length === 0) return

    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))

    for (const sh of strippedStudyHalls) {
      if (newTeacherSchedules[sh.teacher]?.[sh.day]) {
        // Only restore if the slot is still OPEN
        const currentEntry = newTeacherSchedules[sh.teacher][sh.day][sh.block]
        if (!currentEntry || isOpenBlock(currentEntry[1])) {
          newTeacherSchedules[sh.teacher][sh.day][sh.block] = [sh.grade, "Study Hall"]
        }
      }
    }

    // Rebuild grade schedules
    const newGradeSchedules = rebuildGradeSchedules(
      newTeacherSchedules,
      generation?.stats?.grades_snapshot,
      workingSchedules.gradeSchedules
    )

    setStrippedStudyHalls([])
    setStudyHallsStripped(false)
    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })
    setValidationErrors([])
    toast("Study Halls restored", { icon: successIcon })
  }

  function handlePickUpBlock(location: CellLocation) {
    if (!workingSchedules || !location.grade || !location.subject) return

    const entry = workingSchedules.teacherSchedules[location.teacher]?.[location.day]?.[location.block]
    if (!entry || isOpenBlock(entry[1])) return

    // Check if this cell has already been picked up
    const alreadyPickedUp = floatingBlocks.some(b =>
      b.sourceTeacher === location.teacher &&
      b.sourceDay === location.day &&
      b.sourceBlock === location.block
    )
    if (alreadyPickedUp) return

    const blockId = `${location.teacher}-${location.day}-${location.block}-${Date.now()}`
    const block: FloatingBlock = {
      id: blockId,
      sourceTeacher: location.teacher,
      sourceDay: location.day,
      sourceBlock: location.block,
      grade: entry[0],
      subject: entry[1],
      entry,
      isDisplaced: false  // Manually picked up = intentional
    }

    setFloatingBlocks(prev => [...prev, block])

    // Update working schedules - set cell to OPEN
    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))

    newTeacherSchedules[location.teacher][location.day][location.block] = [entry[0], BLOCK_TYPE_OPEN]

    // Remove from grade schedule (works for both classes and study halls)
    if (newGradeSchedules[entry[0]]?.[location.day]?.[location.block]) {
      newGradeSchedules[entry[0]][location.day][location.block] = null
    }

    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })
    setSelectedFloatingBlock(blockId)

    // Clear any previous validation errors and conflict resolution
    setValidationErrors([])
    setConflictResolution(null)
  }

  // Core placement logic - places a block at a location, handling displaced content
  function doPlaceBlock(block: FloatingBlock, location: CellLocation) {
    if (!workingSchedules) return

    // Create a single copy of schedules for all modifications
    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))

    // Check if the target location has a class/study hall that we need to pick up
    const targetEntry = newTeacherSchedules[location.teacher]?.[location.day]?.[location.block]
    let newFloatingBlock: FloatingBlock | null = null

    if (targetEntry && isOccupiedBlock(targetEntry[1])) {
      // Check this cell hasn't already been picked up
      const alreadyPickedUp = floatingBlocks.some(b =>
        b.sourceTeacher === location.teacher &&
        b.sourceDay === location.day &&
        b.sourceBlock === location.block
      )

      if (!alreadyPickedUp) {
        // Create a new floating block for the displaced content
        const newBlockId = `${location.teacher}-${location.day}-${location.block}-${Date.now()}`
        newFloatingBlock = {
          id: newBlockId,
          sourceTeacher: location.teacher,
          sourceDay: location.day,
          sourceBlock: location.block,
          grade: targetEntry[0],
          subject: targetEntry[1],
          entry: targetEntry,
          isDisplaced: true  // Picked up via chain = displaced
        }
        // Note: Don't update gradeSchedules directly - it will be rebuilt from teacherSchedules on save
      }
    }

    // Check if the selected block was already placed somewhere else
    const existingPlacement = pendingPlacements.find(p => p.blockId === block.id)
    if (existingPlacement) {
      // Restore OPEN at old placement location
      const oldEntry = newTeacherSchedules[existingPlacement.teacher][existingPlacement.day][existingPlacement.block]
      if (oldEntry) {
        newTeacherSchedules[existingPlacement.teacher][existingPlacement.day][existingPlacement.block] = [oldEntry[0], BLOCK_TYPE_OPEN]
      }
      // Note: Don't update gradeSchedules directly - it will be rebuilt from teacherSchedules on save
    }

    // Place the selected block at new location (teacherSchedules only - gradeSchedules rebuilt on save)
    newTeacherSchedules[location.teacher][location.day][location.block] = block.entry

    // Note: We intentionally do NOT update gradeSchedules during freeform mode
    // This prevents creating phantom grade keys like "6th-7th Grade"
    // gradeSchedules will be properly rebuilt from teacherSchedules on save

    // Update state (gradeSchedules unchanged during freeform - rebuilt on save)
    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })

    // Update placements — capture what was in the cell before so we can restore it later
    const prevEntry = targetEntry && !isOccupiedBlock(targetEntry[1]) ? targetEntry : null
    if (existingPlacement) {
      setPendingPlacements(prev => [
        ...prev.filter(p => p.blockId !== block.id),
        { blockId: block.id, teacher: location.teacher, day: location.day, block: location.block, previousEntry: prevEntry }
      ])
    } else {
      setPendingPlacements(prev => [...prev, {
        blockId: block.id,
        teacher: location.teacher,
        day: location.day,
        block: location.block,
        previousEntry: prevEntry
      }])
    }

    // Add the displaced block to floating blocks and select it
    if (newFloatingBlock) {
      setFloatingBlocks(prev => [...prev, newFloatingBlock!])
      setSelectedFloatingBlock(newFloatingBlock.id)
    } else {
      setSelectedFloatingBlock(null)
    }

    // Clear validation errors and conflict resolution
    setValidationErrors([])
    setConflictResolution(null)
  }

  function handlePlaceBlock(location: CellLocation) {
    if (!selectedFloatingBlock || !workingSchedules) return

    const block = floatingBlocks.find(b => b.id === selectedFloatingBlock)
    if (!block) return

    // Check for cross-teacher class placement — always prompt for transfer
    // even if target teacher already has that class (their session count still needs updating)
    if (effectiveFreeformClasses && isScheduledClass(block.subject) && location.teacher !== block.sourceTeacher) {
      // Count total blocks the source teacher currently has for this class
      const classDef = effectiveFreeformClasses.find(cls =>
        cls.teacher === block.sourceTeacher && cls.subject === block.subject && gradesEqual(cls.gradeDisplay || cls.grade, block.grade)
      )
      const totalBlocks = classDef?.daysPerWeek ?? 1

      setTransferModal({ block, location, totalBlocks })
      return  // Don't place yet — wait for modal confirmation
    }

    doPlaceBlock(block, location)
  }

  function handleReturnBlock(blockId: string) {
    const block = floatingBlocks.find(b => b.id === blockId)
    if (!block || !workingSchedules) return

    // Check if this block was placed
    const placement = pendingPlacements.find(p => p.blockId === blockId)

    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))

    // If it was placed, restore the cell to what was there before placement
    if (placement) {
      newTeacherSchedules[placement.teacher][placement.day][placement.block] = placement.previousEntry || [block.grade, BLOCK_TYPE_OPEN]
      // Skip gradeSchedules update - rebuilt on save
      setPendingPlacements(prev => prev.filter(p => p.blockId !== blockId))
    }

    // Check if the original location is now occupied by another placed block
    const occupyingPlacement = pendingPlacements.find(
      p => p.teacher === block.sourceTeacher && p.day === block.sourceDay && p.block === block.sourceBlock
    )

    if (occupyingPlacement) {
      // Find the floating block that was placed there
      const occupyingBlock = floatingBlocks.find(b => b.id === occupyingPlacement.blockId)
      if (occupyingBlock) {
        // Skip gradeSchedules update - rebuilt on save
        // Remove its placement - it becomes unplaced again (stays in floatingBlocks)
        setPendingPlacements(prev => prev.filter(p => p.blockId !== occupyingPlacement.blockId))
      }
    }

    // Restore to original location (teacherSchedules only - gradeSchedules rebuilt on save)
    newTeacherSchedules[block.sourceTeacher][block.sourceDay][block.sourceBlock] = block.entry
    // Skip gradeSchedules update - this prevents creating phantom grade keys

    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })

    // Remove the returned block from floating blocks (displaced block stays with its original source info)
    setFloatingBlocks(prev => prev.filter(b => b.id !== blockId))

    // Clear selection if we were selecting the returned block
    if (selectedFloatingBlock === blockId) {
      setSelectedFloatingBlock(null)
    }

    // Clear transfer if no blocks of this class remain placed on or floating toward the target teacher
    if (pendingTransfers.length > 0 && block.sourceTeacher) {
      const transfer = pendingTransfers.find(r =>
        r.fromTeacher === block.sourceTeacher && r.subject === block.subject && r.grade === block.grade
      )
      if (transfer) {
        // Check if any other blocks of this class are still placed on the target teacher
        const otherPlacedOnTarget = pendingPlacements.filter(p => {
          if (p.blockId === blockId) return false // exclude the one we just returned
          const fb = floatingBlocks.find(b => b.id === p.blockId)
          return fb && fb.subject === block.subject && fb.grade === block.grade && p.teacher === transfer.toTeacher
        })
        // Also check for unplaced floating blocks transferred to the target teacher
        const otherFloatingToTarget = floatingBlocks.filter(b => {
          if (b.id === blockId) return false // exclude the one we just returned
          return b.subject === block.subject && b.grade === block.grade &&
            b.transferredTo === transfer.toTeacher &&
            !pendingPlacements.some(p => p.blockId === b.id)
        })
        if (otherPlacedOnTarget.length === 0 && otherFloatingToTarget.length === 0) {
          setPendingTransfers(prev => prev.filter(r => r.id !== transfer.id))
        }
      }
    }

    // Clear validation errors
    setValidationErrors([])
  }

  function handleReturnTransferClick(block: FloatingBlock) {
    if (!block.transferredTo) {
      handleReturnBlock(block.id)
      return
    }

    // Count how many blocks of this class are associated with the target teacher
    // (both placed on target and floating with transferredTo)
    const targetTeacher = block.transferredTo
    const matchingBlocks = floatingBlocks.filter(b =>
      b.subject === block.subject && b.grade === block.grade &&
      b.sourceTeacher === block.sourceTeacher && (
        b.transferredTo === targetTeacher ||
        pendingPlacements.some(p => p.blockId === b.id && p.teacher === targetTeacher)
      )
    )

    setReturnTransferModal({
      block,
      totalBlocks: matchingBlocks.length,
    })
  }

  function handleReturnAllTransferred(block: FloatingBlock) {
    if (!block.transferredTo || !workingSchedules) return

    const targetTeacher = block.transferredTo
    // Find all floating blocks of this class that originated from the same source teacher
    // and are associated with the target teacher (via transferredTo or placement)
    const matchingBlocks = floatingBlocks.filter(b =>
      b.subject === block.subject && b.grade === block.grade &&
      b.sourceTeacher === block.sourceTeacher && (
        b.transferredTo === targetTeacher ||
        pendingPlacements.some(p => p.blockId === b.id && p.teacher === targetTeacher)
      )
    )

    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))
    const placementsToRemove = new Set<string>()
    const blocksToRemove = new Set<string>()

    for (const b of matchingBlocks) {
      const placement = pendingPlacements.find(p => p.blockId === b.id)

      // If placed, restore the cell to what was there before placement
      if (placement) {
        newTeacherSchedules[placement.teacher][placement.day][placement.block] = placement.previousEntry || [b.grade, BLOCK_TYPE_OPEN]
        if (newGradeSchedules[b.grade]?.[placement.day]?.[placement.block]) {
          newGradeSchedules[b.grade][placement.day][placement.block] = null
        }
        placementsToRemove.add(b.id)
      }

      // Check if original location is occupied by another placed block
      const occupyingPlacement = pendingPlacements.find(
        p => p.teacher === b.sourceTeacher && p.day === b.sourceDay && p.block === b.sourceBlock && !placementsToRemove.has(p.blockId)
      )
      if (occupyingPlacement) {
        // Remove that placement — it becomes unplaced floating
        placementsToRemove.add(occupyingPlacement.blockId)
      }

      // Restore to original location
      newTeacherSchedules[b.sourceTeacher][b.sourceDay][b.sourceBlock] = b.entry
      blocksToRemove.add(b.id)
    }

    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })
    setPendingPlacements(prev => prev.filter(p => !placementsToRemove.has(p.blockId)))
    setFloatingBlocks(prev => prev.filter(b => !blocksToRemove.has(b.id)))

    // Clear selection if it was one of the returned blocks
    if (selectedFloatingBlock && blocksToRemove.has(selectedFloatingBlock)) {
      setSelectedFloatingBlock(null)
    }

    // Clear the transfer
    const transfer = pendingTransfers.find(r =>
      r.fromTeacher === block.sourceTeacher && r.subject === block.subject && r.grade === block.grade
    )
    if (transfer) {
      setPendingTransfers(prev => prev.filter(r => r.id !== transfer.id))
    }

    setValidationErrors([])
  }

  function handleUnplaceBlock(blockId: string) {
    const block = floatingBlocks.find(b => b.id === blockId)
    const placement = pendingPlacements.find(p => p.blockId === blockId)
    if (!block || !placement || !workingSchedules) return

    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))

    // Restore the cell to what was there before placement
    newTeacherSchedules[placement.teacher][placement.day][placement.block] = placement.previousEntry || [block.grade, BLOCK_TYPE_OPEN]
    if (newGradeSchedules[block.grade]?.[placement.day]?.[placement.block]) {
      newGradeSchedules[block.grade][placement.day][placement.block] = null
    }

    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })
    setPendingPlacements(prev => prev.filter(p => p.blockId !== blockId))

    // If unplacing from a cross-teacher placement (via transfer), mark the floating block
    // so it shows under the target teacher instead of the source teacher
    if (placement.teacher !== block.sourceTeacher) {
      setFloatingBlocks(prev => prev.map(b =>
        b.id === blockId ? { ...b, transferredTo: placement.teacher } : b
      ))
    }

    setSelectedFloatingBlock(blockId)

    // Clear validation errors
    setValidationErrors([])
  }

  function handleSelectFloatingBlock(blockId: string) {
    // If block is already placed, don't allow selection
    const isPlaced = pendingPlacements.some(p => p.blockId === blockId)
    if (isPlaced) return

    setSelectedFloatingBlock(blockId === selectedFloatingBlock ? null : blockId)
  }

  /**
   * Find what's BLOCKING our intentional placements
   * Returns the blocking classes that need to be moved (not our placements)
   */
  function findBlockers(
    schedules: { teacherSchedules: Record<string, TeacherSchedule>; gradeSchedules: Record<string, GradeSchedule> },
    placedBlocks: Array<{ block: FloatingBlock; placement: PendingPlacement }>
  ): Array<{
    blocker: { teacher: string; day: string; block: number; grade: string; subject: string; entry: [string, string] }
    blockedPlacement: PendingPlacement
    reason: string
  }> {
    const blockers: Array<{
      blocker: { teacher: string; day: string; block: number; grade: string; subject: string; entry: [string, string] }
      blockedPlacement: PendingPlacement
      reason: string
    }> = []
    const seenBlockers = new Set<string>() // Avoid duplicates

    for (const { block, placement } of placedBlocks) {
      const { day, block: blockNum } = placement

      // Check grade conflict - find the OTHER class that has the same grade at this time
      // Use gradesOverlap() to handle multi-grade classes like "6th-11th Grade"
      // In freeform mode, Study Halls are legitimate blocks (just another class)
      // Exception: Two electives can share slots (use shouldIgnoreGradeConflict helper)
      const classesSnapshot = generation?.stats?.classes_snapshot
      for (const [teacher, sched] of Object.entries(schedules.teacherSchedules)) {
        if (teacher === placement.teacher) continue // Skip our placement
        const entry = (sched as TeacherSchedule)[day]?.[blockNum]
        if (entry && gradesOverlap(entry[0], block.grade) && isOccupiedBlock(entry[1])) {
          // Skip if both classes are electives (they can share the slot)
          if (shouldIgnoreGradeConflict(teacher, entry[1], block.sourceTeacher || placement.teacher, block.subject, classesSnapshot)) {
            continue
          }
          const key = `${teacher}-${day}-${blockNum}`
          if (!seenBlockers.has(key)) {
            seenBlockers.add(key)
            blockers.push({
              blocker: { teacher, day, block: blockNum, grade: entry[0], subject: entry[1], entry },
              blockedPlacement: placement,
              reason: `${entry[0]} ${entry[1]} conflicts with ${block.grade} at same time`
            })
          }
        }
      }

      // Check subject conflict - find the OTHER class that has same subject on same day for same grade
      // Use gradesOverlap() to handle multi-grade classes
      for (const [teacher, sched] of Object.entries(schedules.teacherSchedules)) {
        for (let b = 1; b <= 5; b++) {
          if (teacher === placement.teacher && b === blockNum) continue // Skip our placement
          const entry = (sched as TeacherSchedule)[day]?.[b]
          if (entry && gradesOverlap(entry[0], block.grade) && entry[1] === block.subject) {
            const key = `${teacher}-${day}-${b}`
            if (!seenBlockers.has(key)) {
              seenBlockers.add(key)
              blockers.push({
                blocker: { teacher, day, block: b, grade: entry[0], subject: entry[1], entry },
                blockedPlacement: placement,
                reason: `${entry[0]} already has ${entry[1]} on ${day}`
              })
            }
          }
        }
      }
    }

    return blockers
  }

  /**
   * Try to fix conflicts by moving BLOCKING classes to new positions
   * Our intentional placements stay where they are
   */
  function findConflictResolution(
    schedules: { teacherSchedules: Record<string, TeacherSchedule>; gradeSchedules: Record<string, GradeSchedule> },
    blockers: Array<{
      blocker: { teacher: string; day: string; block: number; grade: string; subject: string; entry: [string, string] }
      blockedPlacement: PendingPlacement
      reason: string
    }>,
    seed: number = 0,
    classes?: ClassEntry[] // Pass freeformClasses to check restrictions
  ): {
    movedBlockers: Array<{ from: { teacher: string; day: string; block: number }; to: { teacher: string; day: string; block: number }; grade: string; subject: string }>
    schedules: typeof schedules
  } | null {
    if (blockers.length === 0) return null

    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
    const BLOCKS = [1, 2, 3, 4, 5]

    // Deep copy schedules
    const newTeacherSchedules = JSON.parse(JSON.stringify(schedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(schedules.gradeSchedules))

    // Build a map of class restrictions for quick lookup
    const classRestrictions = new Map<string, {
      availableDays?: string[]
      availableBlocks?: number[]
      fixedSlots?: [string, number][]
    }>()
    if (classes) {
      for (const cls of classes) {
        if (cls.teacher && cls.subject) {
          const key = `${cls.teacher}|${cls.subject}`
          // Merge restrictions if same teacher+subject has multiple entries (different grades)
          const existing = classRestrictions.get(key)
          if (existing) {
            // Take the most restrictive (intersection) for days/blocks
            if (cls.availableDays && existing.availableDays) {
              existing.availableDays = existing.availableDays.filter(d => cls.availableDays!.includes(d))
            } else if (cls.availableDays) {
              existing.availableDays = cls.availableDays
            }
            if (cls.availableBlocks && existing.availableBlocks) {
              existing.availableBlocks = existing.availableBlocks.filter(b => cls.availableBlocks!.includes(b))
            } else if (cls.availableBlocks) {
              existing.availableBlocks = cls.availableBlocks
            }
            if (cls.fixedSlots) {
              existing.fixedSlots = [...(existing.fixedSlots || []), ...cls.fixedSlots]
            }
          } else {
            classRestrictions.set(key, {
              availableDays: cls.availableDays,
              availableBlocks: cls.availableBlocks,
              fixedSlots: cls.fixedSlots
            })
          }
        }
      }
    }

    // Clear blockers from their current positions (only in teacherSchedules - gradeSchedules will be rebuilt)
    for (const { blocker } of blockers) {
      newTeacherSchedules[blocker.teacher][blocker.day][blocker.block] = [blocker.grade, BLOCK_TYPE_OPEN]
    }

    // Helper: check if a placement is valid for a blocker being moved
    function isValidPlacement(grade: string, subject: string, day: string, blockNum: number, teacher: string): boolean {
      // Check if slot is occupied (by a non-OPEN class)
      const currentEntry = newTeacherSchedules[teacher]?.[day]?.[blockNum]
      if (currentEntry && isOccupiedBlock(currentEntry[1])) return false

      // Check class restrictions (availableDays, availableBlocks)
      const restrictionKey = `${teacher}|${subject}`
      const restrictions = classRestrictions.get(restrictionKey)
      if (restrictions) {
        // Check available days
        if (restrictions.availableDays && restrictions.availableDays.length > 0) {
          if (!restrictions.availableDays.includes(day)) {
            return false
          }
        }
        // Check available blocks
        if (restrictions.availableBlocks && restrictions.availableBlocks.length > 0) {
          if (!restrictions.availableBlocks.includes(blockNum)) {
            return false
          }
        }
        // Note: We don't enforce fixedSlots here - those are for specific placements
        // Moving a class away from its fixed slot would be caught by validation
      }

      // Check grade conflict - overlapping grade at same time on another teacher
      // Uses global gradesOverlap() helper for multi-grade class detection
      // Exception: Two electives can share slots (use shouldIgnoreGradeConflict)
      const classesSnapshot = generation?.stats?.classes_snapshot
      for (const [t, sched] of Object.entries(newTeacherSchedules)) {
        const entry = (sched as TeacherSchedule)[day]?.[blockNum]
        if (entry && isOccupiedBlock(entry[1])) {
          if (gradesOverlap(entry[0], grade)) {
            // Check if both are electives (they can share the slot)
            if (!shouldIgnoreGradeConflict(t, entry[1], teacher, subject, classesSnapshot)) {
              return false
            }
          }
        }
      }

      // Check subject conflict - same subject on same day for overlapping grade
      for (const [, sched] of Object.entries(newTeacherSchedules)) {
        for (let b = 1; b <= 5; b++) {
          if (b === blockNum) continue
          const entry = (sched as TeacherSchedule)[day]?.[b]
          if (entry && entry[1] === subject && gradesOverlap(entry[0], grade)) {
            return false
          }
        }
      }

      return true
    }

    // Seeded random shuffle
    function shuffle<T>(arr: T[], s: number): T[] {
      const result = [...arr]
      let rand = s
      for (let i = result.length - 1; i > 0; i--) {
        rand = (rand * 1103515245 + 12345) & 0x7fffffff
        const j = rand % (i + 1)
        ;[result[i], result[j]] = [result[j], result[i]]
      }
      return result
    }

    // Get valid slots for each blocker (must stay on same teacher)
    const blockersWithSlots = blockers.map(({ blocker }) => {
      const slots: Array<{ day: string; block: number }> = []
      for (const day of DAYS) {
        for (const blockNum of BLOCKS) {
          if (isValidPlacement(blocker.grade, blocker.subject, day, blockNum, blocker.teacher)) {
            slots.push({ day, block: blockNum })
          }
        }
      }
      return { blocker, validSlots: slots }
    }).sort((a, b) => a.validSlots.length - b.validSlots.length)

    // Check if any blocker has no valid slots
    if (blockersWithSlots.some(b => b.validSlots.length === 0)) {
      return null
    }

    const movedBlockers: Array<{ from: { teacher: string; day: string; block: number }; to: { teacher: string; day: string; block: number }; grade: string; subject: string }> = []

    // Try to place each blocker in a new position
    for (const { blocker, validSlots } of blockersWithSlots) {
      const shuffledSlots = shuffle(validSlots, seed + movedBlockers.length)

      let placed = false
      for (const slot of shuffledSlots) {
        if (!isValidPlacement(blocker.grade, blocker.subject, slot.day, slot.block, blocker.teacher)) continue

        // Place the blocker at the new position (only in teacherSchedules - gradeSchedules will be rebuilt)
        newTeacherSchedules[blocker.teacher][slot.day][slot.block] = blocker.entry

        movedBlockers.push({
          from: { teacher: blocker.teacher, day: blocker.day, block: blocker.block },
          to: { teacher: blocker.teacher, day: slot.day, block: slot.block },
          grade: blocker.grade,
          subject: blocker.subject
        })

        placed = true
        break
      }

      if (!placed) {
        return null
      }
    }

    return {
      movedBlockers,
      schedules: { teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules }
    }
  }

  function handleCheckAndFix(singleConflictBlockId?: string) {
    if (!workingSchedules) return

    // Get all placed floating blocks
    const placedBlocks = pendingPlacements.map(p => {
      const block = floatingBlocks.find(b => b.id === p.blockId)
      return block ? { block, placement: p } : null
    }).filter((b): b is { block: FloatingBlock; placement: PendingPlacement } => b !== null)

    if (placedBlocks.length === 0) {
      toast.error("No blocks have been placed yet")
      return
    }

    let blockers: Array<{
      blocker: { teacher: string; day: string; block: number; grade: string; subject: string; entry: [string, string] }
      blockedPlacement: PendingPlacement
      reason: string
    }>

    if (singleConflictBlockId) {
      // For single conflict, use placementConflicts directly to get the exact blocker
      const conflict = placementConflicts.find(c => c.blockId === singleConflictBlockId)
      if (!conflict) {
        toast.error("Could not find the specified conflict")
        return
      }

      // Get the blocker info from the conflict - use conflictingBlock for the exact position
      const blockerEntry = workingSchedules.teacherSchedules[conflict.conflictingTeacher]?.[conflict.placement.day]?.[conflict.conflictingBlock]
      if (!blockerEntry || !isScheduledClass(blockerEntry[1])) {
        toast.error("Blocker no longer exists at that position")
        return
      }

      blockers = [{
        blocker: {
          teacher: conflict.conflictingTeacher,
          day: conflict.placement.day,
          block: conflict.conflictingBlock,
          grade: blockerEntry[0],
          subject: blockerEntry[1],
          entry: blockerEntry
        },
        blockedPlacement: conflict.placement,
        reason: conflict.reason
      }]
    } else {
      // For "Fix All", use findBlockers to get all blockers
      const allBlockers = findBlockers(workingSchedules, placedBlocks)

      if (allBlockers.length === 0) {
        toast("No conflicts found!", { icon: successIcon })
        setValidationErrors([])
        return
      }

      blockers = allBlockers
    }

    // Try to fix by moving blockers to new positions
    const attemptIndex = conflictResolution ? conflictResolution.attemptIndex + 1 : 0

    // If no blockers, still show the UI with empty movedBlockers for consistency
    if (blockers.length === 0) {
      // Create a preview of the current state with pending placements applied
      const previewSchedules = JSON.parse(JSON.stringify(workingSchedules))

      // Apply pending placements to the preview
      for (const { block, placement } of placedBlocks) {
        previewSchedules.teacherSchedules[placement.teacher][placement.day][placement.block] = [
          block.grade,
          block.subject
        ]
      }

      // Rebuild grade schedules
      previewSchedules.gradeSchedules = rebuildGradeSchedules(
        previewSchedules.teacherSchedules,
        generation?.stats?.grades_snapshot,
        workingSchedules.gradeSchedules
      )

      setConflictResolution({
        movedBlockers: [],
        blockersList: [],
        schedules: previewSchedules,
        attemptIndex
      })
      setValidationErrors([])
      return
    }

    const result = findConflictResolution(
      workingSchedules,
      blockers,
      attemptIndex * 17 + Date.now() % 1000,
      effectiveFreeformClasses || undefined
    )

    if (!result) {
      const msg = singleConflictBlockId
        ? "Couldn't find an alternative position for this conflict. The blocking class may have day/block restrictions."
        : `Found ${blockers.length} blocking class${blockers.length !== 1 ? 'es' : ''} but couldn't find alternative positions (may have restrictions).`
      toast.error(msg)
      // Only update validation errors for unfixable ones
      if (!singleConflictBlockId) {
        setValidationErrors(blockers.map(b => ({
          type: 'grade_conflict' as const,
          message: b.reason,
          cells: [{ teacher: b.blocker.teacher, day: b.blocker.day, block: b.blocker.block }],
          blockId: pendingPlacements.find(p => p === b.blockedPlacement)?.blockId
        })))
      }
      return
    }

    setConflictResolution({
      movedBlockers: result.movedBlockers,
      blockersList: blockers,
      schedules: result.schedules,
      attemptIndex
    })

    // Scroll to the first moved blocker's new location
    if (result.movedBlockers.length > 0) {
      const firstMoved = result.movedBlockers[0]
      const teacherId = `teacher-grid-${firstMoved.to.teacher.replace(/\s+/g, '-')}`
      setTimeout(() => {
        const element = document.getElementById(teacherId)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
    }
  }

  function handleTryDifferentFix() {
    if (!conflictResolution || !workingSchedules) return

    // Restore blockers to their original positions and try again with different seed
    const restoredSchedules = JSON.parse(JSON.stringify(workingSchedules))

    // Put blockers back at their original positions
    for (const moved of conflictResolution.movedBlockers) {
      // Clear the new position
      restoredSchedules.teacherSchedules[moved.to.teacher][moved.to.day][moved.to.block] = [moved.grade, BLOCK_TYPE_OPEN]
      // Restore to original position
      const entry: [string, string] = [moved.grade, moved.subject]
      restoredSchedules.teacherSchedules[moved.from.teacher][moved.from.day][moved.from.block] = entry
    }

    const result = findConflictResolution(
      restoredSchedules,
      conflictResolution.blockersList,
      (conflictResolution.attemptIndex + 1) * 17 + Date.now() % 1000,
      effectiveFreeformClasses || undefined
    )

    if (!result) {
      toast.error("No more alternative positions found (may have day/block restrictions)")
      return
    }

    setConflictResolution({
      ...conflictResolution,
      movedBlockers: result.movedBlockers,
      schedules: result.schedules,
      attemptIndex: conflictResolution.attemptIndex + 1
    })

    // Scroll to the first moved blocker's new location
    if (result.movedBlockers.length > 0) {
      const firstMoved = result.movedBlockers[0]
      const teacherId = `teacher-grid-${firstMoved.to.teacher.replace(/\s+/g, '-')}`
      setTimeout(() => {
        const element = document.getElementById(teacherId)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
    }
  }

  function handleAcceptFix() {
    if (!conflictResolution || !workingSchedules) return

    // Store previous state for undo
    const previousSchedules = JSON.parse(JSON.stringify(workingSchedules))
    const movedBlockers = conflictResolution.movedBlockers

    // Apply the new schedules with moved blockers
    setWorkingSchedules(conflictResolution.schedules)

    // pendingPlacements stay the same - we only moved other classes, not our placements
    setConflictResolution(null)
    setValidationErrors([])

    // Build description of what was moved
    const moveDescriptions = movedBlockers.map(m =>
      `${m.grade} ${m.subject} → ${m.to.day} B${m.to.block}`
    ).join(', ')

    // Dismiss any existing undo toast
    if (undoToastId.current) toast.dismiss(undoToastId.current)

    const toastId = toast(
      (t) => (
        <div className="flex items-center gap-3">
          <span className="text-sm">Fixed: {moveDescriptions}</span>
          <button
            onClick={() => {
              toast.dismiss(t.id)
              undoToastId.current = null
              // Restore previous schedules
              setWorkingSchedules(previousSchedules)
              toast("Fix undone", { icon: successIcon })
            }}
            className="px-2 py-1 text-sm font-medium text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded transition-colors"
          >
            Undo
          </button>
        </div>
      ),
      {
        duration: 60000,
        icon: successIcon,
      }
    )
    undoToastId.current = toastId
  }

  function handleUndoFix() {
    if (!conflictResolution || !workingSchedules) return

    // Restore blockers to their original positions
    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))

    // Move blockers back to their original positions
    for (const moved of conflictResolution.movedBlockers) {
      // Clear the new position
      newTeacherSchedules[moved.to.teacher][moved.to.day][moved.to.block] = [moved.grade, BLOCK_TYPE_OPEN]
      if (newGradeSchedules[moved.grade]?.[moved.to.day]?.[moved.to.block]) {
        newGradeSchedules[moved.grade][moved.to.day][moved.to.block] = null
      }
      // Restore to original position (teacherSchedules only - gradeSchedules rebuilt on save)
      const entry: [string, string] = [moved.grade, moved.subject]
      newTeacherSchedules[moved.from.teacher][moved.from.day][moved.from.block] = entry
      // Skip gradeSchedules update - prevents creating phantom grade keys
    }

    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })
    setConflictResolution(null)
    toast("Undo complete - blocking classes restored to original positions", { icon: successIcon })
  }

  // =============================================================================
  // VALIDATION ARCHITECTURE
  // =============================================================================
  //
  // This section contains all schedule validation logic, organized as:
  //
  // 1. SHARED TYPES - Common interfaces used across validation functions
  //
  // 2. CORE VALIDATION FUNCTIONS - Shared logic for checking specific rules
  //    These are pure functions that take teacherSchedules and return errors.
  //    Both validatePlacements() and validateFullSchedule() call these.
  //
  //    - checkGradeConflictsCore()    - No grade has two classes at same time
  //    - checkSubjectConflictsCore()  - No subject twice on same day for a grade
  //    - checkFixedSlotViolationsCore() - Classes with fixed slots are honored
  //    - checkAvailabilityViolationsCore() - Classes within available days/blocks
  //    - validateScheduleConsistency() - Grade names are valid/parseable
  //
  // 3. FREEFORM-SPECIFIC HELPERS - Only used by validatePlacements()
  //    - checkUnplacedBlocks()        - All floating blocks must be placed
  //    - checkStudyHallEligibility()  - Only full-time teachers for study hall
  //    - checkTeacherConflictsPending() - No double-booking in pending placements
  //    - checkCoTaughtClasses()       - Co-taught classes at same time
  //
  // 4. COMPREHENSIVE CHECK HELPERS - Only used by validateFullSchedule() with stats
  //    - checkSessionCounts()         - Correct sessions per class (soft)
  //    - checkUnknownClasses()        - No unmatched schedule entries (soft)
  //    - checkStudyHallCoverage()     - All grades have study halls (soft)
  //    - checkBackToBackIssues()      - Minimize consecutive open blocks (soft)
  //
  // 5. MAIN VALIDATION FUNCTIONS
  //    - validatePlacements()    - Freeform mode, hard constraints only
  //    - validateFullSchedule()  - Save-time, all constraints including soft
  //
  // =============================================================================

  // ---------------------------------------------------------------------------
  // SHARED TYPES
  // ---------------------------------------------------------------------------

  interface ClassAtSlot {
    teacher: string
    subject: string
    gradeDisplay: string
    isElective?: boolean  // Optional - detected from snapshot if not provided
  }

  interface GradeConflict {
    gradeNum: number
    gradeName: string
    nonElectives: Array<{ teacher: string; subject: string; gradeDisplay: string }>
    electives: Array<{ teacher: string; subject: string; gradeDisplay: string }>
    conflictType: 'multiple_non_electives' | 'non_elective_with_electives'
  }

  type ClassesSnapshotItem = { teacher_name: string | null; subject_name: string | null; is_elective?: boolean; is_cotaught?: boolean }

  // ---------------------------------------------------------------------------
  // CORE VALIDATION FUNCTIONS
  // ---------------------------------------------------------------------------

  /**
   * Detect grade conflicts at a single time slot.
   * Expands multi-grade classes (e.g., "6th-11th Grade") to individual grades.
   *
   * Conflict types:
   * - multiple_non_electives: Multiple required classes at same grade/slot
   * - non_elective_with_electives: Required class blocks elective attendance
   * - Multiple electives at same slot is OK (students choose one)
   */
  function detectGradeConflictsAtSlot(
    classesAtSlot: ClassAtSlot[],
    classesSnapshot?: ClassesSnapshotItem[]
  ): GradeConflict[] {
    const conflicts: GradeConflict[] = []

    if (classesAtSlot.length > 1) {
    }

    // Build a map of individual grade number -> classes at this slot
    const gradeTeachers = new Map<number, Array<{ teacher: string; subject: string; gradeDisplay: string; isElective: boolean }>>()

    for (const cls of classesAtSlot) {
      const isElective = cls.isElective ?? isClassElective(cls.teacher, cls.subject, classesSnapshot)
      const gradeNums = parseGradeDisplayToNumbers(cls.gradeDisplay)

      if (classesAtSlot.length > 1) {
        const snapshotMatch = classesSnapshot?.find(c => c.teacher_name === cls.teacher && c.subject_name === cls.subject)
      }

      for (const gradeNum of gradeNums) {
        if (!gradeTeachers.has(gradeNum)) {
          gradeTeachers.set(gradeNum, [])
        }
        gradeTeachers.get(gradeNum)!.push({
          teacher: cls.teacher,
          subject: cls.subject,
          gradeDisplay: cls.gradeDisplay,
          isElective
        })
      }
    }

    for (const [gradeNum, teachers] of gradeTeachers) {
      const nonElectives = teachers.filter(t => !t.isElective)
      const electives = teachers.filter(t => t.isElective)

      if (nonElectives.length > 1) {
        conflicts.push({
          gradeNum,
          gradeName: gradeNumToDisplay(gradeNum),
          nonElectives: nonElectives.map(t => ({ teacher: t.teacher, subject: t.subject, gradeDisplay: t.gradeDisplay })),
          electives: electives.map(t => ({ teacher: t.teacher, subject: t.subject, gradeDisplay: t.gradeDisplay })),
          conflictType: 'multiple_non_electives'
        })
      } else if (nonElectives.length > 0 && electives.length > 0) {
        conflicts.push({
          gradeNum,
          gradeName: gradeNumToDisplay(gradeNum),
          nonElectives: nonElectives.map(t => ({ teacher: t.teacher, subject: t.subject, gradeDisplay: t.gradeDisplay })),
          electives: electives.map(t => ({ teacher: t.teacher, subject: t.subject, gradeDisplay: t.gradeDisplay })),
          conflictType: 'non_elective_with_electives'
        })
      }
    }

    return conflicts
  }

  /**
   * CORE: Check for grade conflicts across all slots in a schedule.
   * Rule: No grade can have two different classes at the same time.
   * (Study halls don't conflict; multiple electives at same slot is OK)
   */
  function checkGradeConflictsCore(
    teacherSchedules: Record<string, TeacherSchedule>,
    classesSnapshot?: ClassesSnapshotItem[]
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    for (const day of DAYS) {
      for (let block = 1; block <= 5; block++) {
        const classesAtSlot: ClassAtSlot[] = []

        for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
          const entry = schedule[day]?.[block]
          if (!entry || !isScheduledClass(entry[1])) continue
          if (isStudyHall(entry[1])) continue  // Study halls don't cause conflicts

          classesAtSlot.push({
            teacher,
            subject: entry[1],
            gradeDisplay: entry[0]
          })
        }

        const conflicts = detectGradeConflictsAtSlot(classesAtSlot, classesSnapshot)
        for (const conflict of conflicts) {

          if (conflict.conflictType === 'multiple_non_electives') {
            errors.push({
              type: 'grade_conflict',
              message: `[Grade Conflict] ${conflict.gradeName} has ${conflict.nonElectives.length} classes at ${day} B${block}: ${conflict.nonElectives.map(t => `${t.teacher}/${t.subject}`).join(', ')}`,
              cells: conflict.nonElectives.map(t => ({ teacher: t.teacher, day, block, grade: conflict.gradeName }))
            })
          } else if (conflict.conflictType === 'non_elective_with_electives') {
            const allInConflict = [...conflict.nonElectives, ...conflict.electives]
            errors.push({
              type: 'grade_conflict',
              message: `[Grade Conflict] ${conflict.gradeName} has required class (${conflict.nonElectives.map(t => `${t.teacher}/${t.subject}`).join(', ')}) conflicting with elective(s) (${conflict.electives.map(t => `${t.teacher}/${t.subject}`).join(', ')}) at ${day} B${block}`,
              cells: allInConflict.map(t => ({ teacher: t.teacher, day, block, grade: conflict.gradeName }))
            })
          }
        }
      }
    }

    return errors
  }

  /**
   * CORE: Check for subject conflicts - same subject twice on same day for a grade.
   * Rule: A grade shouldn't have the same subject at different times on the same day.
   * (Multiple teachers at same block = electives/co-taught, which is valid)
   */
  function checkSubjectConflictsCore(
    teacherSchedules: Record<string, TeacherSchedule>
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    // Group by grade -> day -> subject -> occurrences
    const gradeSubjectsByDay = new Map<string, Map<string, Map<string, Array<{ teacher: string; block: number }>>>>()

    for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (!entry || !isScheduledClass(entry[1])) continue

          const grade = entry[0]
          const subject = entry[1]

          if (!gradeSubjectsByDay.has(grade)) {
            gradeSubjectsByDay.set(grade, new Map())
          }
          const dayMap = gradeSubjectsByDay.get(grade)!
          if (!dayMap.has(day)) {
            dayMap.set(day, new Map())
          }
          const subjectMap = dayMap.get(day)!
          if (!subjectMap.has(subject)) {
            subjectMap.set(subject, [])
          }
          subjectMap.get(subject)!.push({ teacher, block })
        }
      }
    }

    for (const [grade, dayMap] of gradeSubjectsByDay) {
      for (const [day, subjectMap] of dayMap) {
        for (const [subject, occurrences] of subjectMap) {
          const uniqueBlocks = new Set(occurrences.map(o => o.block))
          if (uniqueBlocks.size > 1) {
            errors.push({
              type: 'subject_conflict',
              message: `[Subject Conflict] ${grade} has ${subject} at ${uniqueBlocks.size} different times on ${day}: ${occurrences.map(o => `${o.teacher} B${o.block}`).join(', ')}`,
              cells: occurrences.map(o => ({ teacher: o.teacher, day, block: o.block, grade, subject }))
            })
          }
        }
      }
    }

    return errors
  }

  /**
   * CORE: Check fixed slot violations - classes with fixed slots must be in those slots.
   * Rule: If a class has fixed_slot restrictions, it must be scheduled at those times.
   */
  function checkFixedSlotViolationsCore(
    teacherSchedules: Record<string, TeacherSchedule>,
    classes: ClassEntry[]
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    for (const cls of classes) {
      if (!cls.fixedSlots || cls.fixedSlots.length === 0) continue
      if (!cls.teacher || !cls.subject) continue

      const teacherSchedule = teacherSchedules[cls.teacher]
      if (!teacherSchedule) continue

      for (const [day, block] of cls.fixedSlots) {
        const entry = teacherSchedule[day]?.[block]
        const entrySubject = entry?.[1]

        if (entrySubject !== cls.subject) {
          errors.push({
            type: 'fixed_slot_violation',
            message: `[Fixed Slot] ${cls.teacher}/${cls.subject} should be at ${day} B${block} but found ${entrySubject || 'empty'}`,
            cells: [{ teacher: cls.teacher, day, block, grade: cls.grade, subject: cls.subject }]
          })
        }
      }
    }

    return errors
  }

  /**
   * CORE: Check availability violations - classes must be within available days/blocks.
   * Rule: If a class has day or block restrictions, it must be scheduled within them.
   */
  function checkAvailabilityViolationsCore(
    teacherSchedules: Record<string, TeacherSchedule>,
    classes: ClassEntry[]
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    for (const cls of classes) {
      if (!cls.teacher || !cls.subject) continue

      const hasRestrictedDays = cls.availableDays && cls.availableDays.length < 5
      const hasRestrictedBlocks = cls.availableBlocks && cls.availableBlocks.length < 5

      if (!hasRestrictedDays && !hasRestrictedBlocks) continue

      const teacherSchedule = teacherSchedules[cls.teacher]
      if (!teacherSchedule) continue

      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = teacherSchedule[day]?.[block]
          if (!entry || entry[1] !== cls.subject) continue

          // Check if entry's grade overlaps with class's grades
          const entryMatches = gradesOverlap(entry[0], cls.gradeDisplay || cls.grade)
          if (!entryMatches) continue

          if (hasRestrictedDays && !cls.availableDays!.includes(day)) {
            errors.push({
              type: 'availability_violation',
              message: `[Availability] ${cls.teacher}/${cls.subject} at ${day} B${block} but only available on ${cls.availableDays!.join(', ')}`,
              cells: [{ teacher: cls.teacher, day, block, grade: cls.grade, subject: cls.subject }]
            })
          }

          if (hasRestrictedBlocks && !cls.availableBlocks!.includes(block)) {
            errors.push({
              type: 'availability_violation',
              message: `[Availability] ${cls.teacher}/${cls.subject} at ${day} B${block} but only available in blocks ${cls.availableBlocks!.join(', ')}`,
              cells: [{ teacher: cls.teacher, day, block, grade: cls.grade, subject: cls.subject }]
            })
          }
        }
      }
    }

    return errors
  }

  /**
   * CORE: Check that grade displays in teacher schedules are parseable.
   * This catches bugs where grade parsing fails or unknown grades appear.
   */
  function validateScheduleConsistency(
    teacherSchedules: Record<string, TeacherSchedule>,
    knownGrades?: string[]
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    // Build available grades set from provided list, or derive from teacher schedules
    const availableGrades = new Set<string>()
    if (knownGrades && knownGrades.length > 0) {
      knownGrades.forEach(g => availableGrades.add(g))
    } else {
      // Derive from teacher schedules - collect all unique grade displays
      for (const schedule of Object.values(teacherSchedules)) {
        for (const day of DAYS) {
          for (let block = 1; block <= 5; block++) {
            const entry = schedule[day]?.[block]
            if (entry && entry[0] && isScheduledClass(entry[1])) {
              availableGrades.add(entry[0])
            }
          }
        }
      }
    }

    // If no known grades, skip validation (can't determine what's valid)
    if (availableGrades.size === 0) {
      return errors
    }

    // Helper to check if a grade display is parseable
    function isValidGradeDisplay(display: string): boolean {
      // Direct match
      if (availableGrades.has(display)) return true

      // Check for Kindergarten variations
      if (display.toLowerCase().includes('kindergarten') || display === 'K') {
        for (const g of availableGrades) {
          if (g.toLowerCase().includes('kindergarten') || g === 'K') {
            return true
          }
        }
      }

      // Check for range like "6th-11th Grade" or "6th-7th"
      const rangeMatch = display.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?/i)
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1])
        const end = parseInt(rangeMatch[2])
        for (const g of availableGrades) {
          const num = gradeToNum(g)
          if (num >= start && num <= end) {
            return true
          }
        }
      }

      // Check for single grade number
      const singleMatch = display.match(/(\d+)(?:st|nd|rd|th)/i)
      if (singleMatch) {
        const num = parseInt(singleMatch[1])
        for (const g of availableGrades) {
          if (gradeToNum(g) === num) return true
        }
      }

      return false
    }

    const missingGrades = new Set<string>()
    const missingEntries: Array<{ teacher: string; day: string; block: number; grade: string; subject: string }> = []

    for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (!entry || !entry[0] || !isScheduledClass(entry[1])) continue

          const gradeDisplay = entry[0]
          const subject = entry[1]

          if (!isValidGradeDisplay(gradeDisplay)) {
            // Couldn't parse - this is a real issue (unless it's an elective)
            if (!gradeDisplay.toLowerCase().includes('elective')) {
              missingGrades.add(gradeDisplay)
              missingEntries.push({ teacher, day, block, grade: gradeDisplay, subject })
            }
          }
        }
      }
    }

    // Report missing grades as a single error per grade
    if (missingGrades.size > 0) {
      const gradeList = Array.from(missingGrades).sort(gradeSort).join(', ')
      errors.push({
        type: 'grade_conflict',
        message: `[Unknown Grades] Unrecognized grades in schedule: ${gradeList} (${missingEntries.length} entries affected)`,
        cells: missingEntries.slice(0, 10) // Limit to first 10 cells to avoid huge error
      })
    }

    return errors
  }

  // ---------------------------------------------------------------------------
  // FREEFORM-SPECIFIC HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Freeform mode validation - checks HARD CONSTRAINTS only.
   *
   * Purpose: Real-time feedback while user is placing floating blocks.
   * Focus: Validates pending user actions, not full schedule state.
   *
   * Checks:
   * - Unplaced blocks (floating blocks without placements)
   * - Study Hall teacher eligibility (full-time only)
   * - Teacher conflicts (double-booked teachers)
   * - Grade conflicts (between pending placements)
   * - Subject conflicts (same subject twice per day)
   * - Fixed slot restrictions
   * - Teacher availability (days/blocks)
   * - Co-taught classes (must be at same time)
   *
   * Does NOT check (handled by validateFullSchedule at save time):
   * - Back-to-back OPEN issues (soft constraint)
   * - Session counts (informational)
   * - Study Hall coverage (can be adjusted later)
   * - Unknown classes (informational)
   */
  function validatePlacements(): ValidationError[] {
    if (!workingSchedules || !selectedResult) return []

    const errors: ValidationError[] = []

    // Build a map of teacher status for eligibility checks
    const teacherStatus = new Map(
      selectedResult.teacherStats.map(s => [s.teacher, s.status])
    )

    // -------------------------------------------------------------------------
    // FREEFORM-SPECIFIC CHECKS (pending placements)
    // -------------------------------------------------------------------------

    // 1. Unplaced blocks - all floating blocks must be placed before saving
    for (const block of floatingBlocks) {
      if (!pendingPlacements.find(p => p.blockId === block.id)) {
        errors.push({
          type: 'unplaced',
          message: `[Unplaced] ${block.grade} ${block.subject} must be placed`,
          blockId: block.id,
          cells: []
        })
      }
    }

    // 2. Study Hall teacher eligibility - only full-time teachers can supervise
    for (const placement of pendingPlacements) {
      const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
      if (!placedBlock || !isStudyHall(placedBlock.subject)) continue

      const status = teacherStatus.get(placement.teacher)
      if (!isFullTime(status)) {
        errors.push({
          type: 'teacher_conflict',
          message: `[Study Hall Rule] ${placement.teacher} is ${status || 'unknown'}, only full-time teachers can supervise Study Hall`,
          cells: [{ teacher: placement.teacher, day: placement.day, block: placement.block }]
        })
      }
    }

    // 2b. Cross-teacher class placement - class blocks can only be placed on teachers who teach them
    if (effectiveFreeformClasses) {
      for (const placement of pendingPlacements) {
        const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
        if (!placedBlock) continue

        // Skip OPEN and Study Hall blocks — they can move freely
        if (!isScheduledClass(placedBlock.subject)) continue

        // Skip if placed back on the original teacher
        if (placement.teacher === placedBlock.sourceTeacher) continue

        // Check if the target teacher has a class definition matching this grade+subject
        // effectiveFreeformClasses already reflects pending transfers, so no separate check needed
        const hasMatchingClass = effectiveFreeformClasses.some(cls =>
          cls.teacher === placement.teacher && cls.subject === placedBlock.subject && cls.grade === placedBlock.grade
        )

        if (!hasMatchingClass) {
          errors.push({
            type: 'teacher_conflict',
            message: `[Wrong Teacher] ${placement.teacher} doesn't teach ${placedBlock.grade} ${placedBlock.subject} — only the assigned teacher's schedule can hold this class`,
            cells: [{ teacher: placement.teacher, day: placement.day, block: placement.block }]
          })
        }
      }
    }

    // 3. Teacher conflicts - check if multiple floating blocks placed at same teacher/slot
    const placementsByTeacherSlot = new Map<string, PendingPlacement[]>()
    for (const p of pendingPlacements) {
      const key = `${p.teacher}|${p.day}|${p.block}`
      if (!placementsByTeacherSlot.has(key)) {
        placementsByTeacherSlot.set(key, [])
      }
      placementsByTeacherSlot.get(key)!.push(p)
    }
    for (const [key, placements] of placementsByTeacherSlot) {
      if (placements.length > 1) {
        const [teacher, day, blockStr] = key.split('|')
        errors.push({
          type: 'teacher_conflict',
          message: `[No Teacher Conflicts] ${teacher} has ${placements.length} classes placed at ${day} B${blockStr}`,
          cells: placements.map(p => ({ teacher: p.teacher, day: p.day, block: p.block }))
        })
      }
    }

    // -------------------------------------------------------------------------
    // CORE CHECKS (use shared functions on working schedule)
    // -------------------------------------------------------------------------

    // 4. Grade conflicts - use shared core function
    const gradeConflictErrors = checkGradeConflictsCore(
      workingSchedules.teacherSchedules,
      generation?.stats?.classes_snapshot
    )
    errors.push(...gradeConflictErrors)

    // 5. Subject conflicts - use shared core function
    const subjectConflictErrors = checkSubjectConflictsCore(workingSchedules.teacherSchedules)
    errors.push(...subjectConflictErrors)

    // 6. Fixed slot & availability - use shared core functions if class definitions available
    if (effectiveFreeformClasses) {
      const fixedSlotErrors = checkFixedSlotViolationsCore(workingSchedules.teacherSchedules, effectiveFreeformClasses)
      errors.push(...fixedSlotErrors)

      const availabilityErrors = checkAvailabilityViolationsCore(workingSchedules.teacherSchedules, effectiveFreeformClasses)
      errors.push(...availabilityErrors)

      // 7. Co-taught classes - same grade+subject with different teachers must be at same time
      // (Freeform-specific: checks pending placements for co-taught consistency)
      const coTaughtGroups = new Map<string, typeof effectiveFreeformClasses>()
      for (const cls of effectiveFreeformClasses) {
        const key = `${cls.grade}|${cls.subject}`
        if (!coTaughtGroups.has(key)) {
          coTaughtGroups.set(key, [])
        }
        coTaughtGroups.get(key)!.push(cls)
      }

      for (const [key, classes] of coTaughtGroups) {
        if (classes.length <= 1) continue // Not co-taught

        const [grade, subject] = key.split('|')

        // Find all placements for this grade+subject
        const relevantPlacements = pendingPlacements.filter(p => {
          const block = floatingBlocks.find(b => b.id === p.blockId)
          return block && block.grade === grade && block.subject === subject
        })

        if (relevantPlacements.length <= 1) continue // Only one placement, nothing to compare

        // Check that all placements are at the same day+block
        const firstPlacement = relevantPlacements[0]
        const mismatchedPlacements = relevantPlacements.filter(p =>
          p.day !== firstPlacement.day || p.block !== firstPlacement.block
        )

        if (mismatchedPlacements.length > 0) {
          const slots = relevantPlacements.map(p => `${p.teacher}: ${p.day} B${p.block}`).join(', ')
          errors.push({
            type: 'grade_conflict',
            message: `[Co-Taught] ${grade} ${subject} teachers must be scheduled together (${slots})`,
            cells: relevantPlacements.map(p => ({ teacher: p.teacher, day: p.day, block: p.block, grade, subject }))
          })
        }
      }
    }

    // -------------------------------------------------------------------------
    // DATA INTEGRITY CHECK
    // -------------------------------------------------------------------------

    // 8. Grade consistency - check all grade names are valid/parseable
    // Use grades from stats snapshot if available
    const knownGrades = generation?.stats?.grades_snapshot?.map(g => g.display_name)
    const consistencyErrors = validateScheduleConsistency(
      workingSchedules.teacherSchedules,
      knownGrades
    )
    errors.push(...consistencyErrors)

    return errors
  }

  /**
   * Validate the FULL schedule for conflicts (all teachers, not just pending placements).
   * This catches logic errors in solver output or merging.
   *
   * If stats is provided, also runs comprehensive checks:
   * - Session count (classes scheduled correct number of times)
   * - Study hall coverage
   * - Back-to-back issues
   * - Fixed slot violations
   * - Availability violations
   *
   * @param options.skipStudyHallCheck - Skip study hall coverage validation (for stripped study halls mode)
   */
  function validateFullSchedule(
    option: ScheduleOption,
    stats?: GenerationStats,
    options?: { skipStudyHallCheck?: boolean }
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    // -------------------------------------------------------------------------
    // CORE CHECKS (use shared functions)
    // -------------------------------------------------------------------------

    // 1. Grade conflicts - use shared core function
    const gradeConflictErrors = checkGradeConflictsCore(option.teacherSchedules, stats?.classes_snapshot)
    errors.push(...gradeConflictErrors)

    // 2. Subject conflicts - use shared core function
    const subjectConflictErrors = checkSubjectConflictsCore(option.teacherSchedules)
    errors.push(...subjectConflictErrors)

    // 3. Grade consistency - use shared core function
    const knownGrades = stats?.grades_snapshot?.map(g => g.display_name)
    const consistencyErrors = validateScheduleConsistency(option.teacherSchedules, knownGrades)
    errors.push(...consistencyErrors)

    // -------------------------------------------------------------------------
    // COMPREHENSIVE CHECKS (require stats - includes soft constraints)
    // -------------------------------------------------------------------------
    if (stats) {
      // 4. Class Session Count + Unknown Class Detection (informational)
      // In freeform mode with pending transfers, use effectiveFreeformClasses which
      // reflects the updated class ownership. Otherwise parse from the raw snapshot.
      if (stats.classes_snapshot) {
        const classes = (freeformMode && effectiveFreeformClasses && pendingTransfers.length > 0)
          ? effectiveFreeformClasses
          : parseClassesFromSnapshot(stats.classes_snapshot)

        // Helper: check if a schedule entry matches a class definition
        // A match requires: same teacher, same subject, and grades overlap
        // Uses global gradesOverlap() helper
        function entryMatchesClass(
          teacher: string,
          entryGrade: string,
          entrySubject: string,
          cls: ClassEntry
        ): boolean {
          if (cls.teacher !== teacher || cls.subject !== entrySubject) return false
          // Check if entry's grade overlaps with class's grades
          return gradesOverlap(entryGrade, cls.gradeDisplay || cls.grade)
        }

        // Track all teaching entries and whether they've been matched
        const allEntries = new Map<string, { grade: string; subject: string; matched: boolean; teacher: string; day: string; block: number }>()

        for (const [teacher, schedule] of Object.entries(option.teacherSchedules)) {
          for (const day of DAYS) {
            for (let block = 1; block <= 5; block++) {
              const entry = schedule[day]?.[block]
              if (!entry || !isScheduledClass(entry[1])) continue

              const key = `${teacher}|${day}|${block}`
              allEntries.set(key, {
                grade: entry[0],
                subject: entry[1],
                matched: false,
                teacher,
                day,
                block
              })
            }
          }
        }

        // Go through each class and count/match entries
        for (const cls of classes) {
          if (!cls.teacher || !cls.subject) continue

          const teacherSchedule = option.teacherSchedules[cls.teacher]
          if (!teacherSchedule) continue

          let sessionCount = 0

          for (const day of DAYS) {
            for (let block = 1; block <= 5; block++) {
              const entry = teacherSchedule[day]?.[block]
              if (!entry) continue

              const entryGrade = entry[0]
              const entrySubject = entry[1]

              if (entryMatchesClass(cls.teacher, entryGrade, entrySubject, cls)) {
                sessionCount++
                // Mark this entry as matched to SOME class
                const key = `${cls.teacher}|${day}|${block}`
                const entryRecord = allEntries.get(key)
                if (entryRecord) {
                  entryRecord.matched = true
                }
              }
            }
          }

          if (sessionCount !== cls.daysPerWeek) {
            errors.push({
              type: 'session_count',
              message: `[Session Count] ${cls.teacher}/${cls.gradeDisplay || cls.grade}/${cls.subject}: scheduled ${sessionCount}x but should be ${cls.daysPerWeek}x per week`,
              cells: []
            })
          }
        }

        // 5b. Unknown Classes - entries not matched to ANY class are truly unknown
        // For each unmatched entry, verify it doesn't match ANY class (not just the first one found)
        const unmatchedEntries = Array.from(allEntries.values()).filter(e => {
          if (e.matched) return false
          // Double-check: does this entry match ANY class in the snapshot?
          return !classes.some(cls => entryMatchesClass(e.teacher, e.grade, e.subject, cls))
        })

        if (unmatchedEntries.length > 0) {
          const grouped = new Map<string, typeof unmatchedEntries>()
          for (const entry of unmatchedEntries) {
            const key = `${entry.teacher}|${entry.grade}|${entry.subject}`
            if (!grouped.has(key)) grouped.set(key, [])
            grouped.get(key)!.push(entry)
          }

          for (const [key, entries] of grouped) {
            const [teacher, grade, subject] = key.split('|')
            const locations = entries.map(e => `${e.day} B${e.block}`).join(', ')
            errors.push({
              type: 'unknown_class',
              message: `[Unknown Class] ${teacher}/${grade}/${subject} (${entries.length}x at ${locations}) doesn't match any class in snapshot`,
              cells: entries.map(e => ({ teacher: e.teacher, day: e.day, block: e.block, grade: e.grade, subject: e.subject }))
            })
          }
        }
      }

      // 6. Study Hall Coverage - check all required grades have study halls
      // Skip if study halls were stripped for editing (will be reassigned after save)
      if (stats.rules_snapshot && !options?.skipStudyHallCheck) {
        const rules = parseRulesFromSnapshot(stats.rules_snapshot)
        const studyHallRule = rules.find(r => r.rule_key === 'study_hall_grades')

        if (studyHallRule?.enabled && studyHallRule.config?.grades) {
          const requiredGrades = studyHallRule.config.grades as string[]
          const assignedGrades = new Set<string>()

          // Find all study hall assignments
          for (const [, schedule] of Object.entries(option.teacherSchedules)) {
            for (const day of DAYS) {
              for (let block = 1; block <= 5; block++) {
                const entry = schedule[day]?.[block]
                if (entry && isStudyHall(entry[1])) {
                  const gradeDisplay = entry[0]
                  for (const g of requiredGrades) {
                    if (gradeDisplay === g || gradeDisplay?.includes(g.replace(' Grade', ''))) {
                      assignedGrades.add(g)
                    }
                  }
                }
              }
            }
          }

          const missingGrades = requiredGrades.filter(g => !assignedGrades.has(g))
          if (missingGrades.length > 0) {
            errors.push({
              type: 'study_hall_coverage',
              message: `[Study Hall Coverage] Missing study halls for: ${missingGrades.join(', ')}`,
              cells: []
            })
          }
        }
      }

      // 7. Back-to-Back OPEN Issues - warn about consecutive open blocks for full-time teachers
      if (stats.teachers_snapshot) {
        const teachers = parseTeachersFromSnapshot(stats.teachers_snapshot)
        const fullTimeTeachers = teachers.filter(t => isFullTime(t.status)).map(t => t.name)

        for (const teacher of fullTimeTeachers) {
          const schedule = option.teacherSchedules[teacher]
          if (!schedule) continue

          let backToBackCount = 0
          for (const day of DAYS) {
            for (let block = 1; block <= 4; block++) {
              const entry1 = schedule[day]?.[block]
              const entry2 = schedule[day]?.[block + 1]

              const isOpen1 = !entry1 || isOpenBlock(entry1[1]) || isStudyHall(entry1[1])
              const isOpen2 = !entry2 || isOpenBlock(entry2[1]) || isStudyHall(entry2[1])

              if (isOpen1 && isOpen2) {
                backToBackCount++
              }
            }
          }

          if (backToBackCount >= 3) {
            errors.push({
              type: 'back_to_back',
              message: `[Back-to-Back] ${teacher} has ${backToBackCount} consecutive open/study hall blocks`,
              cells: []
            })
          }
        }
      }

      // 8. Fixed Slot Violations - use shared core function
      if (stats.classes_snapshot) {
        const classes = parseClassesFromSnapshot(stats.classes_snapshot)
        const fixedSlotErrors = checkFixedSlotViolationsCore(option.teacherSchedules, classes)
        errors.push(...fixedSlotErrors)
      }

      // 9. Availability Violations - use shared core function
      if (stats.classes_snapshot) {
        const classes = parseClassesFromSnapshot(stats.classes_snapshot)
        const availabilityErrors = checkAvailabilityViolationsCore(option.teacherSchedules, classes)
        errors.push(...availabilityErrors)
      }
    }

    return errors
  }

  /** Soft warning types — shown separately from hard validation errors */
  const SOFT_WARNING_TYPES = new Set(['back_to_back'])

  function splitValidationErrors(errors: ValidationError[]) {
    const hard = errors.filter(e => !SOFT_WARNING_TYPES.has(e.type))
    const soft = errors.filter(e => SOFT_WARNING_TYPES.has(e.type))
    return { hard, soft }
  }

  /**
   * Analyze the schedule against the classes snapshot to find discrepancies.
   * This helps diagnose issues where validation passes but stats look wrong.
   */
  function analyzeScheduleForRepair(
    option: ScheduleOption,
    stats: GenerationStats | undefined
  ): typeof repairAnalysis {
    if (!stats?.classes_snapshot || !stats?.grades_snapshot) {
      return {
        issues: [],
        classesInSnapshot: 0,
        classesFoundInSchedule: 0,
        orphanEntries: 0,
        phantomGrades: [],
        summary: "No snapshot data available for analysis",
        totalMissingSessions: 0,
        orphanAnalysis: 'none',
        orphanGuidance: '',
        electiveSlotConflicts: 0
      }
    }

    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
    const issues: RepairIssue[] = []
    const classes = parseClassesFromSnapshot(stats.classes_snapshot)
    const validGradeNames = stats.grades_snapshot.map(g => g.display_name)

    // Helper: check if a schedule entry matches a class definition
    // A match requires: same teacher, same subject, and grades overlap
    // Uses global gradesOverlap() helper
    function entryMatchesClass(
      teacher: string,
      entryGrade: string,
      entrySubject: string,
      cls: ClassEntry
    ): boolean {
      if (cls.teacher !== teacher || cls.subject !== entrySubject) return false
      // Check if entry's grade overlaps with class's grades
      return gradesOverlap(entryGrade, cls.gradeDisplay || cls.grade)
    }

    // Track session counts per class (using unique class identifier)
    // Key: "teacher|gradeDisplay|subject" to handle same teacher teaching same subject to different grades
    const classSessionCounts = new Map<string, {
      cls: ClassEntry
      foundCount: number
    }>()

    for (const cls of classes) {
      if (!cls.teacher || !cls.subject) continue
      const key = `${cls.teacher}|${cls.gradeDisplay || cls.grade}|${cls.subject}`
      classSessionCounts.set(key, { cls, foundCount: 0 })
    }

    // Scan teacherSchedules and match entries to classes
    let orphanCount = 0
    const phantomGradesFound = new Set<string>()

    for (const [teacher, schedule] of Object.entries(option.teacherSchedules)) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (!entry || !isScheduledClass(entry[1])) continue

          const gradeDisplay = entry[0]
          const subject = entry[1]

          // Note: Range patterns like "6th-11th Grade" in teacherSchedules entries are VALID
          // They represent multi-grade class displays from the solver
          // We only flag phantom grades in gradeSchedules KEYS (not entry values)

          // Find a matching class in the snapshot
          // An entry matches if: same teacher, same subject, and entry's grade is in class's grades
          const matchingClass = classes.find(cls => entryMatchesClass(teacher, gradeDisplay, subject, cls))

          if (matchingClass) {
            // Found a match - increment session count for this class
            const classKey = `${matchingClass.teacher}|${matchingClass.gradeDisplay || matchingClass.grade}|${matchingClass.subject}`
            const counter = classSessionCounts.get(classKey)
            if (counter) {
              counter.foundCount++
            }
          } else {
            // No matching class found - this is an orphan entry
            orphanCount++
            issues.push({
              type: 'orphan_entry',
              severity: 'error',
              teacher,
              day,
              block,
              gradeDisplay,
              subject,
              description: `No matching class for ${teacher}/${gradeDisplay}/${subject} at ${day} B${block}`,
              canFix: false
            })
          }
        }
      }
    }

    // Check for missing sessions (classes not fully scheduled)
    const underScheduled: Array<{ teacher: string; grade: string; subject: string; expected: number; found: number; missing: number }> = []
    for (const [key, { cls, foundCount }] of classSessionCounts) {
      if (foundCount < cls.daysPerWeek) {
        const missing = cls.daysPerWeek - foundCount
        underScheduled.push({
          teacher: cls.teacher,
          grade: cls.gradeDisplay || cls.grade,
          subject: cls.subject,
          expected: cls.daysPerWeek,
          found: foundCount,
          missing
        })
        issues.push({
          type: 'missing_session',
          severity: 'error',
          teacher: cls.teacher,
          subject: cls.subject,
          gradeDisplay: cls.gradeDisplay || cls.grade,
          expected: `${cls.daysPerWeek} sessions`,
          found: `${foundCount} sessions`,
          description: `${cls.teacher}/${cls.gradeDisplay || cls.grade}/${cls.subject}: expected ${cls.daysPerWeek}x/week but found ${foundCount}x`,
          canFix: false
        })
      } else if (foundCount > cls.daysPerWeek) {
        issues.push({
          type: 'missing_session',
          severity: 'warning',
          teacher: cls.teacher,
          subject: cls.subject,
          gradeDisplay: cls.gradeDisplay || cls.grade,
          expected: `${cls.daysPerWeek} sessions`,
          found: `${foundCount} sessions`,
          description: `${cls.teacher}/${cls.gradeDisplay || cls.grade}/${cls.subject}: expected ${cls.daysPerWeek}x/week but found ${foundCount}x (extra sessions)`,
          canFix: false
        })
      }
    }

    // Log under-scheduled classes summary
    if (underScheduled.length > 0) {
      const totalMissing = underScheduled.reduce((sum, c) => sum + c.missing, 0)
      for (const c of underScheduled) {
      }
    } else {
    }

    // Check for phantom grades in gradeSchedules KEYS
    // These are invalid grade names that shouldn't exist as keys
    // (Range patterns in teacherSchedules ENTRIES are valid if they match a class - handled by orphan detection)
    const gradeScheduleKeys = Object.keys(option.gradeSchedules)
    for (const grade of gradeScheduleKeys) {
      if (!validGradeNames.includes(grade)) {
        phantomGradesFound.add(grade)
        issues.push({
          type: 'phantom_grade',
          severity: 'error',
          teacher: '',
          gradeDisplay: grade,
          description: `Phantom grade key "${grade}" in gradeSchedules (not in grades snapshot)`,
          canFix: true
        })
      }
    }

    // NEW: Diagnose per-grade slot counts
    // 1. Calculate expected sessions per grade from classes_snapshot
    // Uses global parseGradeDisplayToNumbers() and gradeNumToDisplay() helpers
    const expectedPerGrade = new Map<string, number>()
    const numToGradeName = (n: number): string => {
      if (n === 0) return validGradeNames.find(g => g.toLowerCase().includes('kindergarten')) || 'Kindergarten'
      return gradeNumToDisplay(n)
    }

    // Log multi-grade classes specifically (likely source of issues for grades 6-11)
    const multiGradeClasses = classes.filter(cls => {
      const gradeNums = parseGradeDisplayToNumbers(cls.gradeDisplay || cls.grade)
      return gradeNums.length > 1
    })
    for (const cls of multiGradeClasses) {
      const gradeNums = parseGradeDisplayToNumbers(cls.gradeDisplay || cls.grade)
    }
    if (multiGradeClasses.length === 0) {
    }

    // Check: for each multi-grade class, how many sessions are actually in teacherSchedules?
    for (const cls of multiGradeClasses) {
      let foundCount = 0
      const locations: string[] = []
      for (const [teacher, schedule] of Object.entries(option.teacherSchedules)) {
        if (teacher !== cls.teacher) continue
        for (const day of DAYS) {
          for (let block = 1; block <= 5; block++) {
            const entry = schedule[day]?.[block]
            if (entry && entry[1] === cls.subject) {
              // Check if grades overlap (using global helper)
              if (gradesOverlap(entry[0], cls.gradeDisplay || cls.grade)) {
                foundCount++
                locations.push(`${day} B${block}: "${entry[0]}"`)
              }
            }
          }
        }
      }
      const status = foundCount === cls.daysPerWeek ? '✓' : foundCount < cls.daysPerWeek ? '⚠️ UNDER' : '⚠️ OVER'
      if (foundCount !== cls.daysPerWeek) {
      }
    }

    // Track elective slots per grade to avoid double-counting
    // Multiple electives at the same time slot only count as 1 session per grade
    const seenElectiveSlots = new Set<string>() // "gradeName:day:block"

    for (const cls of classes) {
      const gradeNums = parseGradeDisplayToNumbers(cls.gradeDisplay || cls.grade)
      for (const num of gradeNums) {
        const gradeName = numToGradeName(num)
        if (!validGradeNames.includes(gradeName)) continue

        if (cls.isElective) {
          // Electives: count each unique time slot once per grade
          // Multiple elective options at the same slot share that slot
          const fixedSlots = cls.fixedSlots || []
          for (const [day, block] of fixedSlots) {
            const slotKey = `${gradeName}:${day}:${block}`
            if (!seenElectiveSlots.has(slotKey)) {
              seenElectiveSlots.add(slotKey)
              expectedPerGrade.set(gradeName, (expectedPerGrade.get(gradeName) || 0) + 1)
            }
          }
        } else {
          // Non-elective: count daysPerWeek normally
          expectedPerGrade.set(gradeName, (expectedPerGrade.get(gradeName) || 0) + cls.daysPerWeek)
        }
      }
    }

    // 2. Count actual filled slots per grade from gradeSchedules
    const actualPerGrade = new Map<string, number>()
    for (const grade of validGradeNames) {
      let count = 0
      const schedule = option.gradeSchedules[grade]
      if (schedule) {
        for (const day of DAYS) {
          for (let block = 1; block <= 5; block++) {
            const entry = schedule[day]?.[block]
            if (entry && entry[1] && entry[1] !== 'OPEN') {
              count++
            }
          }
        }
      }
      actualPerGrade.set(grade, count)
    }

    // 3. Log comparison and flag mismatches
    for (const grade of validGradeNames) {
      const expected = expectedPerGrade.get(grade) || 0
      const actual = actualPerGrade.get(grade) || 0
      // Note: expected can exceed 25 due to slot sharing (electives, multi-grade classes)
      // Compare against min(expected, 25) since a grade can only have 25 slots max
      const effectiveExpected = Math.min(expected, 25)
      const status = actual >= effectiveExpected ? '✓' : '⚠️ UNDER'

      // Only check for missing slots if there are actual empty slots
      // (actual < 25 means there are unfilled slots that could potentially have classes)
      const emptySlotCount = 25 - actual
      if (emptySlotCount > 0) {
        const schedule = option.gradeSchedules[grade]
        const emptySlots: string[] = []
        for (const day of DAYS) {
          for (let block = 1; block <= 5; block++) {
            const entry = schedule?.[day]?.[block]
            if (!entry || !entry[1] || entry[1] === 'OPEN') {
              emptySlots.push(`${day} B${block}`)
            }
          }
        }

        // Check teacherSchedules to see if any teacher HAS a class for this grade at these empty slots
        for (const slot of emptySlots) {
          const [slotDay, slotBlock] = [slot.split(' ')[0], parseInt(slot.split('B')[1])]
          let foundTeacher: string | null = null
          for (const [teacher, teacherSchedule] of Object.entries(option.teacherSchedules)) {
            const entry = teacherSchedule[slotDay]?.[slotBlock]
            if (entry && entry[1] !== 'OPEN' && entry[1] !== 'Study Hall') {
              const entryGradeNums = parseGradeDisplayToNumbers(entry[0])
              const gradeNum = validGradeNames.indexOf(grade) <= 0 ? 0 : parseInt(grade.match(/(\d+)/)?.[1] || '0')
              if (entryGradeNums.includes(gradeNum)) {
                foundTeacher = `${teacher} -> ${entry[0]}/${entry[1]}`
              }
            }
          }
          if (foundTeacher) {
          } else {
          }
        }

        // Only push a warning if actual < effectiveExpected (truly missing sessions)
        // Note: empty slots might be Study Halls which don't appear in gradeSchedules
        if (actual < effectiveExpected) {
          issues.push({
            type: 'grade_gap',
            severity: 'warning',
            teacher: '',
            gradeDisplay: grade,
            expected: `${effectiveExpected} sessions`,
            found: `${actual} sessions`,
            description: `Grade "${grade}" has ${emptySlotCount} empty slots (expected ${effectiveExpected} from snapshot, found ${actual})`,
            canFix: false
          })
        }
      }
    }

    // NEW: Analyze elective slot conflicts
    // Elective slots for grades 6-11: Mon B5, Wed B5, Fri B1
    // If a single-grade (non-elective) class is scheduled in these slots,
    // it conflicts with the electives that run at the same time
    const electiveSlots = [
      { day: 'Mon', block: 5 },
      { day: 'Wed', block: 5 },
      { day: 'Fri', block: 1 }
    ]
    const electiveGrades = [6, 7, 8, 9, 10, 11]

    const electiveSlotConflicts: Array<{
      teacher: string
      day: string
      block: number
      grade: string
      subject: string
      conflictingElectives: Array<{ teacher: string; subject: string; gradeDisplay: string }>
    }> = []

    for (const slot of electiveSlots) {
      // Find all classes at this slot
      const classesAtSlot: Array<{
        teacher: string
        gradeDisplay: string
        subject: string
        gradeNums: number[]
        isElective: boolean
      }> = []

      for (const [teacher, schedule] of Object.entries(option.teacherSchedules)) {
        const entry = schedule[slot.day]?.[slot.block]
        if (entry && entry[1] && entry[1] !== 'OPEN' && entry[1] !== 'Study Hall') {
          const gradeNums = parseGradeDisplayToNumbers(entry[0])
          // Check if this class is marked as elective (use shared helper)
          const isElective = isClassElective(teacher, entry[1], stats?.classes_snapshot)
          classesAtSlot.push({
            teacher,
            gradeDisplay: entry[0],
            subject: entry[1],
            gradeNums,
            isElective
          })
        }
      }

      // Find electives at this slot (multi-grade classes marked as elective)
      const electives = classesAtSlot.filter(c => c.isElective && c.gradeNums.length > 1)

      // Find single-grade non-elective classes in elective grades at this slot
      const singleGradeRegularClasses = classesAtSlot.filter(c =>
        !c.isElective &&
        c.gradeNums.length === 1 &&
        electiveGrades.includes(c.gradeNums[0])
      )

      // If there are both electives and single-grade regular classes at same slot,
      // that's a conflict - students can't be in both places
      if (electives.length > 0 && singleGradeRegularClasses.length > 0) {
        for (const regular of singleGradeRegularClasses) {
          // Check if this regular class's grade is covered by any of the electives
          const conflictingElectives = electives.filter(elec =>
            elec.gradeNums.includes(regular.gradeNums[0])
          )
          if (conflictingElectives.length > 0) {
            electiveSlotConflicts.push({
              teacher: regular.teacher,
              day: slot.day,
              block: slot.block,
              grade: numToGradeName(regular.gradeNums[0]),
              subject: regular.subject,
              conflictingElectives: conflictingElectives.map(e => ({
                teacher: e.teacher,
                subject: e.subject,
                gradeDisplay: e.gradeDisplay
              }))
            })
          }
        }
      }
    }

    if (electiveSlotConflicts.length === 0) {
    } else {
      // Add issues for each conflict
      for (const conflict of electiveSlotConflicts) {
        issues.push({
          type: 'elective_slot_conflict',
          severity: 'warning',
          teacher: conflict.teacher,
          day: conflict.day,
          block: conflict.block,
          gradeDisplay: conflict.grade,
          subject: conflict.subject,
          description: `ELECTIVE CONFLICT: ${conflict.teacher}/${conflict.grade}/${conflict.subject} at ${conflict.day} B${conflict.block} conflicts with ${conflict.conflictingElectives.map(e => `${e.teacher}/${e.subject}`).join(', ')}`,
          canFix: false
        })
      }
    }

    // Correlate orphans with missing sessions to determine if they're related
    const orphanIssues = issues.filter(i => i.type === 'orphan_entry')
    const missingSessionIssues = issues.filter(i => i.type === 'missing_session' && i.severity === 'error')

    // Calculate total missing session count
    let totalMissingSessions = 0
    for (const issue of missingSessionIssues) {
      const expectedMatch = issue.expected?.match(/(\d+)/)
      const foundMatch = issue.found?.match(/(\d+)/)
      if (expectedMatch && foundMatch) {
        totalMissingSessions += parseInt(expectedMatch[1]) - parseInt(foundMatch[1])
      }
    }

    // Determine if orphans might be unlinked classes
    let orphanAnalysis: 'extra' | 'possibly_unlinked' | 'none' = 'none'
    let orphanGuidance = ''

    if (orphanCount > 0) {
      if (totalMissingSessions > 0) {
        // Both orphans and missing sessions - might be related
        orphanAnalysis = 'possibly_unlinked'
        if (orphanCount === totalMissingSessions) {
          orphanGuidance = `Found ${orphanCount} orphan entries AND ${totalMissingSessions} missing sessions - these are likely the SAME classes that got corrupted/unlinked. Removing orphans would lose data. Consider manual review.`
        } else {
          orphanGuidance = `Found ${orphanCount} orphan entries and ${totalMissingSessions} missing sessions. Some orphans may be corrupted versions of missing classes. Review before removing.`
        }
      } else {
        // Orphans but no missing sessions - truly extra
        orphanAnalysis = 'extra'
        orphanGuidance = `Found ${orphanCount} orphan entries but ALL snapshot classes are fully scheduled. These appear to be extra/duplicate entries that can be safely removed.`
      }
    }

    // Build summary
    const errorCount = issues.filter(i => i.severity === 'error').length
    const warningCount = issues.filter(i => i.severity === 'warning').length
    const summary = issues.length === 0
      ? "✓ No issues found - schedule matches snapshot perfectly"
      : `Found ${errorCount} error${errorCount !== 1 ? 's' : ''}, ${warningCount} warning${warningCount !== 1 ? 's' : ''}`

    return {
      issues,
      classesInSnapshot: classes.length,
      classesFoundInSchedule: classSessionCounts.size,
      orphanEntries: orphanCount,
      phantomGrades: Array.from(phantomGradesFound),
      summary,
      // New fields for orphan correlation
      totalMissingSessions,
      orphanAnalysis,
      orphanGuidance,
      // Elective slot conflicts
      electiveSlotConflicts: electiveSlotConflicts.length
    }
  }

  function handleStartRepairMode() {
    if (!selectedResult || !generation?.stats) return

    const analysis = analyzeScheduleForRepair(selectedResult, generation.stats)
    setRepairAnalysis(analysis)
    setRepairMode(true)
    setRepairPreview(null)
  }

  function handleExitRepairMode() {
    setRepairMode(false)
    setRepairAnalysis(null)
    setRepairPreview(null)
  }

  async function handleApplyRepair() {
    if (!repairPreview || !generation || !selectedResult) return

    // Save previous state for undo
    const previousOptions = JSON.parse(JSON.stringify(generation.options))

    // Use the repaired schedules from preview (already rebuilt correctly)
    const updatedOption: ScheduleOption = {
      ...selectedResult,
      teacherSchedules: repairPreview.teacherSchedules,
      gradeSchedules: repairPreview.gradeSchedules,
      updatedAt: new Date().toISOString(),
    }

    // Update options array
    const optionIndex = parseInt(viewingOption) - 1
    const updatedOptions = [...generation.options]
    updatedOptions[optionIndex] = updatedOption

    try {
      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: updatedOptions }),
      })

      if (!updateRes.ok) throw new Error("Failed to save")

      const savedData = await updateRes.json()

      setGeneration({ ...generation, options: updatedOptions })
      handleExitRepairMode()

      toast(
        (t) => (
          <div className="flex items-center gap-3">
            <span className="text-sm">Repair applied: {repairPreview.fixesApplied.length} fixes</span>
            <button
              onClick={async () => {
                toast.dismiss(t.id)
                // Restore previous options
                const restoreRes = await fetch(`/api/history/${id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ options: previousOptions }),
                })
                if (restoreRes.ok) {
                  setGeneration({ ...generation, options: previousOptions })
                  toast("Repair undone", { icon: successIcon })
                }
              }}
              className="px-2 py-1 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
            >
              Undo
            </button>
          </div>
        ),
        { duration: 60000, icon: "🔧" }
      )
    } catch (error) {
      console.error('Repair save error:', error)
      toast.error("Failed to save repair")
    }
  }

  function handlePreviewRepair() {
    if (!repairAnalysis || !selectedResult || !generation?.stats) return

    const newTeacherSchedules = JSON.parse(JSON.stringify(selectedResult.teacherSchedules))
    const fixesApplied: string[] = []

    // Apply fixes for phantom grades - rebuild gradeSchedules will handle this
    if (repairAnalysis.phantomGrades.length > 0) {
      fixesApplied.push(`Remove ${repairAnalysis.phantomGrades.length} phantom grade(s): ${repairAnalysis.phantomGrades.join(', ')}`)
    }

    // Remove orphan entries if they're identified as "extra" (safe to remove)
    if (repairAnalysis.orphanAnalysis === 'extra' && repairAnalysis.orphanEntries > 0) {
      const orphanIssues = repairAnalysis.issues.filter(i => i.type === 'orphan_entry')
      let removedCount = 0
      for (const issue of orphanIssues) {
        if (issue.teacher && issue.day && issue.block) {
          const schedule = newTeacherSchedules[issue.teacher]
          if (schedule?.[issue.day]?.[issue.block]) {
            schedule[issue.day][issue.block] = ['OPEN', 'OPEN']
            removedCount++
          }
        }
      }
      if (removedCount > 0) {
        fixesApplied.push(`Remove ${removedCount} orphan entr${removedCount !== 1 ? 'ies' : 'y'} (set to OPEN)`)
      }
    }

    // Rebuild gradeSchedules from teacherSchedules using valid grades only
    const rebuiltGradeSchedules = rebuildGradeSchedules(
      newTeacherSchedules,
      generation.stats?.grades_snapshot,
      selectedResult.gradeSchedules
    )

    setRepairPreview({
      teacherSchedules: newTeacherSchedules,
      gradeSchedules: rebuiltGradeSchedules,
      fixesApplied
    })
  }

  // Match a snapshot entry's grade display to the transfer's grade string
  // Snapshot grades are stored as an array — join display_names to compare
  function snapshotGradeDisplay(entry: ClassSnapshot): string {
    const names = entry.grades?.map(g => g.display_name) || []
    return names.length > 1 ? names.join(', ') : names[0] || ''
  }

  // Apply pending transfers to the classes snapshot
  // Each transfer is essentially copying/moving a class definition (grade+subject+restrictions) to a new teacher
  function applyTransfersToSnapshot(
    snapshot: ClassSnapshot[],
    transfers: PendingTransfer[],
    teachersSnapshot: TeacherSnapshot[]
  ): ClassSnapshot[] {
    const updated = JSON.parse(JSON.stringify(snapshot)) as ClassSnapshot[]

    for (const r of transfers) {
      const targetTeacher = teachersSnapshot.find(t => t.name === r.toTeacher)

      if (r.moveType === 'all') {
        // Move all sessions to target teacher — merge if target already has this class
        const entry = updated.find(c =>
          c.teacher_name === r.fromTeacher && c.subject_name === r.subject && gradesEqual(snapshotGradeDisplay(c), r.grade)
        )
        if (entry && targetTeacher) {
          const existing = updated.find(c =>
            c.teacher_name === r.toTeacher && c.subject_name === r.subject && gradesEqual(snapshotGradeDisplay(c), r.grade)
          )
          if (existing) {
            // Merge: add sessions to existing target entry, remove source
            existing.days_per_week += entry.days_per_week
            const idx = updated.indexOf(entry)
            updated.splice(idx, 1)
          } else {
            // No existing target — just reassign teacher
            entry.teacher_id = targetTeacher.id
            entry.teacher_name = r.toTeacher
          }
        }
      } else {
        // moveType === 'one': split one day off the class definition
        const entry = updated.find(c =>
          c.teacher_name === r.fromTeacher && c.subject_name === r.subject && gradesEqual(snapshotGradeDisplay(c), r.grade)
        )
        if (entry && targetTeacher) {
          // Decrement source teacher's days_per_week
          entry.days_per_week -= 1
          if (entry.days_per_week <= 0) {
            const idx = updated.indexOf(entry)
            updated.splice(idx, 1)
          }
          // Check if target teacher already has an entry for this grade+subject (from a previous transfer)
          const existing = updated.find(c =>
            c.teacher_name === r.toTeacher && c.subject_name === r.subject && gradesEqual(snapshotGradeDisplay(c), r.grade)
          )
          if (existing) {
            existing.days_per_week += 1
          } else {
            // Copy the full class definition (grades, restrictions, elective flag, etc.) to the new teacher
            updated.push({
              ...JSON.parse(JSON.stringify(entry)),
              teacher_id: targetTeacher.id,
              teacher_name: r.toTeacher,
              days_per_week: 1,
            })
          }
        }
      }
    }

    return updated
  }

  // Apply transfers to DB class definitions
  async function applyTransfersToDB(
    transfers: PendingTransfer[],
    snapshot: ClassSnapshot[],
    teachersSnapshot: TeacherSnapshot[],
    quarterId: string
  ) {
    // Fetch classes once for all transfers
    const classesRes = await fetch(`/api/classes?quarter_id=${quarterId}`)
    const allClasses = await classesRes.json()

    for (const r of transfers) {
      const targetTeacher = teachersSnapshot.find(t => t.name === r.toTeacher)
      if (!targetTeacher) continue

      const sourceClass = snapshot.find(c =>
        c.teacher_name === r.fromTeacher && c.subject_name === r.subject && gradesEqual(snapshotGradeDisplay(c), r.grade)
      )
      if (!sourceClass) continue

      // Match DB classes by teacher+subject+grade_ids
      const sourceGradeIds = new Set(sourceClass.grade_ids)
      const matchesGrades = (dbClass: Record<string, unknown>) => {
        const dbGradeIds: string[] = (dbClass.grade_ids as string[]) || []
        if (dbGradeIds.length !== sourceGradeIds.size) return false
        return dbGradeIds.every(id => sourceGradeIds.has(id))
      }

      if (r.moveType === 'all') {
        // Find the DB class for this teacher+subject+grades
        const dbClass = allClasses.find((c: Record<string, unknown>) =>
          (c.teacher as Record<string, unknown>)?.name === r.fromTeacher &&
          (c.subject as Record<string, unknown>)?.name === r.subject &&
          matchesGrades(c)
        )
        if (dbClass) {
          // Check if target teacher already has a DB class for this subject+grades
          const existingTargetClass = allClasses.find((c: Record<string, unknown>) =>
            (c.teacher as Record<string, unknown>)?.id === targetTeacher.id &&
            (c.subject as Record<string, unknown>)?.name === r.subject &&
            matchesGrades(c)
          )
          if (existingTargetClass) {
            // Merge: add source days to existing target, delete source
            await fetch(`/api/classes/${existingTargetClass.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ days_per_week: existingTargetClass.days_per_week + dbClass.days_per_week })
            })
            await fetch(`/api/classes/${dbClass.id}`, { method: 'DELETE' })
          } else {
            // Simple reassign — just change the teacher
            await fetch(`/api/classes/${dbClass.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ teacher_id: targetTeacher.id })
            })
          }
        }
      } else {
        // moveType === 'one': decrement source, create/increment for target
        const dbClass = allClasses.find((c: Record<string, unknown>) =>
          (c.teacher as Record<string, unknown>)?.name === r.fromTeacher &&
          (c.subject as Record<string, unknown>)?.name === r.subject &&
          matchesGrades(c)
        )
        if (dbClass) {
          if (dbClass.days_per_week <= 1) {
            await fetch(`/api/classes/${dbClass.id}`, { method: 'DELETE' })
          } else {
            await fetch(`/api/classes/${dbClass.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ days_per_week: dbClass.days_per_week - 1 })
            })
          }
          // Check if target teacher already has a DB class for this subject+grades
          const existingTargetClass = allClasses.find((c: Record<string, unknown>) =>
            (c.teacher as Record<string, unknown>)?.id === targetTeacher.id &&
            (c.subject as Record<string, unknown>)?.name === r.subject &&
            matchesGrades(c)
          )
          if (existingTargetClass) {
            // Increment existing class
            await fetch(`/api/classes/${existingTargetClass.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ days_per_week: existingTargetClass.days_per_week + 1 })
            })
          } else {
            // Create new class for target teacher (copies grade_ids, subject, elective flag)
            await fetch('/api/classes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                quarter_id: quarterId,
                teacher_id: targetTeacher.id,
                subject_id: sourceClass.subject_id,
                grade_ids: sourceClass.grade_ids,
                days_per_week: 1,
                is_elective: sourceClass.is_elective,
                is_cotaught: sourceClass.is_cotaught,
              })
            })
          }
        }
      }
    }
  }

  function handleValidate() {
    const errors = validatePlacements()
    setValidationErrors(errors)

    if (errors.length === 0) {
      toast("No validation errors found", { icon: successIcon })
    } else {
      toast.error(`${errors.length} validation error${errors.length !== 1 ? 's' : ''} found`, { icon: errorIcon })
    }
  }

  async function handleApplyFreeform(createNew: boolean = false) {
    if (!generation || !selectedResult || !workingSchedules) return

    const errors = validatePlacements()
    if (errors.length > 0) {
      setValidationErrors(errors)
      toast.error(`${errors.length} error${errors.length !== 1 ? 's' : ''} - fix before applying`, { icon: errorIcon })
      return
    }

    // If there are pending transfers, show review modal before proceeding
    if (pendingTransfers.length > 0) {
      setReviewTransfersModal({
        isOpen: true,
        updateDB: true,
        onConfirm: (updateDB: boolean) => proceedWithFreeformSave(createNew, updateDB)
      })
      return
    }

    proceedWithFreeformSave(createNew)
  }

  async function proceedWithFreeformSave(createNew: boolean, updateDB: boolean = false) {
    if (!generation || !selectedResult || !workingSchedules) return

    const optionIndex = parseInt(viewingOption) - 1

    // Save current state for undo (including stats for snapshot restoration)
    const previousOptions: ScheduleOption[] = JSON.parse(JSON.stringify(generation.options))
    const previousStats = generation.stats
    const previousSelectedOption = viewingOption

    // Apply transfers to snapshot if any
    let updatedStats = generation.stats
    if (pendingTransfers.length > 0 && generation.stats?.classes_snapshot && generation.stats?.teachers_snapshot) {
      const updatedSnapshot = applyTransfersToSnapshot(
        generation.stats.classes_snapshot,
        pendingTransfers,
        generation.stats.teachers_snapshot
      )
      const transferSnapshotVersion = Date.now()
      const transferAffectedTeachers = [...new Set(pendingTransfers.flatMap(t => [t.fromTeacher, t.toTeacher]))]
      updatedStats = {
        ...generation.stats,
        classes_snapshot: updatedSnapshot,
        snapshotVersion: transferSnapshotVersion,
        snapshotAffectedTeachers: transferAffectedTeachers,
      }

      // Optionally update DB class definitions
      if (updateDB && generation.stats.classes_snapshot && generation.stats.teachers_snapshot) {
        try {
          await applyTransfersToDB(
            pendingTransfers,
            generation.stats.classes_snapshot,
            generation.stats.teachers_snapshot,
            generation.quarter_id || ''
          )
        } catch (error) {
          console.error('Failed to update DB class definitions:', error)
          toast.error("Class transfers saved to schedule but failed to update database class definitions")
        }
      }
    }

    // Update studyHallAssignments if any study halls were moved
    // Note: reconciliation in recalculateOptionStats will also catch stale/removed entries
    let updatedStudyHallAssignments = [...selectedResult.studyHallAssignments]
    for (const placement of pendingPlacements) {
      const block = floatingBlocks.find(b => b.id === placement.blockId)
      if (block && isStudyHall(block.subject)) {
        // Find the study hall assignment for this grade group and update it
        const assignmentIndex = updatedStudyHallAssignments.findIndex(sh =>
          sh.group === block.grade &&
          sh.teacher === block.sourceTeacher &&
          sh.day === block.sourceDay &&
          sh.block === block.sourceBlock
        )
        if (assignmentIndex >= 0) {
          updatedStudyHallAssignments[assignmentIndex] = {
            ...updatedStudyHallAssignments[assignmentIndex],
            teacher: placement.teacher,
            day: placement.day,
            block: placement.block
          }
        }
      }
    }

    // Rebuild gradeSchedules from teacherSchedules to ensure consistency
    // This fixes issues with multi-grade classes creating phantom grade keys
    const rebuiltGradeSchedules = rebuildGradeSchedules(
      workingSchedules.teacherSchedules,
      generation.stats?.grades_snapshot,
      selectedResult.gradeSchedules // Fallback for grade keys
    )

    const updatedOption: ScheduleOption = recalculateOptionStats({
      ...selectedResult,
      teacherSchedules: workingSchedules.teacherSchedules,
      gradeSchedules: rebuiltGradeSchedules,
      studyHallAssignments: updatedStudyHallAssignments,
      // Stamp this revision as aligned with the updated snapshot (if transfers modified it)
      ...(pendingTransfers.length > 0 && updatedStats?.snapshotVersion && {
        builtWithSnapshotVersion: updatedStats.snapshotVersion,
      }),
    })

    const hasTransferSnapshots = pendingTransfers.length > 0

    // Define the save function to pass to validation modal
    const doSave = async () => {
      // Save to server
      let updatedOptions: ScheduleOption[]
      let newOptionIndex: number

      updatedOption.updatedAt = new Date().toISOString()
      if (createNew) {
        // Append as new option
        updatedOption.label = getNextLabel(generation.options)
        updatedOptions = [...generation.options, updatedOption]
        newOptionIndex = updatedOptions.length
      } else {
        // Overwrite current option — preserve label
        updatedOption.label = generation.options[optionIndex]?.label
        updatedOptions = [...generation.options]
        updatedOptions[optionIndex] = updatedOption
        newOptionIndex = optionIndex + 1
      }

      try {
        const updateRes = await fetch(`/api/history/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            options: updatedOptions,
            ...(createNew && { selected_option: newOptionIndex }),
            ...(hasTransferSnapshots && { stats: updatedStats }),
          }),
        })

        if (updateRes.ok) {
          setGeneration({
            ...generation,
            options: updatedOptions,
            ...(hasTransferSnapshots && { stats: updatedStats }),
            ...(createNew && { selected_option: newOptionIndex }),
          })
          exitFreeformMode()

          // Switch to the new option if created
          if (createNew) {
            setViewingOption(String(newOptionIndex))
          }

          // Show success toast with undo
          const moveCount = floatingBlocks.length
          const transferCount = pendingTransfers.length
          const transferSuffix = transferCount > 0 ? ` (${transferCount} transfer${transferCount !== 1 ? 's' : ''})` : ''
          const newLabel = updatedOptions[newOptionIndex - 1]?.label || ''
          const isPrimaryOpt = (generation.selected_option || 1) === newOptionIndex
          const displayOpt = createNew ? `Version ${newLabel}` : (isPrimaryOpt ? 'Published' : `Version ${newLabel}`)
          const message = createNew
            ? `Created ${displayOpt} with ${moveCount} change${moveCount !== 1 ? 's' : ''}${transferSuffix}`
            : `Applied ${moveCount} change${moveCount !== 1 ? 's' : ''} to ${displayOpt}${transferSuffix}`

          // Dismiss any existing undo toast
          if (undoToastId.current) toast.dismiss(undoToastId.current)

          const toastId = toast(
            (t) => (
              <div className="flex items-center gap-3">
                <span className="text-sm">{message}</span>
                <button
                  onClick={async () => {
                    toast.dismiss(t.id)
                    undoToastId.current = null
                    try {
                      const undoRes = await fetch(`/api/history/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          options: previousOptions,
                          ...(hasTransferSnapshots && { stats: previousStats }),
                        }),
                      })
                      if (undoRes.ok) {
                        setGeneration((prev) => prev ? {
                          ...prev,
                          options: previousOptions,
                          ...(hasTransferSnapshots && { stats: previousStats }),
                        } : prev)
                        if (createNew) {
                          setViewingOption(previousSelectedOption)
                        }
                        toast("Changes undone", { icon: successIcon })
                      } else {
                        toast.error("Failed to undo changes")
                      }
                    } catch (error) {
                      console.error('Undo error:', error)
                      toast.error("Failed to undo changes")
                    }
                  }}
                  className="px-2 py-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors"
                >
                  Undo
                </button>
              </div>
            ),
            {
              duration: 60000,
              icon: successIcon,
            }
          )
          undoToastId.current = toastId
        } else {
          toast.error("Failed to save changes")
        }
      } catch (error) {
        console.error('Apply freeform error:', error)
        toast.error("Failed to save changes")
      }
    }

    // Run validation with visual modal, then save if passed
    // Skip study hall check if study halls were stripped (will be reassigned after save)
    runValidationWithModal(updatedOption, updatedStats, doSave, 'save', {
      skipStudyHallCheck: studyHallsStripped
    })
  }

  // TWO DISTINCT CONCEPTS - DO NOT CONFUSE:
  // 1. savedOption: The ACTUAL saved schedule from generation.options (what's in the database)
  // 2. displayedOption: What's currently being SHOWN to the user (could be preview or saved)
  const savedOption = generation?.options?.[parseInt(viewingOption) - 1] || null
  const displayedOption = (previewOption && showingPreview) ? previewOption : savedOption

  // Legacy alias - gradually migrate usages to savedOption or displayedOption as appropriate
  const selectedResult = displayedOption
  const currentOption = savedOption

  // Check if current option needs class changes applied
  // Two independent scenarios (either triggers the changes banner):
  // 1. snapshotNeedsUpdate: DB classes differ from snapshot (needs snapshot update + regen)
  // 2. optionNeedsAlignment: Snapshot was updated (from DB changes or transfers on another rev),
  //    but this revision hasn't been rebuilt yet
  const snapshotNeedsUpdate = classChanges?.hasChanges || false
  const optionNeedsAlignment = (() => {
    if (!generation?.stats?.snapshotVersion) return false
    const optionVersion = savedOption?.builtWithSnapshotVersion
    return optionVersion !== generation.stats.snapshotVersion
  })()
  const optionNeedsChanges = snapshotNeedsUpdate || optionNeedsAlignment

  // Determine if we should create a new revision or update existing
  // forceCreateNew: null = auto (create if only 1 revision), true = always create, false = always update
  const shouldCreateNew = forceCreateNew !== null
    ? forceCreateNew
    : (generation?.options?.length === 1)

  // Toggle function for the revision selector
  const toggleCreateNew = () => {
    const defaultBehavior = generation?.options?.length === 1
    if (forceCreateNew === null) {
      // Currently on auto - switch to opposite of default
      setForceCreateNew(!defaultBehavior)
    } else if (forceCreateNew === defaultBehavior) {
      // Same as default - go back to auto
      setForceCreateNew(null)
    } else {
      // Opposite of default - go back to auto (which equals default)
      setForceCreateNew(null)
    }
  }

  if (loading || isPublicView === null) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!generation) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <p>Schedule not found.</p>
        <Link href="/history">
          <Button variant="outline" className="mt-4">
            Back to History
          </Button>
        </Link>
      </div>
    )
  }

  const teacherCount = selectedResult ? Object.keys(selectedResult.teacherSchedules).length : 0
  const selectedCount = selectedForRegen.size

  // Public View Mode - simplified read-only view for shared schedules
  if (isPublicView) {
    // Get the selected/primary option to display
    const publicOption = generation.selected_option
      ? generation.options[generation.selected_option - 1]
      : generation.options[0]

    if (!publicOption) {
      return (
        <div className="max-w-6xl mx-auto p-8">
          <p>Schedule not available.</p>
        </div>
      )
    }

    return (
      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">
            {generation.quarter?.name} Schedule
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{new Date(generation.generated_at).toLocaleString()}</span>
            <span className="text-slate-300">{generation.id.slice(0, 8)}</span>
          </div>
        </div>

        {/* Published indicator and Print button */}
        <div className="flex items-center justify-between mb-4 no-print">
          <div className="inline-flex rounded-lg bg-gray-100 p-1">
            <span className="px-3 py-1.5 rounded-md text-sm bg-white text-gray-900 shadow-sm font-medium flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-600" />
              Published
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Download className="h-4 w-4" />
                Export
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDownloadPng} disabled={isCapturingPng}>
                {isCapturingPng ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ImageDown className="h-4 w-4 mr-2" />}
                PNG
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* View toggle */}
        <div className="flex flex-wrap-reverse items-center justify-between gap-2 mb-4 no-print">
          <h3 className="font-semibold">
            {viewMode === "timetable" ? "Grade Timetables" : viewMode === "teacher" ? "Teacher Schedules" : "Grade Schedules"}
          </h3>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={() => {
                const url = `${window.location.origin}/history/${id}${viewMode !== "teacher" ? `?view=${viewMode}` : ""}`
                navigator.clipboard.writeText(url)
                const viewLabel = viewMode === "timetable" ? "Timetable" : viewMode === "teacher" ? "Teacher" : "Grade"
                toast.success(`${viewLabel} view link copied — shows published version`)
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Share {viewMode === "timetable" ? "Timetable" : viewMode === "teacher" ? "Teacher" : "Grade"} View</span>
              <span className="sm:hidden">Share</span>
            </Button>
            <div className="flex items-center gap-1 border rounded-md p-0.5">
              <Button
                variant={viewMode === "teacher" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("teacher")}
                className="gap-1"
              >
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Teacher</span>
              </Button>
              <Button
                variant={viewMode === "grade" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grade")}
                className="gap-1"
              >
                <GraduationCap className="h-4 w-4" />
                <span className="hidden sm:inline">Grade</span>
              </Button>
              {timetableTemplate && (
                <Button
                  variant={viewMode === "timetable" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("timetable")}
                  className="gap-1"
                >
                  <Clock className="h-4 w-4" />
                  <span className="hidden sm:inline">Timetable</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Schedule Grids */}
        {viewMode === "timetable" && timetableTemplate ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print-grid print-grid-single">
            {Object.entries(publicOption.gradeSchedules)
              .filter(([grade]) => !grade.includes("Elective"))
              .sort(([a], [b]) => gradeSort(a, b))
              .map(([gradeName, schedule]) => {
                const grade = gradesData.find(g => g.display_name === gradeName)
                const resolved = resolveRowsForGrade(timetableTemplate.rows, grade?.id || '')
                return (
                  <GradeTimetable
                    key={gradeName}
                    gradeName={gradeName}
                    gradeId={grade?.id || ''}
                    homeroomTeachers={grade?.homeroom_teachers}
                    templateRows={resolved}
                    gradeSchedule={schedule}
                  />
                )
              })}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print-grid">
            {viewMode === "teacher"
              ? Object.entries(publicOption.teacherSchedules)
                  .sort(([teacherA, scheduleA], [teacherB, scheduleB]) => {
                    const statA = publicOption.teacherStats.find(s => s.teacher === teacherA)
                    const statB = publicOption.teacherStats.find(s => s.teacher === teacherB)
                    const infoA = analyzeTeacherGrades(scheduleA)
                    const infoB = analyzeTeacherGrades(scheduleB)

                    // 1. Full-time before part-time
                    if (statA?.status === 'full-time' && statB?.status !== 'full-time') return -1
                    if (statA?.status !== 'full-time' && statB?.status === 'full-time') return 1

                    // 2. Teachers with a primary grade before those without
                    if (infoA.hasPrimary && !infoB.hasPrimary) return -1
                    if (!infoA.hasPrimary && infoB.hasPrimary) return 1

                    // 3. Sort by primary grade
                    if (infoA.primaryGrade !== infoB.primaryGrade) {
                      return infoA.primaryGrade - infoB.primaryGrade
                    }

                    // 4. Sort by grade spread
                    if (infoA.gradeSpread !== infoB.gradeSpread) {
                      return infoA.gradeSpread - infoB.gradeSpread
                    }

                    // 5. Alphabetical
                    return teacherA.localeCompare(teacherB)
                  })
                  .map(([teacher, schedule]) => (
                    <ScheduleGrid
                      key={teacher}
                      schedule={schedule}
                      type="teacher"
                      name={teacher}
                      status={publicOption.teacherStats.find(s => s.teacher === teacher)?.status}
                      classesSnapshot={generation?.stats?.classes_snapshot}
                      openBlockLabels={publicOption.openBlockLabels}
                      showOpenLabels={true}
                    />
                  ))
              : Object.entries(publicOption.gradeSchedules)
                  .sort(([a], [b]) => gradeSort(a, b))
                  .map(([grade, schedule]) => (
                    <ScheduleGrid
                      key={grade}
                      schedule={schedule}
                      type="grade"
                      name={grade}
                      classesSnapshot={generation?.stats?.classes_snapshot}
                    />
                  ))
            }
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4">
            <Link
              href="/history"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground no-print"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {generation.quarter?.name} Schedule
              {/* Star toggle */}
              <button
                onClick={() => generation.is_starred ? handleUnstar() : openStarDialog()}
                disabled={saving}
                className={`p-1.5 rounded-md transition-colors no-print ${
                  generation.is_starred
                    ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50'
                    : 'text-slate-300 hover:text-amber-500 hover:bg-amber-50'
                }`}
                title={generation.is_starred ? "Unstar schedule" : "Star schedule"}
              >
                <Star className={`h-5 w-5 ${generation.is_starred ? 'fill-amber-500' : ''}`} />
              </button>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{new Date(generation.generated_at).toLocaleString()}</span>
          <span className="text-slate-300">{generation.id.slice(0, 8)}</span>
          {userRole === "admin" && (
            generation.notes ? (
              <span className="text-slate-600 italic no-print group">
                — &ldquo;{generation.notes}&rdquo;
                <button
                  onClick={() => openStarDialog(true)}
                  className="ml-1 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-600 transition-opacity"
                  title="Edit note"
                >
                  <Pencil className="h-3 w-3 inline" />
                </button>
              </span>
            ) : (
              <button
                onClick={() => openStarDialog(true)}
                className="text-slate-400 hover:text-slate-600 no-print"
                title="Add note"
              >
                <span className="text-xs">+ Add note</span>
              </button>
            )
          )}
        </div>
      </div>

      {generation.options && generation.options.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between no-print sticky top-0 z-10 bg-white py-2 -mt-2">
            {(() => {
              const primaryIndex = (generation.selected_option || 1) - 1
              const viewingIndex = parseInt(viewingOption) - 1
              const viewingPrimary = viewingIndex === primaryIndex
              const inEditMode = swapMode || freeformMode || studyHallMode || regenMode
              const currentLabel = generation.options[viewingIndex]?.label || ''
              const hasMultiple = generation.options.length > 1

              return (
                <div className="flex items-center gap-3">
                  {hasMultiple ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          disabled={isGenerating || inEditMode}
                          className="px-2.5 py-1.5 rounded-md text-sm bg-white text-gray-900 font-medium ring-1 ring-gray-300 hover:ring-gray-400 flex items-center gap-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {viewingPrimary ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              Published
                            </>
                          ) : (
                            `Version ${currentLabel}`
                          )}
                          <ChevronDown className="h-3 w-3 text-gray-400" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {generation.options.map((opt, i) => {
                          const isPublished = i === primaryIndex
                          const healthStatus = optionHealthStatuses[i] || 'yellow'
                          const healthColor = healthStatus === 'green'
                            ? 'bg-emerald-500'
                            : healthStatus === 'yellow'
                              ? 'bg-amber-400'
                              : 'bg-red-500'
                          const healthTitle = healthStatus === 'green'
                            ? 'Complete schedule with no conflicts'
                            : healthStatus === 'yellow'
                              ? 'Incomplete schedule (missing blocks, grades, or study halls)'
                              : 'Schedule has conflicts'
                          const isViewing = viewingIndex === i
                          return (
                            <DropdownMenuItem
                              key={i}
                              onClick={() => setViewingOption((i + 1).toString())}
                              className={isViewing ? 'bg-gray-100' : ''}
                            >
                              <span className="flex items-center gap-2 w-full">
                                Version {opt.label || String.fromCharCode(65 + i)}
                                {isPublished ? (
                                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5 leading-none">
                                    Published
                                  </span>
                                ) : opt.updatedAt && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatShortDate(opt.updatedAt)}
                                  </span>
                                )}
                                <span className={`w-2 h-2 rounded-full ${healthColor} ml-auto`} title={healthTitle} />
                              </span>
                            </DropdownMenuItem>
                          )
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="px-2.5 py-1.5 rounded-md text-sm bg-white text-gray-900 font-medium ring-1 ring-gray-300 flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      Published
                    </span>
                  )}

                  {/* Draft tag + nudge when viewing a non-published version */}
                  {!viewingPrimary && (
                    <>
                      <span
                        className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 leading-none"
                        title="Only the published version is shared on public links"
                      >
                        Draft
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Not visible on shared links
                      </span>
                    </>
                  )}
                </div>
              )
            })()}

            <div className="flex items-center gap-2 no-print">
              {/* Export dropdown - hidden during modes */}
              {!previewOption && !regenMode && !swapMode && !freeformMode && !studyHallMode && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1">
                      <Download className="h-4 w-4" />
                      Export
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <a href={`/api/export?generation_id=${id}&option=${viewingOption}&format=xlsx`} download>
                        <Download className="h-4 w-4 mr-2" />
                        XLSX
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={`/api/export?generation_id=${id}&option=${viewingOption}&format=csv`} download>
                        <Download className="h-4 w-4 mr-2" />
                        CSV
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadPng} disabled={isCapturingPng}>
                      {isCapturingPng ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ImageDown className="h-4 w-4 mr-2" />}
                      PNG
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => window.print()}>
                      <Printer className="h-4 w-4 mr-2" />
                      Print
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Class Changes Indicator - small button that opens dialog */}
              {optionNeedsChanges && !dismissedForOptions.has(viewingOption) && !regenMode && !swapMode && !freeformMode && !studyHallMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowChangesDialog(true)}
                  className="gap-1.5 text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100 no-print"
                  title={snapshotNeedsUpdate ? classChanges?.summary : 'This version needs to be aligned with updated classes'}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="text-xs">
                    {snapshotNeedsUpdate
                      ? `${classChanges?.affectedTeachers.length || 0} changed`
                      : `${generation?.stats?.snapshotAffectedTeachers?.length || 0} need alignment`}
                  </span>
                </Button>
              )}

              {/* Edit menu - only visible to admin users */}
              {userRole === "admin" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isGenerating || !!previewOption || regenMode || freeformMode || studyHallMode}>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => enterRegenMode()} disabled={regenMode || swapMode || freeformMode || studyHallMode}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Regenerate Schedules
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => swapMode ? exitSwapMode() : enterSwapMode()} disabled={regenMode || freeformMode || studyHallMode}>
                      <ArrowLeftRight className="h-4 w-4 mr-2" />
                      {swapMode ? "Exit Swap Mode" : "Swap Mode"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => enterFreeformMode()} disabled={regenMode || swapMode || freeformMode || studyHallMode}>
                      <Hand className="h-4 w-4 mr-2" />
                      Freeform Mode
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => enterStudyHallMode()} disabled={regenMode || swapMode || freeformMode || studyHallMode}>
                      <Shuffle className="h-4 w-4 mr-2" />
                      Reassign Study Halls
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger disabled={regenMode || swapMode || freeformMode || studyHallMode || repairMode || !!previewOption}>
                        <AlertTriangle className="h-4 w-4 mr-2" />
                        Diagnostics
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={handleValidateSchedule}>
                          <AlertTriangle className="h-4 w-4 mr-2" />
                          Validate Schedule
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleStartRepairMode}>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Repair Schedule
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem onClick={handleDuplicateRevision} disabled={regenMode || swapMode || freeformMode || studyHallMode || repairMode}>
                      <Copy className="h-4 w-4 mr-2" />
                      Duplicate Version
                    </DropdownMenuItem>
                    {generation.selected_option !== parseInt(viewingOption) && !previewOption && (
                      <DropdownMenuItem onClick={handleMarkAsSelected}>
                        <Globe className="h-4 w-4 mr-2" />
                        Publish This Version
                      </DropdownMenuItem>
                    )}
                    {generation.options.length > 1 && !previewOption && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDeleteOption(parseInt(viewingOption) - 1)}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete {(() => {
                            const idx = parseInt(viewingOption) - 1
                            const isPrimary = (generation.selected_option || 1) === parseInt(viewingOption)
                            return isPrimary ? 'Published' : `Version ${generation.options[idx]?.label || viewingOption}`
                          })()}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {selectedResult && (
            <div className="space-y-6">
              {/* Stats Summary - hidden during edit modes */}
              {!isGenerating && !swapMode && !freeformMode && !studyHallMode && !regenMode && !repairMode && (
                <div>
                  <ScheduleStats
                    stats={selectedResult.teacherStats}
                    studyHallAssignments={selectedResult.studyHallAssignments}
                    gradeSchedules={selectedResult.gradeSchedules}
                    teacherSchedules={selectedResult.teacherSchedules}
                    backToBackIssues={selectedResult.backToBackIssues}
                    studyHallsPlaced={selectedResult.studyHallsPlaced}
                    expectedTeachingSessions={expectedTeachingSessions}
                    defaultExpanded={isNewGeneration}
                    validationIssues={savedScheduleValidationIssues}
                  />
                </div>
              )}

              {/* Mode Banners - Sticky container */}
              {(swapMode || freeformMode || regenMode || studyHallMode || repairMode) && (
                <div className="sticky top-0 z-10">
              {/* Swap Mode Banner */}
              {swapMode && (
                <div className="bg-amber-50/80 backdrop-blur-sm border border-amber-200 rounded-lg p-4 no-print">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ArrowLeftRight className="h-5 w-5 text-amber-600" />
                      <div>
                        <span className="text-amber-800 font-medium">Swap Mode Active</span>
                        <p className="text-sm text-amber-600">
                          {viewMode === "teacher" ? (
                            selectedCell
                              ? isStudyHall(selectedCell.subject)
                                ? `Selected Study Hall (${selectedCell.day} B${selectedCell.block}). Click another teacher's OPEN slot to reassign supervision.`
                                : isOpenBlock(selectedCell.subject)
                                  ? `Selected OPEN block (${selectedCell.day} B${selectedCell.block}). Click another OPEN to exchange.`
                                  : `Selected ${selectedCell.grade} ${selectedCell.subject} (${selectedCell.day} B${selectedCell.block}). Click a highlighted slot to exchange.`
                              : "Click a class to exchange a time slot. Or exchange a Study Hall with another teacher's OPEN slot."
                          ) : (
                            selectedCell
                              ? isStudyHall(selectedCell.subject)
                                ? `Selected Study Hall (${selectedCell.day} B${selectedCell.block}). Click another teacher's OPEN slot to reassign supervision.`
                                : `Selected ${selectedCell.subject} (${selectedCell.day} B${selectedCell.block}). Click a highlighted slot to exchange.`
                              : "Click a class to exchange a time slot. Or exchange a Study Hall with another teacher's OPEN slot."
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exitSwapMode}
                        className="text-amber-700 border-amber-300 hover:bg-amber-100"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleApplySwap(shouldCreateNew)}
                        className="bg-amber-600 hover:bg-amber-700 text-white"
                        disabled={swapCount === 0}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Save
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <div className="flex items-center gap-4">
                      <div className="inline-flex rounded-md bg-white border border-slate-200 p-0.5">
                        <button
                          onClick={() => setShowingPreview(false)}
                          className={`px-2 py-0.5 font-medium rounded transition-colors ${
                            !showingPreview
                              ? 'bg-slate-700 text-white'
                              : 'text-slate-600 hover:text-slate-800'
                          }`}
                        >
                          Original
                        </button>
                        <button
                          onClick={() => setShowingPreview(true)}
                          className={`px-2 py-0.5 font-medium rounded transition-colors ${
                            showingPreview
                              ? 'bg-amber-600 text-white'
                              : 'text-slate-600 hover:text-slate-800'
                          }`}
                        >
                          Preview
                        </button>
                      </div>
                      <span className="text-amber-600">
                        {swapCount} swap{swapCount !== 1 ? 's' : ''} pending
                      </span>
                      {validTargets.length > 0 && (
                        <span className="text-amber-600">
                          {validTargets.length} valid target{validTargets.length !== 1 ? 's' : ''} available
                        </span>
                      )}
                      {validationErrors.length > 0 && (
                        <span className="text-red-600 font-medium">
                          {validationErrors.length} {swapCount === 0 ? 'existing conflict' : 'conflict'}{validationErrors.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={toggleCreateNew}
                      className="text-amber-600/70 hover:text-amber-700 cursor-pointer select-none"
                      title="Click to toggle"
                    >
                      {shouldCreateNew ? 'Save as new version' : 'Update ' + ((generation.selected_option || 1) === parseInt(viewingOption) ? 'Published' : 'Version ' + (generation.options[parseInt(viewingOption) - 1]?.label || viewingOption))}
                    </button>
                  </div>
                  {/* Validation errors list */}
                  {validationErrors.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-amber-200">
                      <div className="text-xs font-medium text-red-600 mb-1">
                        {swapCount === 0 ? 'Existing conflicts in schedule:' : 'Schedule conflicts:'}
                      </div>
                      <ul className="text-xs space-y-1 text-red-600">
                        {validationErrors.slice(0, 5).map((error, idx) => (
                          <li key={idx} className="flex items-center gap-2">
                            <span className="text-red-400">•</span>
                            <span>{error.message}</span>
                          </li>
                        ))}
                        {validationErrors.length > 5 && (
                          <li className="text-red-500 ml-4">...and {validationErrors.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Freeform Mode Banner */}
              {freeformMode && (
                <div className="bg-indigo-50/80 backdrop-blur-sm border border-indigo-200 rounded-lg p-4 no-print">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Hand className="h-5 w-5 text-indigo-600" />
                      <div>
                        <span className="text-indigo-800 font-medium">Freeform Mode</span>
                        <p className="text-sm text-indigo-600">
                          {conflictResolution
                            ? `Fix preview: ${conflictResolution.movedBlockers.length} blocking class${conflictResolution.movedBlockers.length !== 1 ? 'es were' : ' was'} moved (pulsing). Accept, try different, or undo.`
                            : selectedFloatingBlock
                              ? "Click a slot to place the selected block"
                              : floatingBlocks.length === 0
                                ? "Click any class to pick it up and move it to a different time slot."
                                : "Select a floating block, then click a slot to place it. Use Check & Fix to resolve conflicts."}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Main freeform buttons */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleValidate}
                        className="text-indigo-600 border-indigo-300 hover:bg-indigo-100"
                        disabled={floatingBlocks.length === 0 || !!conflictResolution}
                      >
                        <AlertTriangle className="h-4 w-4 mr-1" />
                        Validate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exitFreeformMode}
                        className="text-indigo-600 border-indigo-300 hover:bg-indigo-100"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleApplyFreeform(shouldCreateNew)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        disabled={floatingBlocks.length === 0 || !!conflictResolution}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Save
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <div className="flex items-center gap-4">
                      <div className="inline-flex rounded-md bg-white border border-slate-200 p-0.5">
                        <button
                          onClick={() => setShowingPreview(false)}
                          className={`px-2 py-0.5 font-medium rounded transition-colors ${
                            !showingPreview
                              ? 'bg-slate-700 text-white'
                              : 'text-slate-600 hover:text-slate-800'
                          }`}
                        >
                          Original
                        </button>
                        <button
                          onClick={() => setShowingPreview(true)}
                          className={`px-2 py-0.5 font-medium rounded transition-colors ${
                            showingPreview
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-600 hover:text-slate-800'
                          }`}
                        >
                          Preview
                        </button>
                      </div>
                      <span className="text-indigo-600">
                        {floatingBlocks.length} picked up
                      </span>
                      <span className="text-indigo-600">
                        {pendingPlacements.length} placed
                      </span>
                      {pendingTransfers.length > 0 && (
                        <span className="text-blue-600">
                          {pendingTransfers.length} transfer{pendingTransfers.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {/* Status indicators */}
                      {conflictingBlockIds.length > 0 && !conflictResolution && (
                        <span className="text-amber-600 font-medium">
                          {conflictingBlockIds.length} conflict{conflictingBlockIds.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {conflictResolution && (
                        <span className="text-amber-600 font-medium">
                          {conflictResolution.movedBlockers.length} moved
                        </span>
                      )}
                      {validationErrors.length > 0 && !conflictResolution && conflictingBlockIds.length === 0 && (
                        <span className="text-red-600 font-medium">
                          {validationErrors.length} issue{validationErrors.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {/* Study Hall hide toggle - inline with status indicators */}
                      {!conflictResolution && (
                        <label className="border-l border-indigo-300 pl-3 ml-1 flex items-center gap-1.5 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={studyHallsStripped}
                            onChange={() => {
                              if (studyHallsStripped) {
                                handleRestoreStudyHalls()
                              } else {
                                handleStripStudyHalls()
                              }
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className={studyHallsStripped ? "text-indigo-700" : "text-indigo-600"}>
                            Clear Study Halls
                          </span>
                          {studyHallsStripped ? (
                            <span className="text-indigo-500 font-medium">({strippedStudyHalls.length} cleared)</span>
                          ) : (
                            <span className="text-slate-400 group-hover:text-slate-500">(easier editing)</span>
                          )}
                        </label>
                      )}
                    </div>
                    <button
                      onClick={toggleCreateNew}
                      className="text-indigo-600/70 hover:text-indigo-700 cursor-pointer select-none"
                      title="Click to toggle"
                    >
                      {shouldCreateNew ? 'Save as new version' : 'Update ' + ((generation.selected_option || 1) === parseInt(viewingOption) ? 'Published' : 'Version ' + (generation.options[parseInt(viewingOption) - 1]?.label || viewingOption))}
                    </button>
                  </div>
                  {/* Two-column area: Conflicts (left) + Grade Schedule (right) */}
                  {!conflictResolution && (validationErrors.length > 0 || selectedFloatingBlock) && (
                    <div className="mt-3 pt-3 border-t border-indigo-200 grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Left column: Validation errors */}
                      {validationErrors.length > 0 ? (
                        <div className="min-w-0">
                          <div className={`text-xs font-medium mb-1 ${conflictingBlockIds.length > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                            {conflictingBlockIds.length > 0 ? 'Conflicts:' : 'Existing conflicts in schedule:'}
                          </div>
                          <ul className={`text-xs space-y-1 ${conflictingBlockIds.length > 0 ? 'text-amber-700' : 'text-red-600'}`}>
                            {validationErrors.map((error, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <span className={`mt-0.5 ${conflictingBlockIds.length > 0 ? 'text-amber-500' : 'text-red-400'}`}>•</span>
                                <span className="flex-1">{error.message}</span>
                                {error.blockId && conflictingBlockIds.includes(error.blockId) && (
                                  <button
                                    onClick={() => handleCheckAndFix(error.blockId)}
                                    className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded transition-colors"
                                  >
                                    Fix
                                  </button>
                                )}
                              </li>
                            ))}
                            {conflictingBlockIds.length > 1 && (
                              <li className="flex items-center pt-1">
                                <button
                                  onClick={() => handleCheckAndFix()}
                                  className="px-1.5 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded transition-colors"
                                >
                                  Auto-fix all conflicts
                                </button>
                              </li>
                            )}
                          </ul>
                        </div>
                      ) : selectedFloatingBlock ? (
                        <div></div>
                      ) : null}

                      {/* Right column: Grade Schedule */}
                      {selectedFloatingBlock && workingSchedules && (() => {
                        const selectedBlock = floatingBlocks.find(b => b.id === selectedFloatingBlock)
                        if (!selectedBlock) return null
                        // Rebuild grade schedules from current teacherSchedules (source of truth during freeform)
                        // workingSchedules.gradeSchedules is stale — not updated during freeform editing
                        const liveGradeSchedules = rebuildGradeSchedules(
                          workingSchedules.teacherSchedules,
                          generation?.stats?.grades_snapshot,
                          workingSchedules.gradeSchedules
                        )
                        const gradeSchedule = liveGradeSchedules[selectedBlock.grade]
                        if (!gradeSchedule) return null
                        const DAYS_LIST = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']

                        return (
                          <div className="min-w-0 rounded-lg ring-2 ring-green-400/60 bg-green-50/30 p-2">
                            <div className="flex items-baseline gap-1.5 mb-1.5">
                              <span className="text-xs font-medium text-green-800">Grade Schedule</span>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded border bg-green-50 border-green-200 text-xs">
                                <span className="font-medium leading-tight">{selectedBlock.grade.replace(' Grade', '').replace('Kindergarten', 'K')}</span>
                                <span className="text-[10px] text-muted-foreground ml-1">{selectedBlock.subject}</span>
                              </span>
                              <span className="text-[10px] text-green-600">— placing into {selectedBlock.grade} schedule</span>
                            </div>
                            <div className="grid gap-x-1 gap-y-0.5 text-[10px]" style={{ gridTemplateColumns: 'auto repeat(5, 1fr)' }}>
                              <div></div>
                              {DAYS_LIST.map(day => (
                                <div key={day} className="text-center font-medium text-slate-500 text-[9px]">
                                  {day}
                                </div>
                              ))}
                              {[1, 2, 3, 4, 5].map(block => (
                                <Fragment key={block}>
                                  <div className="text-[9px] font-medium text-slate-500 flex items-center pr-1">
                                    B{block}
                                  </div>
                                  {DAYS_LIST.map(day => {
                                    const cell = gradeSchedule[day]?.[block]
                                    const entry = getFirstGradeEntry(cell)
                                    const isOpen = !entry || entry[1] === 'OPEN'
                                    const isSH = entry && isStudyHall(entry[1])
                                    const isMultiple = isMultipleEntryCell(cell)
                                    const teacher = entry?.[0] || ''
                                    const subject = isMultiple ? 'Elective' : (entry?.[1] || '')

                                    return (
                                      <div
                                        key={`${day}-${block}`}
                                        className={`px-1 py-0.5 rounded text-center overflow-hidden ${
                                          isOpen
                                            ? 'bg-green-100 text-green-700 font-semibold border border-green-400 ring-1 ring-green-300'
                                            : isSH
                                              ? 'bg-blue-50 border border-blue-200'
                                              : isMultiple
                                                ? 'bg-purple-50 border border-purple-200'
                                                : 'bg-slate-50 border border-slate-200'
                                        }`}
                                        title={isOpen ? `OPEN - ${day} B${block}` : isMultiple ? 'Elective' : `${teacher}: ${subject}`}
                                      >
                                        {isOpen ? (
                                          <span>OPEN</span>
                                        ) : (
                                          <>
                                            <div className="font-medium text-[9px] leading-tight truncate">{subject}</div>
                                            <div className="text-[8px] leading-tight text-muted-foreground truncate">{teacher.split(' ')[0]}</div>
                                          </>
                                        )}
                                      </div>
                                    )
                                  })}
                                </Fragment>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )}

                </div>
              )}

              {/* Floating Fix buttons - appears below freeform banner when conflict resolution is active */}
              {freeformMode && conflictResolution && (
                <div className="flex justify-center mt-1 mb-2 no-print">
                  <div className="flex items-center gap-4 px-4 py-2 bg-amber-50 border border-amber-300 rounded-lg shadow-md">
                    <div className="text-xs text-amber-700">
                      To place{' '}
                      {conflictResolution.blockersList.map((b, i) => {
                        const block = floatingBlocks.find(f => f.id === b.blockedPlacement.blockId)
                        return (
                          <span key={i}>
                            {i > 0 && ', '}
                            <span className="font-semibold text-amber-900">{b.blockedPlacement.teacher}</span>'s {block?.grade} {block?.subject}
                          </span>
                        )
                      })}
                      , moved{' '}
                      {conflictResolution.movedBlockers.map((m, i) => (
                        <span key={i}>
                          {i > 0 && ', '}
                          <span className="font-semibold text-amber-900">{m.from.teacher}</span>'s {m.grade} {m.subject} to {m.to.day} B{m.to.block}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTryDifferentFix}
                        className="text-amber-700 border-amber-400 hover:bg-amber-100"
                      >
                        <Shuffle className="h-4 w-4 mr-1" />
                        Try Different
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUndoFix}
                        className="text-amber-700 border-amber-400 hover:bg-amber-100"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Undo
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleAcceptFix}
                        className="bg-amber-500 hover:bg-amber-600 text-white"
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Accept Fix
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Study Hall Mode Banner */}
              {studyHallMode && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 no-print">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Shuffle className="h-5 w-5 text-violet-600" />
                      <div>
                        <span className="text-violet-800 font-medium">Reassign Study Halls</span>
                        <p className="text-sm text-violet-600">
                          {previewOption
                            ? "Preview generated. Click Randomize for a different arrangement."
                            : "Click Randomize to generate a new study hall arrangement."}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={generateStudyHallArrangement}
                        className="text-violet-600 border-violet-300 hover:bg-violet-100"
                      >
                        <Shuffle className="h-4 w-4 mr-1" />
                        Randomize
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setManualStudyHallMode(!manualStudyHallMode)
                          setSelectedStudyHallGroup(null)
                        }}
                        className={manualStudyHallMode
                          ? "bg-violet-100 text-violet-700 border-violet-400"
                          : "text-violet-600 border-violet-300 hover:bg-violet-100"
                        }
                      >
                        <Hand className="h-4 w-4 mr-1" />
                        Place manually
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearAllStudyHalls}
                        className="text-amber-600 border-amber-300 hover:bg-amber-100"
                        title="Remove all study halls (convert to OPEN)"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Clear All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exitStudyHallMode}
                        className="text-slate-600 border-slate-300 hover:bg-slate-100"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleKeepPreview(shouldCreateNew)}
                        className="bg-violet-600 hover:bg-violet-700 text-white"
                        disabled={!previewOption}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Save
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <div className="flex items-center gap-4">
                      <div className="inline-flex rounded-md bg-white border border-slate-200 p-0.5">
                        <button
                          onClick={() => setShowingPreview(false)}
                          className={`px-2 py-0.5 font-medium rounded transition-colors ${
                            !showingPreview
                              ? 'bg-slate-700 text-white'
                              : 'text-slate-600 hover:text-slate-800'
                          }`}
                        >
                          Original
                        </button>
                        <button
                          onClick={() => previewOption && setShowingPreview(true)}
                          disabled={!previewOption}
                          className={`px-2 py-0.5 font-medium rounded transition-colors ${
                            showingPreview && previewOption
                              ? 'bg-violet-600 text-white'
                              : previewOption
                                ? 'text-slate-600 hover:text-slate-800'
                                : 'text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          Preview
                        </button>
                      </div>
                      {unplacedStudyHalls.length > 0 && (
                        <span className="text-red-600 font-medium">
                          {unplacedStudyHalls.length} unplaced
                        </span>
                      )}
                    </div>
                    <button
                      onClick={toggleCreateNew}
                      className="text-violet-600/70 hover:text-violet-700 cursor-pointer select-none"
                      title="Click to toggle"
                    >
                      {shouldCreateNew ? 'Save as new version' : 'Update ' + ((generation.selected_option || 1) === parseInt(viewingOption) ? 'Published' : 'Version ' + (generation.options[parseInt(viewingOption) - 1]?.label || viewingOption))}
                    </button>
                  </div>
                  {/* Unplaced study halls validation */}
                  {unplacedStudyHalls.length > 0 && !manualStudyHallMode && (
                    <div className="mt-3 pt-3 border-t border-violet-200">
                      <div className="text-xs font-medium text-red-600 mb-1">
                        Unplaced study halls:
                      </div>
                      <ul className="text-xs space-y-1 text-red-600">
                        {unplacedStudyHalls.map((sh: { group: string }, idx: number) => (
                          <li key={idx} className="flex items-center gap-2">
                            <span className="text-red-400">•</span>
                            <span>{sh.group} — not assigned</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Manual placement: two-column — errors left, study hall blocks right */}
                  {manualStudyHallMode && (
                    <div className="mt-3 pt-3 border-t border-violet-200 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
                      {/* Left column: validation / status */}
                      <div className="min-w-0">
                        {unplacedStudyHalls.length > 0 && (
                          <>
                            <div className="text-xs font-medium text-red-600 mb-1">
                              Unplaced study halls:
                            </div>
                            <ul className="text-xs space-y-1 text-red-600">
                              {unplacedStudyHalls.map((sh: { group: string }, idx: number) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <span className="text-red-400">•</span>
                                  <span>{sh.group} — not assigned</span>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {unplacedStudyHalls.length === 0 && (
                          <div className="text-xs text-emerald-600 font-medium">
                            All study halls placed
                          </div>
                        )}
                      </div>

                      {/* Right column: study hall blocks styled like schedule cells */}
                      <div className="flex flex-wrap gap-2 items-start">
                        {unplacedStudyHalls.map((sh: { group: string }) => (
                          <button
                            key={sh.group}
                            onClick={() => setSelectedStudyHallGroup(
                              selectedStudyHallGroup === sh.group ? null : sh.group
                            )}
                            className={`w-[72px] rounded border text-center transition-colors cursor-pointer ${
                              selectedStudyHallGroup === sh.group
                                ? 'bg-white border-violet-400 ring-2 ring-violet-500 shadow-sm'
                                : 'bg-white/80 border-gray-300 hover:border-violet-400 hover:shadow-sm'
                            }`}
                            style={{ padding: '4px 6px' }}
                          >
                            <div className="font-medium text-xs leading-tight truncate text-gray-800">
                              {sh.group}
                            </div>
                            <div className="text-[10px] leading-tight text-gray-500 truncate">
                              Study Hall
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Repair Mode Banner */}
              {repairMode && repairAnalysis && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 no-print">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="h-5 w-5 text-blue-600" />
                      <div>
                        <span className="text-blue-800 font-medium">Repair Schedule</span>
                        <p className="text-sm text-blue-600">
                          {repairAnalysis.summary}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!repairPreview && (repairAnalysis.phantomGrades.length > 0 || repairAnalysis.orphanAnalysis === 'extra') && (
                        <Button
                          size="sm"
                          onClick={handlePreviewRepair}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          Preview Repair
                        </Button>
                      )}
                      {repairPreview && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRepairPreview(null)}
                            className="text-blue-600 border-blue-300 hover:bg-blue-100"
                          >
                            Cancel Preview
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleApplyRepair}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Apply Repair
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExitRepairMode}
                        className="text-slate-600 border-slate-300 hover:bg-slate-100"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Close
                      </Button>
                    </div>
                  </div>

                  {/* Repair Preview Info */}
                  {repairPreview && (
                    <div className="mt-3 p-2 bg-blue-100 rounded text-sm text-blue-800">
                      <span className="font-medium">Preview: </span>
                      {repairPreview.fixesApplied.map((fix, i) => (
                        <span key={i}>{i > 0 ? ', ' : ''}{fix}</span>
                      ))}
                    </div>
                  )}

                  {/* Detailed Analysis */}
                  <div className="mt-3 space-y-3">
                    {/* Summary Stats */}
                    <div className="flex gap-4 text-sm">
                      <span className="text-blue-700">
                        <span className="font-medium">{repairAnalysis.classesInSnapshot}</span> classes in snapshot
                      </span>
                      {repairAnalysis.phantomGrades.length > 0 && (
                        <span className="text-red-600">
                          <span className="font-medium">{repairAnalysis.phantomGrades.length}</span> phantom grade(s)
                        </span>
                      )}
                      {repairAnalysis.orphanEntries > 0 && (
                        <span className="text-amber-600">
                          <span className="font-medium">{repairAnalysis.orphanEntries}</span> orphan entries
                        </span>
                      )}
                    </div>

                    {/* Phantom Grades Detail */}
                    {repairAnalysis.phantomGrades.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded p-2">
                        <div className="text-sm font-medium text-red-800 mb-1">Phantom Grades Found:</div>
                        <div className="text-sm text-red-700">
                          {repairAnalysis.phantomGrades.map((g, i) => (
                            <span key={g} className="inline-block bg-red-100 px-2 py-0.5 rounded mr-1 mb-1">
                              {g}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-red-600 mt-1">
                          These grades don't exist in the grades snapshot. They may have been created when multi-grade classes were moved.
                          Clicking "Preview Repair" will rebuild gradeSchedules using only valid grades.
                        </p>
                      </div>
                    )}

                    {/* Orphan Entries Analysis */}
                    {repairAnalysis.orphanEntries > 0 && repairAnalysis.orphanGuidance && (
                      <div className={`border rounded p-2 ${
                        repairAnalysis.orphanAnalysis === 'extra'
                          ? 'bg-emerald-50 border-emerald-200'
                          : 'bg-amber-50 border-amber-200'
                      }`}>
                        <div className={`text-sm font-medium mb-1 ${
                          repairAnalysis.orphanAnalysis === 'extra' ? 'text-emerald-800' : 'text-amber-800'
                        }`}>
                          Orphan Entry Analysis:
                        </div>
                        <p className={`text-xs ${
                          repairAnalysis.orphanAnalysis === 'extra' ? 'text-emerald-700' : 'text-amber-700'
                        }`}>
                          {repairAnalysis.orphanGuidance}
                        </p>
                        {repairAnalysis.orphanAnalysis === 'extra' && (
                          <p className="text-xs text-emerald-600 mt-1 italic">
                            These entries don't match any class in the snapshot (wrong teacher+subject combination).
                            Since all snapshot classes are fully placed, these appear to be duplicates or bugs.
                          </p>
                        )}
                        {repairAnalysis.orphanAnalysis === 'possibly_unlinked' && (
                          <p className="text-xs text-amber-600 mt-1 italic">
                            The snapshot itself is never modified during editing - if orphans and missing sessions exist,
                            the schedule entries may have corrupted teacher/subject/grade data that no longer matches the snapshot definition.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Issues List */}
                    {repairAnalysis.issues.length > 0 && (
                      <details className="group">
                        <summary className="cursor-pointer text-sm font-medium text-blue-800 hover:text-blue-900">
                          View all {repairAnalysis.issues.length} issue{repairAnalysis.issues.length !== 1 ? 's' : ''} →
                        </summary>
                        <div className="mt-2 max-h-60 overflow-y-auto space-y-1 text-xs">
                          {repairAnalysis.issues.map((issue, i) => (
                            <div
                              key={i}
                              className={`p-2 rounded ${
                                issue.severity === 'error' ? 'bg-red-50 text-red-800' :
                                issue.severity === 'warning' ? 'bg-amber-50 text-amber-800' :
                                'bg-slate-50 text-slate-700'
                              }`}
                            >
                              <span className="font-medium">[{issue.type.replace('_', ' ')}]</span>{' '}
                              {issue.description}
                              {issue.day && issue.block && (
                                <span className="text-slate-500 ml-1">
                                  at {issue.day} B{issue.block}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {repairAnalysis.issues.length === 0 && (
                      <div className="text-sm text-emerald-700 bg-emerald-50 rounded p-2">
                        ✓ Schedule data appears consistent with the classes snapshot.
                        If stats still look wrong, try doing a simple swap and save to trigger a gradeSchedules rebuild.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Regen Mode Banner */}
              {regenMode && (
                <div className="bg-sky-50/80 backdrop-blur-sm border border-sky-200 rounded-lg p-4 no-print space-y-3">
                  {/* Updated Class Configuration Notice */}
                  {useCurrentClasses && !isGenerating && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md overflow-hidden">
                      <button
                        onClick={() => setChangesExpanded(!changesExpanded)}
                        className="w-full flex items-start gap-3 text-sm text-amber-800 px-3 py-2.5 hover:bg-amber-100/50 transition-colors text-left"
                      >
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">Applying the changed class configuration</div>
                          <div className="text-xs text-amber-600 mt-0.5">
                            {classChanges?.affectedTeachers.length || 0} affected teacher{classChanges?.affectedTeachers.length !== 1 ? "s are" : " is"} selected.
                            Press Regenerate to apply the updated classes to {classChanges?.affectedTeachers.length !== 1 ? "their" : "this"} schedule{classChanges?.affectedTeachers.length !== 1 ? "s" : ""}.
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-amber-600 flex-shrink-0">
                          <span>{changesExpanded ? "Hide" : "View"} {classChanges?.changes.length || 0} change{classChanges?.changes.length !== 1 ? "s" : ""}</span>
                          {changesExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </div>
                      </button>
                      {changesExpanded && classChanges && classChanges.changes.length > 0 && (
                        <div className="border-t border-amber-200 px-3 py-2 max-h-40 overflow-y-auto bg-amber-50/50">
                          <ul className="text-xs text-amber-800 space-y-1">
                            {classChanges.changes.map((change, idx) => (
                              <li key={idx} className="flex items-start gap-1.5">
                                <span className={`font-medium ${
                                  change.type === 'added' ? 'text-emerald-600' :
                                  change.type === 'removed' ? 'text-red-600' :
                                  'text-amber-600'
                                }`}>
                                  {change.type === 'added' ? '+' : change.type === 'removed' ? '−' : '~'}
                                </span>
                                <span>
                                  <span className="font-medium">{change.teacherName}</span>: {change.gradeName} {change.subjectName}
                                  {change.details && <span className="text-amber-600"> ({change.details})</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {isGenerating ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-sky-700 font-medium">
                          {generationProgress.message || "Generating..."}
                        </span>
                        <span className="text-sky-600">
                          {generationProgress.current === -1
                            ? "100%"
                            : generationProgress.total > 0
                              ? `${Math.round((generationProgress.current / generationProgress.total) * 100)}%`
                              : "0%"}
                        </span>
                      </div>
                      <div className="w-full bg-sky-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-sky-500 h-2.5 rounded-full transition-all duration-300"
                          style={{
                            width: generationProgress.current === -1
                              ? "100%"
                              : generationProgress.total > 0
                                ? `${(generationProgress.current / generationProgress.total) * 100}%`
                                : "0%"
                          }}
                        />
                      </div>
                      <p className="text-xs text-sky-600 flex items-center gap-1.5">
                        {generationProgress.current === -1 ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Wrapping up...
                          </>
                        ) : (
                          `Attempt ${generationProgress.current} of ${generationProgress.total}`
                        )}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <RefreshCw className="h-5 w-5 text-sky-600" />
                          <div>
                            <span className="text-sky-800 font-medium">Regenerate Schedules</span>
                            <p className="text-sm text-sky-600">
                              {previewOption
                                ? "Preview generated. Save as a new option, or select different teachers and regenerate."
                                : "Select teachers to regenerate their schedules. Other teachers remain locked."}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRegenerate}
                            className="text-sky-600 border-sky-300 hover:bg-sky-100"
                            disabled={selectedCount === 0}
                          >
                            <RefreshCw className="h-4 w-4 mr-1" />
                            Regenerate
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={exitRegenMode}
                            className="text-slate-600 border-slate-300 hover:bg-slate-100"
                          >
                            <X className="h-4 w-4 mr-1" />
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleKeepPreview(shouldCreateNew)}
                            className="bg-sky-600 hover:bg-sky-700 text-white"
                            disabled={!previewOption}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Save
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs">
                        <div className="flex items-center gap-4">
                          {previewOption && (
                            <div className="inline-flex rounded-md bg-white border border-slate-200 p-0.5">
                              <button
                                onClick={() => setShowingPreview(false)}
                                className={`px-2 py-0.5 font-medium rounded transition-colors ${
                                  !showingPreview
                                    ? 'bg-slate-700 text-white'
                                    : 'text-slate-600 hover:text-slate-800'
                                }`}
                              >
                                Original
                              </button>
                              <button
                                onClick={() => setShowingPreview(true)}
                                className={`px-2 py-0.5 font-medium rounded transition-colors ${
                                  showingPreview
                                    ? 'bg-sky-600 text-white'
                                    : 'text-slate-600 hover:text-slate-800'
                                }`}
                              >
                                Preview
                              </button>
                            </div>
                          )}
                          <span className="text-sky-600">
                            {selectedCount} teacher{selectedCount !== 1 ? 's' : ''} selected
                          </span>
                          {selectedCount > 0 && !previewOption && (
                            <button
                              onClick={clearSelections}
                              className="text-sky-500 hover:text-sky-700 hover:underline"
                            >
                              clear selection
                            </button>
                          )}
                          {/* Show "select affected" when there are conflicts and not all affected teachers are selected */}
                          {!previewOption && validationErrors.length > 0 && (() => {
                            const affected = getAffectedTeachersFromErrors(validationErrors)
                            const allSelected = affected.size > 0 && Array.from(affected).every(t => selectedForRegen.has(t))
                            if (affected.size === 0 || allSelected) return null
                            return (
                              <button
                                onClick={selectAffectedTeachers}
                                className="text-red-500 hover:text-red-700 hover:underline"
                              >
                                select affected ({affected.size})
                              </button>
                            )
                          })()}
                          <label className="border-l border-sky-300 pl-3 ml-1 flex items-center gap-1.5 cursor-pointer group" title="When enabled, study halls are not assigned during regeneration. You can reassign them manually after saving.">
                            <input
                              type="checkbox"
                              checked={skipStudyHalls}
                              onChange={(e) => setSkipStudyHalls(e.target.checked)}
                              className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                            />
                            <span className={skipStudyHalls ? "text-sky-700" : "text-sky-600"}>
                              Skip Study Halls
                            </span>
                            {skipStudyHalls ? (
                              <span className="text-sky-500 font-medium">(reassign after)</span>
                            ) : (
                              <span className="text-slate-400 group-hover:text-slate-500">(faster results)</span>
                            )}
                          </label>
                        </div>
                        <button
                          onClick={toggleCreateNew}
                          className="text-sky-600/70 hover:text-sky-700 cursor-pointer select-none"
                          title="Click to toggle"
                        >
                          {shouldCreateNew ? 'Save as new version' : 'Update ' + ((generation.selected_option || 1) === parseInt(viewingOption) ? 'Published' : 'Version ' + (generation.options[parseInt(viewingOption) - 1]?.label || viewingOption))}
                        </button>
                      </div>
                      {/* Validation errors and soft warnings */}
                      {(() => {
                        // Filter out study_hall_coverage errors when showing preview (already shown in amber warning)
                        const displayErrors = previewOption
                          ? validationErrors.filter(e => e.type !== 'study_hall_coverage')
                          : validationErrors
                        if (displayErrors.length === 0) return null
                        const { hard, soft } = splitValidationErrors(displayErrors)
                        return (
                          <>
                            {hard.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-sky-200">
                                <div className="text-xs font-medium text-red-600 mb-1">
                                  {previewOption ? 'Schedule conflicts:' : 'Existing conflicts in schedule:'}
                                </div>
                                <ul className="text-xs space-y-1 text-red-600">
                                  {hard.slice(0, 5).map((error, idx) => (
                                    <li key={idx} className="flex items-center gap-2">
                                      <span className="text-red-400">•</span>
                                      <span>{error.message}</span>
                                    </li>
                                  ))}
                                  {hard.length > 5 && (
                                    <li className="text-red-500 ml-4">...and {hard.length - 5} more</li>
                                  )}
                                </ul>
                              </div>
                            )}
                            {soft.length > 0 && (
                              <div className={`${hard.length > 0 ? 'mt-2' : 'mt-3 pt-3 border-t border-sky-200'}`}>
                                <ul className="text-xs space-y-0.5 text-slate-500">
                                  {soft.map((warn, idx) => (
                                    <li key={idx} className="flex items-center gap-1.5">
                                      <span className="text-amber-400 text-[10px]">⚠</span>
                                      <span>{warn.message}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </>
                  )}
                </div>
              )}
                </div>
              )}

              {/* Schedule Grids */}
              <div>
                <div className="flex flex-wrap-reverse items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold">
                      {viewMode === "timetable" ? "Grade Timetables" : viewMode === "teacher" ? "Teacher Schedules" : "Grade Schedules"}
                    </h3>
                    {/* Annotate open blocks toggle - only for admin users in teacher view, hidden during edit modes */}
                    {userRole === "admin" && viewMode === "teacher" && !regenMode && !swapMode && !freeformMode && !studyHallMode && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const next = !showOpenLabels
                          setShowOpenLabels(next)
                          if (next) toast("Tap any Open block to add a label", { icon: <Pencil className="h-4 w-4 text-gray-500" /> })
                        }}
                        className="gap-1 no-print text-muted-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {showOpenLabels ? "Done Annotating" : "Annotate Open Blocks"}
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 ml-auto no-print">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-muted-foreground"
                      onClick={() => {
                        const url = `${window.location.origin}/history/${id}${viewMode !== "teacher" ? `?view=${viewMode}` : ""}`
                        navigator.clipboard.writeText(url)
                        const viewLabel = viewMode === "timetable" ? "Timetable" : viewMode === "teacher" ? "Teacher" : "Grade"
                        toast.success(`${viewLabel} view link copied — shows published version`)
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Share {viewMode === "timetable" ? "Timetable" : viewMode === "teacher" ? "Teacher" : "Grade"} View</span>
                      <span className="sm:hidden">Share</span>
                    </Button>
                    <div className="flex items-center gap-1 border rounded-md p-0.5">
                      <Button
                        variant={viewMode === "teacher" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => {
                          setViewMode("teacher")
                          setSelectedCell(null)
                          setValidTargets([])
                        }}
                        disabled={isGenerating}
                        className="gap-1"
                      >
                        <Users className="h-4 w-4" />
                        <span className="hidden sm:inline">Teacher</span>
                      </Button>
                      <Button
                        variant={viewMode === "grade" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => {
                          setViewMode("grade")
                          setSelectedCell(null)
                          setValidTargets([])
                        }}
                        disabled={isGenerating}
                        className="gap-1"
                      >
                        <GraduationCap className="h-4 w-4" />
                        <span className="hidden sm:inline">Grade</span>
                      </Button>
                      {timetableTemplate && (
                        <Button
                          variant={viewMode === "timetable" ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => setViewMode("timetable")}
                          disabled={isGenerating}
                          className="gap-1"
                        >
                          <Clock className="h-4 w-4" />
                          <span className="hidden sm:inline">Timetable</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                {/* Show message when in regen preview mode */}
                {previewOption && previewType === "regen" && previewTeachers.size > 0 && viewMode === "teacher" && (() => {
                  const expectedSH = previewOption.studyHallAssignments?.length || 0
                  const placedSH = previewOption.studyHallsPlaced || 0
                  const missingSH = expectedSH - placedSH
                  const btbIssues = previewOption.backToBackIssues || 0
                  const isSuboptimal = missingSH > 0 || btbIssues > 0 || previewStrategy === "suboptimal" || previewStrategy === "randomized" || previewStrategy === "js"

                  const strategyNote = previewStrategy === "js"
                    ? "JS fallback"
                    : previewStrategy === "suboptimal"
                      ? "suboptimal mode"
                      : previewStrategy === "randomized"
                        ? "randomized mode"
                        : null

                  const issues: string[] = []
                  if (missingSH > 0) issues.push(`only ${placedSH}/${expectedSH} study halls placed`)
                  if (btbIssues > 0) issues.push(`${btbIssues} back-to-back issue${btbIssues !== 1 ? 's' : ''}`)

                  return (
                    <>
                      <div className={`col-span-full ${isSuboptimal ? 'mb-2' : 'mb-4'} text-sm bg-sky-50 border border-sky-200 rounded-lg px-3 py-2`}>
                        <span className="text-sky-600">
                          Comparing {previewTeachers.size} regenerated teacher{previewTeachers.size !== 1 ? 's' : ''}. Toggle between Original and Preview to compare.
                        </span>
                      </div>
                      {isSuboptimal && (
                        <div className="col-span-full mb-4 flex items-center gap-2 text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                          <span>
                            {issues.length > 0
                              ? `Results: ${issues.join(', ')}${strategyNote ? ` (${strategyNote})` : ''}.`
                              : `Used ${strategyNote} — results may not be optimal.`}
                            {' '}Press Regenerate to try again.
                          </span>
                        </div>
                      )}
                    </>
                  )
                })()}
                {viewMode === "timetable" && timetableTemplate ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print-grid print-grid-single">
                    {Object.entries(selectedResult.gradeSchedules)
                      .filter(([grade]) => !grade.includes("Elective"))
                      .sort(([a], [b]) => gradeSort(a, b))
                      .map(([gradeName, schedule]) => {
                        const grade = gradesData.find(g => g.display_name === gradeName)
                        const resolved = resolveRowsForGrade(timetableTemplate.rows, grade?.id || '')
                        return (
                          <GradeTimetable
                            key={gradeName}
                            gradeName={gradeName}
                            gradeId={grade?.id || ''}
                            homeroomTeachers={grade?.homeroom_teachers}
                            templateRows={resolved}
                            gradeSchedule={schedule}
                          />
                        )
                      })}
                  </div>
                ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print-grid">
                  {viewMode === "teacher"
                    ? Object.entries(selectedResult.teacherSchedules)
                        // Filter to only show regenerated teachers during regen preview (both Original and Preview views)
                        .filter(([teacher]) => {
                          if (previewOption && previewType === "regen" && previewTeachers.size > 0) {
                            return previewTeachers.has(teacher)
                          }
                          return true
                        })
                        .sort(([teacherA, scheduleA], [teacherB, scheduleB]) => {
                          const statA = selectedResult.teacherStats.find(s => s.teacher === teacherA)
                          const statB = selectedResult.teacherStats.find(s => s.teacher === teacherB)
                          const infoA = analyzeTeacherGrades(scheduleA)
                          const infoB = analyzeTeacherGrades(scheduleB)

                          // 1. Full-time before part-time (part-time at bottom)
                          if (statA?.status === 'full-time' && statB?.status !== 'full-time') return -1
                          if (statA?.status !== 'full-time' && statB?.status === 'full-time') return 1

                          // 2. Teachers with a primary grade before those without
                          if (infoA.hasPrimary && !infoB.hasPrimary) return -1
                          if (!infoA.hasPrimary && infoB.hasPrimary) return 1

                          // 3. Sort by primary grade (Kindergarten first)
                          if (infoA.primaryGrade !== infoB.primaryGrade) {
                            return infoA.primaryGrade - infoB.primaryGrade
                          }

                          // 4. Sort by grade spread (fewer grades = more focused = higher)
                          if (infoA.gradeSpread !== infoB.gradeSpread) {
                            return infoA.gradeSpread - infoB.gradeSpread
                          }

                          // 5. Alphabetical
                          return teacherA.localeCompare(teacherB)
                        })
                        .map(([teacher, schedule]) => {
                          // Get unplaced floating blocks belonging to this teacher
                          // Transferred blocks show under the target teacher (transferredTo)
                          const teacherFloatingBlocks = floatingBlocks.filter(b =>
                            (b.transferredTo || b.sourceTeacher) === teacher &&
                            !pendingPlacements.some(p => p.blockId === b.id)
                          )

                          return (
                            <div key={teacher} id={`teacher-grid-${teacher.replace(/\s+/g, '-')}`} className="space-y-2">
                              <ScheduleGrid
                                schedule={
                                  freeformMode && conflictResolution && showingPreview
                                    ? conflictResolution.schedules.teacherSchedules[teacher]
                                    : freeformMode && workingSchedules && showingPreview
                                      ? workingSchedules.teacherSchedules[teacher]
                                      : swapMode && swapWorkingSchedules && showingPreview
                                        ? swapWorkingSchedules.teacherSchedules[teacher]
                                        : previewOption && previewType === "regen" && showingPreview
                                          ? previewOption.teacherSchedules[teacher]
                                          : schedule
                                }
                                type="teacher"
                                name={teacher}
                                status={selectedResult.teacherStats.find(s => s.teacher === teacher)?.status}
                                changeStatus={
                                  useCurrentClasses && regenMode && classChanges?.affectedTeachers.includes(teacher)
                                    ? (previewOption && showingPreview ? 'applied' : 'pending')
                                    : undefined
                                }
                                showCheckbox={regenMode && !isGenerating}
                                isSelected={selectedForRegen.has(teacher)}
                                onToggleSelect={() => toggleTeacherSelection(teacher)}
                                showExcludeCheckbox={studyHallMode}
                                isExcluded={excludedFromStudyHalls.has(teacher)}
                                isExclusionLocked={lockedExclusions.has(teacher)}
                                onToggleExclude={() => toggleStudyHallExclusion(teacher)}
                                swapMode={swapMode && showingPreview}
                                manualStudyHallMode={manualStudyHallMode}
                                selectedCell={selectedCell}
                                validTargets={validTargets}
                                highlightedCells={highlightedCells}
                                onCellClick={handleCellClick}
                                freeformMode={freeformMode && showingPreview}
                                floatingBlocks={floatingBlocks}
                                pendingPlacements={pendingPlacements}
                                selectedFloatingBlock={selectedFloatingBlock}
                                validationErrors={validationErrors}
                                autoFixedBlockIds={conflictingBlockIds}
                                movedBlockerCells={conflictResolution?.movedBlockers.map(m => ({
                                  teacher: m.to.teacher,
                                  day: m.to.day,
                                  block: m.to.block
                                })) || []}
                                classesSnapshot={generation?.stats?.classes_snapshot}
                                onPickUp={handlePickUpBlock}
                                onPlace={handlePlaceBlock}
                                onUnplace={handleUnplaceBlock}
                                onDeselect={() => setSelectedFloatingBlock(null)}
                                openBlockLabels={selectedResult.openBlockLabels}
                                showOpenLabels={!regenMode && !swapMode && !freeformMode && !studyHallMode}
                                onOpenLabelChange={userRole === "admin" && showOpenLabels && !regenMode && !swapMode && !freeformMode && !studyHallMode ? handleOpenLabelChange : undefined}
                              />
                              {/* Unplaced floating blocks from this teacher */}
                              {freeformMode && teacherFloatingBlocks.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 px-1 no-print">
                                  {teacherFloatingBlocks.map(block => {
                                    const isSelected = selectedFloatingBlock === block.id
                                    const error = validationErrors.find(e => e.blockId === block.id)
                                    const blockIsStudyHall = isStudyHall(block.subject)

                                    const isTransferred = !!block.transferredTo

                                    return (
                                      <div
                                        key={block.id}
                                        onClick={() => handleSelectFloatingBlock(block.id)}
                                        title={isTransferred ? `Transferred from ${block.sourceTeacher}` : "Click to select, then click a cell to place"}
                                        className={`
                                          p-1 rounded border text-center w-[60px] cursor-pointer transition-all relative group
                                          ${error
                                            ? 'bg-red-100 border-red-300 ring-2 ring-red-400'
                                            : isSelected
                                              ? 'bg-green-100 border-green-400 ring-2 ring-green-500'
                                              : 'hover:ring-2 hover:ring-green-300'
                                          }
                                          ${!error && !isSelected && (blockIsStudyHall
                                            ? 'bg-blue-100 border-blue-200'
                                            : 'bg-green-50 border-green-200'
                                          )}
                                        `}
                                      >
                                        {isTransferred && <ArrowLeftRight className="absolute top-0 left-0 h-2.5 w-2.5 text-teal-500 z-10" />}
                                        <div className="font-medium text-xs leading-tight truncate">
                                          {block.grade.replace(' Grade', '').replace('Kindergarten', 'K')}
                                        </div>
                                        <div className="text-[10px] leading-tight text-muted-foreground truncate">
                                          {block.subject}
                                        </div>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            if (isTransferred) {
                                              handleReturnTransferClick(block)
                                            } else {
                                              handleReturnBlock(block.id)
                                            }
                                          }}
                                          className="absolute -top-1 -right-1 w-4 h-4 bg-slate-200 hover:bg-slate-300 rounded-full text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                                          title={isTransferred ? `Return to ${block.sourceTeacher}` : "Return to original position"}
                                        >
                                          ↩
                                        </button>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })
                    : Object.entries(
                        swapMode && swapWorkingSchedules && showingPreview
                          ? swapWorkingSchedules.gradeSchedules
                          : previewOption && previewType === "regen" && showingPreview
                            ? previewOption.gradeSchedules
                            : selectedResult.gradeSchedules
                      )
                        .filter(([grade]) => !grade.includes("Elective"))
                        .sort(([a], [b]) => gradeSort(a, b))
                        .map(([grade, schedule]) => (
                          <ScheduleGrid
                            key={grade}
                            schedule={schedule}
                            type="grade"
                            name={grade}
                            swapMode={swapMode && showingPreview}
                            selectedCell={selectedCell}
                            validTargets={validTargets}
                            highlightedCells={highlightedCells}
                            onCellClick={handleCellClick}
                            classesSnapshot={generation?.stats?.classes_snapshot}
                          />
                        ))}
                </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Changes Detected Dialog - shown when clicking the changes indicator or trying to enter a mode */}
      <AlertDialog open={showChangesDialog} onOpenChange={setShowChangesDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              {snapshotNeedsUpdate ? 'Classes have changed' : 'Version needs alignment'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {snapshotNeedsUpdate ? (
                  <>
                    <p>
                      The current class configuration differs from when this schedule was generated.
                    </p>
                    <p className="text-sm">
                      {classChanges?.summary || 'Some classes have been added, removed, or modified.'}
                    </p>
                    {classChanges && classChanges.changes.length > 0 && (
                      <div className="bg-slate-50 rounded-md p-3 max-h-40 overflow-y-auto">
                        <ul className="text-xs text-slate-700 space-y-1">
                          {classChanges.changes.map((change, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <span className={`font-medium ${
                                change.type === 'added' ? 'text-emerald-600' :
                                change.type === 'removed' ? 'text-red-600' :
                                'text-amber-600'
                              }`}>
                                {change.type === 'added' ? '+' : change.type === 'removed' ? '−' : '~'}
                              </span>
                              <span>
                                <span className="font-medium">{change.teacherName}</span>: {change.gradeName} {change.subjectName}
                                {change.details && <span className="text-slate-500"> ({change.details})</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      Another version has been updated with the latest class configuration. This version still uses the older configuration.
                    </p>
                    {generation?.stats?.snapshotAffectedTeachers && generation.stats.snapshotAffectedTeachers.length > 0 && (
                      <p className="text-sm">
                        Affected teacher{generation.stats.snapshotAffectedTeachers.length !== 1 ? 's' : ''}: {generation.stats.snapshotAffectedTeachers.join(', ')}
                      </p>
                    )}
                  </>
                )}
                <p className="text-sm text-slate-500">
                  {snapshotNeedsUpdate
                    ? 'You can apply these changes by regenerating affected teachers, or keep the schedule unchanged.'
                    : 'You can align this version by regenerating teachers, or keep it unchanged.'}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowChangesDialog(false)
                // Continue to the pending mode with snapshot data (keep indicator visible)
                if (pendingModeEntry === 'regen') enterRegenMode(true)
                else if (pendingModeEntry === 'swap') enterSwapMode(true)
                else if (pendingModeEntry === 'freeform') enterFreeformMode(true)
                else if (pendingModeEntry === 'studyHall') enterStudyHallMode(true)
                setPendingModeEntry(null)
              }}
            >
              Keep Unchanged
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowChangesDialog(false)
                setPendingModeEntry(null)
                // Pre-select affected teachers (if known) and enter regen mode
                // For DB changes: use classChanges (snapshot vs DB) and rebuild snapshot from DB
                // For alignment: use stored affected teachers and keep existing snapshot
                const teachersToSelect = snapshotNeedsUpdate
                  ? (classChanges?.affectedTeachers || [])
                  : (generation?.stats?.snapshotAffectedTeachers || [])
                setSelectedForRegen(new Set(teachersToSelect))
                setUseCurrentClasses(snapshotNeedsUpdate) // Only rebuild from DB when DB has actually changed
                setRegenMode(true)
              }}
              className="bg-amber-600 hover:bg-amber-700"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              {snapshotNeedsUpdate ? 'Apply Changes & Regenerate' : 'Align & Regenerate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Validation Modal - Shows animated checklist before save or for review */}
      <Dialog open={validationModal?.isOpen ?? false} onOpenChange={(open) => {
        if (!open) {
          setValidationModal(null)
        }
      }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {validationModal?.checks.some(c => c.status === 'pending' || c.status === 'checking')
                ? <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                : validationModal?.checks.some(c => c.status === 'failed' && c.errorCount && c.errorCount > 0 && c.name !== 'Back-to-back blocks' && c.name !== 'Study hall coverage')
                  ? <AlertTriangle className="h-5 w-5 text-red-500" />
                  : validationModal?.checks.some(c => c.status === 'failed' && c.errorCount && c.errorCount > 0)
                    ? <AlertTriangle className="h-5 w-5 text-amber-500" />
                    : <Check className="h-5 w-5 text-green-600" />
              }
              {validationModal?.mode === 'review' ? 'Schedule Validation' : 'Validating Schedule'}
            </DialogTitle>
            <DialogDescription>
              {validationModal?.checks.every(c => c.status === 'passed' || c.status === 'failed' || c.status === 'skipped')
                ? validationModal?.mode === 'review'
                  ? 'Validation complete. See results below.'
                  : 'Validation complete.'
                : 'Checking schedule for conflicts and issues...'}
            </DialogDescription>
          </DialogHeader>
          <div className="pt-4 pb-2 space-y-1 max-h-[60vh] overflow-y-auto">
            {validationModal?.checks.map((check, idx) => {
              const isExpanded = validationModal?.expandedChecks.has(idx)
              const hasErrors = check.status === 'failed' && check.errors && check.errors.length > 0
              const isClickable = validationModal?.mode === 'review' && hasErrors

              return (
                <div key={idx}>
                  <div
                    className={`flex items-center gap-3 py-1.5 ${isClickable ? 'cursor-pointer hover:bg-slate-50 rounded -mx-2 px-2' : ''}`}
                    onClick={() => {
                      if (isClickable) {
                        setValidationModal(prev => {
                          if (!prev) return null
                          const newExpanded = new Set(prev.expandedChecks)
                          if (newExpanded.has(idx)) {
                            newExpanded.delete(idx)
                          } else {
                            newExpanded.add(idx)
                          }
                          return { ...prev, expandedChecks: newExpanded }
                        })
                      }
                    }}
                  >
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                      {check.status === 'pending' && (
                        <div className="w-3 h-3 rounded-full border-2 border-slate-300" />
                      )}
                      {check.status === 'checking' && (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      )}
                      {check.status === 'passed' && (
                        <Check className="h-4 w-4 text-green-600" />
                      )}
                      {check.status === 'failed' && (check.name === 'Back-to-back blocks' || check.name === 'Study hall coverage') && (
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                      )}
                      {check.status === 'failed' && check.name !== 'Back-to-back blocks' && check.name !== 'Study hall coverage' && (
                        <X className="h-4 w-4 text-red-500" />
                      )}
                      {check.status === 'skipped' && (
                        <Minus className="h-4 w-4 text-slate-400" />
                      )}
                    </div>
                    <span className={`flex-1 text-sm ${
                      check.status === 'checking' ? 'text-blue-600 font-medium' :
                      check.status === 'passed' ? 'text-slate-600' :
                      check.status === 'failed' && (check.name === 'Back-to-back blocks' || check.name === 'Study hall coverage') ? 'text-amber-600 font-medium' :
                      check.status === 'failed' ? 'text-red-600 font-medium' :
                      check.status === 'skipped' ? 'text-slate-400' :
                      'text-slate-400'
                    }`}>
                      {check.name}
                    </span>
                    {check.status === 'skipped' && (
                      <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0 bg-slate-100 text-slate-500">
                        skipped
                      </span>
                    )}
                    {check.status === 'failed' && check.errorCount && check.errorCount > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                        check.name === 'Back-to-back blocks' || check.name === 'Study hall coverage'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {check.errorCount} {check.errorCount === 1 ? 'issue' : 'issues'}
                      </span>
                    )}
                    {isClickable && (
                      <ChevronDown className={`h-4 w-4 text-slate-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    )}
                  </div>
                  {/* Show error details when expanded in review mode */}
                  {validationModal?.mode === 'review' && isExpanded && hasErrors && (
                    <div className="ml-8 mb-2 mt-1 space-y-1 max-h-32 overflow-y-auto">
                      {check.errors!.map((error, errIdx) => (
                        <p key={errIdx} className="text-xs text-slate-600 pl-2 border-l-2 border-slate-200">
                          {error}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {/* Footer - shown when checks complete */}
          {validationModal?.checks.every(c => c.status === 'passed' || c.status === 'failed' || c.status === 'skipped') && (
            <DialogFooter className="flex-col sm:flex-col gap-2 pt-2 border-t">
              {/* Summary message */}
              {(() => {
                const totalIssues = validationModal?.checks.reduce((sum, c) => sum + (c.errorCount || 0), 0) || 0
                const hardErrors = validationModal?.checks
                  .filter(c => c.status === 'failed' && c.name !== 'Back-to-back blocks' && c.name !== 'Study hall coverage')
                  .reduce((sum, c) => sum + (c.errorCount || 0), 0) || 0
                const warnings = totalIssues - hardErrors

                if (totalIssues === 0) {
                  return (
                    <p className="text-sm text-green-600 text-center w-full">
                      All checks passed. Schedule is valid.
                    </p>
                  )
                } else if (hardErrors > 0) {
                  return (
                    <p className="text-sm text-red-600 text-center w-full">
                      {hardErrors} error{hardErrors !== 1 ? 's' : ''} must be fixed
                      {warnings > 0 ? `, ${warnings} warning${warnings !== 1 ? 's' : ''}` : ''}.
                    </p>
                  )
                } else {
                  return (
                    <p className="text-sm text-amber-600 text-center w-full">
                      {warnings} warning{warnings !== 1 ? 's' : ''} (suboptimal but valid).
                    </p>
                  )
                }
              })()}
              <Button
                variant={validationModal?.mode === 'review' ? 'default' : 'outline'}
                onClick={() => {
                  if (validationModal?.mode === 'review') {
                    setValidationModal(null)
                  } else {
                    // Switch to review mode and expand all failed checks
                    const failedIndices = new Set<number>()
                    validationModal?.checks.forEach((check, idx) => {
                      if (check.status === 'failed' && check.errors && check.errors.length > 0) {
                        failedIndices.add(idx)
                      }
                    })
                    setValidationModal(prev => prev ? { ...prev, mode: 'review', expandedChecks: failedIndices } : null)
                  }
                }}
                className="w-full sm:w-auto"
              >
                {validationModal?.mode === 'review' ? 'Close' : 'Review Errors'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Transfer Confirmation Modal - shown when dropping a class on a different teacher */}
      <Dialog open={transferModal !== null} onOpenChange={(open) => {
        if (!open) setTransferModal(null)
      }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-blue-600" />
              Transfer Class
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold">{transferModal?.block.grade} {transferModal?.block.subject}</span> is currently assigned to{' '}
              <span className="font-semibold">{transferModal?.block.sourceTeacher}</span>.
              Transfer to <span className="font-semibold">{transferModal?.location.teacher}</span>?
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-slate-500 pb-1">
            <p>This will transfer <span className="font-medium text-slate-700">{transferModal?.block.grade} {transferModal?.block.subject}</span> from <span className="font-medium text-slate-700">{transferModal?.block.sourceTeacher}</span>&apos;s classes to <span className="font-medium text-slate-700">{transferModal?.location.teacher}</span>&apos;s classes.</p>
          </div>
          <div className="space-y-3 pt-1">
            {(transferModal?.totalBlocks ?? 0) > 1 && (
              <div>
                <Button
                  onClick={() => {
                    if (!transferModal) return
                    const { block, location } = transferModal
                    doPlaceBlock(block, location)
                    setPendingTransfers(prev => [...prev, {
                      id: `transfer-${Date.now()}`,
                      fromTeacher: block.sourceTeacher,
                      toTeacher: location.teacher,
                      subject: block.subject,
                      grade: block.grade,
                      moveType: 'one'
                    }])
                    setTransferModal(null)
                  }}
                  variant="outline"
                  className="w-full"
                >
                  Transfer this class only
                </Button>
                <p className="text-xs text-slate-400 mt-1 px-1">{transferModal?.block.sourceTeacher} keeps the remaining {(transferModal?.totalBlocks ?? 1) - 1} class block{((transferModal?.totalBlocks ?? 1) - 1) !== 1 ? 's' : ''}.</p>
              </div>
            )}
            <div>
              <Button
                onClick={() => {
                  if (!transferModal || !workingSchedules) return
                  const { block, location } = transferModal
                  // Place the dropped block first
                  doPlaceBlock(block, location)

                  if ((transferModal.totalBlocks) > 1) {
                    // Find remaining blocks of this class on the source teacher's schedule
                    const sourceSchedule = workingSchedules.teacherSchedules[block.sourceTeacher]
                    if (sourceSchedule) {
                      const newFloaters: FloatingBlock[] = []

                      // Read from the ORIGINAL working schedules (before doPlaceBlock modified state)
                      // Since setState is async, the original reference is still valid here.
                      for (const day of Object.keys(sourceSchedule)) {
                        for (const blockNum of Object.keys(sourceSchedule[day])) {
                          const entry = sourceSchedule[day][parseInt(blockNum)]
                          if (!entry) continue
                          // Skip if this is the block we just placed
                          if (day === block.sourceDay && parseInt(blockNum) === block.sourceBlock) continue
                          // Match: same grade+subject on same source teacher
                          if (entry[0] === block.grade && entry[1] === block.subject) {
                            const floatId = `${block.sourceTeacher}-${day}-${blockNum}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
                            newFloaters.push({
                              id: floatId,
                              sourceTeacher: block.sourceTeacher,
                              sourceDay: day,
                              sourceBlock: parseInt(blockNum),
                              grade: entry[0],
                              subject: entry[1],
                              entry: entry,
                              isDisplaced: true,
                              transferredTo: location.teacher
                            })
                          }
                        }
                      }

                      if (newFloaters.length > 0) {
                        // Set source cells to OPEN in working schedules
                        setWorkingSchedules(prev => {
                          if (!prev) return prev
                          const updated = JSON.parse(JSON.stringify(prev.teacherSchedules))
                          for (const f of newFloaters) {
                            if (updated[f.sourceTeacher]?.[f.sourceDay]?.[f.sourceBlock]) {
                              const oldGrade = updated[f.sourceTeacher][f.sourceDay][f.sourceBlock][0]
                              updated[f.sourceTeacher][f.sourceDay][f.sourceBlock] = [oldGrade, BLOCK_TYPE_OPEN]
                            }
                          }
                          return { ...prev, teacherSchedules: updated }
                        })
                        // Add to floating blocks and select the first one
                        setFloatingBlocks(prev => [...prev, ...newFloaters])
                        setSelectedFloatingBlock(newFloaters[0].id)
                      }
                    }
                  }

                  // Record the transfer
                  setPendingTransfers(prev => [...prev, {
                    id: `transfer-${Date.now()}`,
                    fromTeacher: block.sourceTeacher,
                    toTeacher: location.teacher,
                    subject: block.subject,
                    grade: block.grade,
                    moveType: 'all'
                  }])
                  setTransferModal(null)
                }}
                className="w-full"
              >
                {(transferModal?.totalBlocks ?? 0) > 1
                  ? `Transfer all ${transferModal?.totalBlocks} classes to ${transferModal?.location.teacher}`
                  : 'Transfer class'}
              </Button>
              {(transferModal?.totalBlocks ?? 0) > 1 && (
                <p className="text-xs text-slate-400 mt-1 px-1">Transfers all {transferModal?.totalBlocks} classes to {transferModal?.location.teacher}. You&apos;ll need to place the remaining {(transferModal?.totalBlocks ?? 1) - 1} class block{((transferModal?.totalBlocks ?? 1) - 1) !== 1 ? 's' : ''} on their schedule.</p>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() => setTransferModal(null)}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review Transfers Modal - shown before save when there are pending transfers */}
      <Dialog open={reviewTransfersModal?.isOpen ?? false} onOpenChange={(open) => {
        if (!open) setReviewTransfersModal(null)
      }}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-blue-600" />
              Review Class Transfers
            </DialogTitle>
            <DialogDescription>
              The following class transfers will be applied to this schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2 max-h-[40vh] overflow-y-auto">
            {pendingTransfers.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-sm py-1.5 px-3 rounded bg-slate-50">
                <span className="font-medium text-slate-900">{r.grade} {r.subject}</span>
                <span className="text-slate-400">:</span>
                <span className="text-slate-600">{r.fromTeacher}</span>
                <span className="text-slate-400">&rarr;</span>
                <span className="text-slate-600">{r.toTeacher}</span>
                <span className="text-xs text-slate-400 ml-auto">
                  {r.moveType === 'all'
                    ? `all ${generation?.stats?.classes_snapshot?.find(c => c.teacher_name === r.fromTeacher && c.subject_name === r.subject)?.days_per_week ?? ''} classes`
                    : '1 class'}
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-2 pb-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="update-db-classes"
                checked={reviewTransfersModal?.updateDB ?? true}
                onCheckedChange={(checked) => {
                  setReviewTransfersModal(prev => prev ? { ...prev, updateDB: !!checked } : null)
                }}
              />
              <label htmlFor="update-db-classes" className="text-sm text-slate-700 cursor-pointer">
                Also update class definitions in the database
              </label>
            </div>
            {reviewTransfersModal?.updateDB ? (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>This will update class definitions — future schedule generations will reflect these transfers.</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-500">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>Class definitions will not be updated — future schedule generations will not reflect these transfers.</span>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setReviewTransfersModal(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (reviewTransfersModal?.onConfirm) {
                  reviewTransfersModal.onConfirm(reviewTransfersModal.updateDB)
                }
                setReviewTransfersModal(prev => prev ? { ...prev, isOpen: false } : null)
              }}
            >
              Confirm & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return Transfer Modal - confirmation when returning a transferred block */}
      <Dialog open={returnTransferModal !== null} onOpenChange={(open) => {
        if (!open) setReturnTransferModal(null)
      }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-orange-600" />
              Return Transferred Class
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold">{returnTransferModal?.block.grade} {returnTransferModal?.block.subject}</span> was transferred from{' '}
              <span className="font-semibold">{returnTransferModal?.block.sourceTeacher}</span>.
              Return to <span className="font-semibold">{returnTransferModal?.block.sourceTeacher}</span>?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            {(returnTransferModal?.totalBlocks ?? 0) > 1 && (
              <div>
                <Button
                  onClick={() => {
                    if (!returnTransferModal) return
                    handleReturnBlock(returnTransferModal.block.id)
                    setReturnTransferModal(null)
                  }}
                  variant="outline"
                  className="w-full"
                >
                  Return this class only
                </Button>
                <p className="text-xs text-slate-400 mt-1 px-1">{returnTransferModal?.block.transferredTo} keeps the remaining {(returnTransferModal?.totalBlocks ?? 1) - 1} class block{((returnTransferModal?.totalBlocks ?? 1) - 1) !== 1 ? 's' : ''}.</p>
              </div>
            )}
            <div>
              <Button
                onClick={() => {
                  if (!returnTransferModal) return
                  handleReturnAllTransferred(returnTransferModal.block)
                  setReturnTransferModal(null)
                }}
                className="w-full"
              >
                {(returnTransferModal?.totalBlocks ?? 0) > 1
                  ? `Return all ${returnTransferModal?.totalBlocks} classes to ${returnTransferModal?.block.sourceTeacher}`
                  : `Return class to ${returnTransferModal?.block.sourceTeacher}`}
              </Button>
              {(returnTransferModal?.totalBlocks ?? 0) > 1 && (
                <p className="text-xs text-slate-400 mt-1 px-1">Returns all {returnTransferModal?.totalBlocks} classes back to {returnTransferModal?.block.sourceTeacher} and cancels the transfer.</p>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() => setReturnTransferModal(null)}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Star/Note Dialog */}
      <Dialog open={showStarDialog} onOpenChange={setShowStarDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{isEditingNote ? "Edit Note" : "Star Schedule"}</DialogTitle>
            <DialogDescription>
              {isEditingNote
                ? "Update the note for this schedule."
                : "Star this schedule to pin it at the top of your history. Add an optional note to remember why this version is special."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="star-note">Note {!isEditingNote && "(optional)"}</Label>
              <Textarea
                id="star-note"
                placeholder="e.g., Best balance of study halls, minimal back-to-back issues for Randy..."
                value={starNote}
                onChange={(e) => setStarNote(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStarDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={isEditingNote ? handleUpdateNote : handleStar}
              disabled={saving}
              className="bg-amber-500 hover:bg-amber-600"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {isEditingNote ? "Saving..." : "Starring..."}
                </>
              ) : (
                <>
                  {isEditingNote ? (
                    <Check className="h-4 w-4 mr-2" />
                  ) : (
                    <Star className="h-4 w-4 mr-2" />
                  )}
                  {isEditingNote ? "Save Note" : "Star Schedule"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


    </div>
  )
}
