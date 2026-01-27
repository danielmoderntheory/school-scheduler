"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScheduleGrid } from "@/components/ScheduleGrid"
import { ScheduleStats } from "@/components/ScheduleStats"
import { Loader2, Play, Download, Coffee, Eye, History, AlertTriangle, X, Server } from "lucide-react"
import { generateSchedulesRemote, type ScheduleDiagnostics } from "@/lib/scheduler-remote"
import type { Teacher, ClassEntry, ScheduleOption } from "@/lib/types"
import toast from "react-hot-toast"

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
function analyzeTeacherGrades(schedule: Record<string, Record<number, [string, string] | null>>): { primaryGrade: number; hasPrimary: boolean; gradeSpread: number } {
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

interface Quarter {
  id: string
  name: string
  is_active: boolean
}

interface HistoryItem {
  id: string
  generated_at: string
  selected_option: number | null
  studyHallsPlaced?: number
  is_saved: boolean
  notes: string | null
  quarter: { id: string; name: string }
}

interface Grade {
  id: string
  name: string
  display_name: string
}

interface DBClass {
  id: string
  teacher: { id: string; name: string }
  grade: { id: string; name: string; display_name: string }
  grade_ids?: string[]
  grades?: Array<{ id: string; name: string; display_name: string; sort_order: number }>
  is_elective?: boolean
  subject: { id: string; name: string }
  days_per_week: number
  restrictions: Array<{
    restriction_type: string
    value: unknown
  }>
}

export default function GeneratePage() {
  const router = useRouter()
  const [activeQuarter, setActiveQuarter] = useState<Quarter | null>(null)
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [classes, setClasses] = useState<DBClass[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, message: "" })
  const [results, setResults] = useState<ScheduleOption[] | null>(null)
  const [selectedOption, setSelectedOption] = useState("1")
  const [viewMode, setViewMode] = useState<"teacher" | "grade">("teacher")
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [recentHistory, setRecentHistory] = useState<HistoryItem[]>([])
  const [scheduleError, setScheduleError] = useState<{ type: 'infeasible' | 'error'; message: string; diagnostics?: ScheduleDiagnostics } | null>(null)
  const [solverStatus, setSolverStatus] = useState<{ isLocal: boolean; url: string } | null>(null)
  const generationIdRef = useRef<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      // Check solver status first
      try {
        const statusRes = await fetch("/api/solve-remote/status")
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          setSolverStatus(statusData)
        }
      } catch {
        // Ignore - will just not show indicator
      }

      const [teachersRes, gradesRes, quartersRes] = await Promise.all([
        fetch("/api/teachers"),
        fetch("/api/grades"),
        fetch("/api/quarters"),
      ])

      const [teachersData, gradesData, quartersData] = await Promise.all([
        teachersRes.json(),
        gradesRes.json(),
        quartersRes.json(),
      ])

      setTeachers(teachersData)
      setGrades(gradesData)

      const active = quartersData.find((q: Quarter) => q.is_active)
      setActiveQuarter(active || null)

      if (active) {
        const classesRes = await fetch(`/api/classes?quarter_id=${active.id}`)
        const classesData = await classesRes.json()
        setClasses(classesData)
      }

      // Load recent history (saved only)
      const historyRes = await fetch("/api/history")
      if (historyRes.ok) {
        const historyData = await historyRes.json()
        setRecentHistory(historyData.slice(0, 5))
      }
    } catch (error) {
      toast.error("Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  function convertToSchedulerFormat(): { teachers: Teacher[]; classes: ClassEntry[] } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const teacherList: Teacher[] = teachers.map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      // API returns snake_case, convert to camelCase for solver
      canSuperviseStudyHall: t.can_supervise_study_hall,
    }))

    const classList: ClassEntry[] = classes.map((c) => {
      // Build grades array - prefer new grades field, fall back to single grade
      let gradesList: string[] = []
      let gradeDisplay = ''

      if (c.grades && c.grades.length > 0) {
        // New multi-grade format
        gradesList = c.grades.map(g => g.display_name)
        // Create display name based on grade range
        if (gradesList.length === 1) {
          gradeDisplay = gradesList[0]
        } else {
          const sorted = [...c.grades].sort((a, b) => a.sort_order - b.sort_order)
          const first = sorted[0].display_name.replace(' Grade', '')
          const last = sorted[sorted.length - 1].display_name.replace(' Grade', '')
          gradeDisplay = `${first}-${last} Grade`
        }
      } else if (c.grade) {
        // Legacy single grade format
        gradesList = [c.grade.display_name]
        gradeDisplay = c.grade.display_name
      }

      const entry: ClassEntry = {
        id: c.id,
        teacher: c.teacher.name,
        grade: gradeDisplay,  // Keep for backward compat
        grades: gradesList,   // New: array of grade names
        gradeDisplay: gradeDisplay,
        subject: c.subject.name,
        daysPerWeek: c.days_per_week,
        isElective: c.is_elective || false,
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

      return entry
    })

    return { teachers: teacherList, classes: classList }
  }

  async function handleGenerate() {
    if (classes.length === 0) {
      toast.error("No classes configured for this quarter")
      return
    }

    // Generate unique ID for this run to prevent stale results
    const generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`
    generationIdRef.current = generationId

    setGenerating(true)
    setResults(null)
    setScheduleError(null)
    setProgress({ current: 0, total: 150, message: "Connecting to OR-Tools solver..." })

    try {
      const { teachers: teacherList, classes: classList } = convertToSchedulerFormat()

      const result = await generateSchedulesRemote(teacherList, classList, {
        numOptions: 1,
        numAttempts: 150,
        maxTimeSeconds: 120,
        onProgress: (current, total, message) => {
          setProgress({ current, total, message })
        },
      })

      // CRITICAL: Verify this result is for the current generation, not stale
      if (generationIdRef.current !== generationId) {
        console.warn('Discarding stale generation result', { expected: generationIdRef.current, got: generationId })
        return
      }

      // DEBUG: Log the actual result to track the stale results bug
      console.log('=== GENERATION RESULT ===')
      console.log('Generation ID:', generationId)
      console.log('Result status:', result.status)
      console.log('Result options count:', result.options?.length ?? 0)
      console.log('Result message:', result.message)
      console.log('=========================')

      if (result.status === 'infeasible') {
        setScheduleError({
          type: 'infeasible',
          message: result.message || "The current class constraints are impossible to satisfy.",
          diagnostics: result.diagnostics,
        })
        setResults(null) // Explicit clear
      } else if (result.status === 'error' || result.options.length === 0) {
        setScheduleError({
          type: 'error',
          message: result.message || "Could not find a valid schedule. Try adjusting constraints.",
          diagnostics: result.diagnostics,
        })
        setResults(null) // Explicit clear
      } else {
        setScheduleError(null)
        toast.success(`Generated ${result.options.length} schedule option(s)`)

        // Auto-save to database for shareable URL
        try {
          const classesSnapshot = classes.map((c) => ({
            teacher_id: c.teacher.id,
            teacher_name: c.teacher.name,
            grade_id: c.grade.id,
            grade_name: c.grade.name,
            grade_display_name: c.grade.display_name,
            subject_id: c.subject.id,
            subject_name: c.subject.name,
            days_per_week: c.days_per_week,
            restrictions: c.restrictions,
          }))

          const saveRes = await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quarter_id: activeQuarter?.id,
              options: result.options,
              allSolutions: result.allSolutions || [],
              selected_option: 1,
              classes_snapshot: classesSnapshot,
            }),
          })

          if (saveRes.ok) {
            const savedData = await saveRes.json()
            // Redirect to shareable history URL (don't show results here)
            router.replace(`/history/${savedData.id}`)
            return // Don't set results - we're redirecting
          } else {
            // Save failed - show results on this page as fallback
            console.warn('Could not auto-save to database')
            toast.error('Could not save to history - results shown below')
            setResults(result.options)
          }
        } catch (e) {
          console.warn('Could not auto-save:', e)
          toast.error('Could not save to history - results shown below')
          setResults(result.options)
        }
      }
    } catch (error) {
      console.error("Generation error:", error)
      toast.error("Schedule generation failed")
    } finally {
      setGenerating(false)
    }
  }

  async function handleExport(format: "xlsx" | "csv") {
    if (!results) return

    const option = parseInt(selectedOption)
    const scheduleOption = results[option - 1]

    // For now, download as JSON - full XLSX export will be in Phase 7
    const blob = new Blob([JSON.stringify(scheduleOption, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `schedule-option-${option}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported as JSON (${format.toUpperCase()} coming soon)`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!activeQuarter) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-4">Generate Schedule</h1>
        <p className="text-muted-foreground">
          Please create and select a quarter first using the dropdown in the navigation.
        </p>
      </div>
    )
  }

  const selectedResult = results?.[parseInt(selectedOption) - 1]

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Solver Status Banner - only show when using local solver */}
      {solverStatus?.isLocal && (
        <div className="mb-4 px-4 py-2 rounded-lg flex items-center justify-between bg-amber-50 border border-amber-300">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">LOCAL SOLVER</span>
            <span className="text-xs text-amber-600">({solverStatus.url})</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-amber-600">
              Remember: <code className="bg-amber-100 px-1 rounded">cd backend && ./deploy.sh</code> before production
            </span>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Generate Schedule</h1>
          <p className="text-muted-foreground">
            {activeQuarter.name} - {classes.length} classes, {teachers.length} teachers
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => {
            if (classes.length === 0) {
              toast.error("No classes configured for this quarter. Add classes first.")
              return
            }
            setShowConfirmDialog(true)
          }}
          disabled={generating}
          className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          {generating ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Play className="h-5 w-5" />
              Generate Schedule
            </>
          )}
        </Button>
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="h-5 w-5 text-amber-600" />
              heads up emily
            </DialogTitle>
            <DialogDescription asChild>
              <div className="pt-2 space-y-3 text-sm text-muted-foreground">
                <p>
                  The OR-Tools solver will run up to 150 attempts to find the best schedules. This typically takes 1-2 minutes.
                </p>
                <p className="text-slate-500">
                  (Perfect time for a coffee break!)
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowConfirmDialog(false)
                handleGenerate()
              }}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              Continue to Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {generating && (
        <Card className="mb-6 border-sky-200 bg-sky-50/50">
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>{progress.message}</span>
                <span>
                  {progress.current}/{progress.total}
                </span>
              </div>
              <div className="w-full bg-sky-100 rounded-full h-2">
                <div
                  className="bg-sky-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {scheduleError && (
        <Card className="mb-6 border-red-300 bg-red-50">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-full">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <CardTitle className="text-red-800 text-lg">
                  {scheduleError.type === 'infeasible'
                    ? 'Schedule Constraints Cannot Be Satisfied'
                    : 'Schedule Generation Failed'}
                </CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-100"
                onClick={() => setScheduleError(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-4">
              <p className="text-red-700">{scheduleError.message}</p>

              {/* Diagnostics Section */}
              {scheduleError.diagnostics && (
                <div className="bg-white/80 rounded-lg p-4 border border-red-200 space-y-3">
                  <p className="font-medium text-red-800">Issues Found:</p>

                  {/* Incomplete classes - most important, show first */}
                  {scheduleError.diagnostics.incompleteClasses && scheduleError.diagnostics.incompleteClasses.length > 0 && (
                    <div className="bg-red-100 rounded p-3 border border-red-300">
                      <p className="font-medium text-red-800 text-sm mb-2">Classes with missing required fields:</p>
                      <ul className="text-sm text-red-700 space-y-1">
                        {scheduleError.diagnostics.incompleteClasses.map((c, i) => (
                          <li key={i}>
                            <strong>Class #{c.index}</strong>:
                            {c.teacher !== '(none)' && <span className="ml-1">{c.teacher}</span>}
                            {c.subject !== '(none)' && <span className="ml-1">- {c.subject}</span>}
                            <span className="ml-2 text-red-600 font-medium">({c.issues.join(', ')})</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-red-600 mt-2">
                        Please fix or remove these classes before generating a schedule.
                      </p>
                    </div>
                  )}

                  {/* Basic stats - only show if solver ran */}
                  {scheduleError.diagnostics.totalSessions !== undefined && (
                    <div className="text-sm text-slate-700 flex gap-4 flex-wrap">
                      <span>Total sessions: <strong>{scheduleError.diagnostics.totalSessions}</strong></span>
                      <span>Fixed sessions: <strong>{scheduleError.diagnostics.fixedSessions}</strong></span>
                      {scheduleError.diagnostics.solverStatus && (
                        <span>Status: <strong className="text-red-600">{scheduleError.diagnostics.solverStatus}</strong></span>
                      )}
                    </div>
                  )}

                  {/* Teacher overload */}
                  {scheduleError.diagnostics.teacherOverload && scheduleError.diagnostics.teacherOverload.length > 0 && (
                    <div className="bg-red-100 rounded p-3 border border-red-200">
                      <p className="font-medium text-red-800 text-sm mb-1">Teachers with too many sessions (&gt;25):</p>
                      <ul className="text-sm text-red-700 space-y-0.5">
                        {scheduleError.diagnostics.teacherOverload.map((t, i) => (
                          <li key={i}><strong>{t.teacher}</strong>: {t.sessions} sessions (max 25)</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Grade overload */}
                  {scheduleError.diagnostics.gradeOverload && scheduleError.diagnostics.gradeOverload.length > 0 && (
                    <div className="bg-red-100 rounded p-3 border border-red-200">
                      <p className="font-medium text-red-800 text-sm mb-1">Grades with too many sessions (&gt;25):</p>
                      <ul className="text-sm text-red-700 space-y-0.5">
                        {scheduleError.diagnostics.gradeOverload.map((g, i) => (
                          <li key={i}><strong>{g.grade}</strong>: {g.sessions} sessions (max 25)</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Fixed slot conflicts */}
                  {scheduleError.diagnostics.fixedSlotConflicts && scheduleError.diagnostics.fixedSlotConflicts.length > 0 && (
                    <div className="bg-red-100 rounded p-3 border border-red-200">
                      <p className="font-medium text-red-800 text-sm mb-1">Fixed Slot Conflicts (same teacher, same time):</p>
                      <ul className="text-sm text-red-700 space-y-1">
                        {scheduleError.diagnostics.fixedSlotConflicts.map((c, i) => (
                          <li key={i}>
                            <strong>{c.teacher}</strong> on {c.day} Block {c.block}:
                            <span className="text-red-600 ml-1">{c.class1.subject}</span> vs
                            <span className="text-red-600 ml-1">{c.class2.subject}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Co-taught mismatches */}
                  {scheduleError.diagnostics.cotaughtMismatches && scheduleError.diagnostics.cotaughtMismatches.length > 0 && (
                    <div className="bg-amber-100 rounded p-3 border border-amber-200">
                      <p className="font-medium text-amber-800 text-sm mb-1">Co-taught Session Mismatches:</p>
                      <p className="text-xs text-amber-600 mb-2">Teachers teaching same class must have same days_per_week</p>
                      <ul className="text-sm text-amber-700 space-y-1">
                        {scheduleError.diagnostics.cotaughtMismatches.map((m, i) => (
                          <li key={i}>
                            <strong>{m.grade} - {m.subject}</strong>:
                            <span className="ml-1">{m.teacher1} ({m.sessions1}x)</span> vs
                            <span className="ml-1">{m.teacher2} ({m.sessions2}x)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Co-taught classes info */}
                  {scheduleError.diagnostics.cotaughtClasses && scheduleError.diagnostics.cotaughtClasses.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-slate-600 hover:text-slate-800">
                        {scheduleError.diagnostics.cotaughtClasses.length} co-taught classes ({scheduleError.diagnostics.cotaughtConstraints} constraints)
                      </summary>
                      <ul className="mt-2 text-slate-600 space-y-0.5 pl-4">
                        {scheduleError.diagnostics.cotaughtClasses.map((c, i) => (
                          <li key={i}>{c.grade} - {c.subject}: {c.teachers.join(', ')}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {scheduleError.type === 'infeasible' && !scheduleError.diagnostics?.incompleteClasses?.length && !scheduleError.diagnostics?.fixedSlotConflicts?.length && !scheduleError.diagnostics?.teacherOverload?.length && !scheduleError.diagnostics?.gradeOverload?.length && (
                <div className="bg-white/60 rounded-lg p-4 border border-red-200">
                  <p className="font-medium text-red-800 mb-2">Common causes:</p>
                  <ul className="text-sm text-red-700 space-y-1.5 list-disc list-inside">
                    <li>Too many classes scheduled for the same teacher on the same day</li>
                    <li>Fixed slot restrictions that conflict with each other</li>
                    <li>A grade has more classes than available time slots</li>
                    <li>Teacher availability restrictions are too narrow</li>
                  </ul>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Link href="/classes">
                  <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-100">
                    Review Classes & Restrictions
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  className="text-red-600 hover:bg-red-100"
                  onClick={() => setScheduleError(null)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {results && results.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Tabs value={selectedOption} onValueChange={setSelectedOption}>
              <TabsList>
                {results.map((_, i) => (
                  <TabsTrigger key={i} value={(i + 1).toString()}>
                    Option {i + 1}
                    {results[i] && (
                      <Badge
                        variant="outline"
                        className={`ml-2 ${results[i].studyHallsPlaced >= (results[i].studyHallAssignments?.length || 5) ? 'border-emerald-400 text-emerald-700' : 'border-amber-400 text-amber-700'}`}
                      >
                        {results[i].studyHallsPlaced}/{results[i].studyHallAssignments?.length || 5} SH
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setViewMode(viewMode === "teacher" ? "grade" : "teacher")}
              >
                View by {viewMode === "teacher" ? "Grade" : "Teacher"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("xlsx")}
                className="gap-1"
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
            </div>
          </div>

          {selectedResult && (
            <div className="space-y-6">
              {/* Stats Summary - At top with clickable links to details */}
              <ScheduleStats
                stats={selectedResult.teacherStats}
                studyHallAssignments={selectedResult.studyHallAssignments}
                backToBackIssues={selectedResult.backToBackIssues}
                studyHallsPlaced={selectedResult.studyHallsPlaced}
                totalClasses={classes.reduce((sum, c) => sum + c.days_per_week, 0)}
                unscheduledClasses={0}
              />

              {/* Schedule Grids */}
              <div>
                <h3 className="font-semibold mb-4">
                  {viewMode === "teacher" ? "Teacher Schedules" : "Grade Schedules"}
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {viewMode === "teacher"
                    ? Object.entries(selectedResult.teacherSchedules)
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

      {/* Stats and History - always visible when not generating */}
      {!generating && !results && (
        <Card className="bg-white shadow-sm mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-slate-700 text-lg">Ready to Generate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <div className="font-semibold text-slate-700">{teachers.length}</div>
                <div className="text-slate-500 text-xs">Teachers</div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <div className="font-semibold text-slate-700">{classes.length}</div>
                <div className="text-slate-500 text-xs">Classes</div>
              </div>
              <div className="border border-sky-200 rounded-lg p-3 bg-sky-50">
                <div className="font-semibold text-sky-700">
                  {classes.reduce((sum, c) => sum + c.days_per_week, 0)}
                </div>
                <div className="text-sky-600 text-xs">Sessions/Week</div>
              </div>
              <div className="border border-emerald-200 rounded-lg p-3 bg-emerald-50">
                <div className="font-semibold text-emerald-700">
                  {teachers.length * 25}
                </div>
                <div className="text-emerald-600 text-xs">Available Slots</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent History - only in ready state (not generating, not showing results) */}
      {!generating && !results && (
        <div className="space-y-4 mb-6">
          {/* Recent History */}
          <Card className="bg-white shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-slate-600 text-sm font-medium flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Recent Saved Schedules
                </CardTitle>
                {recentHistory.length > 0 && (
                  <Link href="/history" className="text-xs text-sky-600 hover:text-sky-700">
                    View all →
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {recentHistory.length > 0 ? (
                <div className="space-y-2">
                  {recentHistory.map((item) => (
                    <div key={item.id} className="py-2 border-b border-slate-100 last:border-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-sm">
                          <span className="text-slate-600">{item.quarter?.name}</span>
                          <span className="text-slate-400 text-xs">
                            {new Date(item.generated_at).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.selected_option && (
                            <Badge variant="outline" className="text-xs border-slate-300 text-slate-500">
                              Option {item.selected_option}
                            </Badge>
                          )}
                          <Link href={`/history/${item.id}`}>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                              <Eye className="h-3.5 w-3.5 text-slate-400" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                      {item.notes && (
                        <p className="text-xs text-slate-500 mt-1 italic truncate" title={item.notes}>
                          &ldquo;{item.notes}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No saved schedules yet. Generate and save a schedule to see it here.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
