"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Loader2, Coffee, AlertTriangle, Users, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react"
import { generateSchedulesRemote, type ScheduleDiagnostics, type SchedulingRule } from "@/lib/scheduler-remote"
import type { Teacher, ClassEntry } from "@/lib/types"
import { useGeneration } from "@/lib/generation-context"
import { calculateGradeBlocks, buildCotaughtGroups, type BlockCountClass } from "@/lib/schedule-utils"
import toast from "@/lib/toast"
import Link from "next/link"

interface Grade {
  id: string
  name: string
  display_name: string
  sort_order: number
}

interface DBClass {
  id: string
  teacher_id?: string
  teacher: { id: string; name: string; status?: string } | null
  teacher_deleted?: boolean
  grade: { id: string; name: string; display_name: string }
  grade_ids?: string[]
  grades?: Array<{ id: string; name: string; display_name: string; sort_order: number }>
  is_elective?: boolean
  is_cotaught?: boolean
  subject: { id: string; name: string }
  days_per_week: number
  restrictions: Array<{
    restriction_type: string
    value: unknown
  }>
}

interface GenerateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  quarterId: string
  quarterName: string
  classes: DBClass[]
  teachers: Teacher[]
  grades: Grade[]
  rules: SchedulingRule[]
}

export function GenerateModal({
  open,
  onOpenChange,
  quarterId,
  quarterName,
  classes,
  teachers,
  grades,
  rules,
}: GenerateModalProps) {
  const router = useRouter()
  const { setIsGenerating } = useGeneration()
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showDismissWarning, setShowDismissWarning] = useState(false)
  const [showCotaughtDetails, setShowCotaughtDetails] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, message: "" })
  const [scheduleError, setScheduleError] = useState<{
    type: "infeasible" | "error"
    message: string
    diagnostics?: ScheduleDiagnostics
  } | null>(null)
  const [lastRequestPayload, setLastRequestPayload] = useState<{
    teachers: unknown[]
    classes: unknown[]
  } | null>(null)
  const generationIdRef = useRef<string | null>(null)

  // Calculate stats for the summary card
  const blockCountClasses: BlockCountClass[] = []
  const uniqueGrades = new Set<string>()

  for (const c of classes) {
    const classGrades = c.grades && c.grades.length > 0 ? c.grades : (c.grade ? [c.grade] : [])

    classGrades.forEach(g => uniqueGrades.add(g.id))

    const fixedSlots = c.restrictions
      ?.filter(r => r.restriction_type === 'fixed_slot')
      .map(r => r.value as { day: string; block: number }) || []

    for (const grade of classGrades) {
      blockCountClasses.push({
        gradeKey: grade.id,
        subjectKey: c.subject?.id || '',
        daysPerWeek: c.days_per_week,
        isElective: c.is_elective || false,
        isCotaught: c.is_cotaught || false,
        fixedSlots,
      })
    }
  }

  const gradeBlockCounts = calculateGradeBlocks(blockCountClasses)
  let totalGradeSessions = 0
  for (const count of gradeBlockCounts.values()) {
    totalGradeSessions += count
  }

  // Add 1 study hall session for grades 6-11 (sort_order 6-11)
  for (const g of grades) {
    if (g.sort_order >= 6 && g.sort_order <= 11 && uniqueGrades.has(g.id)) {
      totalGradeSessions++
    }
  }

  const availableGradeSlots = uniqueGrades.size * 25
  const isOverCapacity = totalGradeSessions > availableGradeSlots
  const isAtCapacity = totalGradeSessions === availableGradeSlots
  const capacityPercent = availableGradeSlots > 0 ? Math.round((totalGradeSessions / availableGradeSlots) * 100) : 0
  const isNearCapacity = capacityPercent >= 85 && !isOverCapacity && !isAtCapacity

  // Count incomplete classes and classes with deleted teachers
  const classesWithDeletedTeacher = classes.filter(c => c.teacher_deleted === true)
  const incompleteClasses = classes.filter(c => (!c.teacher && !c.teacher_deleted) || !c.grade || !c.subject)

  // Build co-taught display groups
  const cotaughtGroups = buildCotaughtGroups(classes.map(c => {
    let gradeDisplay = ''
    const gradeKey = c.grades && c.grades.length > 0
      ? c.grades.map(g => g.name).sort().join(',')
      : c.grade?.name || ''
    if (c.grades && c.grades.length > 0) {
      if (c.grades.length === 1) {
        gradeDisplay = c.grades[0].display_name
      } else {
        const sorted = [...c.grades].sort((a, b) => a.sort_order - b.sort_order)
        const first = sorted[0].display_name.replace(' Grade', '')
        const last = sorted[sorted.length - 1].display_name.replace(' Grade', '')
        gradeDisplay = `${first}-${last} Grade`
      }
    } else if (c.grade) {
      gradeDisplay = c.grade.display_name
    }
    return {
      gradeKey,
      gradeDisplay,
      subjectKey: c.subject?.id || '',
      subjectName: c.subject?.name || '',
      teacherName: c.teacher?.name || '',
      isCotaught: c.is_cotaught || false,
    }
  }))

  // Detect electives without restrictions
  const electivesWithoutRestrictions = classes.filter(c => {
    if (!c.is_elective) return false
    const hasFixedSlot = c.restrictions?.some(r => r.restriction_type === 'fixed_slot')
    const hasAvailableDays = c.restrictions?.some(r => r.restriction_type === 'available_days')
    const hasAvailableBlocks = c.restrictions?.some(r => r.restriction_type === 'available_blocks')
    return !hasFixedSlot && !hasAvailableDays && !hasAvailableBlocks
  })

  // Show confirm dialog when modal opens
  useEffect(() => {
    if (open) {
      setShowConfirmDialog(true)
      setScheduleError(null)
    }
  }, [open])

  // Prevent accidental navigation away during generation
  useEffect(() => {
    setIsGenerating(generating)
    if (generating) {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault()
        e.returnValue = ""
      }
      window.addEventListener("beforeunload", handleBeforeUnload)
      return () => window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [generating, setIsGenerating])

  function handleOpenChange(newOpen: boolean) {
    // If trying to close while generating, show warning
    if (!newOpen && generating) {
      setShowDismissWarning(true)
      return
    }
    onOpenChange(newOpen)
  }

  function handleForceClose() {
    setShowDismissWarning(false)
    setGenerating(false)
    generationIdRef.current = null
    onOpenChange(false)
  }

  function convertToSchedulerFormat(): { teachers: Teacher[]; classes: ClassEntry[] } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const teacherList: Teacher[] = teachers.map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      canSuperviseStudyHall: t.can_supervise_study_hall ?? t.canSuperviseStudyHall,
      availableDays: t.available_days ?? t.availableDays ?? null,
      availableBlocks: t.available_blocks ?? t.availableBlocks ?? null,
    }))

    // Build teacher availability lookup for intersecting with class restrictions
    const teacherAvailMap = new Map<string, { days: string[] | null; blocks: number[] | null }>()
    for (const t of teacherList) {
      if (t.availableDays || t.availableBlocks) {
        teacherAvailMap.set(t.name, { days: t.availableDays ?? null, blocks: t.availableBlocks ?? null })
      }
    }

    const classList: ClassEntry[] = classes.map((c) => {
      // Build grades array - prefer new grades field, fall back to single grade
      let gradesList: string[] = []
      let gradeDisplay = ""

      if (c.grades && c.grades.length > 0) {
        gradesList = c.grades.map((g) => g.display_name)
        if (gradesList.length === 1) {
          gradeDisplay = gradesList[0]
        } else {
          const sorted = [...c.grades].sort((a, b) => a.sort_order - b.sort_order)
          const first = sorted[0].display_name.replace(" Grade", "")
          const last = sorted[sorted.length - 1].display_name.replace(" Grade", "")
          gradeDisplay = `${first}-${last} Grade`
        }
      } else if (c.grade) {
        gradesList = [c.grade.display_name]
        gradeDisplay = c.grade.display_name
      }

      const entry: ClassEntry = {
        id: c.id,
        teacher: c.teacher?.name || "(deleted)",
        grade: gradeDisplay,
        grades: gradesList,
        gradeDisplay: gradeDisplay,
        subject: c.subject.name,
        daysPerWeek: c.days_per_week,
        isElective: c.is_elective || false,
        isCotaught: c.is_cotaught || false,
      }

      // Process restrictions
      c.restrictions?.forEach((r) => {
        if (r.restriction_type === "available_days") {
          entry.availableDays = r.value as string[]
        } else if (r.restriction_type === "available_blocks") {
          entry.availableBlocks = r.value as number[]
        } else if (r.restriction_type === "fixed_slot") {
          const slot = r.value as { day: string; block: number }
          entry.fixedSlots = entry.fixedSlots || []
          entry.fixedSlots.push([slot.day, slot.block])
        }
      })

      // Intersect with teacher availability
      const teacherAvail = teacherAvailMap.get(entry.teacher)
      if (teacherAvail) {
        if (teacherAvail.days) {
          entry.availableDays = entry.availableDays
            ? entry.availableDays.filter((d) => teacherAvail.days!.includes(d))
            : [...teacherAvail.days]
        }
        if (teacherAvail.blocks) {
          entry.availableBlocks = entry.availableBlocks
            ? entry.availableBlocks.filter((b) => teacherAvail.blocks!.includes(b))
            : [...teacherAvail.blocks]
        }
      }

      return entry
    })

    return { teachers: teacherList, classes: classList }
  }

  async function handleGenerate() {
    if (classes.length === 0) {
      toast.error("No classes configured for this quarter")
      return
    }

    // Check for classes with deleted teachers
    const classesWithDeletedTeacher = classes.filter(
      (c) => c.teacher_deleted === true
    )
    if (classesWithDeletedTeacher.length > 0) {
      toast.error(
        `${classesWithDeletedTeacher.length} class${
          classesWithDeletedTeacher.length > 1 ? "es have" : " has"
        } an archived teacher — please reassign or restore`
      )
      return
    }

    // Check for incomplete classes (excluding deleted teachers which are handled separately)
    const incompleteClasses = classes.filter(
      (c) => (!c.teacher && !c.teacher_deleted) || !c.grade || !c.subject
    )
    if (incompleteClasses.length > 0) {
      toast.error(
        `${incompleteClasses.length} class${
          incompleteClasses.length > 1 ? "es are" : " is"
        } incomplete (missing teacher, grade, or subject)`
      )
      return
    }

    // Generate unique ID for this run
    const generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`
    generationIdRef.current = generationId

    setShowConfirmDialog(false)
    setGenerating(true)
    setScheduleError(null)
    setProgress({ current: 0, total: 150, message: "Connecting to OR-Tools solver..." })

    try {
      const { teachers: teacherList, classes: classList } = convertToSchedulerFormat()

      setLastRequestPayload({ teachers: teacherList, classes: classList })

      const gradeNames = grades.map((g) => g.display_name)

      let result = await generateSchedulesRemote(teacherList, classList, {
        numOptions: 1,
        numAttempts: 150,
        maxTimeSeconds: 280,
        rules,
        grades: gradeNames,
        onProgress: (current, total, message) => {
          setProgress({ current, total, message })
        },
      })

      // If first pass returned success but suboptimal results, try deep search
      if (result.status === "success" && result.options.length > 0) {
        const firstOption = result.options[0]
        const expectedStudyHalls = firstOption.studyHallAssignments?.length || 0
        const placedStudyHalls = firstOption.studyHallsPlaced || 0

        if (placedStudyHalls < expectedStudyHalls) {
          setProgress({
            current: 0,
            total: 15,
            message: "Trying deeper exploration for better results...",
          })

          const deepResult = await generateSchedulesRemote(teacherList, classList, {
            numOptions: 1,
            numAttempts: 15,
            maxTimeSeconds: 120,
            rules,
            grades: gradeNames,
            onProgress: (current, total, message) => {
              setProgress({ current, total, message: `[Deep] ${message}` })
            },
          })

          if (deepResult.status === "success" && deepResult.options.length > 0) {
            const deepPlaced = deepResult.options[0].studyHallsPlaced || 0
            if (deepPlaced > placedStudyHalls) {
              result = deepResult
            }
          }
        }
      }

      // Verify this result is for the current generation
      if (generationIdRef.current !== generationId) {
        console.warn("Discarding stale generation result")
        return
      }

      if (result.status === "infeasible") {
        setScheduleError({
          type: "infeasible",
          message:
            result.message || "The current class constraints are impossible to satisfy.",
          diagnostics: result.diagnostics,
        })
      } else if (result.status === "error" || result.options.length === 0) {
        setScheduleError({
          type: "error",
          message:
            result.message || "Could not find a valid schedule. Try adjusting constraints.",
          diagnostics: result.diagnostics,
        })
      } else {
        // Success - save to database
        toast.success(`Generated ${result.options.length} schedule option(s)`)

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const classesSnapshot = classes.map((c: any) => {
            const gradeIds = c.grade_ids?.length
              ? c.grade_ids
              : c.grade?.id
              ? [c.grade.id]
              : []
            const gradesArray = c.grades?.length
              ? c.grades
              : c.grade
              ? [c.grade]
              : []

            return {
              teacher_id: c.teacher?.id || null,
              teacher_name: c.teacher?.name || null,
              grade_id: c.grade?.id || null,
              grade_ids: gradeIds,
              grades: gradesArray.map((g: { id: string; name: string; display_name: string }) => ({
                id: g.id,
                name: g.name,
                display_name: g.display_name,
              })),
              is_elective: c.is_elective || false,
              is_cotaught: c.is_cotaught || false,
              subject_id: c.subject?.id || null,
              subject_name: c.subject?.name || null,
              days_per_week: c.days_per_week,
              restrictions: c.restrictions || [],
            }
          })

          const rulesSnapshot = rules.map((r) => ({
            rule_key: r.rule_key,
            enabled: r.enabled,
            config: r.config || null,
          }))

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const teachersSnapshot = teachers.map((t: any) => ({
            id: t.id,
            name: t.name,
            status: t.status,
            canSuperviseStudyHall: t.can_supervise_study_hall ?? t.canSuperviseStudyHall ?? true,
            availableDays: t.available_days ?? t.availableDays ?? null,
            availableBlocks: t.available_blocks ?? t.availableBlocks ?? null,
          }))

          const gradesSnapshot = grades.map((g) => ({
            id: g.id,
            name: g.name,
            display_name: g.display_name,
          }))

          const saveRes = await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quarter_id: quarterId,
              quarter_name: quarterName,
              options: result.options,
              allSolutions: result.allSolutions || [],
              selected_option: 1,
              classes_snapshot: classesSnapshot,
              rules_snapshot: rulesSnapshot,
              teachers_snapshot: teachersSnapshot,
              grades_snapshot: gradesSnapshot,
            }),
          })

          if (saveRes.ok) {
            const savedData = await saveRes.json()
            setGenerating(false)
            onOpenChange(false)
            router.push(`/history/${savedData.id}?new=true`)
            return
          } else {
            console.warn("Could not auto-save to database")
            toast.error("Could not save to history")
          }
        } catch (e) {
          console.warn("Could not auto-save:", e)
          toast.error("Could not save to history")
        }
      }
    } catch (error) {
      console.error("Generation error:", error)
      toast.error("Schedule generation failed")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      {/* Confirmation Dialog with Summary */}
      <Dialog open={open && showConfirmDialog} onOpenChange={(v) => {
        if (!v) {
          setShowConfirmDialog(false)
          onOpenChange(false)
        }
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Ready to Generate
              {!isOverCapacity && !electivesWithoutRestrictions.length && incompleteClasses.length === 0 && classesWithDeletedTeacher.length === 0 && (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              )}
            </DialogTitle>
            <DialogDescription>{quarterName}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                <div className="font-semibold text-slate-700">{teachers.length}</div>
                <div className="text-slate-500 text-xs">Teachers</div>
              </div>
              <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                <div className="font-semibold text-slate-700">{classes.length}</div>
                <div className="text-slate-500 text-xs">Classes</div>
              </div>
              <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                <div className="font-semibold text-slate-700">{uniqueGrades.size} × 25</div>
                <div className="text-slate-500 text-xs">Grades × Blocks</div>
              </div>
              <div className={`border rounded-lg px-2 py-2.5 ${
                isOverCapacity
                  ? 'border-red-300 bg-red-50'
                  : isAtCapacity
                    ? 'border-emerald-200 bg-emerald-50'
                    : isNearCapacity
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-sky-200 bg-sky-50'
              }`}>
                <div className={`font-semibold whitespace-nowrap ${
                  isOverCapacity
                    ? 'text-red-700'
                    : isAtCapacity
                      ? 'text-emerald-700'
                      : isNearCapacity
                        ? 'text-amber-700'
                        : 'text-sky-700'
                }`}>
                  {totalGradeSessions}/{availableGradeSlots}
                </div>
                <div className={`text-xs ${
                  isOverCapacity
                    ? 'text-red-600'
                    : isAtCapacity
                      ? 'text-emerald-600'
                      : isNearCapacity
                        ? 'text-amber-600'
                        : 'text-sky-600'
                }`}>
                  {isAtCapacity ? 'Full Schedule' : isOverCapacity ? 'Over Capacity' : 'Coverage'}
                </div>
              </div>
              <div className={`border rounded-lg p-2.5 ${
                isOverCapacity
                  ? 'border-red-300 bg-red-50'
                  : isAtCapacity
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-amber-200 bg-amber-50'
              }`}>
                <div className={`font-semibold ${
                  isOverCapacity
                    ? 'text-red-700'
                    : isAtCapacity
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                }`}>
                  {isOverCapacity ? `+${totalGradeSessions - availableGradeSlots}` : availableGradeSlots - totalGradeSessions}
                </div>
                <div className={`text-xs ${
                  isOverCapacity
                    ? 'text-red-600'
                    : isAtCapacity
                      ? 'text-emerald-600'
                      : 'text-amber-600'
                }`}>
                  {isOverCapacity ? 'Over' : 'Unfilled'}
                </div>
              </div>
            </div>

            {/* Co-taught classes indicator */}
            {cotaughtGroups.length > 0 && (
              <div className="text-sm">
                <button
                  onClick={() => setShowCotaughtDetails(!showCotaughtDetails)}
                  className="flex items-center gap-2 text-slate-600 hover:text-slate-800"
                >
                  {showCotaughtDetails ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <Users className="h-4 w-4 text-violet-500" />
                  <span>{cotaughtGroups.length} co-taught class{cotaughtGroups.length !== 1 ? 'es' : ''}</span>
                  <span className="text-xs text-slate-400">(scheduled together)</span>
                </button>
                {showCotaughtDetails && (
                  <div className="mt-2 ml-6 pl-4 border-l-2 border-violet-200 space-y-1">
                    {cotaughtGroups.map((group, i) => (
                      <div key={i} className="text-xs text-slate-600">
                        <span className="font-medium">{group.gradeDisplay} - {group.subjectName}:</span>{' '}
                        {group.teacherNames.join(', ')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Warnings and errors */}
            {electivesWithoutRestrictions.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-amber-800">
                      {electivesWithoutRestrictions.length} elective{electivesWithoutRestrictions.length !== 1 ? 's' : ''} without restrictions
                    </div>
                    <p className="text-xs text-amber-700 mt-1">
                      Electives need fixed time slots so all options align.
                    </p>
                    <ul className="text-xs text-amber-600 mt-1 space-y-0.5">
                      {electivesWithoutRestrictions.slice(0, 3).map((c, i) => {
                        let gradeDisplay = c.grade?.display_name || ''
                        if (c.grades && c.grades.length > 1) {
                          const sorted = [...c.grades].sort((a, b) => a.sort_order - b.sort_order)
                          const first = sorted[0].display_name.replace(' Grade', '')
                          const last = sorted[sorted.length - 1].display_name.replace(' Grade', '')
                          gradeDisplay = `${first}-${last}`
                        } else if (c.grades?.length === 1) {
                          gradeDisplay = c.grades[0].display_name
                        }
                        return <li key={i}>• {c.teacher?.name || "(deleted)"} - {c.subject.name} ({gradeDisplay})</li>
                      })}
                      {electivesWithoutRestrictions.length > 3 && (
                        <li className="text-amber-500">...and {electivesWithoutRestrictions.length - 3} more</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {classesWithDeletedTeacher.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-amber-800">
                      {classesWithDeletedTeacher.length} class{classesWithDeletedTeacher.length > 1 ? 'es have' : ' has'} an archived teacher
                    </div>
                    <p className="text-xs text-amber-700 mt-1">
                      Reassign these classes or restore the teacher before generating.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {incompleteClasses.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-red-800">
                      {incompleteClasses.length} incomplete class{incompleteClasses.length > 1 ? 'es' : ''}
                    </div>
                    <p className="text-xs text-red-700 mt-1">
                      Missing teacher, grade, or subject. Fix on the Classes page before generating.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isOverCapacity && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-red-800">
                      Over capacity by {totalGradeSessions - availableGradeSlots} sessions
                    </div>
                    <p className="text-xs text-red-700 mt-1">
                      The scheduler may fail or produce suboptimal results.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Solver info */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-start gap-3">
              <Coffee className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-muted-foreground">
                <p>
                  Uses <strong className="text-foreground">Google OR-Tools CP-SAT</strong> to
                  explore combinations, then optimizes for back-to-back gaps and study hall distribution.
                </p>
                <p className="text-slate-500 mt-1">
                  Typically takes 2-4 minutes
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button variant="outline" onClick={() => {
              setShowConfirmDialog(false)
              onOpenChange(false)
            }}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={incompleteClasses.length > 0 || classesWithDeletedTeacher.length > 0}
              className="bg-emerald-500 hover:bg-emerald-600 text-white disabled:bg-slate-300"
            >
              Generate Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress Dialog */}
      <Dialog open={open && generating && !showConfirmDialog} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(e) => {
          if (generating) e.preventDefault()
        }}>
          <DialogHeader>
            <DialogTitle>Generating Schedule</DialogTitle>
            <DialogDescription>{quarterName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>{progress.message}</span>
                <span>
                  {progress.current === -1 ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Wrapping up...
                    </span>
                  ) : (
                    `${progress.current}/${progress.total}`
                  )}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all"
                  style={{
                    width:
                      progress.current === -1
                        ? "100%"
                        : `${(progress.current / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Please don&apos;t close this window while generating
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Error Dialog */}
      <Dialog open={open && !!scheduleError && !generating} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <DialogTitle className="text-red-800">
                {scheduleError?.type === "infeasible"
                  ? "Schedule Constraints Cannot Be Satisfied"
                  : "Schedule Generation Failed"}
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-red-700">{scheduleError?.message}</p>

            {/* Diagnostics Section */}
            {scheduleError?.diagnostics && (
              <div className="bg-slate-50 rounded-lg p-4 border space-y-3">
                <p className="font-medium text-slate-800">Issues Found:</p>

                {/* Incomplete classes */}
                {scheduleError.diagnostics.incompleteClasses &&
                  scheduleError.diagnostics.incompleteClasses.length > 0 && (
                    <div className="bg-red-50 rounded p-3 border border-red-200">
                      <p className="font-medium text-red-800 text-sm mb-2">
                        Classes with missing required fields:
                      </p>
                      <ul className="text-sm text-red-700 space-y-1">
                        {scheduleError.diagnostics.incompleteClasses.map((c, i) => (
                          <li key={i}>
                            <strong>Class #{c.index}</strong>:
                            {c.teacher !== "(none)" && (
                              <span className="ml-1">{c.teacher}</span>
                            )}
                            {c.subject !== "(none)" && (
                              <span className="ml-1">- {c.subject}</span>
                            )}
                            <span className="ml-2 text-red-600 font-medium">
                              ({c.issues.join(", ")})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {/* Teacher overload */}
                {scheduleError.diagnostics.teacherOverload &&
                  scheduleError.diagnostics.teacherOverload.length > 0 && (
                    <div className="bg-red-50 rounded p-3 border border-red-200">
                      <p className="font-medium text-red-800 text-sm mb-1">
                        Teachers with too many sessions (&gt;25):
                      </p>
                      <ul className="text-sm text-red-700 space-y-0.5">
                        {scheduleError.diagnostics.teacherOverload.map((t, i) => (
                          <li key={i}>
                            <strong>{t.teacher}</strong>: {t.sessions} sessions (max 25)
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {/* Grade overload */}
                {scheduleError.diagnostics.gradeOverload &&
                  scheduleError.diagnostics.gradeOverload.length > 0 && (
                    <div className="bg-red-50 rounded p-3 border border-red-200">
                      <p className="font-medium text-red-800 text-sm mb-1">
                        Grades with too many sessions (&gt;25):
                      </p>
                      <ul className="text-sm text-red-700 space-y-0.5">
                        {scheduleError.diagnostics.gradeOverload.map((g, i) => (
                          <li key={i}>
                            <strong>{g.grade}</strong>: {g.sessions} sessions (max 25)
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {/* Fixed slot conflicts */}
                {scheduleError.diagnostics.fixedSlotConflicts &&
                  scheduleError.diagnostics.fixedSlotConflicts.length > 0 && (
                    <div className="bg-red-50 rounded p-3 border border-red-200">
                      <p className="font-medium text-red-800 text-sm mb-1">
                        Fixed Slot Conflicts (same teacher, same time):
                      </p>
                      <ul className="text-sm text-red-700 space-y-1">
                        {scheduleError.diagnostics.fixedSlotConflicts.map((c, i) => (
                          <li key={i}>
                            <strong>{c.teacher}</strong> on {c.day} Block {c.block}:
                            <span className="text-red-600 ml-1">{c.class1.subject}</span>{" "}
                            vs
                            <span className="text-red-600 ml-1">{c.class2.subject}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Link href="/classes">
                <Button
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => onOpenChange(false)}
                >
                  Review Classes & Restrictions
                </Button>
              </Link>
              <Button
                variant="ghost"
                className="text-slate-600 hover:bg-slate-100"
                onClick={() => {
                  setScheduleError(null)
                  onOpenChange(false)
                }}
              >
                Close
              </Button>
              {lastRequestPayload && (
                <Button
                  variant="ghost"
                  className="text-slate-500 hover:bg-slate-100 ml-auto"
                  onClick={() => {
                    const debugInfo = {
                      timestamp: new Date().toISOString(),
                      error: scheduleError,
                      request: lastRequestPayload,
                    }
                    navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2))
                    toast.success("Debug info copied to clipboard")
                  }}
                >
                  Copy Debug Info
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dismiss Warning Alert */}
      <AlertDialog open={showDismissWarning} onOpenChange={setShowDismissWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generation in Progress</AlertDialogTitle>
            <AlertDialogDescription>
              A schedule is being generated. Are you sure you want to cancel? Progress will
              be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Generating</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceClose}
              className="bg-red-500 hover:bg-red-600"
            >
              Cancel Generation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
