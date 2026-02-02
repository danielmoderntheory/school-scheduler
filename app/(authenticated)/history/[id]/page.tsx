"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ScheduleGrid } from "@/components/ScheduleGrid"
import { ScheduleStats } from "@/components/ScheduleStats"
import { Loader2, Download, ArrowLeft, Check, RefreshCw, Shuffle, Trash2, Star, MoreVertical, Users, GraduationCap, Printer, ArrowLeftRight, X, Hand, Pencil, Copy, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import type { ScheduleOption, TeacherSchedule, GradeSchedule, Teacher, FloatingBlock, PendingPlacement, ValidationError, CellLocation, ClassEntry } from "@/lib/types"
import { parseClassesFromSnapshot, parseTeachersFromSnapshot, parseRulesFromSnapshot, hasValidSnapshots, detectClassChanges, type GenerationStats, type ChangeDetectionResult, type CurrentClass } from "@/lib/snapshot-utils"
import toast from "react-hot-toast"
import { generateSchedules, reassignStudyHalls } from "@/lib/scheduler"
import { generateSchedulesRemote } from "@/lib/scheduler-remote"
import { useGeneration } from "@/lib/generation-context"

// Sort grades: Kindergarten first, then by grade number
function gradeSort(a: string, b: string): number {
  if (a.includes("Kindergarten")) return -1
  if (b.includes("Kindergarten")) return 1
  const aNum = parseInt(a.match(/(\d+)/)?.[1] || "99")
  const bNum = parseInt(b.match(/(\d+)/)?.[1] || "99")
  return aNum - bNum
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
      if (entry && entry[0] && entry[1] !== "OPEN" && entry[1] !== "Study Hall") {
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
  const id = params.id as string
  const isNewGeneration = searchParams.get('new') === 'true'
  const { setIsGenerating: setGlobalGenerating } = useGeneration()
  const [generation, setGeneration] = useState<Generation | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewingOption, setViewingOption] = useState("1")
  const [viewMode, setViewMode] = useState<"teacher" | "grade">("teacher")
  const [saving, setSaving] = useState(false)

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
    checks: Array<{ name: string; status: 'pending' | 'checking' | 'passed' | 'failed'; errorCount?: number; errors?: string[] }>
    onComplete?: () => void
    mode: 'save' | 'review'  // 'save' auto-closes on success, 'review' stays open
    expandedChecks: Set<number>  // Which check indices are expanded
  } | null>(null)
  const [workingSchedules, setWorkingSchedules] = useState<{
    teacherSchedules: Record<string, TeacherSchedule>
    gradeSchedules: Record<string, GradeSchedule>
  } | null>(null)
  const [freeformClasses, setFreeformClasses] = useState<ClassEntry[] | null>(null)


  // Star dialog state
  const [showStarDialog, setShowStarDialog] = useState(false)
  const [starNote, setStarNote] = useState("")
  const [isEditingNote, setIsEditingNote] = useState(false)

  // Change detection state
  const [classChanges, setClassChanges] = useState<ChangeDetectionResult | null>(null)
  const [changesDismissed, setChangesDismissed] = useState(false)
  const [showChangesDialog, setShowChangesDialog] = useState(false)
  const [pendingModeEntry, setPendingModeEntry] = useState<'regen' | 'swap' | 'freeform' | 'studyHall' | null>(null)
  const [useCurrentClasses, setUseCurrentClasses] = useState(false) // When true, regen uses current DB classes instead of snapshot
  const [changesExpanded, setChangesExpanded] = useState(false) // Expandable changes list in regen banner
  const [allowStudyHallReassignment, setAllowStudyHallReassignment] = useState(false) // Allow study halls to move to any eligible teacher

  useEffect(() => {
    loadGeneration()
  }, [id])

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
  }, [viewingOption])

  async function loadGeneration() {
    try {
      const res = await fetch(`/api/history/${id}`)
      if (res.ok) {
        const data = await res.json()
        setGeneration(data)
        if (data.selected_option) {
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
      document.title = `${generation.quarter?.name || 'Schedule'} Rev ${viewingOption} - ${shortId}`
    }
  }, [generation, viewingOption])

  // Detect class changes when generation loads
  useEffect(() => {
    async function checkForChanges() {
      if (!generation || !hasValidSnapshots(generation.stats)) {
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
        setChangesDismissed(false) // Reset dismissed state when generation changes
      } catch (error) {
        console.error('Error detecting class changes:', error)
      }
    }

    checkForChanges()
  }, [generation?.id, generation?.quarter_id])

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
        toast.success("Schedule starred")
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
        toast.success("Schedule unstarred")
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
        toast.success("Note updated")
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
    // If changes detected and not dismissed, show dialog first
    if (!skipChangesCheck && classChanges?.hasChanges && !changesDismissed) {
      setPendingModeEntry('regen')
      setShowChangesDialog(true)
      return
    }
    setRegenMode(true)
    setSelectedForRegen(new Set())
    setRegenSeed(0) // Reset seed for fresh regeneration session
  }

  function exitRegenMode() {
    setRegenMode(false)
    setSelectedForRegen(new Set())
    setPreviewOption(null)
    setPreviewType(null)
    setUseCurrentClasses(false)
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

      // Debug: log classes for selected teachers being sent to solver
      const selectedTeacherClasses = classes.filter(c => selectedForRegen.has(c.teacher))
      console.log('[Regen] Classes for SELECTED teachers sent to solver:',
        selectedTeacherClasses.map(c => ({
          teacher: c.teacher,
          grade: c.gradeDisplay || c.grade,
          subject: c.subject,
          daysPerWeek: c.daysPerWeek
        }))
      )

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
      console.log('[Regen] Built lockedSchedules from actualOriginalSchedule (generation.options), NOT selectedResult')

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
          allowStudyHallReassignment,
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
          allowStudyHallReassignment,
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
          allowStudyHallReassignment,
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
              allowStudyHallReassignment,
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
          allowStudyHallReassignment,
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
          allowStudyHallReassignment,
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
        toast.error(result?.message || "Could not generate a valid schedule with these constraints")
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
      console.log('[Regen Validation] useCurrentClasses:', useCurrentClasses)
      const selectedTeacherSnapshotClasses = statsForRegenValidation?.classes_snapshot?.filter(
        c => selectedForRegen.has(c.teacher_name || '')
      ) || []
      console.log('[Regen Validation] Classes for SELECTED teachers in validation snapshot:',
        selectedTeacherSnapshotClasses.map(c => ({
          teacher: c.teacher_name,
          grade: c.grades?.map(g => g.display_name).join(', ') || 'none',
          subject: c.subject_name,
          days_per_week: c.days_per_week
        }))
      )
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
        console.log('[Regen Validation] Session count errors (for selected teachers):', sessionErrors.map(e => e.message))
      }

      if (allErrors.length > 0) {
        setValidationErrors(allErrors)
        console.warn('[Regen] Validation errors found (filtered to selected teachers):', allErrors)
        toast.error(`${allErrors.length} validation issue${allErrors.length !== 1 ? 's' : ''} detected - review before applying`)
      } else {
        setValidationErrors([])
      }

      // Save which teachers were regenerated
      setPreviewTeachers(new Set(selectedForRegen))
      setPreviewOption(newOption)
      setPreviewType("regen")
      setPreviewStrategy(usedStrategy)
      toast.success(usedJsFallback ? "Schedules regenerated (JS solver)" : "Schedules regenerated (OR-Tools)")
    } catch (error) {
      console.error('Regeneration error:', error)
      toast.error("Failed to generate variation")
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleKeepPreview(saveAsNew: boolean = false) {
    // Debug logging BEFORE early return to catch silent failures
    console.log('[Save] handleKeepPreview called')
    console.log('[Save] - generation exists:', !!generation)
    console.log('[Save] - previewOption exists:', !!previewOption)
    console.log('[Save] - selectedResult exists:', !!selectedResult)

    if (!generation || !previewOption || !selectedResult) {
      console.log('[Save] Early return - missing required data')
      return
    }

    // For regen mode, build a merged option that ONLY takes selected teachers from preview
    // and keeps EVERYTHING ELSE from the original (safeguard against solver bugs)
    let optionToSave: ScheduleOption = previewOption

    // Debug logging to diagnose merge issues
    console.log('[Save] Proceeding with save:')
    console.log('[Save] - previewType:', previewType)
    console.log('[Save] - previewTeachers:', Array.from(previewTeachers))
    console.log('[Save] - previewTeachers.size:', previewTeachers.size)
    console.log('[Save] - condition check:', previewType === 'regen' && previewTeachers.size > 0)

    if (previewType === 'regen' && previewTeachers.size > 0) {
      const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

      // Get the ACTUAL original option from the database (not selectedResult which could be preview)
      const actualOriginal = generation.options[parseInt(viewingOption) - 1]
      if (!actualOriginal) {
        console.log('[Save] ERROR: Could not find original option in generation.options')
        return
      }

      // Start with a COMPLETE deep copy of the original option
      const originalOption: ScheduleOption = JSON.parse(JSON.stringify(actualOriginal))
      console.log('[Save] Using actualOriginal from generation.options, NOT selectedResult (which could be preview)')

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
            const entry = mergedGradeSchedules[grade]?.[day]?.[block]
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
            const previewEntry = previewGradeSchedules[grade]?.[day]?.[block]
            if (previewEntry && previewTeachers.has(previewEntry[0])) {
              // This slot is taught by a selected teacher in preview - add it
              mergedGradeSchedules[grade][day][block] = previewEntry
            }
          }
        }
      }

      // Merge study hall assignments: keep original, update only if teacher was selected
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

      // Merge teacher stats: keep original, update only selected teachers
      const mergedTeacherStats = originalOption.teacherStats.map(stat => {
        if (previewTeachers.has(stat.teacher)) {
          const previewStat = previewOption.teacherStats.find(ps => ps.teacher === stat.teacher)
          return previewStat || stat
        }
        return stat
      })

      // Build merged option starting from ORIGINAL, replacing only what changed
      optionToSave = {
        ...originalOption,
        teacherSchedules: mergedTeacherSchedules,
        gradeSchedules: mergedGradeSchedules,
        studyHallAssignments: mergedStudyHalls,
        teacherStats: mergedTeacherStats,
      }

      console.log('[Save] Built merged option - CUT only these teachers from preview:', Array.from(previewTeachers))

      // Debug: Compare ALL locked teachers across original, preview, and merged
      const allTeachers = Object.keys(originalOption.teacherSchedules)
      const lockedTeacherNames = allTeachers.filter(t => !previewTeachers.has(t))

      console.log('[Save] Checking ALL locked teachers:')
      let allIdentical = true
      const changedTeachers: string[] = []

      for (const teacher of lockedTeacherNames) {
        const originalSchedule = JSON.stringify(originalOption.teacherSchedules[teacher])
        const mergedSchedule = JSON.stringify(mergedTeacherSchedules[teacher])
        const isIdentical = originalSchedule === mergedSchedule

        if (!isIdentical) {
          allIdentical = false
          changedTeachers.push(teacher)
          console.log(`[Save] MISMATCH for ${teacher}:`)
          console.log(`[Save] - Original:`, originalOption.teacherSchedules[teacher])
          console.log(`[Save] - Merged:`, mergedTeacherSchedules[teacher])
        }
      }

      if (allIdentical) {
        console.log('[Save] ✓ All', lockedTeacherNames.length, 'locked teachers have identical Original and Merged schedules')
      } else {
        console.log('[Save] ✗ PROBLEM:', changedTeachers.length, 'locked teachers have DIFFERENT schedules:', changedTeachers)
      }

      // Also check grade schedules
      console.log('[Save] Checking grade schedules:')
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
        console.log('[Save] ✓ All grade schedules identical')
      } else {
        console.log('[Save] ✗ Grade schedules changed for:', changedGrades)
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
        statsForValidation = {
          ...generation.stats,
          classes_snapshot: classesSnapshot,
          teachers_snapshot: teachersSnapshot,
          grades_snapshot: gradesSnapshot,
          // rules_snapshot intentionally NOT updated - stays from original generation
        }
      } catch (error) {
        console.error('Failed to build updated snapshots for validation:', error)
        // Continue with original stats
      }
    }

    // Define the save logic
    const doSave = async () => {
      let updatedOptions: ScheduleOption[]
      let successMessage: string

      if (!saveAsNew) {
        // Update current option in place
        const optionIndex = parseInt(viewingOption) - 1
        updatedOptions = [...generation.options]
        updatedOptions[optionIndex] = {
          ...optionToSave,
          optionNumber: optionIndex + 1,
        }
        successMessage = previewType === "study-hall"
          ? `Study halls reassigned for Rev ${optionIndex + 1}`
          : `Rev ${optionIndex + 1} updated`
      } else {
        // Save as new option
        const newOptionNumber = generation.options.length + 1
        updatedOptions = [...generation.options, {
          ...optionToSave,
          optionNumber: newOptionNumber,
        }]
        successMessage = `Saved as Rev ${newOptionNumber}`
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
        // Re-check for changes (should now show none if snapshots were updated)
        if (useCurrentClasses) {
          setClassChanges(null) // Clear changes since we just updated snapshots
          setChangesDismissed(false)
        }
        toast.success(successMessage)
      } else {
        toast.error("Failed to save changes")
      }
    }

    // Run validation with visual modal on the MERGED option, then save if passed
    // Use statsForValidation which has updated class snapshots when using current classes
    runValidationWithModal(optionToSave, statsForValidation, doSave)
  }

  function handleDiscardPreview() {
    setPreviewOption(null)
    setPreviewType(null)
    setStudyHallMode(false)
    setStudyHallSeed(null)
    setRegenMode(false)
    setSelectedForRegen(new Set())
    setUseCurrentClasses(false)
    toast("Preview discarded", { icon: "🗑️" })
  }

  function enterStudyHallMode(skipChangesCheck = false) {
    // If changes detected and not dismissed, show dialog first
    if (!skipChangesCheck && classChanges?.hasChanges && !changesDismissed) {
      setPendingModeEntry('studyHall')
      setShowChangesDialog(true)
      return
    }
    setStudyHallMode(true)
  }

  function exitStudyHallMode() {
    setStudyHallMode(false)
    setPreviewOption(null)
    setPreviewType(null)
    setStudyHallSeed(null)
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

    const result = reassignStudyHalls(currentOption, teachers, seed, rules)

    if (!result.success) {
      toast.error(result.message || "Could not reassign study halls")
      return
    }

    // Check if no changes were made
    if (result.noChanges) {
      toast(result.message || "No changes made", { icon: "ℹ️" })
      return
    }

    if (!result.newOption) {
      toast.error("Could not reassign study halls")
      return
    }

    // Validate the full schedule
    const scheduleErrors = validateFullSchedule(result.newOption, generation?.stats)
    if (scheduleErrors.length > 0) {
      setValidationErrors(scheduleErrors)
      console.warn('[Study Hall] Validation errors found:', scheduleErrors)
      toast.error(`${scheduleErrors.length} validation issue${scheduleErrors.length !== 1 ? 's' : ''} detected`)
    } else {
      setValidationErrors([])
    }

    // Set as preview (not saved yet)
    setPreviewOption(result.newOption)
    setPreviewType("study-hall")
    setShowingPreview(true)
    toast.success("Study halls randomized")
  }

  async function handleDeleteOption(optionIndex: number) {
    if (!generation) return

    // Don't allow deleting if only 1 option remains
    if (generation.options.length <= 1) {
      toast.error("Cannot delete the last option")
      return
    }

    const optionNum = optionIndex + 1
    if (!confirm(`Delete Revision ${optionNum}? This cannot be undone.`)) {
      return
    }

    try {
      // Remove the option and renumber remaining ones
      const updatedOptions = generation.options
        .filter((_, i) => i !== optionIndex)
        .map((opt, i) => ({ ...opt, optionNumber: i + 1 }))

      // Check if we're deleting the PRIMARY revision (generation.selected_option)
      const primaryRevision = generation.selected_option || 1
      let newPrimaryRevision: number | undefined = undefined

      if (primaryRevision === optionNum) {
        // Deleting the primary - pick a new one (prefer previous, fall back to first)
        if (optionIndex > 0) {
          newPrimaryRevision = optionIndex // Previous option (now renumbered)
        } else {
          newPrimaryRevision = 1 // First remaining option
        }
        console.log('[Delete] Deleting PRIMARY revision, new primary will be:', newPrimaryRevision)
      } else if (primaryRevision > optionNum) {
        // Primary is after deleted option - adjust the number
        newPrimaryRevision = primaryRevision - 1
        console.log('[Delete] Primary revision adjusted from', primaryRevision, 'to', newPrimaryRevision)
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
        console.log('[Delete] Deleted option:', optionNum, 'Current tab:', currentSelection)
        console.log('[Delete] Remaining options count:', updatedOptions.length)
        if (currentSelection === optionNum) {
          // Deleted the viewed tab - switch to nearest revision
          // Prefer previous option (smaller number), fall back to next
          let newSelection: string
          if (optionIndex > 0) {
            // There's an option before the deleted one - select it
            newSelection = optionIndex.toString()
          } else {
            // No option before, select the first one (was second, now first)
            newSelection = "1"
          }
          console.log('[Delete] Deleted viewed tab, switching to:', newSelection)
          setViewingOption(newSelection)
        } else if (currentSelection > optionNum) {
          // Adjust tab selection if we deleted an earlier option
          const newSelection = (currentSelection - 1).toString()
          console.log('[Delete] Deleted earlier option, adjusting tab to:', newSelection)
          setViewingOption(newSelection)
        }
        toast.success(`Deleted Revision ${optionNum}`)
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
   * Returns true if validation passed (only soft warnings), false if hard errors.
   */
  async function runValidationWithModal(
    option: ScheduleOption,
    stats: GenerationStats | undefined,
    onComplete: () => void,
    mode: 'save' | 'review' = 'save'
  ): Promise<boolean> {
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
    const softWarningTypes = ['back_to_back']

    // Define all checks
    const checkDefinitions = [
      { name: 'Teacher conflicts', key: 'teacher_conflict' },
      { name: 'Grade conflicts', key: 'grade_conflict' },
      { name: 'Subject conflicts', key: 'subject_conflict' },
      { name: 'Schedule consistency', key: 'consistency' },
      { name: 'Session counts', key: 'session_count' },
      { name: 'Study hall coverage', key: 'study_hall_coverage' },
      { name: 'Fixed slot constraints', key: 'fixed_slot_violation' },
      { name: 'Availability constraints', key: 'availability_violation' },
      { name: 'Back-to-back blocks', key: 'back_to_back' },
    ]

    // Initialize modal with all checks pending
    type CheckStatus = 'pending' | 'checking' | 'passed' | 'failed'
    const initialChecks: Array<{ name: string; status: CheckStatus; errorCount: number; errors?: string[] }> =
      checkDefinitions.map(c => ({
        name: c.name,
        status: 'pending' as CheckStatus,
        errorCount: 0
      }))

    setValidationModal({ isOpen: true, checks: initialChecks, onComplete, mode, expandedChecks: new Set() })

    // Run full validation
    const allErrors = validateFullSchedule(option, stats)

    // Animate through checks
    const updatedChecks = [...initialChecks]
    let hasHardErrors = false

    for (let i = 0; i < checkDefinitions.length; i++) {
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
      toast(`⚠️ ${allErrors.length} warning${allErrors.length !== 1 ? 's' : ''} (suboptimal but valid)`)
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
        toast.success(`Created Revision ${updatedOptions.length}`)
      } else {
        toast.error("Failed to duplicate revision")
      }
    } catch (error) {
      console.error('Duplicate revision error:', error)
      toast.error("Failed to duplicate revision")
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
        toast.success(`Rev ${optionNum} set as Primary`)
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
        if (stat?.status !== "full-time") continue

        // Must be same day and block (grade needs study hall at this time)
        const entry = schedule[source.day]?.[source.block]
        if (entry && entry[1] === "OPEN") {
          targets.push({ teacher, day: source.day, block: source.block })
        }
      } else {
        // For OPEN blocks, can swap to any other OPEN block
        const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
        const BLOCKS = [1, 2, 3, 4, 5]
        for (const day of DAYS) {
          for (const block of BLOCKS) {
            const entry = schedule[day]?.[block]
            if (entry && entry[1] === "OPEN") {
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
        const entry = gradeSchedule[day]?.[block]
        if (entry && entry[1] !== "OPEN" && entry[1] !== "Study Hall") {
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
        const gradeEntry = gradeSchedule[day]?.[block]

        // Teacher must have OPEN at this slot
        if (!teacherEntry || teacherEntry[1] !== "OPEN") continue

        // Grade must be free (no class)
        if (gradeEntry && gradeEntry[1] !== "OPEN" && gradeEntry[1] !== "Study Hall") continue

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

        const gradeEntry = gradeSchedule[day]?.[block]

        // Must be a class (not OPEN, Study Hall, or empty)
        if (!gradeEntry || gradeEntry[1] === "OPEN" || gradeEntry[1] === "Study Hall") continue

        const [otherTeacher, otherSubject] = gradeEntry

        // Skip if same teacher (that's Option 1)
        if (otherTeacher === teacher) continue

        const otherTeacherSchedule = teacherSchedules[otherTeacher]
        if (!otherTeacherSchedule) continue

        // Check: source teacher must have OPEN at the other class's time
        const sourceTeacherAtOtherTime = teacherSchedule[day]?.[block]
        if (!sourceTeacherAtOtherTime || sourceTeacherAtOtherTime[1] !== "OPEN") continue

        // Check: other teacher must have OPEN at source's time
        const otherTeacherAtSourceTime = otherTeacherSchedule[source.day]?.[source.block]
        if (!otherTeacherAtSourceTime || otherTeacherAtSourceTime[1] !== "OPEN") continue

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
        const entry = gradeSchedule[day]?.[block]
        if (entry && entry[1] !== "OPEN" && entry[1] !== "Study Hall") {
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
        const gradeEntry = gradeSchedule[day]?.[block]

        // Teacher must have OPEN at this slot
        if (!teacherEntry || teacherEntry[1] !== "OPEN") continue

        // Grade must be free (no class, or OPEN/Study Hall is ok to swap into conceptually but we're moving a class)
        if (gradeEntry && gradeEntry[1] !== "OPEN" && gradeEntry[1] !== "Study Hall") continue

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

        const gradeEntry = gradeSchedule[day]?.[block]

        // Must be a class (not OPEN, Study Hall, or empty)
        if (!gradeEntry || gradeEntry[1] === "OPEN" || gradeEntry[1] === "Study Hall") continue

        const [otherTeacher, otherSubject] = gradeEntry

        // Can't swap with same teacher's class (that's just Option 1)
        if (otherTeacher === source.teacher) continue

        const otherTeacherSchedule = teacherSchedules[otherTeacher]
        if (!otherTeacherSchedule) continue

        // Check: source teacher must have OPEN at the other class's time
        const sourceTeacherAtOtherTime = teacherSchedule[day]?.[block]
        if (!sourceTeacherAtOtherTime || sourceTeacherAtOtherTime[1] !== "OPEN") continue

        // Check: other teacher must have OPEN at source's time
        const otherTeacherAtSourceTime = otherTeacherSchedule[source.day]?.[source.block]
        if (!otherTeacherAtSourceTime || otherTeacherAtSourceTime[1] !== "OPEN") continue

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
    if (!swapMode || !selectedResult) return

    // Handle grade view
    if (viewMode === "grade") {
      // If clicking on a valid target, perform the swap
      if (selectedCell && validTargets.some(t =>
        t.grade === location.grade && t.day === location.day && t.block === location.block
      )) {
        // Determine which type of swap based on what was selected
        if (selectedCell.subject && selectedCell.subject !== "Study Hall") {
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
        toast("No valid move/swap targets found", { icon: "ℹ️" })
      } else {
        toast(`${targets.length} valid target${targets.length !== 1 ? 's' : ''} found`, { icon: "✓" })
      }
      return
    }

    // Handle teacher view
    // If clicking on a valid target, perform the swap
    if (selectedCell && validTargets.some(t =>
      t.teacher === location.teacher && t.day === location.day && t.block === location.block
    )) {
      // Determine which type of swap based on what was selected
      const selectedCellType = selectedCell.subject === "Study Hall" ? "study-hall"
        : selectedCell.subject === "OPEN" ? "open"
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
      toast("No valid swap targets found", { icon: "ℹ️" })
    } else {
      toast(`${targets.length} valid target${targets.length !== 1 ? 's' : ''} found`, { icon: "✓" })
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
    if (sourceEntry[1] === "Study Hall") {
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
        newGradeSchedules[gradeGroup][target.day][target.block] = [target.teacher, "Study Hall"]
      }

      toast(`Study Hall reassigned: ${source.teacher} → ${target.teacher} (${target.day} B${target.block})`, { icon: "✓" })
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
    newTeacherSchedules[teacher][source.day][source.block] = [grade, "OPEN"]
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

    toast(`Moved ${grade} ${subject}: ${source.day} B${source.block} → ${target.day} B${target.block}`, { icon: "✓" })

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
    const sourceGradeEntry = swapWorkingSchedules.gradeSchedules[grade]?.[source.day]?.[source.block]
    const sourceTeacherEntry = swapWorkingSchedules.teacherSchedules[sourceTeacher]?.[source.day]?.[source.block]

    if (!sourceGradeEntry || !sourceTeacherEntry) {
      toast.error("Invalid swap - source not found")
      setSelectedCell(null)
      setValidTargets([])
      return
    }

    // Check if this is Option 1 (move to OPEN) or Option 2 (swap with another class)
    const targetGradeEntry = swapWorkingSchedules.gradeSchedules[grade]?.[target.day]?.[target.block]
    const isOption1 = !targetGradeEntry || targetGradeEntry[1] === "OPEN" || targetGradeEntry[1] === "Study Hall"

    let successMessage = ""
    let destinationCells: CellLocation[] = []

    if (isOption1) {
      // Option 1: Move class to an OPEN slot
      const targetTeacherEntry = newTeacherSchedules[sourceTeacher]?.[target.day]?.[target.block]
      if (!targetTeacherEntry || targetTeacherEntry[1] !== "OPEN") {
        toast.error("Invalid swap - teacher not available at target time")
        setSelectedCell(null)
        setValidTargets([])
        return
      }

      // Update teacher schedule: source slot becomes OPEN, target slot gets the class
      newTeacherSchedules[sourceTeacher][source.day][source.block] = [grade, "OPEN"]
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
      newTeacherSchedules[sourceTeacher][source.day][source.block] = [grade, "OPEN"]
      newTeacherSchedules[sourceTeacher][target.day][target.block] = sourceTeacherEntry

      newTeacherSchedules[targetTeacher][target.day][target.block] = [grade, "OPEN"]
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

    toast(successMessage, { icon: "✓" })
    highlightCells(destinationCells)

    // Clear swap state
    setSelectedCell(null)
    setValidTargets([])
  }

  function enterSwapMode(skipChangesCheck = false) {
    if (!selectedResult) return
    // If changes detected and not dismissed, show dialog first
    if (!skipChangesCheck && classChanges?.hasChanges && !changesDismissed) {
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
  }

  function exitSwapMode() {
    setSwapMode(false)
    setSelectedCell(null)
    setValidTargets([])
    setHighlightedCells([])
    setSwapWorkingSchedules(null)
    setSwapCount(0)
    if (highlightTimeout) clearTimeout(highlightTimeout)
  }

  async function handleApplySwap(createNew: boolean = false) {
    if (!generation || !selectedResult || !swapWorkingSchedules || swapCount === 0) return

    const optionIndex = parseInt(viewingOption) - 1

    // Save current state for undo
    const previousOptions: ScheduleOption[] = JSON.parse(JSON.stringify(generation.options))
    const previousSelectedOption = viewingOption

    // Create updated option with working schedules
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    const updatedOption: ScheduleOption = {
      ...selectedResult,
      teacherSchedules: swapWorkingSchedules.teacherSchedules,
      gradeSchedules: swapWorkingSchedules.gradeSchedules,
      studyHallAssignments: swapWorkingSchedules.studyHallAssignments,
    }

    // Regenerate teacher stats
    updatedOption.teacherStats = selectedResult.teacherStats.map(stat => {
      const schedule = swapWorkingSchedules.teacherSchedules[stat.teacher]
      let teaching = 0, studyHall = 0, open = 0, backToBackIssues = 0

      for (const day of DAYS) {
        let prevWasOpen = false
        for (let block = 1; block <= 5; block++) {
          const entry = schedule?.[day]?.[block]
          if (!entry || entry[1] === "OPEN") {
            open++
            if (prevWasOpen && stat.status === "full-time") backToBackIssues++
            prevWasOpen = true
          } else if (entry[1] === "Study Hall") {
            studyHall++
            prevWasOpen = true
          } else {
            teaching++
            prevWasOpen = false
          }
        }
      }

      return { ...stat, teaching, studyHall, open, totalUsed: teaching + studyHall, backToBackIssues }
    })

    // Regenerate total back-to-back issues
    updatedOption.backToBackIssues = updatedOption.teacherStats.reduce((sum, s) => sum + s.backToBackIssues, 0)

    // Define the save function to pass to validation modal
    const doSave = async () => {
      let updatedOptions: ScheduleOption[]
      let successMessage: string
      let newOptionNumber: string | null = null

      if (createNew) {
        updatedOptions = [...generation.options, updatedOption]
        successMessage = `Saved ${swapCount} swap${swapCount !== 1 ? 's' : ''} as Rev ${generation.options.length + 1}`
        newOptionNumber = (generation.options.length + 1).toString()
      } else {
        updatedOptions = [...generation.options]
        updatedOptions[optionIndex] = updatedOption
        successMessage = `Applied ${swapCount} swap${swapCount !== 1 ? 's' : ''} to Rev ${viewingOption}`
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
                        toast.success("Changes undone")
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
              icon: <Check className="h-4 w-4 text-emerald-600" />,
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
                  toast.success("Swap undone")
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
        icon: <Check className="h-4 w-4 text-emerald-600" />,
      }
    )
    undoToastId.current = toastId
  }

  // Freeform mode functions
  function enterFreeformMode(skipChangesCheck = false) {
    if (!selectedResult || !generation) return

    // If changes detected and not dismissed, show dialog first
    if (!skipChangesCheck && classChanges?.hasChanges && !changesDismissed) {
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
    setValidationErrors([])

    // Parse classes from snapshot for validation
    const classes = parseClassesFromSnapshot(generation.stats!.classes_snapshot!)
    setFreeformClasses(classes)
  }

  function exitFreeformMode() {
    setFreeformMode(false)
    setFloatingBlocks([])
    setPendingPlacements([])
    setSelectedFloatingBlock(null)
    setValidationErrors([])
    setWorkingSchedules(null)
    setFreeformClasses(null)
  }

  function handlePickUpBlock(location: CellLocation) {
    if (!workingSchedules || !location.grade || !location.subject) return

    const entry = workingSchedules.teacherSchedules[location.teacher]?.[location.day]?.[location.block]
    if (!entry || entry[1] === "OPEN") return

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
      entry
    }

    setFloatingBlocks(prev => [...prev, block])

    // Update working schedules - set cell to OPEN
    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))

    newTeacherSchedules[location.teacher][location.day][location.block] = [entry[0], "OPEN"]

    // Remove from grade schedule (works for both classes and study halls)
    if (newGradeSchedules[entry[0]]?.[location.day]?.[location.block]) {
      newGradeSchedules[entry[0]][location.day][location.block] = null
    }

    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })
    setSelectedFloatingBlock(blockId)

    // Clear any previous validation errors
    setValidationErrors([])
  }

  function handlePlaceBlock(location: CellLocation) {
    if (!selectedFloatingBlock || !workingSchedules) return

    const block = floatingBlocks.find(b => b.id === selectedFloatingBlock)
    if (!block) return

    // Create a single copy of schedules for all modifications
    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))

    // Check if the target location has a class/study hall that we need to pick up
    const targetEntry = newTeacherSchedules[location.teacher]?.[location.day]?.[location.block]
    let newFloatingBlock: FloatingBlock | null = null

    if (targetEntry && targetEntry[1] !== "OPEN") {
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
          entry: targetEntry
        }

        // Remove from grade schedule
        if (newGradeSchedules[targetEntry[0]]?.[location.day]?.[location.block]) {
          newGradeSchedules[targetEntry[0]][location.day][location.block] = null
        }
      }
    }

    // Check if the selected block was already placed somewhere else
    const existingPlacement = pendingPlacements.find(p => p.blockId === block.id)
    if (existingPlacement) {
      // Restore OPEN at old placement location
      const oldEntry = newTeacherSchedules[existingPlacement.teacher][existingPlacement.day][existingPlacement.block]
      if (oldEntry) {
        newTeacherSchedules[existingPlacement.teacher][existingPlacement.day][existingPlacement.block] = [oldEntry[0], "OPEN"]
      }

      // Remove from grade schedule at old location
      if (newGradeSchedules[block.grade]?.[existingPlacement.day]?.[existingPlacement.block]) {
        newGradeSchedules[block.grade][existingPlacement.day][existingPlacement.block] = null
      }
    }

    // Place the selected block at new location
    newTeacherSchedules[location.teacher][location.day][location.block] = block.entry

    if (!newGradeSchedules[block.grade]) {
      newGradeSchedules[block.grade] = {}
    }
    if (!newGradeSchedules[block.grade][location.day]) {
      newGradeSchedules[block.grade][location.day] = {}
    }
    newGradeSchedules[block.grade][location.day][location.block] = [location.teacher, block.subject]

    // Update state
    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })

    // Update placements
    if (existingPlacement) {
      setPendingPlacements(prev => [
        ...prev.filter(p => p.blockId !== block.id),
        { blockId: block.id, teacher: location.teacher, day: location.day, block: location.block }
      ])
    } else {
      setPendingPlacements(prev => [...prev, {
        blockId: block.id,
        teacher: location.teacher,
        day: location.day,
        block: location.block
      }])
    }

    // Add the displaced block to floating blocks and select it
    if (newFloatingBlock) {
      setFloatingBlocks(prev => [...prev, newFloatingBlock!])
      setSelectedFloatingBlock(newFloatingBlock.id)
    } else {
      setSelectedFloatingBlock(null)
    }

    // Clear validation errors
    setValidationErrors([])
  }

  function handleReturnBlock(blockId: string) {
    const block = floatingBlocks.find(b => b.id === blockId)
    if (!block || !workingSchedules) return

    // Check if this block was placed
    const placement = pendingPlacements.find(p => p.blockId === blockId)

    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))

    // If it was placed, clear that location
    if (placement) {
      newTeacherSchedules[placement.teacher][placement.day][placement.block] = [block.grade, "OPEN"]
      if (newGradeSchedules[block.grade]?.[placement.day]?.[placement.block]) {
        newGradeSchedules[block.grade][placement.day][placement.block] = null
      }
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
        // Clear this block from grade schedules at current location
        if (newGradeSchedules[occupyingBlock.grade]?.[block.sourceDay]?.[block.sourceBlock]) {
          newGradeSchedules[occupyingBlock.grade][block.sourceDay][block.sourceBlock] = null
        }
        // Remove its placement - it becomes unplaced again (stays in floatingBlocks)
        setPendingPlacements(prev => prev.filter(p => p.blockId !== occupyingPlacement.blockId))
      }
    }

    // Restore to original location
    newTeacherSchedules[block.sourceTeacher][block.sourceDay][block.sourceBlock] = block.entry
    if (!newGradeSchedules[block.grade]) {
      newGradeSchedules[block.grade] = {}
    }
    if (!newGradeSchedules[block.grade][block.sourceDay]) {
      newGradeSchedules[block.grade][block.sourceDay] = {}
    }
    newGradeSchedules[block.grade][block.sourceDay][block.sourceBlock] = [block.sourceTeacher, block.subject]

    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })

    // Remove the returned block from floating blocks (displaced block stays with its original source info)
    setFloatingBlocks(prev => prev.filter(b => b.id !== blockId))

    // Clear selection if we were selecting the returned block
    if (selectedFloatingBlock === blockId) {
      setSelectedFloatingBlock(null)
    }

    // Clear validation errors
    setValidationErrors([])
  }

  function handleUnplaceBlock(blockId: string) {
    const block = floatingBlocks.find(b => b.id === blockId)
    const placement = pendingPlacements.find(p => p.blockId === blockId)
    if (!block || !placement || !workingSchedules) return

    const newTeacherSchedules = JSON.parse(JSON.stringify(workingSchedules.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(workingSchedules.gradeSchedules))

    // Clear the placement location - set to OPEN
    newTeacherSchedules[placement.teacher][placement.day][placement.block] = [block.grade, "OPEN"]
    if (newGradeSchedules[block.grade]?.[placement.day]?.[placement.block]) {
      newGradeSchedules[block.grade][placement.day][placement.block] = null
    }

    setWorkingSchedules({ teacherSchedules: newTeacherSchedules, gradeSchedules: newGradeSchedules })
    setPendingPlacements(prev => prev.filter(p => p.blockId !== blockId))
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
   * Shared validation: Check teacher-grade schedule consistency.
   * Every teacher schedule entry should have a matching grade schedule entry.
   * This catches bugs where grade parsing fails and grades are missing entirely.
   */
  function validateScheduleConsistency(
    teacherSchedules: Record<string, TeacherSchedule>,
    gradeSchedules: Record<string, GradeSchedule>
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
    const availableGrades = new Set(Object.keys(gradeSchedules))

    // Helper to parse a grade display into individual grades
    // e.g., "6th-11th Grade" -> ["6th Grade", "7th Grade", ..., "11th Grade"]
    function parseGradeDisplay(display: string): string[] {
      // Direct match
      if (availableGrades.has(display)) return [display]

      // Check for Kindergarten variations
      if (display.toLowerCase().includes('kindergarten') || display === 'K') {
        for (const g of availableGrades) {
          if (g.toLowerCase().includes('kindergarten') || g === 'K') {
            return [g]
          }
        }
      }

      // Check for range like "6th-11th Grade" or "6th-7th"
      const rangeMatch = display.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)(?:st|nd|rd|th)?/i)
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1])
        const end = parseInt(rangeMatch[2])
        const matched: string[] = []
        for (const g of availableGrades) {
          const num = gradeToNum(g)
          if (num >= start && num <= end) {
            matched.push(g)
          }
        }
        if (matched.length > 0) return matched
      }

      // Check for single grade number
      const singleMatch = display.match(/(\d+)(?:st|nd|rd|th)/i)
      if (singleMatch) {
        const num = parseInt(singleMatch[1])
        for (const g of availableGrades) {
          if (gradeToNum(g) === num) return [g]
        }
      }

      // Study Hall entries don't need grade validation
      return []
    }

    const missingGrades = new Set<string>()
    const missingEntries: Array<{ teacher: string; day: string; block: number; grade: string; subject: string }> = []

    for (const [teacher, schedule] of Object.entries(teacherSchedules)) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (!entry || !entry[0] || entry[1] === "OPEN" || entry[1] === "Study Hall") continue

          const gradeDisplay = entry[0]
          const subject = entry[1]

          // Parse grade display into individual grades
          const individualGrades = parseGradeDisplay(gradeDisplay)

          if (individualGrades.length === 0) {
            // Couldn't parse - this is a real issue (unless it's an elective)
            if (!gradeDisplay.toLowerCase().includes('elective')) {
              missingGrades.add(gradeDisplay)
              missingEntries.push({ teacher, day, block, grade: gradeDisplay, subject })
            }
            continue
          }

          // Check if at least one individual grade has a matching entry
          let foundMatch = false
          for (const g of individualGrades) {
            const gradeSchedule = gradeSchedules[g]
            if (!gradeSchedule) continue

            const gradeEntry = gradeSchedule[day]?.[block]
            if (gradeEntry && gradeEntry[0] === teacher && gradeEntry[1] === subject) {
              foundMatch = true
              break
            }
          }

          // NOTE: We no longer validate teacher vs grade schedule consistency here.
          // The grade schedule data model can only store ONE entry per [grade][day][block],
          // so when multiple classes share a slot (electives, study halls, split classes),
          // only one gets recorded. Teacher schedules are the source of truth.
          // Mismatches are expected and not actual errors.
        }
      }
    }

    // Report missing grades as a single error per grade
    if (missingGrades.size > 0) {
      const gradeList = Array.from(missingGrades).sort(gradeSort).join(', ')
      errors.push({
        type: 'grade_conflict',
        message: `[Missing Grades] Grade schedules missing for: ${gradeList} (${missingEntries.length} entries affected)`,
        cells: missingEntries.slice(0, 10) // Limit to first 10 cells to avoid huge error
      })
    }

    return errors
  }

  function validatePlacements(): ValidationError[] {
    if (!workingSchedules || !selectedResult) return []

    const errors: ValidationError[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    // Build a set of picked-up source locations to exclude from "existing" checks
    const pickedUpLocations = new Set(
      floatingBlocks.map(b => `${b.grade}|${b.sourceDay}|${b.sourceBlock}`)
    )

    // Build a map of teacher status for eligibility checks
    const teacherStatus = new Map(
      selectedResult.teacherStats.map(s => [s.teacher, s.status])
    )

    // 1. Check unplaced blocks
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

    // 2. Check Study Hall teacher eligibility (only full-time teachers)
    for (const placement of pendingPlacements) {
      const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
      if (!placedBlock || placedBlock.subject !== "Study Hall") continue

      const status = teacherStatus.get(placement.teacher)
      if (status !== "full-time") {
        errors.push({
          type: 'teacher_conflict',
          message: `[Study Hall Rule] ${placement.teacher} is ${status || 'unknown'}, only full-time teachers can supervise Study Hall`,
          cells: [{ teacher: placement.teacher, day: placement.day, block: placement.block }]
        })
      }
    }

    // 3. Check teacher conflicts (same teacher, same day, same block)
    for (const [teacher, schedule] of Object.entries(workingSchedules.teacherSchedules)) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (!entry || entry[1] === "OPEN" || entry[1] === "Study Hall") continue

          // Count how many classes this teacher has at this slot (should be 1)
          const placementsHere = pendingPlacements.filter(p =>
            p.teacher === teacher && p.day === day && p.block === block
          )
          if (placementsHere.length > 1) {
            errors.push({
              type: 'teacher_conflict',
              message: `[No Teacher Conflicts] ${teacher} has ${placementsHere.length} classes at ${day} B${block}`,
              cells: placementsHere.map(p => ({ teacher: p.teacher, day: p.day, block: p.block }))
            })
          }
        }
      }
    }

    // 4. Check grade conflicts - multiple placements at same grade/day/block
    // (Skip Study Halls - they don't conflict with regular classes)
    // Note: We check the working schedule for actual conflicts, not the original
    for (const placement of pendingPlacements) {
      const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
      if (!placedBlock) continue

      // Skip Study Halls - they don't cause grade conflicts
      if (placedBlock.subject === "Study Hall") continue

      const grade = placedBlock.grade
      const { day, block } = placement

      // Check for multiple placements at same grade/slot (excluding Study Halls)
      const otherPlacementsAtSlot = pendingPlacements.filter(p => {
        if (p === placement) return false
        const otherBlock = floatingBlocks.find(b => b.id === p.blockId)
        // Skip Study Halls
        if (otherBlock?.subject === "Study Hall") return false
        return otherBlock && otherBlock.grade === grade && p.day === day && p.block === block
      })
      if (otherPlacementsAtSlot.length > 0) {
        // Only report once per conflict set
        const allInConflict = [placement, ...otherPlacementsAtSlot]
        const alreadyReported = errors.some(e =>
          e.type === 'grade_conflict' && e.message.includes(`${grade}`) && e.message.includes(`${day} B${block}`)
        )
        if (!alreadyReported) {
          errors.push({
            type: 'grade_conflict',
            message: `[No Grade Conflicts] ${grade} has ${allInConflict.length} classes scheduled at ${day} B${block}`,
            cells: allInConflict.map(p => ({ teacher: p.teacher, day: p.day, block: p.block, grade }))
          })
        }
      }
    }

    // 5. Check subject conflicts (same subject twice on same day for a grade)
    for (const [grade, schedule] of Object.entries(workingSchedules.gradeSchedules)) {
      for (const day of DAYS) {
        const subjectsOnDay = new Map<string, CellLocation[]>()

        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (!entry || entry[1] === "OPEN" || entry[1] === "Study Hall") continue

          const subject = entry[1]
          if (!subjectsOnDay.has(subject)) {
            subjectsOnDay.set(subject, [])
          }
          subjectsOnDay.get(subject)!.push({ teacher: entry[0], day, block, grade, subject })
        }

        for (const [subject, locations] of subjectsOnDay) {
          if (locations.length > 1) {
            errors.push({
              type: 'subject_conflict',
              message: `[No Duplicate Subjects] ${grade} has ${subject} twice on ${day}`,
              cells: locations
            })
          }
        }
      }
    }

    // Additional validations using class definitions (if loaded)
    if (freeformClasses) {
      // 6. Check fixed slot restrictions
      for (const placement of pendingPlacements) {
        const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
        if (!placedBlock || placedBlock.subject === "Study Hall") continue

        // Find the class definition for this placement
        const classDef = freeformClasses.find(c =>
          c.teacher === placement.teacher &&
          c.grade === placedBlock.grade &&
          c.subject === placedBlock.subject
        )

        if (classDef?.fixedSlots && classDef.fixedSlots.length > 0) {
          const isValidSlot = classDef.fixedSlots.some(
            ([day, block]) => day === placement.day && block === placement.block
          )
          if (!isValidSlot) {
            const validSlots = classDef.fixedSlots.map(([d, b]) => `${d} B${b}`).join(', ')
            errors.push({
              type: 'teacher_conflict',
              message: `[Fixed Slot] ${placedBlock.grade} ${placedBlock.subject} with ${placement.teacher} must be at: ${validSlots}`,
              cells: [{ teacher: placement.teacher, day: placement.day, block: placement.block }]
            })
          }
        }
      }

      // 7. Check teacher availability (days and blocks)
      for (const placement of pendingPlacements) {
        const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
        if (!placedBlock || placedBlock.subject === "Study Hall") continue

        // Find the class definition
        const classDef = freeformClasses.find(c =>
          c.teacher === placement.teacher &&
          c.grade === placedBlock.grade &&
          c.subject === placedBlock.subject
        )

        if (classDef) {
          // Check available days (default to all days if not specified)
          const availDays = classDef.availableDays ?? ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']
          if (!availDays.includes(placement.day)) {
            errors.push({
              type: 'teacher_conflict',
              message: `[Teacher Availability] ${placement.teacher} is not available on ${placement.day} for ${placedBlock.subject}`,
              cells: [{ teacher: placement.teacher, day: placement.day, block: placement.block }]
            })
          }

          // Check available blocks (default to all blocks if not specified)
          const availBlocks = classDef.availableBlocks ?? [1, 2, 3, 4, 5]
          if (!availBlocks.includes(placement.block)) {
            errors.push({
              type: 'teacher_conflict',
              message: `[Teacher Availability] ${placement.teacher} is not available at B${placement.block} for ${placedBlock.subject}`,
              cells: [{ teacher: placement.teacher, day: placement.day, block: placement.block }]
            })
          }
        }
      }

      // 8. Check co-taught classes (same grade+subject with different teachers must be at same time)
      // Group classes by grade+subject to find co-taught pairs
      const coTaughtGroups = new Map<string, typeof freeformClasses>()
      for (const cls of freeformClasses) {
        const key = `${cls.grade}|${cls.subject}`
        if (!coTaughtGroups.has(key)) {
          coTaughtGroups.set(key, [])
        }
        coTaughtGroups.get(key)!.push(cls)
      }

      // For each co-taught group with multiple teachers, check that placements are at the same slot
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

    // 9. Check teacher-grade consistency (shared validation)
    const consistencyErrors = validateScheduleConsistency(
      workingSchedules.teacherSchedules,
      workingSchedules.gradeSchedules
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
   */
  function validateFullSchedule(option: ScheduleOption, stats?: GenerationStats): ValidationError[] {
    const errors: ValidationError[] = []
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    // 1. Check teacher conflicts - no teacher in two places at once
    for (const [teacher, schedule] of Object.entries(option.teacherSchedules)) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entries: Array<{ grade: string; subject: string }> = []
          const entry = schedule[day]?.[block]
          if (entry && entry[1] && entry[1] !== "OPEN") {
            // Count this as an entry (grade, subject)
            entries.push({ grade: entry[0], subject: entry[1] })
          }
          // If somehow there's more than one class at a slot (shouldn't happen but let's check)
          if (entries.length > 1) {
            errors.push({
              type: 'teacher_conflict',
              message: `[Teacher Conflict] ${teacher} has ${entries.length} classes at ${day} B${block}`,
              cells: entries.map(e => ({ teacher, day, block, grade: e.grade, subject: e.subject }))
            })
          }
        }
      }
    }

    // 2. Check grade conflicts - no grade has two different classes at the same time
    // (Study halls don't conflict with each other but do with regular classes)
    for (const [grade, schedule] of Object.entries(option.gradeSchedules)) {
      for (const day of DAYS) {
        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (!entry) continue

          // Also check if any other grade entry at this slot has the same grade
          // (This shouldn't happen but catches merging bugs)
          const teacher = entry[0]
          const subject = entry[1]

          // Cross-check: find all teachers teaching this grade at this slot
          const teachersAtSlot: string[] = []
          for (const [t, tSchedule] of Object.entries(option.teacherSchedules)) {
            const tEntry = tSchedule[day]?.[block]
            if (tEntry && tEntry[0] === grade && tEntry[1] !== "OPEN" && tEntry[1] !== "Study Hall") {
              teachersAtSlot.push(t)
            }
          }

          // Skip study halls for conflict detection (multiple study halls at same slot is OK)
          if (subject !== "Study Hall" && teachersAtSlot.length > 1) {
            errors.push({
              type: 'grade_conflict',
              message: `[Grade Conflict] ${grade} has ${teachersAtSlot.length} classes at ${day} B${block}: ${teachersAtSlot.join(', ')}`,
              cells: teachersAtSlot.map(t => ({ teacher: t, day, block, grade }))
            })
          }
        }
      }
    }

    // 3. Check subject conflicts - same subject twice on same day for a grade
    for (const [grade, schedule] of Object.entries(option.gradeSchedules)) {
      for (const day of DAYS) {
        const subjectsOnDay = new Map<string, Array<{ teacher: string; block: number }>>()

        for (let block = 1; block <= 5; block++) {
          const entry = schedule[day]?.[block]
          if (!entry || entry[1] === "OPEN" || entry[1] === "Study Hall") continue

          const subject = entry[1]
          if (!subjectsOnDay.has(subject)) {
            subjectsOnDay.set(subject, [])
          }
          subjectsOnDay.get(subject)!.push({ teacher: entry[0], block })
        }

        for (const [subject, occurrences] of subjectsOnDay) {
          if (occurrences.length > 1) {
            errors.push({
              type: 'subject_conflict',
              message: `[Subject Conflict] ${grade} has ${subject} ${occurrences.length}x on ${day}`,
              cells: occurrences.map(o => ({ teacher: o.teacher, day, block: o.block, grade, subject }))
            })
          }
        }
      }
    }

    // 4. Check teacher-grade consistency (shared validation)
    const consistencyErrors = validateScheduleConsistency(
      option.teacherSchedules,
      option.gradeSchedules
    )
    errors.push(...consistencyErrors)

    // === Comprehensive checks (require stats) ===
    if (stats) {
      // 5. Class Session Count - check each class is scheduled the correct number of times
      if (stats.classes_snapshot) {
        const classes = parseClassesFromSnapshot(stats.classes_snapshot)

        for (const cls of classes) {
          if (!cls.teacher || !cls.subject) continue

          const teacherSchedule = option.teacherSchedules[cls.teacher]
          if (!teacherSchedule) continue

          // Count how many times this class appears in the schedule
          let sessionCount = 0
          for (const day of DAYS) {
            for (let block = 1; block <= 5; block++) {
              const entry = teacherSchedule[day]?.[block]
              if (!entry || entry[1] !== cls.subject) continue

              // Check if grade matches (handle multi-grade classes)
              const classGrades = cls.grades || [cls.grade]
              const entryMatches = classGrades.some(g =>
                entry[0] === g || entry[0]?.includes(g) || g?.includes(entry[0])
              ) || entry[0] === cls.gradeDisplay

              if (entryMatches) {
                sessionCount++
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
      }

      // 6. Study Hall Coverage - check all required grades have study halls
      if (stats.rules_snapshot) {
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
                if (entry && entry[1] === 'Study Hall') {
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
        const fullTimeTeachers = teachers.filter(t => t.status === 'full-time').map(t => t.name)

        for (const teacher of fullTimeTeachers) {
          const schedule = option.teacherSchedules[teacher]
          if (!schedule) continue

          let backToBackCount = 0
          for (const day of DAYS) {
            for (let block = 1; block <= 4; block++) {
              const entry1 = schedule[day]?.[block]
              const entry2 = schedule[day]?.[block + 1]

              const isOpen1 = !entry1 || entry1[1] === 'OPEN' || entry1[1] === 'Study Hall'
              const isOpen2 = !entry2 || entry2[1] === 'OPEN' || entry2[1] === 'Study Hall'

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

      // 8. Fixed Slot Violations - check classes with fixed slots are in those slots
      if (stats.classes_snapshot) {
        const classes = parseClassesFromSnapshot(stats.classes_snapshot)

        for (const cls of classes) {
          if (!cls.fixedSlots || cls.fixedSlots.length === 0) continue
          if (!cls.teacher || !cls.subject) continue

          const teacherSchedule = option.teacherSchedules[cls.teacher]
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
      }

      // 9. Availability Violations - check classes are within available days/blocks
      if (stats.classes_snapshot) {
        const classes = parseClassesFromSnapshot(stats.classes_snapshot)

        for (const cls of classes) {
          if (!cls.teacher || !cls.subject) continue

          const hasRestrictedDays = cls.availableDays && cls.availableDays.length < 5
          const hasRestrictedBlocks = cls.availableBlocks && cls.availableBlocks.length < 5

          if (!hasRestrictedDays && !hasRestrictedBlocks) continue

          const teacherSchedule = option.teacherSchedules[cls.teacher]
          if (!teacherSchedule) continue

          for (const day of DAYS) {
            for (let block = 1; block <= 5; block++) {
              const entry = teacherSchedule[day]?.[block]
              if (!entry || entry[1] !== cls.subject) continue

              const classGrades = cls.grades || [cls.grade]
              const entryMatches = classGrades.some(g =>
                entry[0] === g || entry[0]?.includes(g) || g?.includes(entry[0])
              ) || entry[0] === cls.gradeDisplay

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
      }
    }

    return errors
  }

  function handleValidate() {
    const errors = validatePlacements()
    setValidationErrors(errors)

    if (errors.length === 0) {
      toast.success("No validation errors found")
    } else {
      toast.error(`${errors.length} validation error${errors.length !== 1 ? 's' : ''} found`)
    }
  }

  async function handleApplyFreeform(createNew: boolean = false) {
    if (!generation || !selectedResult || !workingSchedules) return

    const errors = validatePlacements()
    if (errors.length > 0) {
      setValidationErrors(errors)
      toast.error(`${errors.length} error${errors.length !== 1 ? 's' : ''} - fix before applying`)
      return
    }

    const optionIndex = parseInt(viewingOption) - 1

    // Save current state for undo
    const previousOptions: ScheduleOption[] = JSON.parse(JSON.stringify(generation.options))
    const previousSelectedOption = viewingOption

    // Build updated option with working schedules
    const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]

    // Update studyHallAssignments if any study halls were moved
    let updatedStudyHallAssignments = [...selectedResult.studyHallAssignments]
    for (const placement of pendingPlacements) {
      const block = floatingBlocks.find(b => b.id === placement.blockId)
      if (block && block.subject === "Study Hall") {
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

    const updatedOption: ScheduleOption = {
      ...selectedResult,
      teacherSchedules: workingSchedules.teacherSchedules,
      gradeSchedules: workingSchedules.gradeSchedules,
      studyHallAssignments: updatedStudyHallAssignments,
    }

    // Regenerate teacher stats
    updatedOption.teacherStats = selectedResult.teacherStats.map(stat => {
      const schedule = workingSchedules.teacherSchedules[stat.teacher]
      let teaching = 0, studyHall = 0, open = 0, backToBackIssues = 0

      for (const day of DAYS) {
        let prevWasOpen = false
        for (let block = 1; block <= 5; block++) {
          const entry = schedule?.[day]?.[block]
          if (!entry || entry[1] === "OPEN") {
            open++
            if (prevWasOpen && stat.status === "full-time") backToBackIssues++
            prevWasOpen = true
          } else if (entry[1] === "Study Hall") {
            studyHall++
            prevWasOpen = true
          } else {
            teaching++
            prevWasOpen = false
          }
        }
      }

      return { ...stat, teaching, studyHall, open, totalUsed: teaching + studyHall, backToBackIssues }
    })

    // Regenerate total back-to-back issues
    updatedOption.backToBackIssues = updatedOption.teacherStats.reduce((sum, s) => sum + s.backToBackIssues, 0)

    // Define the save function to pass to validation modal
    const doSave = async () => {
      // Save to server
      let updatedOptions: ScheduleOption[]
      let newOptionIndex: number

      if (createNew) {
        // Append as new option
        updatedOptions = [...generation.options, updatedOption]
        newOptionIndex = updatedOptions.length
      } else {
        // Overwrite current option
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
          }),
        })

        if (updateRes.ok) {
          setGeneration({
            ...generation,
            options: updatedOptions,
            ...(createNew && { selected_option: newOptionIndex }),
          })
          exitFreeformMode()

          // Switch to the new option if created
          if (createNew) {
            setViewingOption(String(newOptionIndex))
          }

          // Show success toast with undo
          const moveCount = floatingBlocks.length
          const message = createNew
            ? `Created Rev ${newOptionIndex} with ${moveCount} change${moveCount !== 1 ? 's' : ''}`
            : `Applied ${moveCount} change${moveCount !== 1 ? 's' : ''} to Rev ${viewingOption}`

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
                        body: JSON.stringify({ options: previousOptions }),
                      })
                      if (undoRes.ok) {
                        setGeneration((prev) => prev ? { ...prev, options: previousOptions } : prev)
                        if (createNew) {
                          setViewingOption(previousSelectedOption)
                        }
                        toast.success("Changes undone")
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
              icon: <Check className="h-4 w-4 text-emerald-600" />,
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
    runValidationWithModal(updatedOption, generation.stats, doSave)
  }

  // TWO DISTINCT CONCEPTS - DO NOT CONFUSE:
  // 1. savedOption: The ACTUAL saved schedule from generation.options (what's in the database)
  // 2. displayedOption: What's currently being SHOWN to the user (could be preview or saved)
  const savedOption = generation?.options?.[parseInt(viewingOption) - 1] || null
  const displayedOption = (previewOption && showingPreview) ? previewOption : savedOption

  // Legacy alias - gradually migrate usages to savedOption or displayedOption as appropriate
  const selectedResult = displayedOption
  const currentOption = savedOption

  if (loading) {
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
          {generation.notes ? (
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
          )}
        </div>
      </div>

      {generation.options && generation.options.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between no-print sticky top-0 z-10 bg-white py-2 -mt-2">
            <div className="flex flex-col gap-1">
              <div className="inline-flex rounded-lg bg-gray-100 p-1">
                {generation.options.map((opt, i) => {
                  const isThisOption = viewingOption === (i + 1).toString()
                  const isActive = isThisOption && (!previewOption || !showingPreview)
                  const shPlaced = opt?.studyHallsPlaced ?? 0
                  const shTotal = opt?.studyHallAssignments?.length || 6
                  const allStudyHallsPlaced = shPlaced >= shTotal
                  const isSelected = generation.selected_option === i + 1
                  // Disable switching options while in an edit mode
                  const inEditMode = swapMode || freeformMode || studyHallMode || regenMode
                  // During preview, allow clicking current option to toggle to original view
                  const isClickable = !isGenerating && !inEditMode && (!previewOption || isThisOption)
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        if (previewOption && isThisOption) {
                          setShowingPreview(false)
                        } else {
                          setViewingOption((i + 1).toString())
                        }
                      }}
                      disabled={!isClickable}
                      title={inEditMode ? "Exit current mode before switching options" : undefined}
                      className={`
                        px-3 py-1.5 rounded-md text-sm transition-all flex items-center gap-1.5
                        ${isActive
                          ? 'bg-white text-gray-900 shadow-sm font-medium'
                          : isSelected
                            ? 'text-gray-600 hover:text-gray-900 font-medium'
                            : 'text-gray-400 hover:text-gray-600 font-normal'
                        }
                        disabled:opacity-50 disabled:cursor-not-allowed
                      `}
                    >
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                      Revision {i + 1}
                      {allStudyHallsPlaced && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500" title="All study halls placed" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 no-print">
              {/* Export buttons - hidden during modes */}
              {!previewOption && !regenMode && !swapMode && !freeformMode && !studyHallMode && (
                <>
                  <a
                    href={`/api/export?generation_id=${id}&option=${viewingOption}&format=xlsx`}
                    download
                  >
                    <Button variant="outline" size="sm" className="gap-1">
                      <Download className="h-4 w-4" />
                      XLSX
                    </Button>
                  </a>
                  <a
                    href={`/api/export?generation_id=${id}&option=${viewingOption}&format=csv`}
                    download
                  >
                    <Button variant="outline" size="sm" className="gap-1">
                      <Download className="h-4 w-4" />
                      CSV
                    </Button>
                  </a>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => window.print()}
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </Button>
                </>
              )}

              {/* Class Changes Indicator - small button that opens dialog */}
              {classChanges?.hasChanges && !changesDismissed && !regenMode && !swapMode && !freeformMode && !studyHallMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowChangesDialog(true)}
                  className="gap-1.5 text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100 no-print"
                  title={classChanges.summary}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="text-xs">{classChanges.affectedTeachers.length} changed</span>
                </Button>
              )}

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
                  <DropdownMenuItem onClick={handleValidateSchedule} disabled={regenMode || swapMode || freeformMode || studyHallMode || !!previewOption}>
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Validate Schedule
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDuplicateRevision} disabled={regenMode || swapMode || freeformMode || studyHallMode}>
                    <Copy className="h-4 w-4 mr-2" />
                    Duplicate Revision
                  </DropdownMenuItem>
                  {generation.selected_option !== parseInt(viewingOption) && !previewOption && (
                    <DropdownMenuItem onClick={handleMarkAsSelected}>
                      <Star className="h-4 w-4 mr-2" />
                      Mark as Selected
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
                        Delete Revision {viewingOption}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {selectedResult && (
            <div className="space-y-6">
              {/* Stats Summary - hidden during edit modes */}
              {!isGenerating && !swapMode && !freeformMode && !studyHallMode && !regenMode && (
                <div>
                  <ScheduleStats
                    stats={selectedResult.teacherStats}
                    studyHallAssignments={selectedResult.studyHallAssignments}
                    gradeSchedules={selectedResult.gradeSchedules}
                    teacherSchedules={selectedResult.teacherSchedules}
                    backToBackIssues={selectedResult.backToBackIssues}
                    studyHallsPlaced={selectedResult.studyHallsPlaced}
                    defaultExpanded={isNewGeneration}
                  />
                </div>
              )}

              {/* Mode Banners - Sticky container */}
              {(swapMode || freeformMode || regenMode || studyHallMode) && (
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
                              ? selectedCell.subject === "Study Hall"
                                ? `Selected Study Hall (${selectedCell.day} B${selectedCell.block}). Click another teacher's OPEN slot to reassign supervision.`
                                : selectedCell.subject === "OPEN"
                                  ? `Selected OPEN block (${selectedCell.day} B${selectedCell.block}). Click another OPEN to exchange.`
                                  : `Selected ${selectedCell.grade} ${selectedCell.subject} (${selectedCell.day} B${selectedCell.block}). Click a highlighted slot to exchange.`
                              : "Click a class to exchange a time slot. Or exchange a Study Hall with another teacher's OPEN slot."
                          ) : (
                            selectedCell
                              ? selectedCell.subject === "Study Hall"
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
                        onClick={() => handleApplySwap(generation.options.length === 1)}
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
                    </div>
                    <span className="text-amber-600/70">
                      {generation.options.length === 1 ? "Will create Revision 2" : `Will update Revision ${viewingOption}`}
                    </span>
                  </div>
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
                          {selectedFloatingBlock
                            ? "Click an OPEN slot to place the selected block"
                            : floatingBlocks.length === 0
                              ? "Click any class to pick it up and move it to a different time slot."
                              : "Select a floating block, then click an OPEN slot to place it"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleValidate}
                        className="text-indigo-600 border-indigo-300 hover:bg-indigo-100"
                        disabled={floatingBlocks.length === 0}
                      >
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
                        onClick={() => handleApplyFreeform(generation.options.length === 1)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        disabled={floatingBlocks.length === 0}
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
                      {validationErrors.length > 0 && (
                        <span className="text-amber-600 font-medium">
                          {validationErrors.length} issue{validationErrors.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <span className="text-indigo-600/70">
                      {generation.options.length === 1 ? "Will create Revision 2" : `Will update Revision ${viewingOption}`}
                    </span>
                  </div>
                  {/* Validation errors list */}
                  {validationErrors.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-indigo-200">
                      <div className="text-xs font-medium text-red-600 mb-1">Validation Issues:</div>
                      <ul className="text-xs text-red-600 space-y-0.5">
                        {validationErrors.map((error, idx) => (
                          <li key={idx} className="flex items-start gap-1">
                            <span className="text-red-400 mt-0.5">•</span>
                            <span>{error.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
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
                        onClick={exitStudyHallMode}
                        className="text-slate-600 border-slate-300 hover:bg-slate-100"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleKeepPreview(generation.options.length === 1)}
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
                                ? 'bg-violet-600 text-white'
                                : 'text-slate-600 hover:text-slate-800'
                            }`}
                          >
                            Preview
                          </button>
                        </div>
                      )}
                    </div>
                    {previewOption && validationErrors.length > 0 && (
                      <span className="text-amber-600 font-medium">
                        {validationErrors.length} issue{validationErrors.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {previewOption && (
                      <span className="text-violet-600/70">
                        {generation.options.length === 1 ? "Will create Revision 2" : `Will update Revision ${viewingOption}`}
                      </span>
                    )}
                  </div>
                  {/* Validation errors warning */}
                  {previewOption && validationErrors.length > 0 && (
                    <div className="mt-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">
                      <div className="flex items-center gap-2 font-medium mb-1">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                        <span>Schedule conflicts detected:</span>
                      </div>
                      <ul className="text-xs space-y-0.5 ml-6">
                        {validationErrors.slice(0, 5).map((error, idx) => (
                          <li key={idx}>• {error.message}</li>
                        ))}
                        {validationErrors.length > 5 && (
                          <li className="text-red-500">...and {validationErrors.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}
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
                            onClick={() => handleKeepPreview(generation.options.length === 1)}
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
                          {!previewOption && (
                            <label className="flex items-center gap-1.5 text-slate-500 cursor-pointer select-none group" title="When enabled, study halls can move to any eligible teacher (not just selected ones). This may help find a valid schedule when constraints are tight.">
                              <input
                                type="checkbox"
                                checked={allowStudyHallReassignment}
                                onChange={(e) => setAllowStudyHallReassignment(e.target.checked)}
                                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                              />
                              <span>Reassign study halls to any teacher</span>
                              <span className="text-slate-400 group-hover:text-slate-500">(may improve results)</span>
                            </label>
                          )}
                        </div>
                        {previewOption && validationErrors.length > 0 && (
                          <span className="text-red-600 font-medium">
                            {validationErrors.length} validation issue{validationErrors.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {previewOption && (
                          <span className="text-sky-600/70">
                            {generation.options.length === 1 ? "Will create Revision 2" : `Will update Revision ${viewingOption}`}
                          </span>
                        )}
                      </div>
                      {/* Validation errors warning */}
                      {previewOption && validationErrors.length > 0 && (
                        <div className="mt-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">
                          <div className="flex items-center gap-2 font-medium mb-1">
                            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                            <span>Schedule conflicts detected:</span>
                          </div>
                          <ul className="text-xs space-y-0.5 ml-6">
                            {validationErrors.slice(0, 5).map((error, idx) => (
                              <li key={idx}>• {error.message}</li>
                            ))}
                            {validationErrors.length > 5 && (
                              <li className="text-red-500">...and {validationErrors.length - 5} more</li>
                            )}
                          </ul>
                        </div>
                      )}
                      {/* Warning for suboptimal results */}
                      {previewOption && (() => {
                        const expectedSH = previewOption.studyHallAssignments?.length || 0
                        const placedSH = previewOption.studyHallsPlaced || 0
                        const missingSH = expectedSH - placedSH
                        const btbIssues = previewOption.backToBackIssues || 0
                        const isSuboptimal = missingSH > 0 || previewStrategy === "suboptimal" || previewStrategy === "randomized" || previewStrategy === "js"

                        if (!isSuboptimal) return null

                        // Build the warning message
                        const issues: string[] = []
                        if (missingSH > 0) {
                          issues.push(`only ${placedSH}/${expectedSH} study halls placed`)
                        }
                        if (btbIssues > 0) {
                          issues.push(`${btbIssues} back-to-back issue${btbIssues !== 1 ? 's' : ''}`)
                        }

                        const strategyNote = previewStrategy === "js"
                          ? "JS fallback"
                          : previewStrategy === "suboptimal"
                            ? "suboptimal mode"
                            : previewStrategy === "randomized"
                              ? "randomized mode"
                              : null

                        return (
                          <div className="flex items-center gap-2 mt-2 text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
                            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                            <span>
                              {issues.length > 0
                                ? `Results: ${issues.join(', ')}${strategyNote ? ` (${strategyNote})` : ''}.`
                                : `Used ${strategyNote} — results may not be optimal.`}
                              {' '}Press Regenerate to try again.
                            </span>
                          </div>
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
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">
                    {viewMode === "teacher" ? "Teacher Schedules" : "Grade Schedules"}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setViewMode(viewMode === "teacher" ? "grade" : "teacher")
                      // Clear swap state when switching views
                      setSelectedCell(null)
                      setValidTargets([])
                    }}
                    disabled={isGenerating || freeformMode}
                    className="gap-1.5 no-print"
                  >
                    {viewMode === "teacher" ? (
                      <GraduationCap className="h-4 w-4" />
                    ) : (
                      <Users className="h-4 w-4" />
                    )}
                    View by {viewMode === "teacher" ? "Grade" : "Teacher"}
                  </Button>
                </div>
                {/* Show message when in regen preview mode */}
                {previewOption && previewType === "regen" && previewTeachers.size > 0 && viewMode === "teacher" && (
                  <div className="col-span-full mb-4 text-sm text-sky-600 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                    Comparing {previewTeachers.size} regenerated teacher{previewTeachers.size !== 1 ? 's' : ''}. Toggle between Original and Preview to compare.
                  </div>
                )}
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
                          // Get unplaced floating blocks from this teacher
                          const teacherFloatingBlocks = floatingBlocks.filter(b =>
                            b.sourceTeacher === teacher &&
                            !pendingPlacements.some(p => p.blockId === b.id)
                          )

                          return (
                            <div key={teacher} className="space-y-2">
                              <ScheduleGrid
                                schedule={
                                  freeformMode && workingSchedules && showingPreview
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
                                swapMode={swapMode && showingPreview}
                                selectedCell={selectedCell}
                                validTargets={validTargets}
                                highlightedCells={highlightedCells}
                                onCellClick={handleCellClick}
                                freeformMode={freeformMode && showingPreview}
                                floatingBlocks={floatingBlocks}
                                pendingPlacements={pendingPlacements}
                                selectedFloatingBlock={selectedFloatingBlock}
                                validationErrors={validationErrors}
                                onPickUp={handlePickUpBlock}
                                onPlace={handlePlaceBlock}
                                onUnplace={handleUnplaceBlock}
                                onDeselect={() => setSelectedFloatingBlock(null)}
                              />
                              {/* Unplaced floating blocks from this teacher */}
                              {freeformMode && teacherFloatingBlocks.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 px-1 no-print">
                                  {teacherFloatingBlocks.map(block => {
                                    const isSelected = selectedFloatingBlock === block.id
                                    const error = validationErrors.find(e => e.blockId === block.id)
                                    const isStudyHall = block.subject === "Study Hall"

                                    return (
                                      <div
                                        key={block.id}
                                        onClick={() => handleSelectFloatingBlock(block.id)}
                                        title="Click to select, then click a cell to place"
                                        className={`
                                          p-1 rounded border text-center w-[60px] cursor-pointer transition-all relative group
                                          ${error
                                            ? 'bg-red-100 border-red-300 ring-2 ring-red-400'
                                            : isSelected
                                              ? 'ring-2 ring-indigo-500'
                                              : 'hover:ring-2 hover:ring-indigo-300'
                                          }
                                          ${isStudyHall
                                            ? 'bg-blue-100 border-blue-200'
                                            : 'bg-green-50 border-green-200'
                                          }
                                        `}
                                      >
                                        <div className="font-medium text-xs leading-tight truncate">
                                          {block.grade.replace(' Grade', '').replace('Kindergarten', 'K')}
                                        </div>
                                        <div className="text-[10px] leading-tight text-muted-foreground truncate">
                                          {block.subject}
                                        </div>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleReturnBlock(block.id)
                                          }}
                                          className="absolute -top-1 -right-1 w-4 h-4 bg-slate-200 hover:bg-slate-300 rounded-full text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                                          title="Return to original position"
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
                          />
                        ))}
                </div>
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
              Classes have changed
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
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
                <p className="text-sm text-slate-500">
                  You can apply these changes by regenerating affected teachers, or keep the schedule unchanged.
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
                setChangesDismissed(true)
                setPendingModeEntry(null)
                // Pre-select affected teachers and enter regen mode with current classes
                setSelectedForRegen(new Set(classChanges?.affectedTeachers || []))
                setUseCurrentClasses(true) // Use current DB classes for this regeneration
                setRegenMode(true)
              }}
              className="bg-amber-600 hover:bg-amber-700"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Apply Changes & Regenerate
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
                : validationModal?.checks.some(c => c.status === 'failed' && c.errorCount && c.errorCount > 0 && c.name !== 'Back-to-back blocks')
                  ? <AlertTriangle className="h-5 w-5 text-red-500" />
                  : validationModal?.checks.some(c => c.status === 'failed' && c.errorCount && c.errorCount > 0)
                    ? <AlertTriangle className="h-5 w-5 text-amber-500" />
                    : <Check className="h-5 w-5 text-green-600" />
              }
              {validationModal?.mode === 'review' ? 'Schedule Validation' : 'Validating Schedule'}
            </DialogTitle>
            <DialogDescription>
              {validationModal?.checks.every(c => c.status === 'passed' || c.status === 'failed')
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
                      {check.status === 'failed' && (
                        <X className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <span className={`flex-1 text-sm ${
                      check.status === 'checking' ? 'text-blue-600 font-medium' :
                      check.status === 'passed' ? 'text-slate-600' :
                      check.status === 'failed' ? 'text-red-600 font-medium' :
                      'text-slate-400'
                    }`}>
                      {check.name}
                    </span>
                    {check.status === 'failed' && check.errorCount && check.errorCount > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                        check.name === 'Back-to-back blocks'
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
          {validationModal?.checks.every(c => c.status === 'passed' || c.status === 'failed') && (
            <DialogFooter className="flex-col sm:flex-col gap-2 pt-2 border-t">
              {/* Summary message */}
              {(() => {
                const totalIssues = validationModal?.checks.reduce((sum, c) => sum + (c.errorCount || 0), 0) || 0
                const hardErrors = validationModal?.checks
                  .filter(c => c.status === 'failed' && c.name !== 'Back-to-back blocks')
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
                onClick={() => setValidationModal(null)}
                className="w-full sm:w-auto"
              >
                {validationModal?.mode === 'review' ? 'Close' : 'Review Errors'}
              </Button>
            </DialogFooter>
          )}
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
