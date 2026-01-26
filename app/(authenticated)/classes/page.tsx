"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp, Loader2, Plus, X, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

interface LastRun {
  timestamp: string
  quarterId: string
  quarterName: string
  studyHallsPlaced: number
  backToBackIssues: number
  saved: boolean
}

interface Teacher {
  id: string
  name: string
  status: "full-time" | "part-time"
}

interface Grade {
  id: string
  name: string
  display_name: string
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
  subject_id: string
  days_per_week: number
  teacher: Teacher
  grade: Grade
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
  const [activeQuarter, setActiveQuarter] = useState<Quarter | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const pendingDeletes = useRef<Map<string, NodeJS.Timeout>>(new Map())

  useEffect(() => {
    loadData()
    // Load last run from localStorage
    const stored = localStorage.getItem('lastScheduleRun')
    if (stored) {
      try {
        const run = JSON.parse(stored) as LastRun
        // Check if within 48 hours
        const diffMs = Date.now() - new Date(run.timestamp).getTime()
        const hoursAgo = diffMs / (1000 * 60 * 60)
        if (hoursAgo <= 48) {
          setLastRun(run)
        }
      } catch (e) {
        // ignore
      }
    }
    // Cleanup pending deletes on unmount
    return () => {
      pendingDeletes.current.forEach((timeout) => clearTimeout(timeout))
    }
  }, [])

  async function loadData() {
    try {
      const [teachersRes, gradesRes, subjectsRes, quartersRes] = await Promise.all([
        fetch("/api/teachers"),
        fetch("/api/grades"),
        fetch("/api/subjects"),
        fetch("/api/quarters"),
      ])

      const [teachersData, gradesData, subjectsData, quartersData] = await Promise.all([
        teachersRes.json(),
        gradesRes.json(),
        subjectsRes.json(),
        quartersRes.json(),
      ])

      setTeachers(teachersData)
      setGrades(gradesData)
      setSubjects(subjectsData)

      const active = quartersData.find((q: Quarter) => q.is_active)
      setActiveQuarter(active || null)

      if (active) {
        const classesRes = await fetch(`/api/classes?quarter_id=${active.id}`)
        const classesData = await classesRes.json()
        // Sort by teacher name on initial load to group classes by teacher
        const sorted = [...classesData].sort((a: ClassEntry, b: ClassEntry) =>
          a.teacher.name.localeCompare(b.teacher.name)
        )
        setClasses(sorted)
      }
    } catch (error) {
      toast.error("Failed to load data")
    } finally {
      setLoading(false)
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

        // Show undo toast
        toast((t) => (
          <div className="flex items-center gap-3">
            <span className="text-sm">Row {rowNumber} updated</span>
            <button
              onClick={async () => {
                toast.dismiss(t.id)
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
              }}
              className="text-sm font-medium text-sky-600 hover:text-sky-700"
            >
              Undo
            </button>
          </div>
        ), { duration: 5000 })
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

        // Show undo toast
        toast((t) => (
          <div className="flex items-center gap-3">
            <span className="text-sm">Row {rowNumber} restrictions updated</span>
            <button
              onClick={async () => {
                toast.dismiss(t.id)
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
              className="text-sm font-medium text-sky-600 hover:text-sky-700"
            >
              Undo
            </button>
          </div>
        ), { duration: 5000 })
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

    // Show toast with undo
    toast((t) => (
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
          }}
          className="px-2 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded"
        >
          Undo
        </button>
      </div>
    ), { duration: 5000 })

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
        body: JSON.stringify({ name, status: "full-time" }),
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          {activeQuarter.name} &middot; {classes.length} classes
        </div>
        <Button
          size="sm"
          onClick={scrollToBottom}
          className="h-7 text-xs gap-1 bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          <Plus className="h-3 w-3" />
          Add Class
        </Button>
      </div>

      {showLastRunNotice && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-700">
          <Clock className="h-4 w-4 flex-shrink-0" />
          <span>
            You generated a schedule for these classes{" "}
            <span className="font-medium">{formatTimeAgo(lastRun.timestamp)}</span>.
          </span>
          <Link href="/generate" className="ml-auto text-sky-600 hover:text-sky-800 font-medium">
            View results →
          </Link>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
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
  onUpdate,
  onUpdateRestrictions,
  onDelete,
  onCreateSubject,
  onCreateTeacher,
}: ClassRowProps) {
  return (
    <tr className="border-b border-slate-100 hover:bg-blue-50/50 group">
      <td className="px-3 py-1 text-slate-400 text-xs w-10">{index}</td>
      <td className="px-1 py-1">
        <SelectCell
          value={cls.teacher_id}
          displayValue={cls.teacher?.name}
          options={teachers.map((t) => ({
            id: t.id,
            label: t.name,
            tag: t.status === "part-time" ? "PT" : undefined
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
        <SelectCell
          value={cls.grade_id}
          displayValue={cls.grade?.display_name}
          options={grades.map((g) => ({ id: g.id, label: g.display_name }))}
          onChange={(id) => onUpdate(cls.id, "grade_id", id)}
          placeholder="Select grade"
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
    grade_id: "",
    subject_id: "",
    days_per_week: 1,
  })
  const [isActive, setIsActive] = useState(false)

  async function handleCreate() {
    if (data.teacher_id && data.grade_id && data.subject_id) {
      const result = await onCreate(data)
      if (result) {
        setData({ teacher_id: "", grade_id: "", subject_id: "", days_per_week: 1 })
        setIsActive(false)
      }
    }
  }

  const canCreate = data.teacher_id && data.grade_id && data.subject_id

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
            tag: t.status === "part-time" ? "PT" : undefined
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
          <SelectCell
            value={data.grade_id}
            displayValue={grades.find((g) => g.id === data.grade_id)?.display_name}
            options={grades.map((g) => ({ id: g.id, label: g.display_name }))}
            onChange={(id) => setData((d) => ({ ...d, grade_id: id }))}
            placeholder="Grade"
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
