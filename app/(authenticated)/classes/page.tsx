"use client"

import { useState, useEffect, useRef, useCallback } from "react"
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
import { ChevronDown, ChevronUp, Loader2, Plus, X, Clock, Users, Upload, Download, Check, History, Star, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { GradeSelector, formatGradeDisplay } from "@/components/GradeSelector"
import { TEACHER_STATUS_FULL_TIME, isPartTime, calculateGradeBlocks, buildCotaughtGroups, type TeacherStatus } from "@/lib/schedule-utils"
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
  teacher: Teacher
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
const BLOCKS = [1, 2, 3, 4, 5]
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
  const [classes, setClasses] = useState<ClassEntry[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [studyHallGrades, setStudyHallGrades] = useState<string[]>([])
  const [activeQuarter, setActiveQuarter] = useState<Quarter | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [tableLocked, setTableLocked] = useState(true)
  const [showImportDialog, setShowImportDialog] = useState(false)
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
  const [replaceAll, setReplaceAll] = useState(false)
  const [undoImportData, setUndoImportData] = useState<ClassEntry[] | null>(null)
  const [showCotaughtDetails, setShowCotaughtDetails] = useState(false)
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const undoToastId = useRef<string | null>(null)
  const pendingDeletes = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const initialLoadDone = useRef(false)

  // Unlock table when classes are modified after initial load
  useEffect(() => {
    if (initialLoadDone.current) {
      setTableLocked(false)
    }
  }, [classes])

  useEffect(() => {
    loadData()
    // Cleanup pending deletes on unmount
    return () => {
      pendingDeletes.current.forEach((timeout) => clearTimeout(timeout))
    }
  }, [])

  async function loadData() {
    try {
      const [teachersRes, gradesRes, subjectsRes, quartersRes, rulesRes] = await Promise.all([
        fetch("/api/teachers"),
        fetch("/api/grades"),
        fetch("/api/subjects"),
        fetch("/api/quarters"),
        fetch("/api/rules"),
      ])

      const [teachersData, gradesData, subjectsData, quartersData, rulesData] = await Promise.all([
        teachersRes.json(),
        gradesRes.json(),
        subjectsRes.json(),
        quartersRes.json(),
        rulesRes.json(),
      ])

      setTeachers(teachersData)
      setGrades(gradesData)
      setSubjects(subjectsData)

      // Extract study hall grades from rules config
      const studyHallRule = rulesData.find((r: { rule_key: string }) => r.rule_key === 'study_hall_grades')
      const configuredStudyHallGrades: string[] = studyHallRule?.enabled && studyHallRule?.config?.grades
        ? studyHallRule.config.grades
        : []
      setStudyHallGrades(configuredStudyHallGrades)

      const active = quartersData.find((q: Quarter) => q.is_active)
      setActiveQuarter(active || null)

      if (active) {
        const classesRes = await fetch(`/api/classes?quarter_id=${active.id}`)
        const classesData = await classesRes.json()
        // Sort by teacher name on initial load to group classes by teacher
        // Classes without teachers sort to the top for visibility
        const sorted = [...classesData].sort((a: ClassEntry, b: ClassEntry) => {
          const aName = a.teacher?.name || ''
          const bName = b.teacher?.name || ''
          if (!aName && bName) return -1
          if (aName && !bName) return 1
          return aName.localeCompare(bName)
        })
        setClasses(sorted)

        // Fetch last saved generation: prefer starred, fall back to most recent
        try {
          let lastGen = null
          // Try starred first
          const starredRes = await fetch(`/api/history?quarter_id=${active.id}&limit=1&starred_only=true`)
          if (starredRes.ok) {
            const starredData = await starredRes.json()
            if (starredData.length > 0) lastGen = starredData[0]
          }
          // Fall back to most recent
          if (!lastGen) {
            const historyRes = await fetch(`/api/history?quarter_id=${active.id}&limit=1`)
            if (historyRes.ok) {
              const historyData = await historyRes.json()
              if (historyData.length > 0) lastGen = historyData[0]
            }
          }
          if (lastGen) {
            const bestOption = lastGen.options?.[0]
            setLastRun({
              historyId: lastGen.id,
              timestamp: lastGen.generated_at,
              quarterId: active.id,
              quarterName: active.name,
              studyHallsPlaced: bestOption?.studyHallsPlaced ?? 0,
              backToBackIssues: bestOption?.backToBackIssues ?? 0,
              starred: lastGen.is_starred ?? false,
            })
            // Lock table only if no classes were modified after the schedule was generated
            const generatedAt = new Date(lastGen.generated_at).getTime()
            const maxUpdatedAt = classesData.reduce((max: number, c: { updated_at?: string; created_at?: string }) => {
              const t = new Date(c.updated_at || c.created_at || 0).getTime()
              return t > max ? t : max
            }, 0)
            setTableLocked(maxUpdatedAt <= generatedAt)
          }
        } catch (e) {
          // Ignore history fetch errors
        }
      }
    } catch (error) {
      toast.error("Failed to load data")
    } finally {
      setLoading(false)
      initialLoadDone.current = true
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
        return created
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to add class")
      }
    } catch (error) {
      toast.error("Failed to add class")
    }
    return null
  }

  function deleteClass(id: string) {
    const deletedIndex = classes.findIndex((c) => c.id === id)
    const deletedClass = classes[deletedIndex]
    if (!deletedClass) return

    const rowNumber = deletedIndex + 1
    // Track the ID of the item before this one (if any) for more reliable repositioning
    const previousItemId = deletedIndex > 0 ? classes[deletedIndex - 1].id : null

    // Remove from UI immediately
    setClasses((prev) => prev.filter((c) => c.id !== id))

    // Dismiss previous undo toast
    if (undoToastId.current) toast.dismiss(undoToastId.current)

    // Show toast with undo
    const toastId = toast((t) => (
      <div className="flex items-center gap-3">
        <span className="text-sm">Row {rowNumber} deleted</span>
        <button
          onClick={() => {
            // Cancel the pending delete
            const timeout = pendingDeletes.current.get(id)
            if (timeout) {
              clearTimeout(timeout)
              pendingDeletes.current.delete(id)
            }
            // Restore the class at original position
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
          }}
          className="px-2 py-1 text-sm font-medium text-violet-600 hover:text-violet-800 hover:bg-violet-50 rounded transition-colors"
        >
          Undo
        </button>
      </div>
    ), { duration: 60000, icon: <Check className="h-4 w-4 text-emerald-600" /> })
    undoToastId.current = toastId

    // Schedule actual deletion after 5 seconds
    const timeout = setTimeout(async () => {
      pendingDeletes.current.delete(id)
      try {
        await fetch(`/api/classes/${id}`, { method: "DELETE" })
      } catch (error) {
        // If delete fails, restore the class at original position
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
      }
    }, 5000)

    pendingDeletes.current.set(id, timeout)
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

  async function createTeacher(name: string): Promise<Teacher | null> {
    try {
      const res = await fetch("/api/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, status: TEACHER_STATUS_FULL_TIME }),
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

  function parseRestrictions(restrictionStr: string): Restriction[] {
    if (!restrictionStr?.trim()) return []

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
          if (!availableBlocks.includes(b)) availableBlocks.push(b)
        }
        continue
      }

      // Check for single fixed slot like "Mon Block 5" or "Fri Block 1"
      const fixedMatch = part.match(/([A-Za-z]+(?:day)?)\s*Block\s*(\d+)/i)
      if (fixedMatch) {
        const day = DAY_MAP[fixedMatch[1]] || fixedMatch[1]
        const block = parseInt(fixedMatch[2])
        restrictions.push({ restriction_type: 'fixed_slot', value: { day, block } })
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

  async function handleImport() {
    if (!importText.trim() || !activeQuarter) return

    setImporting(true)
    const lines = importText.trim().split('\n')
    let startIndex = 0

    // Check if first line is headers
    const firstLine = lines[0].toLowerCase()
    if (firstLine.includes('teacher') && firstLine.includes('grade') && firstLine.includes('subject')) {
      startIndex = 1
    }

    // Parse all rows first for validation
    interface ParsedRow {
      line: number
      teacherName: string
      gradeStr: string
      subjectName: string
      daysPerWeek: number
      restrictionStr: string
      gradeIds: string[]
      isElective: boolean
    }

    const parsedRows: ParsedRow[] = []
    const validationErrors: string[] = []

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const [teacherName, gradeStr, subjectName, daysStr, restrictionStr] = line.split('\t')
      const lineNum = i + 1

      if (!teacherName || !gradeStr || !subjectName) {
        validationErrors.push(`Line ${lineNum}: Missing teacher, grade, or subject`)
        continue
      }

      // Parse grade string - supports:
      // - Single: "Kindergarten", "1st Grade", "1st", "6th Grade Elective"
      // - Range: "1st-3rd", "1st-3rd Grades", "6th-11th Elective", "K-3rd Grades"
      const isElective = gradeStr.toLowerCase().includes('elective')

      // Strip "Elective" and "Grades" suffixes for parsing
      let gradeClean = gradeStr
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

      parsedRows.push({
        line: lineNum,
        teacherName,
        gradeStr,
        subjectName,
        daysPerWeek,
        restrictionStr: restrictionStr || '',
        gradeIds,
        isElective,
      })
    }

    // If there are validation errors, stop and show them
    if (validationErrors.length > 0) {
      setImporting(false)
      toast.error(`Validation failed with ${validationErrors.length} errors:\n${validationErrors.slice(0, 5).join('\n')}${validationErrors.length > 5 ? `\n...and ${validationErrors.length - 5} more` : ''}`)
      return
    }

    // Validation passed - close modal and show progress toast
    setShowImportDialog(false)
    const loadingToastId = toast.loading(`Importing ${parsedRows.length} classes...`)

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
    const total = parsedRows.length

    // Track created teachers/subjects to avoid duplicates within import
    const createdTeachers = new Map<string, Teacher>()
    const createdSubjects = new Map<string, Subject>()

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i]
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
    setReplaceAll(false)

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

    // Header
    lines.push(['Teacher', 'Grade', 'Subject', 'Days per Week', 'Restrictions'].join('\t'))

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

      lines.push([teacher, grade, subject, daysPerWeek, restrictions].join('\t'))
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!activeQuarter) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">
          Create a quarter using the dropdown in the navigation to get started.
        </p>
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
  // Shows other teachers with same grade+subject, regardless of is_cotaught flag
  const cotaughtTeacherNames = new Map<string, string[]>()
  for (const { classIds, teachers: teacherIds } of gradeSetSubjectTeachers.values()) {
    if (teacherIds.size > 1) {
      for (const classId of classIds) {
        const cls = classes.find(c => c.id === classId)
        if (!cls) continue
        const otherNames = Array.from(teacherIds)
          .filter(tid => tid !== cls.teacher_id)
          .map(tid => teachers.find((t: Teacher) => t.id === tid)?.name || 'Unknown')
        cotaughtTeacherNames.set(classId, otherNames)
      }
    }
  }

  // Build maps for grade lookups
  const gradeNameToDisplay = new Map<string, string>()
  for (const g of grades) {
    gradeNameToDisplay.set(g.name, g.display_name)
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <span>{activeQuarter.name} &middot; {classes.length} classes</span>
          {incompleteCount > 0 && (
            <span className="text-amber-600 font-medium">
              ({incompleteCount} incomplete)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowImportFromHistoryDialog(true)
              loadHistoryForImport()
            }}
            className="h-7 text-xs gap-1"
          >
            <History className="h-3 w-3" />
            Import from Schedule
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowImportDialog(true)}
            className="h-7 text-xs gap-1"
          >
            <Upload className="h-3 w-3" />
            Import
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            className="h-7 text-xs gap-1"
          >
            <Download className="h-3 w-3" />
            Export
          </Button>
          <Button
            size="sm"
            onClick={scrollToBottom}
            className="h-7 text-xs gap-1 bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            <Plus className="h-3 w-3" />
            Add Class
          </Button>
        </div>
      </div>

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
                    {item.is_starred && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />}
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
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Classes</DialogTitle>
            <DialogDescription>
              Paste tab-delimited data from Google Sheets. Format: Teacher, Grade, Subject, Days per Week, Restrictions (optional)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <textarea
              className="w-full h-64 p-3 text-sm font-mono border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder={`Teacher\tGrade\tSubject\tDays per Week\tRestrictions
New Teacher\tKindergarten\tEnglish\t4\t
Carolina\t1st Grade\tMath\t4\t
Phil\t6th-8th\tScience\t3\t
Maria\t6th-11th Elective\tSpanish 101\t1\tMon Block 5`}
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
              Data will be validated before any changes are made.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || !importText.trim()}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Importing...
                </>
              ) : (
                'Import Classes'
              )}
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
            const isFull = count === 25
            const isOver = count > 25
            const isUnder = count < 25
            const shortName = grade.display_name.replace(' Grade', '').replace('Kindergarten', 'K')

            return (
              <div
                key={grade.id}
                title={`${grade.display_name}: ${count}/25 blocks${studyHallGrades.includes(grade.display_name) ? ' (includes study hall)' : ''}`}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium flex-shrink-0",
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
              </div>
            )
          })}

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

      {showLastRunNotice && (
        lastRun.starred ? (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
            <Star className="h-4 w-4 flex-shrink-0 fill-amber-400 text-amber-400" />
            <span>You have a starred schedule for these classes.</span>
            <Link href={`/history/${lastRun.historyId}`} className="ml-auto text-amber-600 hover:text-amber-800 font-medium">
              View results →
            </Link>
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-700">
            <Clock className="h-4 w-4 flex-shrink-0" />
            <span>
              You generated a schedule for these classes{" "}
              <span className="font-medium">{formatTimeAgo(lastRun.timestamp)}</span>.
            </span>
            <Link href={`/history/${lastRun.historyId}`} className="ml-auto text-sky-600 hover:text-sky-800 font-medium">
              View results →
            </Link>
          </div>
        )
      )}


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

      <div className="relative border rounded-lg overflow-hidden bg-white shadow-sm">
        {showLastRunNotice && tableLocked && (
          <div className="absolute inset-0 z-20 bg-white/40 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 bg-white/90 rounded-xl px-8 py-6 shadow-sm">
              <Lock className="h-8 w-8 text-slate-400" />
              <p className="text-sm font-medium text-slate-600">Classes are locked</p>
              <Button variant="outline" size="sm" onClick={() => setTableLocked(false)}>
                Unlock
              </Button>
            </div>
          </div>
        )}
        <div className="max-h-[calc(100vh-12rem)] overflow-auto">
          <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr className="border-b border-slate-200">
              <th className="text-left font-medium text-slate-500 px-3 py-2.5 w-10">#</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5 w-[180px]">Teacher</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5 w-[160px]">Grade</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5 w-[200px]">Subject</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5 w-[60px]">Days</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Restricted Availability</th>
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
  cotaughtTeachers,
  onUpdate,
  onUpdateRestrictions,
  onDelete,
  onCreateSubject,
  onCreateTeacher,
}: ClassRowProps) {
  const isIncomplete = !cls.teacher_id || !cls.grade_id || !cls.subject_id
  return (
    <tr className={cn(
      "border-b border-slate-100 hover:bg-blue-50/50 group",
      isIncomplete && "bg-amber-50/50"
    )}>
      <td className="px-3 py-1 text-slate-400 text-xs w-10">
        {isIncomplete ? (
          <span className="text-amber-500" title="Missing required fields">!</span>
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
        <NumberCell
          value={cls.days_per_week}
          onChange={(val) => onUpdate(cls.id, "days_per_week", val)}
          min={1}
          max={5}
        />
      </td>
      <td className="px-1 py-1">
        <RestrictionsCell
          restrictions={cls.restrictions}
          onChange={(r) => onUpdateRestrictions(cls.id, r)}
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
  })
  const [isActive, setIsActive] = useState(false)

  async function handleCreate() {
    if (data.teacher_id && data.grade_ids.length > 0 && data.subject_id) {
      const result = await onCreate(data)
      if (result) {
        setData({ teacher_id: "", grade_ids: [], is_elective: false, is_cotaught: false, subject_id: "", days_per_week: 1 })
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
          <NumberCell
            value={data.days_per_week}
            onChange={(val) => setData((d) => ({ ...d, days_per_week: val }))}
            min={1}
            max={5}
          />
        )}
      </td>
      <td className="px-1 py-1">
        {isActive && canCreate && (
          <Button size="sm" onClick={handleCreate} className="h-6 text-xs px-3 bg-emerald-500 hover:bg-emerald-600 text-white">
            Add
          </Button>
        )}
      </td>
      <td></td>
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
}

function SelectCell({
  value,
  displayValue,
  options,
  onChange,
  onCreateNew,
  placeholder,
}: SelectCellProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
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
            "h-6 px-2 flex items-center rounded cursor-pointer hover:bg-muted text-sm",
            !displayValue && "text-muted-foreground"
          )}
        >
          {displayValue || placeholder}
        </div>
      )}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-auto min-w-[180px]">
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
}

function RestrictionsCell({ restrictions, onChange }: RestrictionsCellProps) {
  const [adding, setAdding] = useState(false)
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [selectedBlocks, setSelectedBlocks] = useState<number[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAdding(false)
        resetAdd()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function resetAdd() {
    setSelectedDays([])
    setSelectedBlocks([])
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

  function addRestriction() {
    if (selectedDays.length === 0) return

    const newRestrictions = [...restrictions]

    if (selectedBlocks.length > 0) {
      // Add fixed slots for each day+block combo
      selectedDays.forEach((day) => {
        selectedBlocks.forEach((block) => {
          newRestrictions.push({
            restriction_type: "fixed_slot",
            value: { day, block },
          })
        })
      })
    } else {
      // Just available days
      newRestrictions.push({
        restriction_type: "available_days",
        value: selectedDays,
      })
    }

    onChange(newRestrictions)
    setAdding(false)
    resetAdd()
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1 min-h-[24px]">
        {restrictions.map((r, i) => (
          <Badge
            key={i}
            variant="secondary"
            className={cn(
              "text-xs font-normal py-0 h-5 gap-1 group/badge cursor-default",
              r.restriction_type === "fixed_slot"
                ? "bg-violet-100 text-violet-700 hover:bg-violet-100"
                : "bg-sky-100 text-sky-700 hover:bg-sky-100"
            )}
          >
            {formatRestriction(r)}
            <button
              onClick={() => removeRestriction(i)}
              className="opacity-0 group-hover/badge:opacity-100 hover:text-red-500 ml-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <button
          onClick={() => setAdding(true)}
          className="h-5 px-1.5 text-xs text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded flex items-center"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {adding && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-popover border rounded-md shadow-lg p-3 w-72">
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Limit which days/blocks this class can be scheduled
            </div>
            <div>
              <div className="text-xs font-medium mb-1">Available days</div>
              <div className="flex gap-1">
                {DAYS.map((day) => (
                  <button
                    key={day}
                    onClick={() => {
                      setSelectedDays((d) =>
                        d.includes(day) ? d.filter((x) => x !== day) : [...d, day]
                      )
                    }}
                    className={cn(
                      "px-2 py-1 text-xs rounded border transition-colors",
                      selectedDays.includes(day)
                        ? "bg-sky-500 text-white border-sky-500"
                        : "border-slate-200 hover:border-sky-300 hover:bg-sky-50"
                    )}
                  >
                    {day.slice(0, 2)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium mb-1">Fixed block (optional)</div>
              <div className="flex gap-1">
                {BLOCKS.map((block) => (
                  <button
                    key={block}
                    onClick={() => {
                      setSelectedBlocks((b) =>
                        b.includes(block) ? b.filter((x) => x !== block) : [...b, block]
                      )
                    }}
                    className={cn(
                      "w-7 h-7 text-xs rounded border transition-colors",
                      selectedBlocks.includes(block)
                        ? "bg-violet-500 text-white border-violet-500"
                        : "border-slate-200 hover:border-violet-300 hover:bg-violet-50"
                    )}
                  >
                    {block}
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Leave empty to allow any block on selected days
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={addRestriction}
                disabled={selectedDays.length === 0}
                className="h-6 text-xs bg-emerald-500 hover:bg-emerald-600 text-white disabled:bg-slate-200 disabled:text-slate-400"
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false)
                  resetAdd()
                }}
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
