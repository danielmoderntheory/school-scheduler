"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScheduleGrid, CellLocation } from "@/components/ScheduleGrid"
import { ScheduleStats } from "@/components/ScheduleStats"
import { Loader2, Download, ArrowLeft, Save, Check, RefreshCw, Shuffle, Trash2, Star, MoreVertical, Users, GraduationCap, Printer, ArrowLeftRight, X } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import type { ScheduleOption, TeacherSchedule, Teacher } from "@/lib/types"
import toast from "react-hot-toast"
import { generateSchedules, reassignStudyHalls } from "@/lib/scheduler"

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

        // Count each grade (split credit for combined grades)
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
  is_saved: boolean
  options: ScheduleOption[]
  stats?: {
    classes_snapshot?: ClassSnapshot[]
  }
  quarter: { id: string; name: string }
}

export default function HistoryDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [generation, setGeneration] = useState<Generation | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedOption, setSelectedOption] = useState("1")
  const [viewMode, setViewMode] = useState<"teacher" | "grade">("teacher")
  const [saving, setSaving] = useState(false)

  // Regeneration state - teachers selected for regeneration
  const [selectedForRegen, setSelectedForRegen] = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, message: "" })

  // Preview state - holds unsaved regenerated option for review
  const [previewOption, setPreviewOption] = useState<ScheduleOption | null>(null)
  const [showingPreview, setShowingPreview] = useState(true) // Toggle between preview and original
  const [previewTeachers, setPreviewTeachers] = useState<Set<string>>(new Set()) // Teachers that were regenerated

  // Swap mode state
  const [swapMode, setSwapMode] = useState(false)
  const [selectedCell, setSelectedCell] = useState<CellLocation | null>(null)
  const [validTargets, setValidTargets] = useState<CellLocation[]>([])

  // Study hall revert state - stores previous option before reassignment
  const [previousOption, setPreviousOption] = useState<ScheduleOption | null>(null)

  // Save dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveNote, setSaveNote] = useState("")

  useEffect(() => {
    loadGeneration()
  }, [id])

  // Clear selections when switching options
  useEffect(() => {
    setSelectedForRegen(new Set())
    setSwapMode(false)
    setSelectedCell(null)
    setValidTargets([])
    setPreviousOption(null)
    setPreviewOption(null)
    setShowingPreview(true)
    setPreviewTeachers(new Set())
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

  function openSaveDialog() {
    setSaveNote("")
    setShowSaveDialog(true)
  }

  async function handleSave() {
    if (!generation || generation.is_saved) return
    if (!saveNote.trim()) {
      toast.error("Please add a note explaining why you're saving this schedule")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_saved: true, notes: saveNote.trim() }),
      })
      if (res.ok) {
        setGeneration({ ...generation, is_saved: true, notes: saveNote.trim() })
        setShowSaveDialog(false)
        toast.success("Schedule saved")
      } else {
        toast.error("Failed to save schedule")
      }
    } catch (error) {
      toast.error("Failed to save schedule")
    } finally {
      setSaving(false)
    }
  }

  async function handleUnsave() {
    if (!generation || !generation.is_saved) return
    setSaving(true)
    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_saved: false }),
      })
      if (res.ok) {
        setGeneration({ ...generation, is_saved: false })
        toast.success("Schedule marked as not saved")
      } else {
        toast.error("Failed to update schedule")
      }
    } catch (error) {
      toast.error("Failed to update schedule")
    } finally {
      setSaving(false)
    }
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
      // Fetch current teachers and classes for the quarter
      const [teachersRes, classesRes] = await Promise.all([
        fetch('/api/teachers'),
        fetch(`/api/classes?quarter_id=${generation.quarter_id}`)
      ])

      const teachers = await teachersRes.json()
      const classesRaw = await classesRes.json()

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
      // Use more attempts for refinement mode since constraints are tighter
      setGenerationProgress({ current: 0, total: 100, message: "Starting..." })
      const result = await generateSchedules(teachers, classes, {
        numOptions: 1,
        numAttempts: 100,
        lockedTeachers: lockedSchedules,
        teachersNeedingStudyHalls,
        onProgress: (current, total, message) => {
          setGenerationProgress({ current, total, message })
        }
      })

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

      // Save which teachers were regenerated before clearing selection
      setPreviewTeachers(new Set(selectedForRegen))
      setPreviewOption(newOption)
      setSelectedForRegen(new Set()) // Clear selections
      toast.success("Preview generated - review and choose to keep or discard")
    } catch (error) {
      console.error('Regeneration error:', error)
      toast.error("Failed to generate variation")
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleKeepPreview() {
    if (!generation || !previewOption) return

    try {
      const updatedOptions = [...generation.options, previewOption]

      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: updatedOptions }),
      })

      if (updateRes.ok) {
        setGeneration({ ...generation, options: updatedOptions })
        setSelectedOption((generation.options.length + 1).toString())
        setPreviewOption(null)
        toast.success(`Saved as Option ${generation.options.length + 1}`)
      } else {
        toast.error("Failed to save option")
      }
    } catch (error) {
      console.error('Save preview error:', error)
      toast.error("Failed to save option")
    }
  }

  function handleDiscardPreview() {
    setPreviewOption(null)
    toast("Preview discarded", { icon: "🗑️" })
  }

  async function handleReassignStudyHalls() {
    if (!generation || !selectedResult) return

    const optionIndex = parseInt(selectedOption) - 1

    try {
      // Fetch current teachers
      const teachersRes = await fetch('/api/teachers')
      const teachers: Teacher[] = await teachersRes.json()

      const result = reassignStudyHalls(selectedResult, teachers)

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

      // Save the current option for potential revert
      setPreviousOption(selectedResult)

      // Update the current option in place
      const updatedOption = {
        ...result.newOption,
        optionNumber: optionIndex + 1,
      }

      const updatedOptions = [...generation.options]
      updatedOptions[optionIndex] = updatedOption

      // Save to the server
      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: updatedOptions }),
      })

      if (updateRes.ok) {
        setGeneration({ ...generation, options: updatedOptions })
        toast.success(`Reassigned study halls for Option ${optionIndex + 1}`)
      } else {
        toast.error("Failed to save changes")
      }
    } catch (error) {
      console.error('Reassign study halls error:', error)
      toast.error("Failed to reassign study halls")
    }
  }

  async function handleRevertStudyHalls() {
    if (!generation || !previousOption) return

    const optionIndex = parseInt(selectedOption) - 1

    try {
      const updatedOptions = [...generation.options]
      updatedOptions[optionIndex] = previousOption

      // Save to the server
      const updateRes = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: updatedOptions }),
      })

      if (updateRes.ok) {
        setGeneration({ ...generation, options: updatedOptions })
        setPreviousOption(null)
        toast.success(`Reverted study halls for Option ${optionIndex + 1}`)
      } else {
        toast.error("Failed to revert changes")
      }
    } catch (error) {
      console.error('Revert study halls error:', error)
      toast.error("Failed to revert study halls")
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
    if (!confirm(`Delete Option ${optionNum}? This cannot be undone.`)) {
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
        toast.success(`Deleted Option ${optionNum}`)
      } else {
        toast.error("Failed to delete option")
      }
    } catch (error) {
      console.error('Delete option error:', error)
      toast.error("Failed to delete option")
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
        toast.success(`Option ${optionNum} marked as selected`)
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

    // For study hall: find OPEN blocks on eligible teachers at the SAME day/block
    // (the grade needs the study hall at this specific time, we're just changing the teacher)
    // For open: find all OPEN blocks (can swap OPEN with OPEN on any slot)
    for (const [teacher, schedule] of Object.entries(selectedResult.teacherSchedules)) {
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

  function handleCellClick(location: CellLocation, cellType: "study-hall" | "open" | "class") {
    if (!swapMode || !selectedResult) return

    // If clicking on a valid target, perform the swap
    if (selectedCell && validTargets.some(t =>
      t.teacher === location.teacher && t.day === location.day && t.block === location.block
    )) {
      performSwap(selectedCell, location)
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

    // Only allow selecting study halls or open blocks
    if (cellType !== "study-hall" && cellType !== "open") {
      toast.error("Can only swap Study Halls or OPEN blocks")
      return
    }

    // Select the cell and find valid targets
    setSelectedCell(location)
    const targets = findValidSwapTargets(location, cellType)
    setValidTargets(targets)

    if (targets.length === 0) {
      toast("No valid swap targets found", { icon: "ℹ️" })
    }
  }

  async function performSwap(source: CellLocation, target: CellLocation) {
    if (!generation || !selectedResult) return

    const optionIndex = parseInt(selectedOption) - 1

    // Get the cell contents
    const sourceEntry = selectedResult.teacherSchedules[source.teacher]?.[source.day]?.[source.block]
    const targetEntry = selectedResult.teacherSchedules[target.teacher]?.[target.day]?.[target.block]

    if (!sourceEntry || !targetEntry) {
      toast.error("Invalid swap")
      return
    }

    // Create deep copy of the schedules
    const newTeacherSchedules = JSON.parse(JSON.stringify(selectedResult.teacherSchedules))
    const newGradeSchedules = JSON.parse(JSON.stringify(selectedResult.gradeSchedules))

    // Perform the swap in teacher schedules
    newTeacherSchedules[source.teacher][source.day][source.block] = targetEntry
    newTeacherSchedules[target.teacher][target.day][target.block] = sourceEntry

    // Update grade schedules if it's a study hall
    if (sourceEntry[1] === "Study Hall") {
      const gradeGroup = sourceEntry[0] // e.g., "6th Grade" or "6th-7th"

      // Update study hall assignments
      const newStudyHallAssignments = selectedResult.studyHallAssignments.map(sh => {
        if (sh.teacher === source.teacher && sh.day === source.day && sh.block === source.block) {
          return { ...sh, teacher: target.teacher, day: target.day, block: target.block }
        }
        return sh
      })

      // Update the grade schedule - remove from old slot, add to new
      if (newGradeSchedules[gradeGroup]) {
        // Remove study hall from old grade schedule slot
        if (newGradeSchedules[gradeGroup][source.day]?.[source.block]) {
          newGradeSchedules[gradeGroup][source.day][source.block] = null
        }
        // Add study hall to new grade schedule slot
        if (!newGradeSchedules[gradeGroup][target.day]) {
          newGradeSchedules[gradeGroup][target.day] = {}
        }
        newGradeSchedules[gradeGroup][target.day][target.block] = [target.teacher, "Study Hall"]
      }

      // Create updated option
      const updatedOption: ScheduleOption = {
        ...selectedResult,
        teacherSchedules: newTeacherSchedules,
        gradeSchedules: newGradeSchedules,
        studyHallAssignments: newStudyHallAssignments,
      }

      // Recalculate teacher stats
      updatedOption.teacherStats = selectedResult.teacherStats.map(stat => {
        const schedule = newTeacherSchedules[stat.teacher]
        let teaching = 0, studyHall = 0, open = 0, backToBackIssues = 0

        const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
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
              prevWasOpen = true // Study hall counts as "open" for BTB
            } else {
              teaching++
              prevWasOpen = false
            }
          }
        }

        return { ...stat, teaching, studyHall, open, totalUsed: teaching + studyHall, backToBackIssues }
      })

      // Recalculate total back-to-back issues
      updatedOption.backToBackIssues = updatedOption.teacherStats.reduce((sum, s) => sum + s.backToBackIssues, 0)

      // Save to server
      const updatedOptions = [...generation.options]
      updatedOptions[optionIndex] = updatedOption

      try {
        const updateRes = await fetch(`/api/history/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options: updatedOptions }),
        })

        if (updateRes.ok) {
          setGeneration({ ...generation, options: updatedOptions })
          toast.success(`Moved Study Hall from ${source.teacher} to ${target.teacher}`)
        } else {
          toast.error("Failed to save swap")
        }
      } catch (error) {
        console.error('Swap error:', error)
        toast.error("Failed to save swap")
      }
    }

    // Clear swap state
    setSelectedCell(null)
    setValidTargets([])
  }

  function exitSwapMode() {
    setSwapMode(false)
    setSelectedCell(null)
    setValidTargets([])
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
        <Link
          href="/history"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4 no-print"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to History
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              {generation.quarter?.name} Schedule
              {generation.is_saved && (
                <Badge className="ml-3 bg-emerald-500 no-print">Saved</Badge>
              )}
            </h1>
            <p className="text-muted-foreground">
              Generated {new Date(generation.generated_at).toLocaleString()}
            </p>
            {generation.notes && (
              <p className="text-sm text-slate-600 mt-1 italic no-print">
                &ldquo;{generation.notes}&rdquo;
              </p>
            )}
          </div>
          {/* Save button or saved indicator with unsave option */}
          {!generation.is_saved ? (
            <Button
              onClick={openSaveDialog}
              size="sm"
              className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-white no-print"
            >
              <Save className="h-4 w-4" />
              Save Schedule
            </Button>
          ) : (
            <Button
              onClick={handleUnsave}
              disabled={saving}
              variant="outline"
              size="sm"
              className="gap-1 no-print"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Unsave
            </Button>
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
                  const isSelected = generation.selected_option === i + 1
                  // During preview, allow clicking current option to toggle to original view
                  const isClickable = !isGenerating && (!previewOption || isThisOption)
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
                      className={`
                        px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5
                        ${isActive
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                        }
                        disabled:opacity-50 disabled:cursor-not-allowed
                      `}
                    >
                      Option {i + 1}
                      {opt && (
                        <span className={`text-xs ${shPlaced >= shTotal ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {shPlaced}/{shTotal}
                        </span>
                      )}
                      {isSelected && (
                        <Star className="h-3 w-3 text-sky-500 fill-sky-500" />
                      )}
                    </button>
                  )
                })}
                {/* Preview tab */}
                {previewOption && (
                  <button
                    onClick={() => setShowingPreview(true)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
                      showingPreview
                        ? 'bg-violet-100 text-violet-800 shadow-sm'
                        : 'text-violet-600 hover:text-violet-800'
                    }`}
                  >
                    Preview
                    <span className={`text-xs ${previewOption.studyHallsPlaced >= 6 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {previewOption.studyHallsPlaced}/{previewOption.studyHallAssignments?.length || 6}
                    </span>
                  </button>
                )}
              </div>
              <div className="text-xs text-muted-foreground pl-1">
                <span className="text-emerald-600">3/6</span> = study halls placed • <Star className="h-3 w-3 text-sky-500 fill-sky-500 inline" /> = selected option
              </div>
            </div>

            <div className="flex items-center gap-2 no-print">
              {/* Export buttons - disabled during preview */}
              {!previewOption ? (
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
              ) : (
                <span className="text-sm text-muted-foreground">Save preview to enable export</span>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isGenerating || !!previewOption}>
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSwapMode(!swapMode)}>
                    <ArrowLeftRight className="h-4 w-4 mr-2" />
                    {swapMode ? "Exit Swap Mode" : "Swap Mode"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {previousOption ? (
                    <DropdownMenuItem onClick={handleRevertStudyHalls}>
                      <Shuffle className="h-4 w-4 mr-2" />
                      Revert Study Halls
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={handleReassignStudyHalls}>
                      <Shuffle className="h-4 w-4 mr-2" />
                      Reassign Study Halls
                    </DropdownMenuItem>
                  )}
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
                        Delete Option {selectedOption}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Swap Mode Banner */}
          {swapMode && viewMode === "teacher" && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 no-print">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ArrowLeftRight className="h-5 w-5 text-amber-600" />
                  <div>
                    <span className="text-amber-800 font-medium">Swap Mode Active</span>
                    <p className="text-sm text-amber-600">
                      {selectedCell
                        ? `Selected ${selectedCell.teacher}'s ${selectedCell.day} B${selectedCell.block}. Click a green OPEN block to move the Study Hall there.`
                        : "Click a Study Hall to select it, then click another teacher's OPEN block (same day/block) to reassign."}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={exitSwapMode}
                  className="text-amber-700 hover:text-amber-900 hover:bg-amber-100"
                >
                  <X className="h-4 w-4 mr-1" />
                  Exit
                </Button>
              </div>
              {validTargets.length > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  {validTargets.length} teacher{validTargets.length !== 1 ? 's have' : ' has'} OPEN at this time slot
                </p>
              )}
            </div>
          )}

          {/* Preview Banner - shows when regenerated option is pending review */}
          {previewOption && !isGenerating && (
            <div className={`border rounded-lg p-4 no-print ${showingPreview ? 'bg-violet-50 border-violet-200' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RefreshCw className={`h-5 w-5 ${showingPreview ? 'text-violet-600' : 'text-slate-500'}`} />
                  <div>
                    <span className={`font-medium ${showingPreview ? 'text-violet-800' : 'text-slate-700'}`}>
                      {showingPreview ? `Preview: Option ${generation.options.length + 1}` : `Original: Option ${selectedOption}`}
                    </span>
                    <p className={`text-sm ${showingPreview ? 'text-violet-600' : 'text-slate-500'}`}>
                      {showingPreview
                        ? "Viewing regenerated schedule. Toggle to compare with original."
                        : "Viewing original schedule. Toggle to see the preview."}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Toggle between Preview and Original */}
                  <div className="inline-flex rounded-md bg-white border border-slate-200 p-0.5 mr-2">
                    <button
                      onClick={() => setShowingPreview(false)}
                      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                        !showingPreview
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-600 hover:text-slate-800'
                      }`}
                    >
                      Original
                    </button>
                    <button
                      onClick={() => setShowingPreview(true)}
                      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                        showingPreview
                          ? 'bg-violet-600 text-white'
                          : 'text-slate-600 hover:text-slate-800'
                      }`}
                    >
                      Preview
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDiscardPreview}
                    className="text-slate-600 border-slate-300 hover:bg-slate-100"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleKeepPreview}
                    className="bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Keep
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Regenerate Bar - appears when teachers are selected */}
          {(selectedCount > 0 || isGenerating) && viewMode === "teacher" && !swapMode && !previewOption && (
            <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sky-800 font-medium">
                      {selectedCount} teacher{selectedCount !== 1 ? 's' : ''} selected
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearSelections}
                      className="text-sky-600 hover:text-sky-800 h-auto py-1 px-2"
                    >
                      Clear
                    </Button>
                  </div>
                  <Button
                    onClick={handleRegenerate}
                    className="gap-2 bg-sky-600 hover:bg-sky-700 text-white"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Regenerate as Option {generation.options.length + 1}
                  </Button>
                </div>
              )}
            </div>
          )}

          {selectedResult && (
            <div className="space-y-6">
              {/* Stats Summary */}
              {!isGenerating && (
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
                  />
                </div>
              )}

              {/* Schedule Grids */}
              <div className="print-page-break-before">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">
                    {viewMode === "teacher" ? "Teacher Schedules" : "Grade Schedules"}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setViewMode(viewMode === "teacher" ? "grade" : "teacher")
                    }
                    disabled={isGenerating}
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
                {/* Show message when in preview mode */}
                {previewOption && showingPreview && previewTeachers.size > 0 && viewMode === "teacher" && (
                  <div className="col-span-full mb-2 text-sm text-violet-600 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                    Showing {previewTeachers.size} regenerated teacher{previewTeachers.size !== 1 ? 's' : ''}. Toggle to &quot;Original&quot; to see all teachers.
                  </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print-grid">
                  {viewMode === "teacher"
                    ? Object.entries(selectedResult.teacherSchedules)
                        // Filter to only show regenerated teachers when previewing
                        .filter(([teacher]) => {
                          if (previewOption && showingPreview && previewTeachers.size > 0) {
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
                        .map(([teacher, schedule]) => (
                          <ScheduleGrid
                            key={teacher}
                            schedule={schedule}
                            type="teacher"
                            name={teacher}
                            status={selectedResult.teacherStats.find(s => s.teacher === teacher)?.status}
                            showCheckbox={!isGenerating && !swapMode && !previewOption}
                            isSelected={selectedForRegen.has(teacher)}
                            onToggleSelect={() => toggleTeacherSelection(teacher)}
                            swapMode={swapMode}
                            selectedCell={selectedCell}
                            validTargets={validTargets}
                            onCellClick={handleCellClick}
                          />
                        ))
                    : Object.entries(selectedResult.gradeSchedules)
                        .filter(([grade]) => !grade.includes("Elective"))
                        .sort(([a], [b]) => gradeSort(a, b))
                        .map(([grade, schedule]) => (
                          <ScheduleGrid
                            key={grade}
                            schedule={schedule}
                            type="grade"
                            name={grade}
                          />
                        ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save Schedule Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Save Schedule</DialogTitle>
            <DialogDescription>
              Add a note explaining why this schedule is being saved. This helps you remember what makes this version special compared to others.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="save-note">Note (required)</Label>
              <Textarea
                id="save-note"
                placeholder="e.g., Best balance of study halls, minimal back-to-back issues for Randy..."
                value={saveNote}
                onChange={(e) => setSaveNote(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !saveNote.trim()}
              className="bg-emerald-500 hover:bg-emerald-600"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Schedule
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
