"use client"

import { useState, useEffect, useRef } from "react"
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
import { Loader2, Play, Save, Download, Coffee, Clock, Eye, History, AlertTriangle, X } from "lucide-react"
import { generateSchedules } from "@/lib/scheduler"
import type { Teacher, ClassEntry, ScheduleOption } from "@/lib/types"
import toast from "react-hot-toast"

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
  quarter: { id: string; name: string }
}

interface LastRun {
  timestamp: string
  quarterId: string
  quarterName: string
  studyHallsPlaced: number
  backToBackIssues: number
  saved: boolean
  options: ScheduleOption[] // Store full results so we can view them
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
  subject: { id: string; name: string }
  days_per_week: number
  restrictions: Array<{
    restriction_type: string
    value: unknown
  }>
}

export default function GeneratePage() {
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
  const [saving, setSaving] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [recentHistory, setRecentHistory] = useState<HistoryItem[]>([])
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [scheduleError, setScheduleError] = useState<{ type: 'infeasible' | 'error'; message: string } | null>(null)
  const generationIdRef = useRef<string | null>(null)

  useEffect(() => {
    loadData()
    // Load last run from localStorage
    const stored = localStorage.getItem('lastScheduleRun')
    if (stored) {
      try {
        setLastRun(JSON.parse(stored))
      } catch (e) {
        // ignore
      }
    }
  }, [])

  async function loadData() {
    try {
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

      // Load recent history
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
    const teacherList: Teacher[] = teachers.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      canSuperviseStudyHall: t.canSuperviseStudyHall,
    }))

    const classList: ClassEntry[] = classes.map((c) => {
      const entry: ClassEntry = {
        id: c.id,
        teacher: c.teacher.name,
        grade: c.grade.display_name,
        subject: c.subject.name,
        daysPerWeek: c.days_per_week,
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
    setLastRun(null) // Clear last run when starting new generation
    setProgress({ current: 0, total: 50, message: "Initializing solver..." })

    try {
      const { teachers: teacherList, classes: classList } = convertToSchedulerFormat()

      const result = await generateSchedules(teacherList, classList, {
        numOptions: 3,
        numAttempts: 50,
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
          message: result.message || "The current class constraints are impossible to satisfy."
        })
        setResults(null) // Explicit clear
      } else if (result.status === 'error' || result.options.length === 0) {
        setScheduleError({
          type: 'error',
          message: result.message || "Could not find a valid schedule. Try adjusting constraints."
        })
        setResults(null) // Explicit clear
      } else {
        setScheduleError(null)
        setResults(result.options)
        toast.success(`Generated ${result.options.length} schedule option(s)`)

        // Store last run in localStorage
        const run: LastRun = {
          timestamp: new Date().toISOString(),
          quarterId: activeQuarter?.id || '',
          quarterName: activeQuarter?.name || '',
          studyHallsPlaced: result.options[0].studyHallsPlaced,
          backToBackIssues: result.options[0].backToBackIssues,
          saved: false,
          options: result.options, // Store full results for viewing later
        }
        setLastRun(run)
        try {
          localStorage.setItem('lastScheduleRun', JSON.stringify(run))
        } catch (e) {
          // localStorage might be full - that's ok, we still have it in state
          console.warn('Could not save last run to localStorage:', e)
        }
      }
    } catch (error) {
      console.error("Generation error:", error)
      toast.error("Schedule generation failed")
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave() {
    if (!results || !activeQuarter) return

    setSaving(true)
    try {
      // Save classes snapshot along with the schedule
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

      const res = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quarter_id: activeQuarter.id,
          options: results,
          selected_option: parseInt(selectedOption),
          classes_snapshot: classesSnapshot,
        }),
      })

      if (res.ok) {
        toast.success("Schedule saved to history")
        // Mark last run as saved
        if (lastRun) {
          const updatedRun = { ...lastRun, saved: true }
          setLastRun(updatedRun)
          localStorage.setItem('lastScheduleRun', JSON.stringify(updatedRun))
        }
        // Refresh history
        const historyRes = await fetch("/api/history")
        if (historyRes.ok) {
          const historyData = await historyRes.json()
          setRecentHistory(historyData.slice(0, 5))
        }
      } else {
        toast.error("Failed to save schedule")
      }
    } catch (error) {
      toast.error("Failed to save schedule")
    } finally {
      setSaving(false)
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
                  this could take a minute or two.
                </p>
                <p className="text-slate-500">
                  (and depending on how many browser tabs you have open, it might take longer. take a coffee break.)
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

              {scheduleError.type === 'infeasible' && (
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
                        className={`ml-2 ${results[i].studyHallsPlaced === 5 ? 'border-emerald-400 text-emerald-700' : 'border-amber-400 text-amber-700'}`}
                      >
                        {results[i].studyHallsPlaced}/5 SH
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
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-white">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
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
                        .sort(([teacherA], [teacherB]) => {
                          const statA = selectedResult.teacherStats.find(s => s.teacher === teacherA)
                          const statB = selectedResult.teacherStats.find(s => s.teacher === teacherB)
                          if (statA?.status === 'full-time' && statB?.status !== 'full-time') return -1
                          if (statA?.status !== 'full-time' && statB?.status === 'full-time') return 1
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

      {/* Last Run and Recent History - only in ready state (not generating, not showing results) */}
      {!generating && !results && (
        <div className="space-y-4 mb-6">
          {/* Last Run - clickable to view results */}
          {lastRun && lastRun.options && lastRun.options.length > 0 && (
            <Card
              className="bg-white shadow-sm cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => {
                setResults(lastRun.options)
                setSelectedOption("1")
              }}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-slate-600 text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Last Run
                  <span className="text-xs text-slate-400 font-normal ml-auto">Click to view</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-slate-600">{lastRun.quarterName}</span>
                    <span className="text-slate-400 mx-2">·</span>
                    <span className="text-slate-400">
                      {new Date(lastRun.timestamp).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={lastRun.studyHallsPlaced === 5 ? 'border-emerald-300 text-emerald-600' : 'border-amber-300 text-amber-600'}
                    >
                      {lastRun.studyHallsPlaced}/5 SH
                    </Badge>
                    {lastRun.saved ? (
                      <Badge variant="outline" className="border-slate-300 text-slate-500">Saved</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-300 text-amber-600">Not saved</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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
                    <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
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
