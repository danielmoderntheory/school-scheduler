"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ScheduleGrid } from "@/components/ScheduleGrid"
import { ScheduleStats } from "@/components/ScheduleStats"
import { Loader2, Download, ArrowLeft, Check, RefreshCw, Shuffle, Trash2, Star, MoreVertical, Users, GraduationCap, Printer, ArrowLeftRight, X, Hand, Pencil, Copy } from "lucide-react"
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
import type { ScheduleOption, TeacherSchedule, GradeSchedule, Teacher, FloatingBlock, PendingPlacement, ValidationError, CellLocation } from "@/lib/types"
import toast from "react-hot-toast"
import { generateSchedules, reassignStudyHalls } from "@/lib/scheduler"
import { generateSchedulesRemote } from "@/lib/scheduler-remote"

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

interface ClassSnapshot {
  days_per_week: number
  [key: string]: unknown
}

interface Generation {
  id: string
  quarter_id: string
  generated_at: string
  selected_option: number | null
  notes: string | null
  is_starred: boolean
  options: ScheduleOption[]
  stats?: {
    classes_snapshot?: ClassSnapshot[]
  }
  quarter: { id: string; name: string }
}

export default function HistoryDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string
  const isNewGeneration = searchParams.get('new') === 'true'
  const [generation, setGeneration] = useState<Generation | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedOption, setSelectedOption] = useState("1")
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
  const [workingSchedules, setWorkingSchedules] = useState<{
    teacherSchedules: Record<string, TeacherSchedule>
    gradeSchedules: Record<string, GradeSchedule>
  } | null>(null)
  const [freeformClasses, setFreeformClasses] = useState<Array<{
    teacher: string
    grade: string
    subject: string
    daysPerWeek: number
    fixedSlots?: [string, number][]
    availableDays: string[]
    availableBlocks: number[]
  }> | null>(null)


  // Star dialog state
  const [showStarDialog, setShowStarDialog] = useState(false)
  const [starNote, setStarNote] = useState("")
  const [isEditingNote, setIsEditingNote] = useState(false)

  useEffect(() => {
    loadGeneration()
  }, [id])

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
  }, [selectedOption])

  async function loadGeneration() {
    try {
      const res = await fetch(`/api/history/${id}`)
      if (res.ok) {
        const data = await res.json()
        setGeneration(data)
        if (data.selected_option) {
          setSelectedOption(data.selected_option.toString())
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
      document.title = `${generation.quarter?.name || 'Schedule'} Rev ${selectedOption} - ${shortId}`
    }
  }, [generation, selectedOption])

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

  function enterRegenMode() {
    setRegenMode(true)
    setSelectedForRegen(new Set())
    setRegenSeed(0) // Reset seed for fresh regeneration session
  }

  function exitRegenMode() {
    setRegenMode(false)
    setSelectedForRegen(new Set())
    setPreviewOption(null)
    setPreviewType(null)
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
    if (!generation || !selectedResult) return

    if (selectedForRegen.size === 0) {
      toast.error("Select at least one teacher to regenerate")
      return
    }

    setIsGenerating(true)

    try {
      // Fetch current teachers, classes, and rules for the quarter
      const [teachersRes, classesRes, rulesRes] = await Promise.all([
        fetch('/api/teachers'),
        fetch(`/api/classes?quarter_id=${generation.quarter_id}`),
        fetch('/api/rules')
      ])

      const teachers = await teachersRes.json()
      const classesRaw = await classesRes.json()
      const rulesRaw = await rulesRes.json()

      // Transform rules to scheduler format
      const rules = rulesRaw.map((r: { rule_key: string; enabled: boolean; config?: Record<string, unknown> }) => ({
        rule_key: r.rule_key,
        enabled: r.enabled,
        config: r.config
      }))

      // Transform classes to the format expected by the scheduler
      const classes = classesRaw.map((c: {
        teacher: { name: string }
        grade: { display_name: string }
        subject: { name: string }
        days_per_week: number
        restrictions?: Array<{
          restriction_type: string
          value: unknown
        }>
      }) => {
        const restrictions = c.restrictions || []
        const fixedSlots: [string, number][] = []
        let availableDays = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']
        let availableBlocks = [1, 2, 3, 4, 5]

        restrictions.forEach((r: { restriction_type: string; value: unknown }) => {
          if (r.restriction_type === 'fixed_slot') {
            const v = r.value as { day: string; block: number }
            fixedSlots.push([v.day, v.block])
          } else if (r.restriction_type === 'available_days') {
            availableDays = r.value as string[]
          } else if (r.restriction_type === 'available_blocks') {
            availableBlocks = r.value as number[]
          }
        })

        return {
          teacher: c.teacher.name,
          grade: c.grade.display_name,
          subject: c.subject.name,
          daysPerWeek: c.days_per_week,
          fixedSlots: fixedSlots.length > 0 ? fixedSlots : undefined,
          availableDays,
          availableBlocks,
        }
      })

      // Build locked teacher schedules (all teachers EXCEPT those selected for regen)
      const lockedSchedules: Record<string, TeacherSchedule> = {}
      for (const teacher of Object.keys(selectedResult.teacherSchedules)) {
        if (!selectedForRegen.has(teacher)) {
          lockedSchedules[teacher] = selectedResult.teacherSchedules[teacher]
        }
      }

      // Find which regenerated teachers had study halls in the original schedule
      // These teachers must be assigned study halls again
      const teachersNeedingStudyHalls = (selectedResult.studyHallAssignments || [])
        .filter(sh => sh.teacher && selectedForRegen.has(sh.teacher))
        .map(sh => sh.teacher as string)

      // Generate new schedule with locked teachers
      // Try OR-Tools solver first, fall back to JS solver if it fails
      // Increment seed to get different results on subsequent regenerations
      const currentSeed = regenSeed + 1
      setRegenSeed(currentSeed)

      setGenerationProgress({ current: 0, total: 100, message: "Starting OR-Tools solver..." })

      // First try OR-Tools remote solver
      const remoteResult = await generateSchedulesRemote(teachers, classes, {
        numOptions: 1,
        numAttempts: 50, // Fewer attempts for regen since it's a partial solve
        maxTimeSeconds: 120, // 2 minute timeout for regen
        lockedTeachers: lockedSchedules,
        teachersNeedingStudyHalls,
        rules,
        onProgress: (current, total, message) => {
          setGenerationProgress({ current, total, message: `[OR-Tools] ${message}` })
        }
      })

      // Use a unified result type
      let result: { status: string; options: ScheduleOption[]; message?: string } = remoteResult
      let usedJsFallback = false

      // Check if OR-Tools failed or produced no material changes
      let shouldFallbackToJs = remoteResult.status !== 'success' || remoteResult.options.length === 0

      // Also check for "no material changes" - if regenerated teachers' schedules are identical
      if (!shouldFallbackToJs && remoteResult.options.length > 0) {
        const newSchedules = remoteResult.options[0].teacherSchedules
        let hasChanges = false

        for (const teacher of selectedForRegen) {
          const originalSchedule = selectedResult.teacherSchedules[teacher]
          const newSchedule = newSchedules[teacher]

          if (!originalSchedule || !newSchedule) continue

          // Compare each slot
          for (const day of ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']) {
            for (const block of [1, 2, 3, 4, 5]) {
              const origEntry = originalSchedule[day]?.[block]
              const newEntry = newSchedule[day]?.[block]

              // Compare as JSON strings to handle null and array entries
              if (JSON.stringify(origEntry) !== JSON.stringify(newEntry)) {
                hasChanges = true
                break
              }
            }
            if (hasChanges) break
          }
          if (hasChanges) break
        }

        if (!hasChanges) {
          console.log('[Regen] OR-Tools returned no material changes, falling back to JS solver')
          shouldFallbackToJs = true
        }
      }

      // If OR-Tools failed or no changes, fall back to JS solver
      if (shouldFallbackToJs) {
        console.log('[Regen] Falling back to JS solver:', remoteResult.message || 'no changes')
        setGenerationProgress({ current: 0, total: 100, message: "Trying JS solver for variety..." })

        const jsResult = await generateSchedules(teachers, classes, {
          numOptions: 1,
          numAttempts: 100,
          lockedTeachers: lockedSchedules,
          teachersNeedingStudyHalls,
          seed: currentSeed * 12345,
          rules,
          onProgress: (current, total, message) => {
            setGenerationProgress({ current, total, message: `[JS] ${message}` })
          }
        })
        result = jsResult
        usedJsFallback = true
      }

      if (result.status !== 'success' || result.options.length === 0) {
        toast.error(result.message || "Could not generate a valid schedule with these constraints")
        setIsGenerating(false)
        return
      }

      // Set as preview (not saved yet)
      const newOption = {
        ...result.options[0],
        optionNumber: generation.options.length + 1,
      }

      // Save which teachers were regenerated
      setPreviewTeachers(new Set(selectedForRegen))
      setPreviewOption(newOption)
      setPreviewType("regen")
      toast.success(usedJsFallback ? "Schedules regenerated (JS solver)" : "Schedules regenerated (OR-Tools)")
    } catch (error) {
      console.error('Regeneration error:', error)
      toast.error("Failed to generate variation")
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleKeepPreview(saveAsNew: boolean = false) {
    if (!generation || !previewOption) return

    try {
      let updatedOptions: ScheduleOption[]
      let successMessage: string

      if (!saveAsNew) {
        // Update current option in place
        const optionIndex = parseInt(selectedOption) - 1
        updatedOptions = [...generation.options]
        updatedOptions[optionIndex] = {
          ...previewOption,
          optionNumber: optionIndex + 1,
        }
        successMessage = previewType === "study-hall"
          ? `Study halls reassigned for Rev ${optionIndex + 1}`
          : `Rev ${optionIndex + 1} updated`
      } else {
        // Save as new option
        const newOptionNumber = generation.options.length + 1
        updatedOptions = [...generation.options, {
          ...previewOption,
          optionNumber: newOptionNumber,
        }]
        successMessage = `Saved as Rev ${newOptionNumber}`
      }

      const newOptionNumber = saveAsNew ? generation.options.length + 1 : null
      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          options: updatedOptions,
          ...(newOptionNumber && { selected_option: newOptionNumber }),
        }),
      })

      if (updateRes.ok) {
        setGeneration({
          ...generation,
          options: updatedOptions,
          ...(newOptionNumber && { selected_option: newOptionNumber }),
        })
        if (saveAsNew) {
          setSelectedOption(newOptionNumber!.toString())
        }
        setPreviewOption(null)
        setPreviewType(null)
        setStudyHallMode(false)
        setStudyHallSeed(null)
        setRegenMode(false)
        setSelectedForRegen(new Set())
        toast.success(successMessage)
      } else {
        toast.error("Failed to save changes")
      }
    } catch (error) {
      console.error('Save preview error:', error)
      toast.error("Failed to save changes")
    }
  }

  function handleDiscardPreview() {
    setPreviewOption(null)
    setPreviewType(null)
    setStudyHallMode(false)
    setStudyHallSeed(null)
    setRegenMode(false)
    setSelectedForRegen(new Set())
    toast("Preview discarded", { icon: "🗑️" })
  }

  function enterStudyHallMode() {
    setStudyHallMode(true)
  }

  function exitStudyHallMode() {
    setStudyHallMode(false)
    setPreviewOption(null)
    setPreviewType(null)
    setStudyHallSeed(null)
  }

  async function generateStudyHallArrangement() {
    // Always use the current saved option, not a previous preview
    const currentOption = generation?.options?.[parseInt(selectedOption) - 1]
    if (!generation || !currentOption) return

    try {
      // Fetch current teachers
      const teachersRes = await fetch('/api/teachers')
      const teachers: Teacher[] = await teachersRes.json()

      // Generate a new random seed each time
      const seed = Math.floor(Math.random() * 2147483647)
      setStudyHallSeed(seed)

      const result = reassignStudyHalls(currentOption, teachers, seed)

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

      // Set as preview (not saved yet)
      setPreviewOption(result.newOption)
      setPreviewType("study-hall")
      setShowingPreview(true)
      toast.success("Study halls randomized")
    } catch (error) {
      console.error('Reassign study halls error:', error)
      toast.error("Failed to reassign study halls")
    }
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

      // Save to the server
      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: updatedOptions }),
      })

      if (updateRes.ok) {
        setGeneration({ ...generation, options: updatedOptions })
        // If we deleted the currently selected option, switch to option 1
        if (parseInt(selectedOption) === optionNum) {
          setSelectedOption("1")
        } else if (parseInt(selectedOption) > optionNum) {
          // Adjust selection if we deleted an earlier option
          setSelectedOption((parseInt(selectedOption) - 1).toString())
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
        setSelectedOption(updatedOptions.length.toString())
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

    const optionNum = parseInt(selectedOption)

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

  function enterSwapMode() {
    if (!selectedResult) return
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

    const optionIndex = parseInt(selectedOption) - 1

    // Save current state for undo
    const previousOptions: ScheduleOption[] = JSON.parse(JSON.stringify(generation.options))
    const previousSelectedOption = selectedOption

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
      successMessage = `Applied ${swapCount} swap${swapCount !== 1 ? 's' : ''} to Rev ${selectedOption}`
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
          setSelectedOption(newOptionNumber)
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
                      setSelectedOption(previousSelectedOption)
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
  async function enterFreeformMode() {
    if (!selectedResult || !generation) return
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

    // Fetch classes with restrictions for validation
    try {
      const classesRes = await fetch(`/api/classes?quarter_id=${generation.quarter_id}`)
      const classesRaw = await classesRes.json()

      const classes = classesRaw.map((c: {
        teacher: { name: string }
        grade: { display_name: string }
        subject: { name: string }
        days_per_week: number
        restrictions?: Array<{
          restriction_type: string
          value: unknown
        }>
      }) => {
        const restrictions = c.restrictions || []
        const fixedSlots: [string, number][] = []
        let availableDays = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']
        let availableBlocks = [1, 2, 3, 4, 5]

        restrictions.forEach((r: { restriction_type: string; value: unknown }) => {
          if (r.restriction_type === 'fixed_slot') {
            const v = r.value as { day: string; block: number }
            fixedSlots.push([v.day, v.block])
          } else if (r.restriction_type === 'available_days') {
            availableDays = r.value as string[]
          } else if (r.restriction_type === 'available_blocks') {
            availableBlocks = r.value as number[]
          }
        })

        return {
          teacher: c.teacher.name,
          grade: c.grade.display_name,
          subject: c.subject.name,
          daysPerWeek: c.days_per_week,
          fixedSlots: fixedSlots.length > 0 ? fixedSlots : undefined,
          availableDays,
          availableBlocks,
        }
      })

      setFreeformClasses(classes)
    } catch (error) {
      console.error('Failed to load classes for validation:', error)
      // Continue without class data - some validations won't run
    }
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
          // Check available days
          if (!classDef.availableDays.includes(placement.day)) {
            errors.push({
              type: 'teacher_conflict',
              message: `[Teacher Availability] ${placement.teacher} is not available on ${placement.day} for ${placedBlock.subject}`,
              cells: [{ teacher: placement.teacher, day: placement.day, block: placement.block }]
            })
          }

          // Check available blocks
          if (!classDef.availableBlocks.includes(placement.block)) {
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

    const optionIndex = parseInt(selectedOption) - 1

    // Save current state for undo
    const previousOptions: ScheduleOption[] = JSON.parse(JSON.stringify(generation.options))
    const previousSelectedOption = selectedOption

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
          setSelectedOption(String(newOptionIndex))
        }

        // Show success toast with undo
        const moveCount = floatingBlocks.length
        const message = createNew
          ? `Created Rev ${newOptionIndex} with ${moveCount} change${moveCount !== 1 ? 's' : ''}`
          : `Applied ${moveCount} change${moveCount !== 1 ? 's' : ''} to Rev ${selectedOption}`

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
                        setSelectedOption(previousSelectedOption)
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

  // Show preview if available and toggled on, otherwise show selected option
  const currentOption = generation?.options?.[parseInt(selectedOption) - 1]
  const selectedResult = (previewOption && showingPreview) ? previewOption : currentOption

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
          <div className="flex items-center justify-between no-print">
            <div className="flex flex-col gap-1">
              <div className="inline-flex rounded-lg bg-gray-100 p-1">
                {generation.options.map((opt, i) => {
                  const isThisOption = selectedOption === (i + 1).toString()
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
                          setSelectedOption((i + 1).toString())
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
                    href={`/api/export?generation_id=${id}&option=${selectedOption}&format=xlsx`}
                    download
                  >
                    <Button variant="outline" size="sm" className="gap-1">
                      <Download className="h-4 w-4" />
                      XLSX
                    </Button>
                  </a>
                  <a
                    href={`/api/export?generation_id=${id}&option=${selectedOption}&format=csv`}
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

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isGenerating || !!previewOption || regenMode || freeformMode || studyHallMode}>
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={enterRegenMode} disabled={regenMode || swapMode || freeformMode || studyHallMode}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate Schedules
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => swapMode ? exitSwapMode() : enterSwapMode()} disabled={regenMode || freeformMode || studyHallMode}>
                    <ArrowLeftRight className="h-4 w-4 mr-2" />
                    {swapMode ? "Exit Swap Mode" : "Swap Mode"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={enterFreeformMode} disabled={regenMode || swapMode || freeformMode || studyHallMode}>
                    <Hand className="h-4 w-4 mr-2" />
                    Freeform Mode
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={enterStudyHallMode} disabled={regenMode || swapMode || freeformMode || studyHallMode}>
                    <Shuffle className="h-4 w-4 mr-2" />
                    Reassign Study Halls
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDuplicateRevision} disabled={regenMode || swapMode || freeformMode || studyHallMode}>
                    <Copy className="h-4 w-4 mr-2" />
                    Duplicate Revision
                  </DropdownMenuItem>
                  {generation.selected_option !== parseInt(selectedOption) && !previewOption && (
                    <DropdownMenuItem onClick={handleMarkAsSelected}>
                      <Star className="h-4 w-4 mr-2" />
                      Mark as Selected
                    </DropdownMenuItem>
                  )}
                  {generation.options.length > 1 && !previewOption && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDeleteOption(parseInt(selectedOption) - 1)}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Revision {selectedOption}
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
                    backToBackIssues={selectedResult.backToBackIssues}
                    studyHallsPlaced={selectedResult.studyHallsPlaced}
                    totalClasses={
                      generation.stats?.classes_snapshot
                        ? generation.stats.classes_snapshot.reduce((sum, c) => sum + (c.days_per_week || 0), 0)
                        : 0
                    }
                    unscheduledClasses={0}
                    defaultExpanded={isNewGeneration}
                  />
                </div>
              )}

              {/* Mode Banners - Sticky container */}
              {(swapMode || freeformMode || regenMode) && (
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
                      {generation.options.length === 1 ? "Will create Revision 2" : `Will update Revision ${selectedOption}`}
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
                      {generation.options.length === 1 ? "Will create Revision 2" : `Will update Revision ${selectedOption}`}
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
                    {previewOption && (
                      <span className="text-violet-600/70">
                        {generation.options.length === 1 ? "Will create Revision 2" : `Will update Revision ${selectedOption}`}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Regen Mode Banner */}
              {regenMode && (
                <div className="bg-sky-50/80 backdrop-blur-sm border border-sky-200 rounded-lg p-4 no-print">
                  {isGenerating ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-sky-700 font-medium">
                          {generationProgress.message || "Generating..."}
                        </span>
                        <span className="text-sky-600">
                          {generationProgress.total > 0
                            ? `${Math.round((generationProgress.current / generationProgress.total) * 100)}%`
                            : "0%"}
                        </span>
                      </div>
                      <div className="w-full bg-sky-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-sky-500 h-2.5 rounded-full transition-all duration-300"
                          style={{
                            width: generationProgress.total > 0
                              ? `${(generationProgress.current / generationProgress.total) * 100}%`
                              : "0%"
                          }}
                        />
                      </div>
                      <p className="text-xs text-sky-600">
                        Attempt {generationProgress.current} of {generationProgress.total}
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
                          {selectedCount > 0 && (
                            <button
                              onClick={clearSelections}
                              className="text-sky-500 hover:text-sky-700 hover:underline"
                            >
                              clear selection
                            </button>
                          )}
                        </div>
                        {previewOption && (
                          <span className="text-sky-600/70">
                            {generation.options.length === 1 ? "Will create Revision 2" : `Will update Revision ${selectedOption}`}
                          </span>
                        )}
                      </div>
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
                                      : schedule
                                }
                                type="teacher"
                                name={teacher}
                                status={selectedResult.teacherStats.find(s => s.teacher === teacher)?.status}
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
                    : Object.entries(swapMode && swapWorkingSchedules && showingPreview ? swapWorkingSchedules.gradeSchedules : selectedResult.gradeSchedules)
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
