"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScheduleGrid } from "@/components/ScheduleGrid"
import { ScheduleStats } from "@/components/ScheduleStats"
import { Loader2, Download, ArrowLeft, RotateCcw } from "lucide-react"
import Link from "next/link"
import type { ScheduleOption } from "@/lib/types"
import toast from "react-hot-toast"

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
  options: ScheduleOption[]
  stats?: { classes_snapshot?: ClassSnapshot[] }
  quarter: { id: string; name: string }
}

export default function HistoryDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const [generation, setGeneration] = useState<Generation | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedOption, setSelectedOption] = useState("1")
  const [viewMode, setViewMode] = useState<"teacher" | "grade">("teacher")
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [restoreMode, setRestoreMode] = useState<"overwrite" | "new_quarter">("new_quarter")
  const [newQuarterName, setNewQuarterName] = useState("")
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    loadGeneration()
  }, [id])

  async function loadGeneration() {
    try {
      const res = await fetch(`/api/history/${id}`)
      if (res.ok) {
        const data = await res.json()
        setGeneration(data)
        if (data.selected_option) {
          setSelectedOption(data.selected_option.toString())
        }
        // Set default new quarter name
        if (data.quarter?.name) {
          setNewQuarterName(`${data.quarter.name} (restored)`)
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

  async function handleRestore() {
    if (!generation) return

    setRestoring(true)
    try {
      const res = await fetch(`/api/history/${id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: restoreMode,
          new_quarter_name: restoreMode === "new_quarter" ? newQuarterName : undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success(`Restored ${data.classes_count} classes`)
        setRestoreDialogOpen(false)
        router.push("/classes")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to restore classes")
      }
    } catch (error) {
      toast.error("Failed to restore classes")
    } finally {
      setRestoring(false)
    }
  }

  const hasClassesSnapshot = generation?.stats?.classes_snapshot &&
    Array.isArray(generation.stats.classes_snapshot) &&
    generation.stats.classes_snapshot.length > 0

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

  const selectedResult = generation.options?.[parseInt(selectedOption) - 1]

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="mb-6">
        <Link
          href="/history"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to History
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              {generation.quarter?.name} Schedule
            </h1>
            <p className="text-muted-foreground">
              Generated {new Date(generation.generated_at).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {generation.options && generation.options.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Tabs value={selectedOption} onValueChange={setSelectedOption}>
              <TabsList>
                {generation.options.map((_, i) => (
                  <TabsTrigger key={i} value={(i + 1).toString()}>
                    Option {i + 1}
                    {generation.options[i] && (
                      <Badge
                        variant="outline"
                        className={`ml-2 ${generation.options[i].studyHallsPlaced === 5 ? 'border-emerald-400 text-emerald-700' : 'border-amber-400 text-amber-700'}`}
                      >
                        {generation.options[i].studyHallsPlaced}/5 SH
                      </Badge>
                    )}
                    {generation.selected_option === i + 1 && (
                      <Badge className="ml-2 bg-sky-500">Selected</Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setViewMode(viewMode === "teacher" ? "grade" : "teacher")
                }
              >
                View by {viewMode === "teacher" ? "Grade" : "Teacher"}
              </Button>
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
              {hasClassesSnapshot && (
                <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1">
                      <RotateCcw className="h-4 w-4" />
                      Restore Classes
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Restore Classes</DialogTitle>
                      <DialogDescription>
                        Restore the {generation?.stats?.classes_snapshot?.length} classes
                        that were used to generate this schedule.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-3">
                        <Label>Restore option</Label>
                        <div className="space-y-2">
                          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
                            <input
                              type="radio"
                              name="restoreMode"
                              value="new_quarter"
                              checked={restoreMode === "new_quarter"}
                              onChange={() => setRestoreMode("new_quarter")}
                              className="mt-1"
                            />
                            <div>
                              <div className="font-medium">Create new quarter</div>
                              <div className="text-sm text-muted-foreground">
                                Creates a new quarter with these classes
                              </div>
                            </div>
                          </label>
                          <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
                            <input
                              type="radio"
                              name="restoreMode"
                              value="overwrite"
                              checked={restoreMode === "overwrite"}
                              onChange={() => setRestoreMode("overwrite")}
                              className="mt-1"
                            />
                            <div>
                              <div className="font-medium">Overwrite {generation?.quarter?.name}</div>
                              <div className="text-sm text-red-600">
                                ⚠️ This will delete all current classes in this quarter
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>
                      {restoreMode === "new_quarter" && (
                        <div className="space-y-2">
                          <Label htmlFor="quarterName">New quarter name</Label>
                          <Input
                            id="quarterName"
                            value={newQuarterName}
                            onChange={(e) => setNewQuarterName(e.target.value)}
                            placeholder="Q1 2026 (restored)"
                          />
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setRestoreDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleRestore}
                        disabled={restoring}
                        className={restoreMode === "overwrite" ? "bg-red-600 hover:bg-red-700" : ""}
                      >
                        {restoring ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Restoring...
                          </>
                        ) : (
                          restoreMode === "overwrite" ? "Overwrite & Restore" : "Create & Restore"
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
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
                totalClasses={
                  generation.stats?.classes_snapshot
                    ? generation.stats.classes_snapshot.reduce((sum, c) => sum + (c.days_per_week || 0), 0)
                    : 0
                }
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
    </div>
  )
}
