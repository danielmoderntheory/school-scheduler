"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Plus, X, Clock, Users, UserX, Upload, Download, Check, History, Star, Lock, Play, MoreVertical, Pencil, Settings2, Trash2, Undo2, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { GradeSelector, formatGradeDisplay } from "@/components/GradeSelector"
import { AddClassModal } from "@/components/AddClassModal"
import { LocalQuarterSelector } from "@/components/LocalQuarterSelector"
import { GenerateModal } from "@/components/GenerateModal"
import { useQuarterSelection } from "@/lib/hooks/useQuarterSelection"
import { TEACHER_STATUS_FULL_TIME, isPartTime, isFullTime, calculateGradeBlocks, buildCotaughtGroups, type TeacherStatus } from "@/lib/schedule-utils"
import { getTemplateBlocks, getTeachableBlocksForGrade } from "@/lib/timetable-utils"
import { type TimetableTemplate } from "@/lib/types"
import type { SchedulingRule } from "@/lib/scheduler-remote"
import toast from "@/lib/toast"

interface LastRun {
  historyId: string
  timestamp: string
  quarterId: string
  quarterName: string
  studyHallsPlaced: number
  backToBackIssues: number
  starred: boolean
}

interface Teacher {
  id: string
  name: string
  status: TeacherStatus
  available_days?: string[] | null
  available_blocks?: number[] | null
}

interface Grade {
  id: string
  name: string
  display_name: string
  sort_order: number
}

interface Subject {
  id: string
  name: string
}

interface Restriction {
  id?: string
  restriction_type: "fixed_slot" | "available_days" | "available_blocks"
  value: unknown
}

interface ClassEntry {
  id: string
  quarter_id: string
  teacher_id: string
  grade_id: string
  grade_ids?: string[]
  is_elective?: boolean
  is_cotaught?: boolean
  subject_id: string
  days_per_week: number
  /** Per-class double periods setting (classes.double_periods, returned by the classes API) */
  double_periods?: boolean
  teacher: Teacher | null
  teacher_deleted?: boolean
  grade: Grade
  grades?: Grade[]
  subject: Subject
  restrictions: Restriction[]
}

interface Quarter {
  id: string
  name: string
  is_active: boolean
}

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
// Legacy fallback — the real block list comes from the quarter's timetable template
const DEFAULT_BLOCKS = [1, 2, 3, 4, 5]

// NOTE: Study hall grades are now configured in the rules, fetched below

function formatTimeAgo(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
}

export default function ClassesPage() {
  return (
    <Suspense>
      <ClassesPageContent />
    </Suspense>
  )
}

function ClassesPageContent() {
  const searchParams = useSearchParams()
  const [classes, setClasses] = useState<ClassEntry[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [studyHallGrades, setStudyHallGrades] = useState<string[]>([])
  const [timetableTemplate, setTimetableTemplate] = useState<TimetableTemplate | null>(null)
  const [rules, setRules] = useState<SchedulingRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showGenerateModal, setShowGenerateModal] = useState(false)

  // Use localStorage-based quarter selection
  const {
    quarters,
    selectedQuarter: activeQuarter,
    setSelectedQuarterId,
    refetchQuarters,
    isLoading: quartersLoading,
    error: quartersError,
  } = useQuarterSelection({
    onQuarterChange: (quarterId) => {
      // Reload classes when quarter changes
      loadClassesForQuarter(quarterId)
    },
  })

  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [tableLocked, setTableLocked] = useState(false)
  const [lockReason, setLockReason] = useState<'generation' | 'import' | null>(null)
  const [classesLoading, setClassesLoading] = useState(true)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showAddClassModal, setShowAddClassModal] = useState(false)
  const [showCotaughtSuggestion, setShowCotaughtSuggestion] = useState(false)
  const [cotaughtSuggestionClasses, setCotaughtSuggestionClasses] = useState<ClassEntry[]>([])
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showImportFromHistoryDialog, setShowImportFromHistoryDialog] = useState(false)
  const [historyItems, setHistoryItems] = useState<Array<{
    id: string
    generated_at: string
    is_starred: boolean
    notes: string | null
    quarter: { id: string; name: string }
    stats?: { classes_snapshot?: unknown[] }
  }>>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [importText, setImportText] = useState("")
  const [importing, setImporting] = useState(false)
  const [replaceAll, setReplaceAll] = useState(true)
  const [undoImportData, setUndoImportData] = useState<ClassEntry[] | null>(null)
  const [importStep, setImportStep] = useState<'input' | 'confirm'>('input')
  const [pendingImport, setPendingImport] = useState<Array<{
    line: number
    teacherName: string
    gradeStr: string
    subjectName: string
    daysPerWeek: number
    restrictionStr: string
    gradeIds: string[]
    isElective: boolean
    detectedElective: boolean
    isCotaught: boolean
    isDouble: boolean
  }>>([])
  const [importCotaughtGroups, setImportCotaughtGroups] = useState<Map<string, number[]>>(new Map())
  const [showCotaughtDetails, setShowCotaughtDetails] = useState(false)
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [showDeletedDialog, setShowDeletedDialog] = useState(false)
  const [deletedClasses, setDeletedClasses] = useState<Array<{
    id: string
    deleted_at: string
    description: string
  }>>([])
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())
  const undoToastId = useRef<string | null>(null)
  const initialLoadDone = useRef(false)
  const skipNextClassesUnlock = useRef(false)

  // Unlock table when classes are modified after initial load (not during loads)
  useEffect(() => {
    if (skipNextClassesUnlock.current) {
      skipNextClassesUnlock.current = false
      return
    }
    if (initialLoadDone.current) {
      setTableLocked(false)
    }
  }, [classes])

  useEffect(() => {
    loadData()
  }, [])

  // Load classes for a specific quarter (called on quarter change)
  async function loadClassesForQuarter(quarterId: string) {
    if (!quarterId) return

    setClassesLoading(true)
    try {
      // Fetch classes and lock state in parallel
      const [classesRes, snapshotRes, historyRes, starredRes, templateRes] = await Promise.all([
        fetch(`/api/classes?quarter_id=${quarterId}`),
        fetch(`/api/history?quarter_id=${quarterId}&snapshot_version_only=true`).catch(() => null),
        fetch(`/api/history?quarter_id=${quarterId}&limit=1&most_recent=true&summary=true`).catch(() => null),
        fetch(`/api/history?quarter_id=${quarterId}&limit=1&starred_only=true&summary=true`).catch(() => null),
        fetch(`/api/timetable-templates?quarter_id=${quarterId}`).catch(() => null),
      ])

      // Resolve the quarter's block format (falls back to legacy 5-block when unavailable)
      try {
        if (templateRes?.ok) {
          const templates = await templateRes.json()
          setTimetableTemplate(Array.isArray(templates) && templates.length > 0 ? templates[0] : null)
        } else {
          setTimetableTemplate(null)
        }
      } catch {
        setTimetableTemplate(null)
      }

      const classesData = await classesRes.json()
      // Sort by teacher name
      const sorted = [...classesData].sort((a: ClassEntry, b: ClassEntry) => {
        const aName = a.teacher?.name || ''
        const bName = b.teacher?.name || ''
        if (!aName && bName) return -1
        if (aName && !bName) return 1
        return aName.localeCompare(bName)
      })

      // Determine lock state before setting classes (avoids flash)
      let shouldLock = false
      try {
        if (snapshotRes?.ok) {
          const { maxSnapshotVersion } = await snapshotRes.json()
          if (maxSnapshotVersion > 0) {
            shouldLock = true
          }
        }
      } catch {
        // Ignore
      }

      // Fetch schedule generations for display
      try {
        let displayGen = null
        let mostRecentGen = null

        if (historyRes?.ok) {
          const historyData = await historyRes.json()
          if (historyData.length > 0) mostRecentGen = historyData[0]
        }

        if (starredRes?.ok) {
          const starredData = await starredRes.json()
          if (starredData.length > 0) displayGen = starredData[0]
        }

        if (!displayGen) displayGen = mostRecentGen

        if (displayGen) {
          const quarterInfo = quarters.find(q => q.id === quarterId)
          setLastRun({
            historyId: displayGen.id,
            timestamp: displayGen.generated_at,
            quarterId: quarterId,
            quarterName: quarterInfo?.name || '',
            studyHallsPlaced: displayGen.studyHallsPlaced ?? 0,
            backToBackIssues: displayGen.backToBackIssues ?? 0,
            starred: displayGen.is_starred ?? false,
          })
        } else {
          setLastRun(null)
        }
      } catch {
        // Ignore history fetch errors
      }

      // Set classes and lock state together to avoid flashing
      skipNextClassesUnlock.current = true
      setClasses(sorted)
      setTableLocked(shouldLock)
      setLockReason(shouldLock ? 'generation' : null)
    } catch (error) {
      toast.error("Failed to load classes")
    } finally {
      setClassesLoading(false)
    }
  }

  // Initial load of teachers, grades, subjects, and rules (quarters handled by hook)
  async function loadData() {
    try {
      const [teachersRes, gradesRes, subjectsRes, rulesRes] = await Promise.all([
        fetch("/api/teachers"),
        fetch("/api/grades"),
        fetch("/api/subjects"),
        fetch("/api/rules"),
      ])

      const [teachersData, gradesData, subjectsData, rulesData] = await Promise.all([
        teachersRes.json(),
        gradesRes.json(),
        subjectsRes.json(),
        rulesRes.json(),
      ])

      setTeachers(teachersData)
      setGrades(gradesData)
      setSubjects(subjectsData)

      // Store rules for GenerateModal
      setRules(rulesData.map((r: { rule_key: string; enabled: boolean; config?: Record<string, unknown> }) => ({
        rule_key: r.rule_key,
        enabled: r.enabled,
        config: r.config,
      })))

      // Extract study hall grades from rules config
      const studyHallRule = rulesData.find((r: { rule_key: string }) => r.rule_key === 'study_hall_grades')
      const configuredStudyHallGrades: string[] = studyHallRule?.enabled && studyHallRule?.config?.grades
        ? studyHallRule.config.grades
        : []
      setStudyHallGrades(configuredStudyHallGrades)

    } catch (error) {
      toast.error("Failed to load data")
    } finally {
      setLoading(false)
      initialLoadDone.current = true
    }
  }

  // Load classes when activeQuarter becomes available (from hook)
  useEffect(() => {
    if (activeQuarter?.id && !quartersLoading) {
      loadClassesForQuarter(activeQuarter.id)
    }
  }, [activeQuarter?.id, quartersLoading])

  async function fetchDeletedClasses() {
    if (!activeQuarter?.id) return
    try {
      const res = await fetch(`/api/classes/deleted?quarter_id=${activeQuarter.id}`)
      if (res.ok) {
        const data = await res.json()
        setDeletedClasses(data)
      }
    } catch (error) {
      console.error("Failed to fetch deleted classes", error)
    }
  }

  async function restoreClass(id: string) {
    setRestoringIds(prev => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/classes/${id}/restore`, { method: "POST" })
      if (res.ok) {
        // Remove from deleted list
        setDeletedClasses(prev => prev.filter(c => c.id !== id))
        // Reload classes to get the restored one
        loadClassesForQuarter(activeQuarter!.id)
        toast.success("Class restored")
      } else {
        toast.error("Failed to restore class")
      }
    } catch (error) {
      toast.error("Failed to restore class")
    } finally {
      setRestoringIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function updateClass(id: string, field: string, value: unknown) {
    // Find the class and store previous value for undo
    const classIndex = classes.findIndex((c) => c.id === id)
    const cls = classes[classIndex]
    if (!cls) return

    const rowNumber = classIndex + 1
    const previousValue = field === "teacher_id" ? cls.teacher_id
      : field === "grade_id" ? cls.grade_id
      : field === "subject_id" ? cls.subject_id
      : field === "days_per_week" ? cls.days_per_week
      : field === "double_periods" ? (cls.double_periods === true)
      : null

    // Optimistic update
    const previousClasses = classes
    setClasses((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    )

    try {
      const res = await fetch(`/api/classes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        const updated = await res.json()
        setClasses((prev) => prev.map((c) => (c.id === id ? updated : c)))

        // Sync co-taught siblings: when toggling is_cotaught, apply the same
        // value to all other classes with the same grade_ids + subject_id
        const cotaughtSiblings: Array<{ id: string; rowNumber: number }> = []
        if (field === "is_cotaught") {
          const gradeIds = cls.grade_ids?.length ? [...cls.grade_ids].sort() : (cls.grade_id ? [cls.grade_id] : [])
          const gradeKey = JSON.stringify(gradeIds)
          const siblings = classes.filter(c =>
            c.id !== id &&
            c.subject_id === cls.subject_id &&
            JSON.stringify((c.grade_ids?.length ? [...c.grade_ids] : (c.grade_id ? [c.grade_id] : [])).sort()) === gradeKey
          )
          for (const sibling of siblings) {
            if ((sibling.is_cotaught || false) !== value) {
              const sibIndex = classes.findIndex(c => c.id === sibling.id)
              cotaughtSiblings.push({ id: sibling.id, rowNumber: sibIndex + 1 })
              // Optimistic update for sibling
              setClasses((prev) => prev.map((c) => (c.id === sibling.id ? { ...c, is_cotaught: value as boolean } : c)))
              fetch(`/api/classes/${sibling.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ is_cotaught: value }),
              }).then(async (sibRes) => {
                if (sibRes.ok) {
                  const sibUpdated = await sibRes.json()
                  setClasses((prev) => prev.map((c) => (c.id === sibling.id ? sibUpdated : c)))
                }
              })
            }
          }
        }

        // Dismiss previous undo toast
        if (undoToastId.current) toast.dismiss(undoToastId.current)

        // Show undo toast
        const allRows = [rowNumber, ...cotaughtSiblings.map(s => s.rowNumber)]
        const rowLabel = allRows.length > 1
          ? `Rows ${allRows.join(', ')} updated`
          : `Row ${rowNumber} updated`
        const toastId = toast((t) => (
          <div className="flex items-center gap-3">
            <span className="text-sm">{rowLabel}</span>
            <button
              onClick={async () => {
                toast.dismiss(t.id)
                undoToastId.current = null
                // Revert to previous value
                const revertRes = await fetch(`/api/classes/${id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ [field]: previousValue }),
                })
                if (revertRes.ok) {
                  const reverted = await revertRes.json()
                  setClasses((prev) => prev.map((c) => (c.id === id ? reverted : c)))
                }
                // Revert siblings too
                for (const sibling of cotaughtSiblings) {
                  const sibRevertRes = await fetch(`/api/classes/${sibling.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ is_cotaught: previousValue }),
                  })
                  if (sibRevertRes.ok) {
                    const sibReverted = await sibRevertRes.json()
                    setClasses((prev) => prev.map((c) => (c.id === sibling.id ? sibReverted : c)))
                  }
                }
              }}
              className="px-2 py-1 text-sm font-medium text-violet-600 hover:text-violet-800 hover:bg-violet-50 rounded transition-colors"
            >
              Undo
            </button>
          </div>
        ), { duration: 60000, icon: <Check className="h-4 w-4 text-emerald-600" /> })
        undoToastId.current = toastId
      } else {
        // Revert on error
        setClasses(previousClasses)
        const error = await res.json()
        toast.error(error.error || "Failed to save")
      }
    } catch (error) {
      // Revert on error
      setClasses(previousClasses)
      toast.error("Failed to save")
    }
  }

  async function updateRestrictions(classId: string, restrictions: Restriction[]) {
    // Store previous restrictions for undo
    const classIndex = classes.findIndex((c) => c.id === classId)
    const cls = classes[classIndex]
    const rowNumber = classIndex + 1
    const previousRestrictions = cls?.restrictions || []

    try {
      const res = await fetch(`/api/restrictions/${classId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restrictions }),
      })
      if (res.ok) {
        const updated = await res.json()
        setClasses((prev) =>
          prev.map((c) => (c.id === classId ? { ...c, restrictions: updated } : c))
        )

        // Dismiss previous undo toast
        if (undoToastId.current) toast.dismiss(undoToastId.current)

        // Show undo toast
        const toastId = toast((t) => (
          <div className="flex items-center gap-3">
            <span className="text-sm">Row {rowNumber} restrictions updated</span>
            <button
              onClick={async () => {
                toast.dismiss(t.id)
                undoToastId.current = null
                // Revert to previous restrictions
                const revertRes = await fetch(`/api/restrictions/${classId}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ restrictions: previousRestrictions }),
                })
                if (revertRes.ok) {
                  const reverted = await revertRes.json()
                  setClasses((prev) =>
                    prev.map((c) => (c.id === classId ? { ...c, restrictions: reverted } : c))
                  )
                }
              }}
              className="px-2 py-1 text-sm font-medium text-violet-600 hover:text-violet-800 hover:bg-violet-50 rounded transition-colors"
            >
              Undo
            </button>
          </div>
        ), { duration: 60000, icon: <Check className="h-4 w-4 text-emerald-600" /> })
        undoToastId.current = toastId
      }
    } catch (error) {
      toast.error("Failed to save restrictions")
    }
  }

  async function createClass(data: Partial<ClassEntry>) {
    if (!activeQuarter) return null
    try {
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          quarter_id: activeQuarter.id,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        setClasses((prev) => [...prev, created])

        // Check for potential co-taught situation: other classes with same grade+subject but different teacher
        // that aren't already marked as co-taught
        if (!data.is_cotaught && data.subject_id) {
          const createdGradeIds = data.grade_ids?.length ? [...data.grade_ids].sort() : (data.grade_id ? [data.grade_id] : [])
          const createdGradeKey = createdGradeIds.join(',')

          const matchingClasses = classes.filter(cls => {
            if (cls.is_cotaught) return false // Already co-taught
            if (cls.subject_id !== data.subject_id) return false
            if (cls.teacher_id === data.teacher_id) return false // Same teacher

            const clsGradeIds = cls.grade_ids?.length ? [...cls.grade_ids].sort() : (cls.grade_id ? [cls.grade_id] : [])
            const clsGradeKey = clsGradeIds.join(',')
            return clsGradeKey === createdGradeKey
          })

          if (matchingClasses.length > 0) {
            // Show suggestion dialog with the new class + matching classes
            setCotaughtSuggestionClasses([created, ...matchingClasses])
            setShowCotaughtSuggestion(true)
          }
        }

        return created
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to add class")
      }
    } catch {
      toast.error("Failed to add class")
    }
    return null
  }

  async function markClassesAsCotaught(classIds: string[]) {
    // Update all classes to have is_cotaught = true
    const updates = classIds.map(id =>
      fetch(`/api/classes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_cotaught: true }),
      })
    )

    try {
      await Promise.all(updates)
      // Update local state
      setClasses(prev =>
        prev.map(c => classIds.includes(c.id) ? { ...c, is_cotaught: true } : c)
      )
      toast.success(`Marked ${classIds.length} classes as co-taught`)
    } catch {
      toast.error("Failed to update classes")
    }
  }

  async function deleteClass(id: string) {
    const deletedIndex = classes.findIndex((c) => c.id === id)
    const deletedClass = classes[deletedIndex]
    if (!deletedClass) return

    const rowNumber = deletedIndex + 1
    // Track the ID of the item before this one (if any) for more reliable repositioning
    const previousItemId = deletedIndex > 0 ? classes[deletedIndex - 1].id : null

    // Remove from UI immediately
    setClasses((prev) => prev.filter((c) => c.id !== id))

    // Soft delete immediately (can be undone via restore API)
    try {
      await fetch(`/api/classes/${id}`, { method: "DELETE" })
    } catch (error) {
      // If delete fails, restore the class
      setClasses((prev) => {
        const newClasses = [...prev]
        let insertIndex = deletedIndex
        if (previousItemId) {
          const prevIdx = newClasses.findIndex((c) => c.id === previousItemId)
          if (prevIdx !== -1) {
            insertIndex = prevIdx + 1
          }
        } else {
          insertIndex = 0
        }
        insertIndex = Math.min(insertIndex, newClasses.length)
        newClasses.splice(insertIndex, 0, deletedClass)
        return newClasses
      })
      toast.error("Failed to delete")
      return
    }

    // Dismiss previous undo toast
    if (undoToastId.current) toast.dismiss(undoToastId.current)

    // Show toast with undo - works even after delete because it's a soft delete
    let isRestoring = false
    const toastId = toast((t) => (
      <div className="flex items-center gap-3">
        <span className="text-sm">Row {rowNumber} deleted</span>
        <button
          onClick={async () => {
            // Prevent double-click
            if (isRestoring) return
            isRestoring = true
            // Restore the soft-deleted class
            try {
              await fetch(`/api/classes/${id}/restore`, { method: "POST" })
              // Restore the class at original position in UI
              setClasses((prev) => {
                const newClasses = [...prev]
                // Find position based on previous item, or use original index
                let insertIndex = deletedIndex
                if (previousItemId) {
                  const prevIdx = newClasses.findIndex((c) => c.id === previousItemId)
                  if (prevIdx !== -1) {
                    insertIndex = prevIdx + 1
                  }
                } else {
                  insertIndex = 0 // Was first item
                }
                // Clamp to valid range
                insertIndex = Math.min(insertIndex, newClasses.length)
                newClasses.splice(insertIndex, 0, deletedClass)
                return newClasses
              })
              toast.dismiss(t.id)
              undoToastId.current = null
            } catch (error) {
              toast.error("Failed to restore")
              isRestoring = false
            }
          }}
          className="px-2 py-1 text-sm font-medium text-violet-600 hover:text-violet-800 hover:bg-violet-50 rounded transition-colors"
        >
          Undo
        </button>
      </div>
    ), { duration: 10000, icon: <Check className="h-4 w-4 text-emerald-600" /> })
    undoToastId.current = toastId
  }

  async function createSubject(name: string): Promise<Subject | null> {
    try {
      const res = await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        const subject = await res.json()
        setSubjects((prev) => [...prev, subject].sort((a, b) => a.name.localeCompare(b.name)))
        return subject
      }
    } catch (error) {
      toast.error("Failed to create subject")
    }
    return null
  }

  async function createTeacher(name: string, status: "full-time" | "part-time" = TEACHER_STATUS_FULL_TIME): Promise<Teacher | null> {
    try {
      const res = await fetch("/api/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, status }),
      })
      if (res.ok) {
        const teacher = await res.json()
        setTeachers((prev) => [...prev, teacher].sort((a, b) => a.name.localeCompare(b.name)))
        return teacher
      }
    } catch (error) {
      toast.error("Failed to create teacher")
    }
    return null
  }

  // Day name normalization for parsing restrictions
  const DAY_MAP: Record<string, string> = {
    'Mon': 'Mon', 'Monday': 'Mon',
    'Tues': 'Tues', 'Tuesday': 'Tues',
    'Wed': 'Wed', 'Wednesday': 'Wed',
    'Thurs': 'Thurs', 'Thursday': 'Thurs',
    'Fri': 'Fri', 'Friday': 'Fri',
  }

  function parseRestrictions(restrictionStr: string, onInvalidBlock?: (block: number) => void): Restriction[] {
    if (!restrictionStr?.trim()) return []

    // Accept block numbers within the quarter's template (e.g. 1-9 under the 9-block format)
    const validBlocks = getTemplateBlocks(timetableTemplate)
    const restrictions: Restriction[] = []
    const str = restrictionStr.trim()

    // Check if it's just days (e.g., "Tues, Wed" or "Mon, Tues, Wed")
    const dayOnlyPattern = /^([A-Za-z]+(?:day)?(?:\s*,\s*[A-Za-z]+(?:day)?)*)$/
    const dayOnlyMatch = str.match(dayOnlyPattern)

    if (dayOnlyMatch && !str.includes('Block')) {
      const availableDays = str.split(/\s*,\s*/).map(d => DAY_MAP[d.trim()] || d.trim()).filter(Boolean)
      if (availableDays.length > 0) {
        restrictions.push({ restriction_type: 'available_days', value: availableDays })
      }
      return restrictions
    }

    // Parse fixed slots and block ranges
    const parts = str.split(/\s*,\s*/)
    let availableDays: string[] = []
    let availableBlocks: number[] = []

    for (const part of parts) {
      // Check for block range like "Tues Block 3-5" or "Thurs 3-5"
      const rangeMatch = part.match(/([A-Za-z]+(?:day)?)\s*(?:Block\s*)?(\d+)\s*-\s*(\d+)/i)
      if (rangeMatch) {
        const day = DAY_MAP[rangeMatch[1]] || rangeMatch[1]
        const startBlock = parseInt(rangeMatch[2])
        const endBlock = parseInt(rangeMatch[3])
        if (!availableDays.includes(day)) availableDays.push(day)
        for (let b = startBlock; b <= endBlock; b++) {
          if (!validBlocks.includes(b)) {
            onInvalidBlock?.(b)
            continue
          }
          if (!availableBlocks.includes(b)) availableBlocks.push(b)
        }
        continue
      }

      // Check for single fixed slot like "Mon Block 5" or "Fri Block 1"
      const fixedMatch = part.match(/([A-Za-z]+(?:day)?)\s*Block\s*(\d+)/i)
      if (fixedMatch) {
        const day = DAY_MAP[fixedMatch[1]] || fixedMatch[1]
        const block = parseInt(fixedMatch[2])
        if (validBlocks.includes(block)) {
          restrictions.push({ restriction_type: 'fixed_slot', value: { day, block } })
        } else {
          onInvalidBlock?.(block)
        }
      }
    }

    if (availableDays.length > 0) {
      restrictions.push({ restriction_type: 'available_days', value: availableDays })
    }
    if (availableBlocks.length > 0) {
      restrictions.push({ restriction_type: 'available_blocks', value: availableBlocks })
    }

    return restrictions
  }

  function formatRestrictionsForExport(restrictions: Restriction[]): string {
    const parts: string[] = []

    // Fixed slots
    const fixedSlots = restrictions.filter(r => r.restriction_type === 'fixed_slot')
    for (const r of fixedSlots) {
      const slot = r.value as { day: string; block: number }
      parts.push(`${slot.day} Block ${slot.block}`)
    }

    // Available days (if no fixed slots)
    if (fixedSlots.length === 0) {
      const availDays = restrictions.find(r => r.restriction_type === 'available_days')
      if (availDays) {
        const days = availDays.value as string[]
        // Check for available blocks too
        const availBlocks = restrictions.find(r => r.restriction_type === 'available_blocks')
        if (availBlocks) {
          const blocks = availBlocks.value as number[]
          const minBlock = Math.min(...blocks)
          const maxBlock = Math.max(...blocks)
          for (const day of days) {
            parts.push(`${day} Block ${minBlock}-${maxBlock}`)
          }
        } else {
          parts.push(days.join(', '))
        }
      }
    }

    return parts.join(', ')
  }

  function handleImport() {
    if (!importText.trim() || !activeQuarter) return

    // Fail closed: restriction block numbers are validated against the
    // quarter's block format. Importing before the template loads would
    // silently validate against the legacy 5-block list and drop e.g. Block 9.
    if (!timetableTemplate) {
      toast.error("The quarter's block format hasn't finished loading — wait a moment and try importing again.")
      return
    }

    const lines = importText.trim().split('\n')
    let startIndex = 0

    // Check if first line is headers
    const firstLine = lines[0].toLowerCase()
    if (firstLine.includes('teacher') && firstLine.includes('grade') && firstLine.includes('subject')) {
      startIndex = 1
    }

    // Parse all rows first for validation
    const parsedRows: Array<{
      line: number
      teacherName: string
      gradeStr: string
      subjectName: string
      daysPerWeek: number
      restrictionStr: string
      gradeIds: string[]
      isElective: boolean
      detectedElective: boolean
      isCotaught: boolean
      isDouble: boolean
    }> = []
    const validationErrors: string[] = []

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Column 6 (Double) is optional — legacy 5-column sheets parse identically
      const [teacherName, gradeStr, subjectName, daysStr, restrictionStr, doubleStr] = line.split('\t')
      const lineNum = i + 1

      if (!teacherName || !gradeStr || !subjectName) {
        validationErrors.push(`Line ${lineNum}: Missing teacher, grade, or subject`)
        continue
      }

      // Validate restriction block numbers against the quarter's format now,
      // as a hard error — never silently drop a pinned slot.
      if (restrictionStr?.trim()) {
        const invalidBlocks: number[] = []
        parseRestrictions(restrictionStr, (b) => invalidBlocks.push(b))
        if (invalidBlocks.length > 0) {
          validationErrors.push(
            `Line ${lineNum}: Block${invalidBlocks.length > 1 ? 's' : ''} ${[...new Set(invalidBlocks)].join(', ')} ` +
            `not in this quarter's block format (valid: ${getTemplateBlocks(timetableTemplate).join(', ')})`
          )
          continue
        }
      }

      // Parse grade string - supports:
      // - Single: "Kindergarten", "1st Grade", "1st", "6th Grade Elective"
      // - Range: "1st-3rd", "1st-3rd Grades", "6th-11th Elective", "K-3rd Grades"
      const isElective = gradeStr.toLowerCase().includes('elective')

      // Strip "Elective" and "Grades" suffixes for parsing
      const gradeClean = gradeStr
        .replace(/\s*elective\s*/gi, '')
        .replace(/\s*grades\s*/gi, '')
        .replace(/\s*grade\s*/gi, '')
        .trim()

      let gradeIds: string[] = []

      // Helper to match grade string to grade object
      const matchGrade = (str: string) => {
        const s = str.toLowerCase()
        // Check for Pre-K variants
        if (s === 'prek' || s === 'pre-k' || s === 'pre-kindergarten' || s === 'prekindergarten') {
          return grades.find(g =>
            g.name.toLowerCase().includes('pre-k') ||
            g.name.toLowerCase().includes('prek') ||
            g.name.toLowerCase() === 'pre-kindergarten'
          )
        }
        // Check for Kindergarten variants
        if (s === 'k' || s === 'kinder') {
          return grades.find(g => g.name.toLowerCase() === 'kindergarten')
        }
        // Standard matching - prefix match on name or display_name
        return grades.find(g =>
          g.name.toLowerCase().startsWith(s) ||
          g.display_name.toLowerCase().startsWith(s)
        )
      }

      // Check for range pattern like "1st-3rd" or "K-3rd"
      const rangeMatch = gradeClean.match(/^(\S+)\s*-\s*(\S+)$/)
      if (rangeMatch) {
        const [, startStr, endStr] = rangeMatch

        // Find start and end grades
        const startGrade = matchGrade(startStr)
        const endGrade = matchGrade(endStr)

        if (startGrade && endGrade) {
          // Get all grades within the sort_order range
          const minOrder = Math.min(startGrade.sort_order, endGrade.sort_order)
          const maxOrder = Math.max(startGrade.sort_order, endGrade.sort_order)
          gradeIds = grades
            .filter(g => g.sort_order >= minOrder && g.sort_order <= maxOrder)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(g => g.id)
        }
      } else {
        // Single grade - try exact match first, then use helper
        const exactMatch = grades.find(g =>
          g.display_name.toLowerCase() === gradeStr.replace(/\s*elective\s*/gi, '').trim().toLowerCase()
        )
        const grade = exactMatch || matchGrade(gradeClean)
        if (grade) {
          gradeIds = [grade.id]
        }
      }

      if (gradeIds.length === 0) {
        validationErrors.push(`Line ${lineNum}: Grade not found: "${gradeStr}"`)
        continue
      }

      const daysPerWeek = parseInt(daysStr) || 1
      if (daysPerWeek < 1 || daysPerWeek > 10) {
        validationErrors.push(`Line ${lineNum}: Blocks/Week must be between 1 and 10 (got ${daysPerWeek})`)
        continue
      }

      // Double column: "2x"/"2×"/"yes"/"true" (case-insensitive) = on; blank/anything else = off
      const isDouble = /^(2x|2×|yes|true)$/i.test((doubleStr || '').trim())

      parsedRows.push({
        line: lineNum,
        teacherName,
        gradeStr,
        subjectName,
        daysPerWeek,
        restrictionStr: restrictionStr || '',
        gradeIds,
        isElective,
        detectedElective: isElective,
        isCotaught: false, // Will be set below
        isDouble,
      })
    }

    // If there are validation errors, stop and show them
    if (validationErrors.length > 0) {
      toast.error(`Validation failed with ${validationErrors.length} errors:\n${validationErrors.slice(0, 5).join('\n')}${validationErrors.length > 5 ? `\n...and ${validationErrors.length - 5} more` : ''}`)
      return
    }

    // Detect co-taught classes: same grade+subject with different teachers
    const gradeSubjectMap = new Map<string, number[]>()
    parsedRows.forEach((row, index) => {
      const key = `${row.gradeIds.sort().join(',')}|${row.subjectName.toLowerCase()}`
      const existing = gradeSubjectMap.get(key) || []
      existing.push(index)
      gradeSubjectMap.set(key, existing)
    })

    // Mark classes as co-taught if multiple teachers teach same grade+subject
    const detectedCotaughtGroups = new Map<string, number[]>()
    gradeSubjectMap.forEach((indices, key) => {
      if (indices.length > 1) {
        // Check if they have different teachers
        const teacherNames = new Set(indices.map(i => parsedRows[i].teacherName.toLowerCase()))
        if (teacherNames.size > 1) {
          indices.forEach(i => {
            parsedRows[i].isCotaught = true
          })
          detectedCotaughtGroups.set(key, indices)
        }
      }
    })

    // Store parsed data and show confirmation step
    setPendingImport(parsedRows)
    setImportCotaughtGroups(detectedCotaughtGroups)
    setImportStep('confirm')
  }

  async function handleConfirmImport() {
    if (!activeQuarter || pendingImport.length === 0) return

    setImporting(true)
    setTableLocked(true)
    setLockReason('import')
    setShowImportDialog(false)
    const loadingToastId = toast.loading(`Importing ${pendingImport.length} classes...`)

    // If replaceAll is checked, delete all existing classes first
    if (replaceAll && classes.length > 0) {
      try {
        toast.loading('Deleting existing classes...', { id: loadingToastId })
        const res = await fetch(`/api/classes?quarter_id=${activeQuarter.id}`, {
          method: "DELETE",
        })
        if (!res.ok) {
          setImporting(false)
          toast.error("Failed to delete existing classes", { id: loadingToastId })
          return
        }
      } catch {
        setImporting(false)
        toast.error("Failed to delete existing classes", { id: loadingToastId })
        return
      }
    }

    // Now import all validated rows
    let created = 0
    let errors = 0
    const total = pendingImport.length

    // Track created teachers/subjects to avoid duplicates within import
    const createdTeachers = new Map<string, Teacher>()
    const createdSubjects = new Map<string, Subject>()

    for (let i = 0; i < pendingImport.length; i++) {
      const row = pendingImport[i]
      toast.loading(`Importing classes... ${i + 1}/${total}`, { id: loadingToastId })
      // Find or create teacher
      let teacher: Teacher | null | undefined = teachers.find(t => t.name.toLowerCase() === row.teacherName.toLowerCase())
        || createdTeachers.get(row.teacherName.toLowerCase())
      if (!teacher) {
        teacher = await createTeacher(row.teacherName)
        if (teacher) {
          createdTeachers.set(row.teacherName.toLowerCase(), teacher)
        } else {
          errors++
          continue
        }
      }

      // Find or create subject
      let subject: Subject | null | undefined = subjects.find(s => s.name.toLowerCase() === row.subjectName.toLowerCase())
        || createdSubjects.get(row.subjectName.toLowerCase())
      if (!subject) {
        subject = await createSubject(row.subjectName)
        if (subject) {
          createdSubjects.set(row.subjectName.toLowerCase(), subject)
        } else {
          errors++
          continue
        }
      }

      // Create class - use gradeIds for multi-grade class support
      const classData = {
        quarter_id: activeQuarter.id,
        teacher_id: teacher.id,
        grade_id: row.gradeIds[0],  // First grade for backward compatibility
        grade_ids: row.gradeIds,     // All individual grade IDs
        subject_id: subject.id,
        days_per_week: row.daysPerWeek,
        is_elective: row.isElective,
        is_cotaught: row.isCotaught,
        double_periods: row.isDouble,
      }

      try {
        const res = await fetch("/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(classData),
        })

        if (res.ok) {
          const newClass = await res.json()

          // Add restrictions if any
          const restrictions = parseRestrictions(row.restrictionStr)
          if (restrictions.length > 0) {
            await fetch(`/api/restrictions/${newClass.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ restrictions }),
            })
          }

          created++
        } else {
          errors++
        }
      } catch {
        errors++
      }
    }

    // Store old data for undo before reloading
    const oldClasses = [...classes]

    // Reload data
    await loadData()

    // Dismiss loading toast
    toast.dismiss(loadingToastId)

    setImporting(false)
    setImportText("")
    setReplaceAll(true)
    setImportStep('input')
    setPendingImport([])

    // Always unlock table after successful import (loadData may have re-locked it)
    setTableLocked(false)
    setLockReason(null)

    if (created > 0) {

      // Dismiss any previous undo toast
      if (undoToastId.current) {
        toast.dismiss(undoToastId.current)
      }

      // Store for undo
      setUndoImportData(oldClasses)

      // Show success toast with undo option
      const toastId = toast(
        (t) => (
          <div className="flex items-center gap-3">
            <span className="text-sm">
              Imported {created} classes{errors > 0 ? ` (${errors} errors)` : ''}
            </span>
            <button
              onClick={() => {
                toast.dismiss(t.id)
                undoToastId.current = null
                handleUndoImport(oldClasses)
              }}
              className="px-2 py-1 text-sm font-medium text-violet-600 hover:text-violet-800 hover:bg-violet-50 rounded transition-colors"
            >
              Undo
            </button>
          </div>
        ),
        { duration: 60000, icon: <Check className="h-4 w-4 text-emerald-600" /> }
      )
      undoToastId.current = toastId
    } else if (errors > 0) {
      toast.error(`Import failed with ${errors} errors`)
    }
  }

  async function handleUndoImport(oldClasses: ClassEntry[]) {
    if (!activeQuarter) return

    const undoToast = toast.loading('Restoring previous classes...')

    try {
      // Delete all current classes for the quarter
      const deleteRes = await fetch(`/api/classes?quarter_id=${activeQuarter.id}`, {
        method: "DELETE",
      })

      if (!deleteRes.ok) {
        toast.error('Failed to undo import', { id: undoToast })
        return
      }

      // Recreate all old classes
      let restored = 0
      for (const cls of oldClasses) {
        const classData = {
          quarter_id: activeQuarter.id,
          teacher_id: cls.teacher_id,
          grade_id: cls.grade_id,
          grade_ids: cls.grade_ids,
          subject_id: cls.subject_id,
          days_per_week: cls.days_per_week,
          is_elective: cls.is_elective,
          double_periods: cls.double_periods === true,
        }

        const res = await fetch("/api/classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(classData),
        })

        if (res.ok) {
          const newClass = await res.json()

          // Restore restrictions if any
          if (cls.restrictions && cls.restrictions.length > 0) {
            await fetch(`/api/restrictions/${newClass.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ restrictions: cls.restrictions }),
            })
          }
          restored++
        }
      }

      // Reload data
      await loadData()
      setUndoImportData(null)

      toast.success(`Restored ${restored} classes`, { id: undoToast })
    } catch (error) {
      toast.error('Failed to undo import', { id: undoToast })
    }
  }

  async function loadHistoryForImport() {
    setLoadingHistory(true)
    try {
      // Fetch history - already ordered by starred first, then by date
      const res = await fetch('/api/history?limit=20')
      if (res.ok) {
        const data = await res.json()
        // Filter to only items that have classes_snapshot
        // Need to fetch full data for each to get stats
        const starred: typeof historyItems = []
        const unstarred: typeof historyItems = []

        for (const item of data) {
          // Limit: all starred + max 3 unstarred
          if (!item.is_starred && unstarred.length >= 3) continue

          const detailRes = await fetch(`/api/history/${item.id}`)
          if (detailRes.ok) {
            const detail = await detailRes.json()
            if (detail.stats?.classes_snapshot?.length > 0) {
              const itemWithStats = { ...item, stats: detail.stats }
              if (item.is_starred) {
                starred.push(itemWithStats)
              } else {
                unstarred.push(itemWithStats)
              }
            }
          }
        }
        setHistoryItems([...starred, ...unstarred])
      }
    } catch (error) {
      toast.error('Failed to load history')
    } finally {
      setLoadingHistory(false)
    }
  }

  async function handleImportFromHistory(historyId: string, replace: boolean) {
    const historyItem = historyItems.find(h => h.id === historyId)
    if (!historyItem?.stats?.classes_snapshot) {
      toast.error('No class data found in this schedule')
      return
    }

    // Close modal and show loading toast
    setShowImportFromHistoryDialog(false)
    setImporting(true)
    const loadingToastId = toast.loading('Importing classes...')

    const oldClasses = [...classes]
    const snapshot = historyItem.stats.classes_snapshot as Array<{
      teacher_id?: string
      teacher_name?: string
      grade_id?: string
      grade_ids?: string[]
      // Full grades array with id, name, display_name for fallback matching
      grades?: Array<{ id: string; name: string; display_name: string }>
      subject_id?: string
      subject_name?: string
      days_per_week: number
      is_elective?: boolean
      is_cotaught?: boolean
      double_periods?: boolean
      restrictions?: Array<{ restriction_type: string; value: unknown }>
    }>

    const total = snapshot.length

    try {
      // Delete existing classes if replacing (use bulk delete)
      if (replace && classes.length > 0) {
        toast.loading('Deleting existing classes...', { id: loadingToastId })
        await fetch(`/api/classes?quarter_id=${activeQuarter?.id}`, { method: 'DELETE' })
        toast.loading('Importing classes...', { id: loadingToastId })
      }

      let created = 0
      let incomplete = 0

      // Track missing items grouped by type
      const missingTeachers = new Map<string, string[]>() // teacher name -> array of "Grade - Subject"
      const missingGrades: string[] = []
      const missingSubjects: string[] = []

      for (let i = 0; i < snapshot.length; i++) {
        const cls = snapshot[i]
        // Update progress immediately
        toast.loading(`Importing classes... ${i + 1}/${total}`, { id: loadingToastId })

        // Build class context for warning messages using grades array if available
        const snapshotGradeNames = cls.grades?.map(g => g.display_name).join(', ')
        const gradeContext = snapshotGradeNames || 'Unknown Grade'
        const subjectContext = cls.subject_name || 'Unknown Subject'
        const teacherContext = cls.teacher_name || 'Unknown Teacher'
        const classContext = `${gradeContext} - ${subjectContext}`

        // Find teacher by name (null if not found)
        const teacher = teachers.find(t => t.name === cls.teacher_name)
        if (!teacher && cls.teacher_name) {
          const existing = missingTeachers.get(cls.teacher_name) || []
          existing.push(classContext)
          missingTeachers.set(cls.teacher_name, existing)
        }

        // Find subject by name (or create it, null if fails)
        let subject = subjects.find(s => s.name === cls.subject_name)
        if (!subject && cls.subject_name) {
          const subjectRes = await fetch('/api/subjects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: cls.subject_name })
          })
          if (subjectRes.ok) {
            subject = await subjectRes.json()
            setSubjects(prev => [...prev, subject!])
          } else {
            missingSubjects.push(`Subject "${cls.subject_name}" for ${teacherContext} - ${gradeContext}`)
          }
        }

        // Find grades - try UUID first, then name-based fallback
        let gradeId: string | null = null
        let gradeIds: string[] | null = null

        // Strategy 1: Match by UUID from grade_ids array
        if (cls.grade_ids && cls.grade_ids.length > 0) {
          const matchedGrades: string[] = []
          for (const gid of cls.grade_ids) {
            const found = grades.find(gr => gr.id === gid)
            if (found) {
              matchedGrades.push(found.id)
            }
          }
          if (matchedGrades.length > 0) {
            gradeId = matchedGrades[0]
            gradeIds = matchedGrades
          }
        }

        // Strategy 2: If UUID match failed but we have grades array with names, match by name
        if (!gradeIds && cls.grades && cls.grades.length > 0) {
          const matchedGrades: string[] = []
          for (const snapshotGrade of cls.grades) {
            // Match by display_name or name
            const found = grades.find(gr =>
              gr.display_name === snapshotGrade.display_name ||
              gr.name === snapshotGrade.name
            )
            if (found) {
              matchedGrades.push(found.id)
            }
          }
          if (matchedGrades.length > 0) {
            gradeId = matchedGrades[0]
            gradeIds = matchedGrades
          } else {
            missingGrades.push(`Grades "${snapshotGradeNames}" for ${teacherContext} - ${subjectContext}`)
          }
        }

        // Strategy 3: Fallback to single grade_id
        if (!gradeIds && cls.grade_id) {
          const found = grades.find(gr => gr.id === cls.grade_id)
          if (found) {
            gradeId = found.id
            gradeIds = [found.id]
          } else {
            missingGrades.push(`Grade for ${teacherContext} - ${subjectContext}`)
          }
        }

        if (!gradeId && !gradeIds) {
          missingGrades.push(`No grade data for ${teacherContext} - ${subjectContext}`)
        }

        // Track if this class is incomplete
        const isIncomplete = !teacher || !subject || !gradeId
        if (isIncomplete) incomplete++

        // Create the class (with null for missing fields)
        const classRes = await fetch('/api/classes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teacher_id: teacher?.id || null,
            grade_id: gradeId,
            grade_ids: gradeIds,
            subject_id: subject?.id || null,
            quarter_id: activeQuarter?.id,
            days_per_week: cls.days_per_week,
            is_elective: cls.is_elective || false,
            is_cotaught: cls.is_cotaught || false,
            double_periods: cls.double_periods === true,
            restrictions: cls.restrictions || []
          })
        })

        if (classRes.ok) {
          created++
        }
      }

      // Reload data
      await loadData()
      setImporting(false)
      toast.dismiss(loadingToastId)

      // Always unlock table after successful import (loadData may have re-locked it)
      setTableLocked(false)
      setLockReason(null)

      if (created > 0) {
        // Dismiss any previous undo toast
        if (undoToastId.current) {
          toast.dismiss(undoToastId.current)
        }

        setUndoImportData(oldClasses)

        // Build warnings for display in notice banner
        const warnings: string[] = []

        // Add teacher warnings (one line per teacher with their classes)
        for (const [teacherName, classList] of missingTeachers) {
          warnings.push(`Teacher "${teacherName}": ${classList.join(', ')}`)
        }

        // Add grade warnings
        warnings.push(...missingGrades)

        // Add subject warnings
        warnings.push(...missingSubjects)

        if (warnings.length > 0) {
          setImportWarnings(warnings)
          console.warn('Missing data:', warnings)
        }

        const toastId = toast(
          (t) => (
            <div className="flex items-center gap-3">
              <span className="text-sm">
                Imported {created} classes{incomplete > 0 ? ` (${incomplete} need attention)` : ''}
              </span>
              <button
                onClick={() => {
                  toast.dismiss(t.id)
                  undoToastId.current = null
                  handleUndoImport(oldClasses)
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
      } else {
        toast.error('Import failed - no classes created')
      }
    } catch (error) {
      console.error('Import from history error:', error)
      toast.dismiss(loadingToastId)
      toast.error('Failed to import from history')
      setImporting(false)
    }
  }

  function getGradeDisplayForExport(cls: ClassEntry): string {
    const gradeIds = cls.grade_ids?.length ? cls.grade_ids : (cls.grade_id ? [cls.grade_id] : [])
    const gradeObjects = gradeIds
      .map(id => grades.find(g => g.id === id))
      .filter((g): g is Grade => Boolean(g))
      .sort((a, b) => a.sort_order - b.sort_order)

    let display = ''

    if (gradeObjects.length === 0) {
      display = cls.grade?.display_name || ''
    } else if (gradeObjects.length === 1) {
      display = gradeObjects[0].display_name
    } else {
      // Multi-grade: show range like "1st-3rd Grades"
      const first = gradeObjects[0].name.replace(' Grade', '')
      const last = gradeObjects[gradeObjects.length - 1].name.replace(' Grade', '')
      display = `${first}-${last} Grades`
    }

    // Append "Elective" suffix if applicable
    return cls.is_elective ? `${display} Elective` : display
  }

  function generateExportData(): string[] {
    const lines: string[] = []

    // Header — Double is the optional 6th column (round-trips through paste import)
    lines.push(['Teacher', 'Grade', 'Subject', 'Blocks/Week', 'Restrictions', 'Double'].join('\t'))

    // Sort classes by teacher name, then grade (incomplete classes first)
    const sortedClasses = [...classes].sort((a, b) => {
      const aName = a.teacher?.name || ''
      const bName = b.teacher?.name || ''
      if (!aName && bName) return -1
      if (aName && !bName) return 1
      const teacherCompare = aName.localeCompare(bName)
      if (teacherCompare !== 0) return teacherCompare
      return (a.grade?.sort_order || 0) - (b.grade?.sort_order || 0)
    })

    for (const cls of sortedClasses) {
      const teacher = cls.teacher?.name || '(no teacher)'
      const grade = getGradeDisplayForExport(cls) || '(no grade)'
      const subject = cls.subject?.name || '(no subject)'
      const daysPerWeek = cls.days_per_week.toString()
      const restrictions = formatRestrictionsForExport(cls.restrictions || [])
      const double = cls.double_periods === true ? '2x' : ''

      lines.push([teacher, grade, subject, daysPerWeek, restrictions, double].join('\t'))
    }

    return lines
  }

  function handleExport() {
    setShowExportDialog(true)
  }

  function handleCopyToClipboard() {
    const lines = generateExportData()
    const text = lines.join('\n')

    navigator.clipboard.writeText(text).then(() => {
      toast.success(`Copied ${classes.length} classes to clipboard`)
      setShowExportDialog(false)
    }).catch(() => {
      // Fallback: create a textarea and select it
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      toast.success(`Copied ${classes.length} classes to clipboard`)
      setShowExportDialog(false)
    })
  }

  function handleDownloadCSV() {
    const lines = generateExportData()
    // Convert tabs to commas for CSV, and escape fields with commas
    const csvLines = lines.map(line => {
      const fields = line.split('\t')
      return fields.map(field => {
        // Escape fields that contain commas, quotes, or newlines
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
          return `"${field.replace(/"/g, '""')}"`
        }
        return field
      }).join(',')
    })

    const csvContent = csvLines.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const quarterName = activeQuarter?.name.replace(/\s+/g, '-') || 'classes'
    link.download = `${quarterName}-classes.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast.success(`Downloaded ${classes.length} classes as CSV`)
    setShowExportDialog(false)
  }

  if (loading || quartersLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!activeQuarter) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <LocalQuarterSelector
            quarters={quarters}
            selectedQuarter={null}
            onSelectQuarter={setSelectedQuarterId}
            onQuarterCreated={refetchQuarters}
          />
          {quartersError && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchQuarters()}
              className="text-red-600 border-red-300 hover:bg-red-50"
            >
              Retry
            </Button>
          )}
        </div>
        {quartersError ? (
          <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="font-medium">Failed to load quarters</p>
            <p className="text-sm text-red-500 mt-1">{quartersError}</p>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Select or create a quarter to get started.
          </p>
        )}
      </div>
    )
  }

  function scrollToBottom() {
    const table = document.querySelector('tbody')
    if (table) {
      const lastRow = table.lastElementChild
      lastRow?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  // Check if lastRun is for the current quarter
  const showLastRunNotice = lastRun && activeQuarter && lastRun.quarterId === activeQuarter.id

  // Count incomplete classes (missing teacher, grade, or subject)
  const incompleteCount = classes.filter(c => !c.teacher_id || !c.grade_id || !c.subject_id).length

  // Group classes by grade-set + subject for co-taught detection
  const gradeSetSubjectTeachers = new Map<string, {
    classIds: string[],
    teachers: Set<string>,
    gradeIds: string[],
    subjectId: string
  }>()

  for (const cls of classes) {
    if (!cls.grade_id && !cls.grade_ids?.length) continue
    if (!cls.subject_id) continue

    const gradeIds = cls.grade_ids?.length ? [...cls.grade_ids].sort() : [cls.grade_id]
    const key = `${gradeIds.join(',')}:${cls.subject_id}`

    if (!gradeSetSubjectTeachers.has(key)) {
      gradeSetSubjectTeachers.set(key, {
        classIds: [],
        teachers: new Set(),
        gradeIds: gradeIds.filter((id): id is string => Boolean(id)),
        subjectId: cls.subject_id
      })
    }
    const entry = gradeSetSubjectTeachers.get(key)!
    entry.classIds.push(cls.id)
    if (cls.teacher_id) entry.teachers.add(cls.teacher_id)
  }

  // Build co-taught display groups using shared helper
  const cotaughtGroups = buildCotaughtGroups(classes.filter(c => c.teacher_id && c.subject_id).map(cls => {
    const gradeIds = cls.grade_ids?.length ? [...cls.grade_ids].sort() : (cls.grade_id ? [cls.grade_id] : [])
    const gradeObjects = gradeIds
      .map(gid => grades.find(g => g.id === gid))
      .filter((g): g is Grade => Boolean(g))
      .sort((a, b) => a.sort_order - b.sort_order)

    let gradeDisplay = ''
    if (gradeObjects.length === 1) {
      gradeDisplay = gradeObjects[0].display_name
    } else if (gradeObjects.length > 1) {
      const first = gradeObjects[0].display_name.replace(' Grade', '')
      const last = gradeObjects[gradeObjects.length - 1].display_name.replace(' Grade', '')
      gradeDisplay = `${first}-${last} Grades`
    }

    const teacher = teachers.find((t: Teacher) => t.id === cls.teacher_id)
    const subject = subjects.find(s => s.id === cls.subject_id)

    return {
      teacherName: teacher?.name || 'Unknown',
      gradeKey: gradeIds.join(','),
      gradeDisplay,
      subjectKey: cls.subject_id || '',
      subjectName: subject?.name || '',
      isCotaught: cls.is_cotaught || false,
    }
  }))

  // Build per-class map of potential co-taught teacher names (for GradeSelector)
  // Shows OTHER teachers with same grade+subject (different teacher_id)
  // This enables the co-taught checkbox when there's a matching class
  const cotaughtTeacherNames = new Map<string, string[]>()

  // Group ALL classes by grade+subject (not just is_cotaught=true)
  const gradeSubjectGroups = new Map<string, ClassEntry[]>()
  for (const cls of classes) {
    if (!cls.subject_id || !cls.teacher_id) continue
    const gradeIds = cls.grade_ids?.length ? [...cls.grade_ids].sort() : (cls.grade_id ? [cls.grade_id] : [])
    const key = `${gradeIds.join(',')}_${cls.subject_id}`
    if (!gradeSubjectGroups.has(key)) {
      gradeSubjectGroups.set(key, [])
    }
    gradeSubjectGroups.get(key)!.push(cls)
  }

  // For each group with multiple teachers, build the potential co-taught teacher names
  for (const groupClasses of gradeSubjectGroups.values()) {
    // Only show if there are multiple different teachers for same grade+subject
    const uniqueTeachers = new Set(groupClasses.map(c => c.teacher_id))
    if (uniqueTeachers.size > 1) {
      for (const cls of groupClasses) {
        const otherNames = groupClasses
          .filter(c => c.id !== cls.id && c.teacher && c.teacher_id !== cls.teacher_id)
          .map(c => {
            const name = c.teacher?.name || 'Unknown'
            return c.teacher_deleted ? `${name} (archived)` : name
          })
          // Remove duplicates (if same teacher teaches multiple sections)
          .filter((name, index, self) => self.indexOf(name) === index)
        if (otherNames.length > 0) {
          cotaughtTeacherNames.set(cls.id, otherNames)
        }
      }
    }
  }

  // Build maps for grade lookups
  const gradeNameToDisplay = new Map<string, string>()
  for (const g of grades) {
    gradeNameToDisplay.set(g.name, g.display_name)
  }

  // Blocks defined by this quarter's timetable template (legacy quarters resolve to 1-5)
  const templateBlocks = getTemplateBlocks(timetableTemplate)
  const teachableBlocksByGrade = new Map<string, number[]>()
  for (const g of grades) {
    teachableBlocksByGrade.set(g.id, getTeachableBlocksForGrade(timetableTemplate, g.id))
  }

  // Blocks a class can never occupy — any block that isn't teachable for one of its
  // grades (e.g. that band's lunch block under the 9-block format)
  function lunchBlocksForClass(cls: ClassEntry): number[] {
    const gradeIds = cls.grade_ids?.length ? cls.grade_ids : (cls.grade_id ? [cls.grade_id] : [])
    if (gradeIds.length === 0) return []
    return templateBlocks.filter(b =>
      gradeIds.some(gid => !(teachableBlocksByGrade.get(gid) ?? templateBlocks).includes(b))
    )
  }

  // Calculate grade capacity using shared helper
  const blockCountClasses: import('@/lib/schedule-utils').BlockCountClass[] = []
  for (const cls of classes) {
    const classGrades = cls.grades?.length
      ? cls.grades
      : [cls.grade].filter(Boolean)

    const fixedSlots = cls.restrictions
      ?.filter(r => r.restriction_type === 'fixed_slot')
      .map(r => r.value as { day: string; block: number }) || []

    for (const grade of classGrades) {
      if (!grade) continue
      blockCountClasses.push({
        gradeKey: grade.display_name,
        subjectKey: cls.subject_id,
        daysPerWeek: cls.days_per_week,
        isElective: cls.is_elective || false,
        isCotaught: cls.is_cotaught || false,
        fixedSlots,
      })
    }
  }
  const gradeCapacity = calculateGradeBlocks(blockCountClasses)

  // Add 1 for study hall for grades 6-11
  for (const gradeName of studyHallGrades) {
    gradeCapacity.set(gradeName, (gradeCapacity.get(gradeName) || 0) + 1)
  }

  // Sort grades for display (exclude electives from capacity display)
  const sortedGrades = grades
    .filter(g => !g.display_name.includes('Elective'))
    .sort((a, b) => a.sort_order - b.sort_order)

  const fromSchedule = searchParams.get('from') === 'schedule'

  return (
    <div className="p-6 max-w-6xl mx-auto h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
      {/* Page title with quarter context */}
      <div className="flex items-center gap-3 mb-3">
        <h1 className="text-lg font-semibold">Class Setup</h1>
        {activeQuarter && (
          <span className="text-lg text-muted-foreground font-normal">— {activeQuarter.name}</span>
        )}
      </div>
      {/* Header with Quarter Selector and Generate Button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <LocalQuarterSelector
            quarters={quarters}
            selectedQuarter={activeQuarter}
            onSelectQuarter={setSelectedQuarterId}
            onQuarterCreated={refetchQuarters}
          />
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <span>{classes.length} classes</span>
            {incompleteCount > 0 && (
              <span className="text-amber-600 font-medium">
                ({incompleteCount} incomplete)
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowAddClassModal(true)}
            className="gap-2 h-9"
          >
            <Plus className="h-4 w-4" />
            Add Class
          </Button>
          {!fromSchedule && (
            <Button
              variant={showLastRunNotice ? "outline" : "default"}
              onClick={() => {
                if (classes.length === 0) {
                  toast.error("No classes configured for this quarter. Add classes first.")
                  return
                }
                if (incompleteCount > 0) {
                  toast.error(`${incompleteCount} class${incompleteCount > 1 ? 'es are' : ' is'} incomplete`)
                  return
                }
                setShowGenerateModal(true)
              }}
              disabled={incompleteCount > 0 || classes.length === 0}
              className={cn("gap-2 h-9", !showLastRunNotice && "bg-emerald-500 hover:bg-emerald-600 text-white disabled:bg-slate-300")}
            >
              <Play className="h-4 w-4" />
              {showLastRunNotice ? "Generate New" : "Generate Schedule"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-9 w-9 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  if (classes.length === 0) {
                    toast.error("No classes configured for this quarter. Add classes first.")
                    return
                  }
                  if (incompleteCount > 0) {
                    toast.error(`${incompleteCount} class${incompleteCount > 1 ? 'es are' : ' is'} incomplete`)
                    return
                  }
                  setShowGenerateModal(true)
                }}
                disabled={incompleteCount > 0 || classes.length === 0}
              >
                <Play className="h-4 w-4 mr-2" />
                Generate Schedule
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                setShowImportFromHistoryDialog(true)
                loadHistoryForImport()
              }}>
                <History className="h-4 w-4 mr-2" />
                Import from Schedule
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowImportDialog(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Import from Text
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                fetchDeletedClasses()
                setShowDeletedDialog(true)
              }}>
                <Trash2 className="h-4 w-4 mr-2" />
                Recently Deleted
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Generate Modal */}
      <GenerateModal
        open={showGenerateModal}
        onOpenChange={setShowGenerateModal}
        quarterId={activeQuarter.id}
        quarterName={activeQuarter.name}
        classes={classes}
        teachers={teachers}
        grades={grades}
        rules={rules}
      />

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Export Classes</DialogTitle>
            <DialogDescription>
              Export {classes.length} classes from {activeQuarter?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button
              onClick={handleCopyToClipboard}
              variant="outline"
              className="h-12 justify-start gap-3 px-4"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <div className="text-left">
                <div className="font-medium">Copy to Clipboard</div>
                <div className="text-xs text-muted-foreground">Tab-delimited format for Google Sheets</div>
              </div>
            </Button>
            <Button
              onClick={handleDownloadCSV}
              variant="outline"
              className="h-12 justify-start gap-3 px-4"
            >
              <Download className="h-5 w-5" />
              <div className="text-left">
                <div className="font-medium">Download CSV</div>
                <div className="text-xs text-muted-foreground">Comma-separated file for Excel</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recently Deleted Dialog */}
      <Dialog open={showDeletedDialog} onOpenChange={setShowDeletedDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recently Deleted</DialogTitle>
            <DialogDescription>
              Classes deleted from {activeQuarter?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {deletedClasses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No recently deleted classes
              </p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-auto">
                {deletedClasses.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-md border bg-muted/30"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{c.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {(() => {
                          const diff = Date.now() - new Date(c.deleted_at).getTime()
                          const mins = Math.floor(diff / 60000)
                          if (mins < 1) return "Just now"
                          if (mins < 60) return `${mins} min ago`
                          const hours = Math.floor(mins / 60)
                          if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`
                          const days = Math.floor(hours / 24)
                          return `${days} day${days > 1 ? "s" : ""} ago`
                        })()}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => restoreClass(c.id)}
                      disabled={restoringIds.has(c.id)}
                      className="gap-1.5 h-7 text-xs"
                    >
                      {restoringIds.has(c.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Undo2 className="h-3 w-3" />
                      )}
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Import from History Dialog */}
      <Dialog open={showImportFromHistoryDialog} onOpenChange={setShowImportFromHistoryDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Classes from Schedule</DialogTitle>
            <DialogDescription>
              Select a previously generated schedule to import its class configuration
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : historyItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No schedules with class data found
              </p>
            ) : (
              historyItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {item.is_starred && <Star className="h-3.5 w-3.5 text-sky-500 fill-sky-500 flex-shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {item.quarter?.name}
                        <span className="text-muted-foreground font-normal ml-2">
                          {new Date(item.generated_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {(item.stats?.classes_snapshot as unknown[])?.length || 0} classes
                        {item.notes && <span className="ml-1">· {item.notes}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={importing}
                      onClick={() => handleImportFromHistory(item.id, false)}
                    >
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                      disabled={importing}
                      onClick={() => handleImportFromHistory(item.id, true)}
                    >
                      Replace
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          {importing && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing classes...
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportFromHistoryDialog(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={(open) => {
        setShowImportDialog(open)
        if (!open) {
          setImportStep('input')
          setPendingImport([])
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {importStep === 'input' ? 'Import Classes' : 'Confirm Import'}
            </DialogTitle>
            <DialogDescription>
              {importStep === 'input'
                ? 'Paste tab-delimited data from Google Sheets. Format: Teacher, Grade, Subject, Blocks/Week, Restrictions (optional), Double (optional — "2x" or "yes")'
                : `Review ${pendingImport.length} classes before importing. Adjust elective and co-taught flags as needed.`
              }
            </DialogDescription>
          </DialogHeader>

          {importStep === 'input' ? (
            <>
              <div className="space-y-4">
                <textarea
                  className="w-full h-64 p-3 text-sm font-mono border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-sky-500"
                  placeholder={`Teacher\tGrade\tSubject\tBlocks/Week\tRestrictions\tDouble
New Teacher\tKindergarten\tEnglish\t4\t\t
Carolina\t1st Grade\tMath\t4\t\t
Phil\t6th-8th\tScience\t7\t\t2x
Maria\t6th-11th Elective\tSpanish 101\t1\tMon Block 5\t`}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="replaceAll"
                    checked={replaceAll}
                    onChange={(e) => setReplaceAll(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="replaceAll" className="text-sm text-slate-700">
                    Replace all existing classes (deletes current {classes.length} classes)
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Headers are optional. New teachers and subjects will be created automatically.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={!importText.trim()}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white"
                >
                  Continue
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
                {/* Validation warnings */}
                {(() => {
                  const warnings: string[] = []
                  const newTeachers = new Set<string>()
                  const newSubjects = new Set<string>()

                  pendingImport.forEach(row => {
                    if (!teachers.find(t => t.name.toLowerCase() === row.teacherName.toLowerCase())) {
                      newTeachers.add(row.teacherName)
                    }
                    if (!subjects.find(s => s.name.toLowerCase() === row.subjectName.toLowerCase())) {
                      newSubjects.add(row.subjectName)
                    }
                  })

                  if (newTeachers.size > 0) {
                    warnings.push(`New teachers will be created: ${Array.from(newTeachers).join(', ')}`)
                  }
                  if (newSubjects.size > 0) {
                    warnings.push(`New subjects will be created: ${Array.from(newSubjects).join(', ')}`)
                  }

                  // More than 5 lessons/week is legal for any subject — the scheduler
                  // pairs lessons into back-to-back doubles as needed. Surface a
                  // neutral note, not a warning.
                  const highBlockCount = pendingImport.filter(row => row.daysPerWeek > 5).length

                  // Check for duplicates within import
                  const seen = new Map<string, number>()
                  const duplicates: string[] = []
                  pendingImport.forEach((row, idx) => {
                    const key = `${row.teacherName.toLowerCase()}|${row.gradeIds.sort().join(',')}|${row.subjectName.toLowerCase()}`
                    if (seen.has(key)) {
                      duplicates.push(`${row.teacherName} - ${row.gradeStr} - ${row.subjectName}`)
                    }
                    seen.set(key, idx)
                  })
                  if (duplicates.length > 0) {
                    warnings.push(`Duplicate entries: ${duplicates.slice(0, 3).join('; ')}${duplicates.length > 3 ? ` (+${duplicates.length - 3} more)` : ''}`)
                  }

                  // Check for conflicts with existing classes (only if not replacing all)
                  if (!replaceAll && classes.length > 0) {
                    const conflicts: string[] = []
                    pendingImport.forEach(row => {
                      const teacher = teachers.find(t => t.name.toLowerCase() === row.teacherName.toLowerCase())
                      const subject = subjects.find(s => s.name.toLowerCase() === row.subjectName.toLowerCase())
                      if (teacher && subject) {
                        const existing = classes.find(c =>
                          c.teacher_id === teacher.id &&
                          c.subject_id === subject.id &&
                          row.gradeIds.includes(c.grade_id)
                        )
                        if (existing) {
                          conflicts.push(`${row.teacherName} - ${row.gradeStr} - ${row.subjectName}`)
                        }
                      }
                    })
                    if (conflicts.length > 0) {
                      warnings.push(`Already exists: ${conflicts.slice(0, 3).join('; ')}${conflicts.length > 3 ? ` (+${conflicts.length - 3} more)` : ''}`)
                    }
                  }

                  return (
                    <div className="space-y-2">
                      {warnings.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                          <p className="font-medium mb-1">Heads up:</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {warnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      )}
                      {highBlockCount > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                          {highBlockCount} {highBlockCount === 1 ? "row has" : "rows have"} more than 5
                          lessons — these will use back-to-back doubles as needed.
                        </div>
                      )}
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
                        {pendingImport.length} classes ready to import
                      </div>
                    </div>
                  )
                })()}

                {/* Electives section */}
                {pendingImport.some(r => r.detectedElective) && (
                  <div className="border rounded-lg p-3">
                    <p className="text-sm font-medium mb-1">Electives ({pendingImport.filter(r => r.isElective).length} selected)</p>
                    <p className="text-xs text-slate-500 mb-2">Electives can share the same block with other electives, allowing students to choose between concurrent options.</p>
                    <div className="space-y-1.5">
                      {pendingImport.map((row, idx) => row.detectedElective && (
                        <label key={idx} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={row.isElective}
                            onChange={(e) => {
                              setPendingImport(prev => prev.map((r, i) =>
                                i === idx ? { ...r, isElective: e.target.checked } : r
                              ))
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                          />
                          <span className="text-slate-600">{row.teacherName}</span>
                          <span className="text-slate-400">·</span>
                          <span>{row.gradeStr}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-medium">{row.subjectName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Double periods section */}
                {pendingImport.some(r => r.isDouble) && (
                  <div className="border rounded-lg p-3">
                    <p className="text-sm font-medium mb-1">Double periods ({pendingImport.filter(r => r.isDouble).length})</p>
                    <p className="text-xs text-slate-500 mb-2">Lessons for these classes pair into back-to-back blocks.</p>
                    <div className="space-y-1.5">
                      {pendingImport.map((row, idx) => row.isDouble && (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <span
                            title="Double periods — lessons pair into back-to-back blocks"
                            className="px-1 rounded bg-violet-100 text-violet-700 text-[10px] font-semibold flex-shrink-0"
                          >
                            2×
                          </span>
                          <span className="text-slate-600">{row.teacherName}</span>
                          <span className="text-slate-400">·</span>
                          <span>{row.gradeStr}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-medium">{row.subjectName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Co-taught section */}
                {importCotaughtGroups.size > 0 && (
                  <div className="border rounded-lg p-3">
                    <p className="text-sm font-medium mb-1">Co-taught ({pendingImport.filter(r => r.isCotaught).length} classes in {importCotaughtGroups.size} groups)</p>
                    <p className="text-xs text-slate-500 mb-2">Co-taught classes are scheduled in the same block so multiple teachers can teach together.</p>
                    <div className="space-y-3">
                      {Array.from(importCotaughtGroups.entries()).map(([key, indices]) => (
                        <div key={key} className="bg-slate-50 rounded p-2 space-y-1.5">
                          {indices.map(idx => {
                            const row = pendingImport[idx]
                            return (
                              <label key={idx} className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={row.isCotaught}
                                  onChange={(e) => {
                                    setPendingImport(prev => prev.map((r, i) =>
                                      i === idx ? { ...r, isCotaught: e.target.checked } : r
                                    ))
                                  }}
                                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                />
                                <span className="text-slate-600">{row.teacherName}</span>
                                <span className="text-slate-400">·</span>
                                <span>{row.gradeStr}</span>
                                <span className="text-slate-400">·</span>
                                <span className="font-medium">{row.subjectName}</span>
                              </label>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportStep('input')}>
                  Back
                </Button>
                <Button
                  onClick={handleConfirmImport}
                  disabled={importing}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white"
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Importing...
                    </>
                  ) : (
                    `Import ${pendingImport.length} Classes`
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Class Modal */}
      <AddClassModal
        open={showAddClassModal}
        onOpenChange={setShowAddClassModal}
        teachers={teachers}
        grades={grades}
        subjects={subjects}
        existingClasses={classes}
        quarterId={activeQuarter?.id || ""}
        onCreateClass={createClass}
        onCreateSubject={createSubject}
        onCreateTeacher={createTeacher}
        blocks={templateBlocks}
        template={timetableTemplate}
      />

      {/* Co-taught Suggestion Dialog */}
      <Dialog open={showCotaughtSuggestion} onOpenChange={setShowCotaughtSuggestion}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-purple-600" />
              Mark as Co-taught?
            </DialogTitle>
            <DialogDescription>
              These classes have the same grade and subject but different teachers. Should they be scheduled at the same time?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            {cotaughtSuggestionClasses.map(cls => {
              const grade = cls.grades?.length
                ? cls.grades.length === 1
                  ? cls.grades[0].display_name
                  : `${cls.grades[0].display_name.replace(' Grade', '')}-${cls.grades[cls.grades.length - 1].display_name.replace(' Grade', '')} Grades`
                : cls.grade?.display_name || ''
              return (
                <div key={cls.id} className="flex items-center gap-2 text-sm p-2 bg-slate-50 rounded">
                  <span className="font-medium">{cls.teacher?.name || '(no teacher)'}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">{grade}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">{cls.subject?.name}</span>
                </div>
              )
            })}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowCotaughtSuggestion(false)}
            >
              No, Keep Separate
            </Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => {
                markClassesAsCotaught(cotaughtSuggestionClasses.map(c => c.id))
                setShowCotaughtSuggestion(false)
              }}
            >
              <Users className="h-4 w-4 mr-2" />
              Mark as Co-taught
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grade Capacity & Status Indicator */}
      <div className="mb-4 rounded-lg bg-slate-50 border border-slate-200">
        <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto">
          <span className="text-xs text-slate-500 mr-2 flex-shrink-0">Blocks:</span>
          {sortedGrades.map(grade => {
            const count = gradeCapacity.get(grade.display_name) || 0
            // Weekly capacity = teachable blocks/day for this grade × 5 days
            const capacity = (teachableBlocksByGrade.get(grade.id)?.length ?? templateBlocks.length) * 5
            const isFull = count === capacity
            const isOver = count > capacity
            const isUnder = count < capacity
            const shortName = grade.display_name.replace(' Grade', '').replace('Kindergarten', 'K')

            // Get classes for this grade
            const gradeClasses = classes.filter(cls => {
              const classGradeIds = cls.grade_ids?.length ? cls.grade_ids : (cls.grade_id ? [cls.grade_id] : [])
              return classGradeIds.includes(grade.id)
            })

            return (
              <Popover key={grade.id}>
                <PopoverTrigger asChild>
                  <button
                    title={`${grade.display_name}: ${count}/${capacity} blocks${studyHallGrades.includes(grade.display_name) ? ' (includes study hall)' : ''}`}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 cursor-pointer hover:ring-1 hover:ring-slate-300 transition-all",
                      isOver && "bg-red-100 text-red-700",
                      isFull && "bg-emerald-100 text-emerald-700",
                      isUnder && "bg-amber-50 text-amber-600"
                    )}
                  >
                    <span>{shortName}</span>
                    <span className={cn(
                      "text-[10px]",
                      isOver && "text-red-500",
                      isFull && "text-emerald-500",
                      isUnder && "text-amber-400"
                    )}>
                      {count}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-0">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">{grade.display_name}</span>
                      <span className={cn(
                        "text-xs font-medium",
                        isOver && "text-red-600",
                        isFull && "text-emerald-600",
                        isUnder && "text-amber-600"
                      )}>
                        {count}/{capacity} blocks
                      </span>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {gradeClasses.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-slate-400 text-center">No classes assigned</div>
                    ) : (
                      <div className="py-1">
                        {gradeClasses.map(cls => {
                          const teacher = teachers.find(t => t.id === cls.teacher_id)
                          const subject = subjects.find(s => s.id === cls.subject_id)
                          return (
                            <div key={cls.id} className="px-3 py-1.5 flex items-center justify-between text-xs hover:bg-slate-50">
                              <div className="min-w-0">
                                <span className="font-medium text-slate-700">{subject?.name || '—'}</span>
                                <span className="text-slate-400 ml-1.5">{teacher?.name || '(unassigned)'}</span>
                              </div>
                              <span className="text-slate-400 ml-2 flex-shrink-0">{cls.days_per_week}×</span>
                            </div>
                          )
                        })}
                        {studyHallGrades.includes(grade.display_name) && (
                          <div className="px-3 py-1.5 flex items-center justify-between text-xs text-slate-400 italic">
                            <span>Study Hall</span>
                            <span className="ml-2 flex-shrink-0">1×</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )
          })}

          {/* Teacher allocation check */}
          {(() => {
            const teacherBlocks = new Map<string, number>()
            for (const cls of classes) {
              if (!cls.teacher_id) continue
              teacherBlocks.set(cls.teacher_id, (teacherBlocks.get(cls.teacher_id) || 0) + cls.days_per_week)
            }
            const fullTimeTeachers = teachers.filter(t => isFullTime(t.status))
            const hasIssue = fullTimeTeachers.some(t => {
              const maxBlocks = (t.available_days?.length ?? 5) * (t.available_blocks?.length ?? templateBlocks.length)
              const blocks = teacherBlocks.get(t.id) || 0
              return blocks > maxBlocks || blocks < maxBlocks - 5
            })

            return (
              <>
                <div className="w-px h-4 bg-slate-300 mx-2 flex-shrink-0" />
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-colors flex-shrink-0",
                        hasIssue
                          ? "bg-amber-50 text-amber-600 hover:bg-amber-100"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      )}
                      title="Teacher block allocation"
                    >
                      <User className="h-3 w-3" />
                      <span>Teachers</span>
                      {hasIssue && <AlertTriangle className="h-3 w-3" />}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-0">
                    <div className="px-3 py-2 border-b border-slate-100">
                      <span className="text-xs font-semibold text-slate-700">Teacher Block Allocation</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {fullTimeTeachers.length > 0 && (
                        <div className="py-1">
                          <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Full-time</div>
                          {fullTimeTeachers
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map(t => {
                              const blocks = teacherBlocks.get(t.id) || 0
                              const maxBlocks = (t.available_days?.length ?? 5) * (t.available_blocks?.length ?? templateBlocks.length)
                              const isOver = blocks > maxBlocks
                              const isUnderAllocated = blocks < maxBlocks - 5
                              return (
                                <div key={t.id} className="px-3 py-1.5 flex items-center justify-between text-xs hover:bg-slate-50">
                                  <span className="text-slate-700 truncate">{t.name}</span>
                                  <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                                    <span className={cn(
                                      "font-medium",
                                      isOver && "text-red-600",
                                      isUnderAllocated && "text-amber-600",
                                      !isOver && !isUnderAllocated && "text-emerald-600"
                                    )}>
                                      {blocks}/{maxBlocks}
                                    </span>
                                    {isOver && <span className="text-red-500 text-[10px]">over</span>}
                                    {isUnderAllocated && <span className="text-amber-500 text-[10px]">low</span>}
                                  </div>
                                </div>
                              )
                            })}
                        </div>
                      )}
                      {teachers.filter(t => isPartTime(t.status)).length > 0 && (
                        <div className="py-1 border-t border-slate-100">
                          <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Part-time</div>
                          {teachers
                            .filter(t => isPartTime(t.status))
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map(t => {
                              const blocks = teacherBlocks.get(t.id) || 0
                              const maxBlocks = (t.available_days?.length ?? 5) * (t.available_blocks?.length ?? templateBlocks.length)
                              return (
                                <div key={t.id} className="px-3 py-1.5 flex items-center justify-between text-xs hover:bg-slate-50">
                                  <span className="text-slate-500 truncate">{t.name}</span>
                                  <span className="text-slate-400 font-medium ml-2 flex-shrink-0">{blocks}/{maxBlocks}</span>
                                </div>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </>
            )
          })()}

          {/* Co-taught indicator */}
          {cotaughtGroups.length > 0 && (
            <>
              <div className="w-px h-4 bg-slate-300 mx-2 flex-shrink-0" />
              <button
                onClick={() => setShowCotaughtDetails(!showCotaughtDetails)}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors flex-shrink-0"
                title="Co-taught classes will be scheduled at the same time"
              >
                <Users className="h-3 w-3" />
                <span>{cotaughtGroups.length} co-taught</span>
                {showCotaughtDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </>
          )}
        </div>

        {/* Expanded co-taught details */}
        {showCotaughtDetails && cotaughtGroups.length > 0 && (
          <div className="px-3 py-2 border-t border-slate-200 bg-purple-50 text-sm text-purple-700">
            <p className="text-xs font-medium mb-1">Co-taught classes (scheduled at same time):</p>
            <ul className="space-y-0.5 text-xs">
              {cotaughtGroups.map((group, i) => (
                <li key={i}>
                  <span className="font-medium">{group.gradeDisplay} - {group.subjectName}:</span>{" "}
                  {group.teacherNames.join(", ")}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-purple-500 text-xs">
              To remove co-taught scheduling, uncheck &ldquo;Co-taught&rdquo; in the grade selector.
            </p>
          </div>
        )}
      </div>

      {fromSchedule && searchParams.get('schedule_id') ? (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-700">
          <Settings2 className="h-4 w-4 flex-shrink-0 text-sky-500" />
          <span>
            Editing classes for <span className="font-medium">{activeQuarter?.name || 'this quarter'}</span>. Changes will be detected when you return to the schedule.
          </span>
          <Link
            href={`/history/${searchParams.get('schedule_id')}${searchParams.get('version') ? `#${searchParams.get('version')}` : ''}`}
            className="ml-auto px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 transition-colors font-medium whitespace-nowrap"
          >
            ← Back to schedule
          </Link>
        </div>
      ) : showLastRunNotice ? (
        lastRun.starred ? (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-700">
            <Star className="h-4 w-4 flex-shrink-0 fill-sky-400 text-sky-400" />
            <span>You have a starred schedule for these classes.</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowGenerateModal(true)}
                className="px-2 py-1 rounded text-sky-600 hover:bg-sky-100 transition-colors"
              >
                Generate new
              </button>
              <span className="text-sky-300">|</span>
              <Link
                href={`/history/${lastRun.historyId}`}
                className="px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 transition-colors font-medium"
              >
                View results →
              </Link>
            </div>
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-700">
            <Clock className="h-4 w-4 flex-shrink-0" />
            <span>
              You generated a schedule for these classes{" "}
              <span className="font-medium">{formatTimeAgo(lastRun.timestamp)}</span>.
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowGenerateModal(true)}
                className="px-2 py-1 rounded text-sky-600 hover:bg-sky-100 transition-colors"
              >
                Generate new
              </button>
              <span className="text-sky-300">|</span>
              <Link
                href={`/history/${lastRun.historyId}`}
                className="px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 transition-colors font-medium"
              >
                View results →
              </Link>
            </div>
          </div>
        )
      ) : null}


      {/* Import warnings notice */}
      {importWarnings.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-800 mb-1">
                Some data wasn&apos;t found during import
              </div>
              <div className="text-xs text-amber-700 space-y-0.5">
                {importWarnings.map((warning, i) => (
                  <div key={i}>• {warning}</div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setImportWarnings([])}
              className="text-amber-600 hover:text-amber-800 p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="relative border rounded-lg overflow-hidden bg-white shadow-sm flex-1 flex flex-col min-h-0">
        {classesLoading && (
          <div className="absolute inset-0 z-20 bg-white/60 flex justify-center pt-[15%]">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {tableLocked && !classesLoading && (
          <div className="absolute inset-0 z-20 bg-slate-800/20 flex justify-center pt-[15%]">
            <div className="flex flex-col items-center gap-3 bg-slate-700/95 rounded-xl px-8 py-6 shadow-lg max-w-sm text-center h-fit">
              <Lock className="h-8 w-8 text-slate-400" />
              <p className="text-sm font-medium text-slate-200">Classes are locked</p>
              <p className="text-xs text-slate-400">
                {lockReason === 'import'
                  ? 'Please wait.. Import is currently in progress.'
                  : lastRun
                    ? `A schedule was generated for ${activeQuarter?.name} on ${new Date(lastRun.timestamp).toLocaleDateString()}. Editing may require regenerating.`
                    : 'A schedule has been generated with these classes. Editing may require regenerating the schedule.'}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" className="bg-white text-slate-800 hover:bg-slate-100" onClick={() => setTableLocked(false)}>
                  Unlock
                </Button>
                {lockReason === 'generation' && quarters.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-slate-200 hover:bg-slate-600"
                    onClick={() => {
                      // Find a different quarter to suggest
                      const otherQuarter = quarters.find(q => q.id !== activeQuarter?.id)
                      if (otherQuarter) {
                        setSelectedQuarterId(otherQuarter.id)
                      }
                    }}
                  >
                    Switch Quarter
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr className="border-b border-slate-200">
              <th className="text-left font-medium text-slate-500 px-3 py-2.5 w-10">#</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5 w-[180px]">Teacher</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5 w-[160px]">Grade</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5 w-[200px]">Subject</th>
              <th className="text-left font-medium text-slate-500 pl-2 pr-3 py-2.5 w-[60px]">Blocks</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Fixed Time Slots</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {classes.map((cls, index) => (
              <ClassRow
                key={cls.id}
                cls={cls}
                index={index + 1}
                teachers={teachers}
                grades={grades}
                subjects={subjects}
                blocks={templateBlocks}
                lunchBlocks={lunchBlocksForClass(cls)}
                cotaughtTeachers={cotaughtTeacherNames.get(cls.id)}
                onUpdate={updateClass}
                onUpdateRestrictions={updateRestrictions}
                onDelete={deleteClass}
                onCreateSubject={createSubject}
                onCreateTeacher={createTeacher}
              />
            ))}
            <NewClassRow
              teachers={teachers}
              grades={grades}
              subjects={subjects}
              onCreate={createClass}
              onCreateSubject={createSubject}
              onCreateTeacher={createTeacher}
              rowNumber={classes.length + 1}
            />
          </tbody>
        </table>
        </div>
        <div className="sticky bottom-0 py-3 border-t border-slate-100 bg-white flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddClassModal(true)}
            className="h-8 text-slate-600"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Class
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ClassRowProps {
  cls: ClassEntry
  index: number
  teachers: Teacher[]
  grades: Grade[]
  subjects: Subject[]
  blocks: number[]
  lunchBlocks: number[]
  cotaughtTeachers?: string[]
  onUpdate: (id: string, field: string, value: unknown) => void
  onUpdateRestrictions: (id: string, restrictions: Restriction[]) => void
  onDelete: (id: string) => void
  onCreateSubject: (name: string) => Promise<Subject | null>
  onCreateTeacher: (name: string) => Promise<Teacher | null>
}

function ClassRow({
  cls,
  index,
  teachers,
  grades,
  subjects,
  blocks,
  lunchBlocks,
  cotaughtTeachers,
  onUpdate,
  onUpdateRestrictions,
  onDelete,
  onCreateSubject,
  onCreateTeacher,
}: ClassRowProps) {
  const isIncomplete = !cls.teacher_id || !cls.grade_id || !cls.subject_id
  const hasDeletedTeacher = cls.teacher_deleted === true
  return (
    <tr className={cn(
      "border-b border-slate-100 hover:bg-blue-50/50 group",
      (isIncomplete || hasDeletedTeacher) && "bg-amber-50/50"
    )}>
      <td className="px-3 py-1 text-slate-400 text-xs w-10">
        {(isIncomplete || hasDeletedTeacher) ? (
          <span className="text-amber-500" title={hasDeletedTeacher ? "Teacher was archived" : "Missing required fields"}>!</span>
        ) : index}
      </td>
      <td className="px-1 py-1">
        <SelectCell
          value={cls.teacher_id}
          displayValue={cls.teacher?.name}
          options={teachers.map((t) => ({
            id: t.id,
            label: t.name,
            tag: isPartTime(t.status) ? "PT" : undefined
          }))}
          onChange={(id) => onUpdate(cls.id, "teacher_id", id)}
          onCreateNew={async (name) => {
            const teacher = await onCreateTeacher(name)
            if (teacher) onUpdate(cls.id, "teacher_id", teacher.id)
          }}
          placeholder="Select teacher"
          warning={hasDeletedTeacher ? "Teacher was archived" : undefined}
        />
      </td>
      <td className="px-1 py-1">
        <GradeSelector
          grades={grades}
          selectedIds={cls.grade_ids || (cls.grade_id ? [cls.grade_id] : [])}
          isElective={cls.is_elective || false}
          isCotaught={cls.is_cotaught || false}
          cotaughtTeachers={cotaughtTeachers}
          onChange={(ids, isElective, isCotaughtVal) => {
            const currentIds = cls.grade_ids || (cls.grade_id ? [cls.grade_id] : [])
            if (JSON.stringify([...ids].sort()) !== JSON.stringify([...currentIds].sort())) {
              onUpdate(cls.id, "grade_ids", ids)
            }
            if (isElective !== cls.is_elective) {
              onUpdate(cls.id, "is_elective", isElective)
            }
            if (isCotaughtVal !== undefined && isCotaughtVal !== (cls.is_cotaught || false)) {
              onUpdate(cls.id, "is_cotaught", isCotaughtVal)
            }
          }}
          hasRestrictions={cls.restrictions && cls.restrictions.length > 0}
          placeholder="Select grade"
          compact
        />
      </td>
      <td className="px-1 py-1">
        <SelectCell
          value={cls.subject_id}
          displayValue={cls.subject?.name}
          options={subjects.map((s) => ({ id: s.id, label: s.name }))}
          onChange={(id) => onUpdate(cls.id, "subject_id", id)}
          onCreateNew={async (name) => {
            const subject = await onCreateSubject(name)
            if (subject) onUpdate(cls.id, "subject_id", subject.id)
          }}
          placeholder="Select subject"
        />
      </td>
      <td className="px-1 py-1">
        <div className="flex items-center gap-2.5">
          <NumberCell
            value={cls.days_per_week}
            onChange={(val) => onUpdate(cls.id, "days_per_week", val)}
            min={1}
            max={10}
          />
          <DoublePeriodsToggle
            value={cls.double_periods === true}
            onChange={(val) => onUpdate(cls.id, "double_periods", val)}
          />
        </div>
      </td>
      <td className="px-1 py-1">
        <RestrictionsCell
          restrictions={cls.restrictions}
          onChange={(r) => onUpdateRestrictions(cls.id, r)}
          teacherAvailableDays={teachers.find(t => t.id === cls.teacher_id)?.available_days}
          teacherAvailableBlocks={teachers.find(t => t.id === cls.teacher_id)?.available_blocks}
          blocks={blocks}
          lunchBlocks={lunchBlocks}
        />
      </td>
      <td className="px-1 py-1">
        <button
          onClick={() => onDelete(cls.id)}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive transition-opacity"
        >
          <X className="h-3 w-3" />
        </button>
      </td>
    </tr>
  )
}

interface NewClassRowProps {
  teachers: Teacher[]
  grades: Grade[]
  subjects: Subject[]
  onCreate: (data: Partial<ClassEntry>) => Promise<ClassEntry | null>
  onCreateSubject: (name: string) => Promise<Subject | null>
  onCreateTeacher: (name: string) => Promise<Teacher | null>
  rowNumber: number
}

function NewClassRow({
  teachers,
  grades,
  subjects,
  onCreate,
  onCreateSubject,
  onCreateTeacher,
  rowNumber,
}: NewClassRowProps) {
  const [data, setData] = useState({
    teacher_id: "",
    grade_ids: [] as string[],
    is_elective: false,
    is_cotaught: false,
    subject_id: "",
    days_per_week: 1,
    double_periods: false,
  })
  const [isActive, setIsActive] = useState(false)

  async function handleCreate() {
    if (data.teacher_id && data.grade_ids.length > 0 && data.subject_id) {
      const result = await onCreate(data)
      if (result) {
        setData({ teacher_id: "", grade_ids: [], is_elective: false, is_cotaught: false, subject_id: "", days_per_week: 1, double_periods: false })
        setIsActive(false)
      }
    }
  }

  const canCreate = data.teacher_id && data.grade_ids.length > 0 && data.subject_id

  return (
    <tr className={cn("border-b border-slate-100", isActive ? "bg-emerald-50/50" : "bg-slate-50/50")}>
      <td className="px-3 py-1 text-slate-400 text-xs w-10">{rowNumber}</td>
      <td className="px-1 py-1">
        <SelectCell
          value={data.teacher_id}
          displayValue={teachers.find((t) => t.id === data.teacher_id)?.name}
          options={teachers.map((t) => ({
            id: t.id,
            label: t.name,
            tag: isPartTime(t.status) ? "PT" : undefined
          }))}
          onChange={(id) => {
            setData((d) => ({ ...d, teacher_id: id }))
            setIsActive(true)
          }}
          onCreateNew={async (name) => {
            const teacher = await onCreateTeacher(name)
            if (teacher) {
              setData((d) => ({ ...d, teacher_id: teacher.id }))
              setIsActive(true)
            }
          }}
          placeholder="+ Add class"
        />
      </td>
      <td className="px-1 py-1">
        {isActive && (
          <GradeSelector
            grades={grades}
            selectedIds={data.grade_ids}
            isElective={data.is_elective}
            isCotaught={data.is_cotaught}
            onChange={(ids, isElective, isCotaughtVal) => setData((d) => ({ ...d, grade_ids: ids, is_elective: isElective, ...(isCotaughtVal !== undefined ? { is_cotaught: isCotaughtVal } : {}) }))}
            hasRestrictions={false}
            placeholder="Grade"
            compact
          />
        )}
      </td>
      <td className="px-1 py-1">
        {isActive && (
          <SelectCell
            value={data.subject_id}
            displayValue={subjects.find((s) => s.id === data.subject_id)?.name}
            options={subjects.map((s) => ({ id: s.id, label: s.name }))}
            onChange={(id) => setData((d) => ({ ...d, subject_id: id }))}
            onCreateNew={async (name) => {
              const subject = await onCreateSubject(name)
              if (subject) setData((d) => ({ ...d, subject_id: subject.id }))
            }}
            placeholder="Subject"
          />
        )}
      </td>
      <td className="px-1 py-1">
        {isActive && (
          <div className="flex items-center gap-2.5">
            <NumberCell
              value={data.days_per_week}
              onChange={(val) => setData((d) => ({ ...d, days_per_week: val }))}
              min={1}
              max={10}
            />
            <DoublePeriodsToggle
              value={data.double_periods}
              onChange={(val) => setData((d) => ({ ...d, double_periods: val }))}
            />
          </div>
        )}
      </td>
      <td className="px-1 py-1">
        {isActive && canCreate && (
          <Button size="sm" onClick={handleCreate} className="h-6 text-xs px-3 bg-emerald-500 hover:bg-emerald-600 text-white">
            Add
          </Button>
        )}
      </td>
      <td className="px-1 py-1">
        {isActive && (
          <button
            onClick={() => {
              setData({ teacher_id: "", grade_ids: [], is_elective: false, is_cotaught: false, subject_id: "", days_per_week: 1, double_periods: false })
              setIsActive(false)
            }}
            className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </td>
    </tr>
  )
}

interface SelectCellProps {
  value: string
  displayValue?: string
  options: { id: string; label: string; tag?: string }[]
  onChange: (id: string) => void
  onCreateNew?: (name: string) => void
  placeholder?: string
  warning?: string
}

function SelectCell({
  value,
  displayValue,
  options,
  onChange,
  onCreateNew,
  placeholder,
  warning,
}: SelectCellProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [dropUp, setDropUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Check if dropdown should appear above (when near bottom of viewport)
  useEffect(() => {
    if (open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const dropdownHeight = 200 // approx max-h-48 = 192px
      setDropUp(spaceBelow < dropdownHeight)
    }
  }, [open])

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  )
  const showCreate = onCreateNew && search.trim() && !options.some(
    (o) => o.label.toLowerCase() === search.toLowerCase()
  )

  return (
    <div ref={containerRef} className="relative">
      {open ? (
        <Input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false)
              setSearch("")
            }
            if (e.key === "Enter" && filtered.length === 1) {
              onChange(filtered[0].id)
              setOpen(false)
              setSearch("")
            }
          }}
          className="h-6 text-sm"
          autoFocus
          placeholder="Search..."
        />
      ) : (
        <div
          onClick={() => {
            setOpen(true)
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          className={cn(
            "h-6 px-2 flex items-center gap-1.5 rounded cursor-pointer hover:bg-muted text-sm",
            !displayValue && "text-muted-foreground",
            warning && "text-amber-600"
          )}
          title={warning}
        >
          {displayValue || placeholder}
          {warning && <UserX className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
        </div>
      )}
      {open && (
        <div className={cn(
          "absolute z-50 left-0 right-0 bg-popover border rounded-md shadow-lg max-h-48 overflow-auto min-w-[180px]",
          dropUp ? "bottom-full mb-1" : "top-full mt-1"
        )}>
          {filtered.map((opt) => (
            <div
              key={opt.id}
              onClick={() => {
                onChange(opt.id)
                setOpen(false)
                setSearch("")
              }}
              className={cn(
                "px-2 py-1 cursor-pointer hover:bg-accent text-sm flex items-center justify-between gap-2",
                opt.id === value && "bg-accent"
              )}
            >
              <span>{opt.label}</span>
              {opt.tag && (
                <span className="text-[10px] text-slate-400 flex-shrink-0">{opt.tag}</span>
              )}
            </div>
          ))}
          {showCreate && (
            <div
              onClick={() => {
                onCreateNew!(search.trim())
                setOpen(false)
                setSearch("")
              }}
              className="px-2 py-1 cursor-pointer hover:bg-accent text-sm text-primary border-t"
            >
              Create "{search}"
            </div>
          )}
          {filtered.length === 0 && !showCreate && (
            <div className="px-2 py-1 text-sm text-muted-foreground">No results</div>
          )}
        </div>
      )}
    </div>
  )
}

interface DoublePeriodsToggleProps {
  value: boolean
  onChange: (val: boolean) => void
}

// Small "2×" chip: violet when on, grey/hollow when off. Click to flip.
function DoublePeriodsToggle({ value, onChange }: DoublePeriodsToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      title="Double periods — lessons pair into back-to-back blocks"
      aria-pressed={value}
      className={cn(
        "px-1 rounded border text-[10px] font-semibold flex-shrink-0 transition-colors",
        value
          ? "bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200"
          : "bg-transparent text-slate-300 border-slate-200 hover:text-violet-500 hover:border-violet-300"
      )}
    >
      2×
    </button>
  )
}

interface NumberCellProps {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
}

function NumberCell({ value, onChange, min = 1, max = 5 }: NumberCellProps) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="w-4 text-center text-sm">{value}</span>
      <div className="flex flex-col">
        <button
          onClick={() => value < max && onChange(value + 1)}
          disabled={value >= max}
          className="h-3 px-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          onClick={() => value > min && onChange(value - 1)}
          disabled={value <= min}
          className="h-3 px-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

interface RestrictionsCellProps {
  restrictions: Restriction[]
  onChange: (restrictions: Restriction[]) => void
  teacherAvailableDays?: string[] | null
  teacherAvailableBlocks?: number[] | null
  blocks?: number[]
  lunchBlocks?: number[]
}

function RestrictionsCell({ restrictions, onChange, teacherAvailableDays, teacherAvailableBlocks, blocks = DEFAULT_BLOCKS, lunchBlocks = [] }: RestrictionsCellProps) {
  const [editing, setEditing] = useState(false)
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [selectedBlocks, setSelectedBlocks] = useState<number[]>([])
  const [availableDaysOnly, setAvailableDaysOnly] = useState<string[]>([])
  const [dropUp, setDropUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditing(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Check if dropdown should appear above (when near bottom of viewport)
  useEffect(() => {
    if (editing && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const dropdownHeight = 320 // approx height of the restrictions popup
      setDropUp(spaceBelow < dropdownHeight)
    }
  }, [editing])

  function openEditor() {
    // Preselect existing fixed_slot restrictions
    const fixedSlots = restrictions.filter((r) => r.restriction_type === "fixed_slot")
    const days: string[] = []
    const blocks: number[] = []
    fixedSlots.forEach((r) => {
      const slot = r.value as { day: string; block: number }
      days.push(slot.day)
      blocks.push(slot.block)
    })
    setSelectedDays(days)
    setSelectedBlocks(blocks)

    // Preselect existing available_days restrictions
    const availDays = restrictions.find((r) => r.restriction_type === "available_days")
    setAvailableDaysOnly(availDays ? (availDays.value as string[]) : [])

    setEditing(true)
  }

  function formatRestriction(r: Restriction): string {
    if (r.restriction_type === "fixed_slot") {
      const slot = r.value as { day: string; block: number }
      return `${slot.day} B${slot.block}`
    }
    if (r.restriction_type === "available_days") {
      return (r.value as string[]).join(", ")
    }
    if (r.restriction_type === "available_blocks") {
      const blocks = r.value as number[]
      return `B${blocks.join(",")}`
    }
    return ""
  }

  function removeRestriction(index: number) {
    const newRestrictions = restrictions.filter((_, i) => i !== index)
    onChange(newRestrictions)
  }

  // Blocks the class can actually be pinned to (template blocks minus lunch)
  const selectableBlocks = blocks.filter((b) => !lunchBlocks.includes(b))

  function saveRestrictions() {
    const newRestrictions: Restriction[] = []

    // Check which days have all selectable blocks selected (should become available_days)
    const daysWithAllBlocks: string[] = []
    DAYS.forEach((day) => {
      const blocksForDay = selectedDays
        .map((d, i) => d === day ? selectedBlocks[i] : null)
        .filter((b): b is number => b !== null)
      if (blocksForDay.length === selectableBlocks.length) {
        daysWithAllBlocks.push(day)
      }
    })

    // Combine explicit available days with days that have all blocks selected
    const allAvailableDays = [...new Set([...availableDaysOnly, ...daysWithAllBlocks])]
    if (allAvailableDays.length > 0) {
      newRestrictions.push({
        restriction_type: "available_days",
        value: allAvailableDays,
      })
    }

    // Add fixed_slots only for days that don't have all 5 blocks selected
    selectedDays.forEach((day, i) => {
      if (!daysWithAllBlocks.includes(day)) {
        newRestrictions.push({
          restriction_type: "fixed_slot",
          value: { day, block: selectedBlocks[i] },
        })
      }
    })

    onChange(newRestrictions)
    setEditing(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1 min-h-[24px]">
        {restrictions.map((r, i) => (
          <Badge
            key={i}
            variant="secondary"
            className={cn(
              "text-xs font-normal py-0 h-5 gap-0.5 pr-1 group/badge cursor-default",
              r.restriction_type === "fixed_slot"
                ? "bg-violet-100 text-violet-700 hover:bg-violet-100"
                : "bg-sky-100 text-sky-700 hover:bg-sky-100"
            )}
          >
            {formatRestriction(r)}
            <button
              onClick={() => removeRestriction(i)}
              className="opacity-0 group-hover/badge:opacity-100 hover:text-red-500"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <button
          onClick={openEditor}
          className="h-5 px-1.5 text-xs text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded flex items-center"
        >
          <Settings2 className="h-3 w-3" />
        </button>
      </div>

      {editing && (
        <div className={cn(
          "absolute z-50 left-0 bg-popover border rounded-md shadow-lg p-2",
          dropUp ? "bottom-full mb-1" : "top-full mt-1"
        )}>
          <div className="space-y-3">
            {/* Available Days Only */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Available Days</div>
              <div className="flex gap-1">
                {DAYS.map((day) => {
                  const isSelected = availableDaysOnly.includes(day)
                  return (
                    <button
                      key={day}
                      onClick={() => {
                        let newAvailDays: string[]
                        if (isSelected) {
                          newAvailDays = availableDaysOnly.filter((d) => d !== day)
                        } else {
                          newAvailDays = [...availableDaysOnly, day]
                        }
                        setAvailableDaysOnly(newAvailDays)
                        // Clear fixed slots that are no longer on available days
                        if (newAvailDays.length > 0) {
                          const indicesToKeep = selectedDays.map((d, i) => newAvailDays.includes(d) ? i : -1).filter(i => i >= 0)
                          setSelectedDays(indicesToKeep.map(i => selectedDays[i]))
                          setSelectedBlocks(indicesToKeep.map(i => selectedBlocks[i]))
                        }
                      }}
                      className={cn(
                        "px-2 py-1 text-xs rounded transition-colors",
                        isSelected
                          ? "bg-sky-500 text-white hover:bg-sky-600"
                          : "bg-slate-100 text-slate-600 hover:bg-sky-50 hover:text-sky-600"
                      )}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>
              {availableDaysOnly.length > 0 && (
                <p className="text-[10px] text-muted-foreground">Class can only be scheduled on selected days</p>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-slate-200" />

            {/* Fixed Time Slots Grid */}
            <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Fixed Time Slots</div>
            <p className="text-[10px] text-muted-foreground">
              {availableDaysOnly.length > 0
                ? "Lock to exact slots on available days"
                : "Lock class to specific time slots"}
            </p>
            <table className="text-xs border rounded-md border-separate border-spacing-0">
              <thead>
                <tr className="bg-muted/50">
                  <th className="w-7 h-7 border-r border-b"></th>
                  {DAYS.map((day) => {
                    const isDayAvailable = availableDaysOnly.length === 0 || availableDaysOnly.includes(day)
                    const teacherDayAvailable = !teacherAvailableDays || teacherAvailableDays.includes(day)
                    return (
                      <th key={day} className={cn(
                        "w-7 h-7 text-center border-r border-b last:border-r-0 font-medium",
                        isDayAvailable && teacherDayAvailable ? "text-muted-foreground" : "text-slate-300"
                      )}>
                        {day.slice(0, 2)}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {blocks.map((block, blockIdx) => {
                  const isLastRow = blockIdx === blocks.length - 1
                  const isLunchBlock = lunchBlocks.includes(block)
                  return (
                    <tr key={block}>
                      <td
                        title={isLunchBlock ? "Lunch — not schedulable" : undefined}
                        className={cn("w-7 h-7 text-center border-r font-medium bg-muted/50", !isLastRow && "border-b", isLunchBlock ? "text-slate-300" : "text-muted-foreground")}
                      >
                        B{block}
                      </td>
                      {DAYS.map((day) => {
                        const isExplicitlySelected = selectedDays.some((d, i) => d === day && selectedBlocks[i] === block)
                        const isDayInAvailable = availableDaysOnly.includes(day)
                        const dayHasExplicitSlots = selectedDays.some((d) => d === day)
                        // If day is available and has no explicit slots, all blocks are implicitly selected
                        const isImplicitlySelected = isDayInAvailable && !dayHasExplicitSlots && !isLunchBlock
                        const isSelected = isExplicitlySelected || isImplicitlySelected
                        const isDayAvailable = availableDaysOnly.length === 0 || isDayInAvailable
                        // Check teacher availability
                        const teacherDayOk = !teacherAvailableDays || teacherAvailableDays.includes(day)
                        const teacherBlockOk = !teacherAvailableBlocks || teacherAvailableBlocks.includes(block)
                        const teacherSlotAvailable = teacherDayOk && teacherBlockOk
                        return (
                          <td
                            key={day}
                            title={isLunchBlock ? "Lunch — not schedulable" : undefined}
                            onClick={() => {
                              if (isLunchBlock || !isDayAvailable || !teacherSlotAvailable) return // Can't select slots on unavailable days/blocks

                              if (isDayInAvailable) {
                                // Day is in available days
                                if (isImplicitlySelected) {
                                  // All blocks implicitly selected - add OTHER blocks explicitly (unselect this one)
                                  const otherBlocks = selectableBlocks.filter((b) => b !== block)
                                  const newDays = [...selectedDays.filter((d) => d !== day), ...otherBlocks.map(() => day)]
                                  const newBlocks = [...selectedBlocks.filter((_, i) => selectedDays[i] !== day), ...otherBlocks]
                                  setSelectedDays(newDays)
                                  setSelectedBlocks(newBlocks)
                                } else if (isExplicitlySelected) {
                                  // Explicitly selected - remove it
                                  const idx = selectedDays.findIndex((d, i) => d === day && selectedBlocks[i] === block)
                                  if (idx >= 0) {
                                    setSelectedDays(selectedDays.filter((_, i) => i !== idx))
                                    setSelectedBlocks(selectedBlocks.filter((_, i) => i !== idx))
                                  }
                                } else {
                                  // Not selected - add it
                                  setSelectedDays([...selectedDays, day])
                                  setSelectedBlocks([...selectedBlocks, block])
                                }
                              } else {
                                // Day not in available days (no days selected = all available)
                                if (isExplicitlySelected) {
                                  const idx = selectedDays.findIndex((d, i) => d === day && selectedBlocks[i] === block)
                                  if (idx >= 0) {
                                    setSelectedDays(selectedDays.filter((_, i) => i !== idx))
                                    setSelectedBlocks(selectedBlocks.filter((_, i) => i !== idx))
                                  }
                                } else {
                                  setSelectedDays([...selectedDays, day])
                                  setSelectedBlocks([...selectedBlocks, block])
                                }
                              }
                            }}
                            className={cn(
                              "w-7 h-7 text-center border-r last:border-r-0 transition-colors",
                              !isLastRow && "border-b",
                              isLunchBlock
                                ? "bg-slate-100 cursor-not-allowed"
                                : !teacherSlotAvailable
                                  ? "bg-orange-50 cursor-not-allowed"
                                  : isSelected
                                    ? "bg-violet-500 text-white hover:bg-violet-600 cursor-pointer"
                                    : isDayAvailable
                                      ? "hover:bg-violet-50 cursor-pointer"
                                      : "bg-slate-100 cursor-not-allowed"
                            )}
                          >
                            {isSelected && <Check className="h-3.5 w-3.5 mx-auto" />}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={saveRestrictions}
                className="h-6 text-xs bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                className="h-6 text-xs text-slate-500 hover:text-slate-700"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
