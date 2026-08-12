"use client"

import { useState, useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  Trash2,
  Users,
  Settings2,
  Check,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import toast from "@/lib/toast"
import { BLOCKS, DOUBLE_REQUIRED_FROM_SORT_ORDER, type TimetableTemplate } from "@/lib/types"
import { getTeachableBlocksForGrade } from "@/lib/timetable-utils"

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
// Stable default so existing call sites without a template keep the legacy 5-block grid
const DEFAULT_BLOCKS: number[] = [...BLOCKS]

// Prefix for temporary IDs to distinguish from real UUIDs
const PENDING_PREFIX = "pending:"

interface Teacher {
  id: string
  name: string
  status: string
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
  requires_double_periods?: boolean
}

interface Restriction {
  id?: string
  restriction_type: "fixed_slot" | "available_days" | "available_blocks"
  value: unknown
}

interface ClassEntry {
  id?: string
  teacher_id?: string
  grade_id?: string
  grade_ids?: string[]
  subject_id?: string
  days_per_week: number
  is_elective?: boolean
  is_cotaught?: boolean
  restrictions?: Restriction[]
}

interface Assignment {
  id: string
  teacherId: string
  teacherName: string
  // For co-taught (both regular and elective):
  coTeachers?: Array<{ id: string; name: string }>
  // For elective mode only:
  subjectId?: string
  subjectName?: string
  // For regular mode:
  restrictions: Restriction[]
}

// Pending items that will be created on confirm
interface PendingTeacher {
  tempId: string
  name: string
  status: "full-time" | "part-time"
}

interface PendingSubject {
  tempId: string
  name: string
}

interface AddClassModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teachers: Teacher[]
  grades: Grade[]
  subjects: Subject[]
  existingClasses: ClassEntry[]
  quarterId: string
  onCreateClass: (data: Partial<ClassEntry>) => Promise<ClassEntry | null>
  onCreateSubject: (name: string) => Promise<Subject | null>
  onCreateTeacher: (name: string, status: "full-time" | "part-time") => Promise<Teacher | null>
  /** Block numbers from the quarter's timetable template (defaults to legacy 1-5) */
  blocks?: number[]
  /** Quarter's timetable template — used to grey out a grade's lunch block */
  template?: TimetableTemplate | null
}

type Step = "setup" | "assign" | "confirm"

export function AddClassModal({
  open,
  onOpenChange,
  teachers,
  grades,
  subjects,
  existingClasses,
  quarterId,
  onCreateClass,
  onCreateSubject,
  onCreateTeacher,
  blocks = DEFAULT_BLOCKS,
  template = null,
}: AddClassModalProps) {
  // Step state
  const [step, setStep] = useState<Step>("setup")

  // Mode
  const [isElective, setIsElective] = useState(false)

  // Step 1: Setup
  const [gradeIds, setGradeIds] = useState<string[]>([])
  const [daysPerWeek, setDaysPerWeek] = useState(4)
  const [subjectId, setSubjectId] = useState("")
  const [subjectName, setSubjectName] = useState("")
  const [multiGrade, setMultiGrade] = useState(false)

  // Step 2: Assignments
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [sharedRestrictions, setSharedRestrictions] = useState<Restriction[]>([])

  // Pending items (created on confirm, not immediately)
  const [pendingTeachers, setPendingTeachers] = useState<PendingTeacher[]>([])
  const [pendingSubjects, setPendingSubjects] = useState<PendingSubject[]>([])

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Combined lists: existing + pending
  const allTeachers: Teacher[] = [
    ...teachers,
    ...pendingTeachers.map((p) => ({
      id: p.tempId,
      name: p.name,
      status: p.status,
    })),
  ]

  const allSubjects: Subject[] = [
    ...subjects,
    ...pendingSubjects.map((p) => ({
      id: p.tempId,
      name: p.name,
    })),
  ]

  // Filter to individual grades (K-11)
  const individualGrades = grades
    .filter((g) => g.sort_order >= 0 && g.sort_order <= 11)
    .sort((a, b) => a.sort_order - b.sort_order)

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setStep("setup")
      setIsElective(false)
      setGradeIds([])
      setDaysPerWeek(4)
      setSubjectId("")
      setSubjectName("")
      setMultiGrade(false)
      setAssignments([])
      setSharedRestrictions([])
      setPendingTeachers([])
      setPendingSubjects([])
    }
  }, [open])

  // === Pending Item Management ===
  function addPendingTeacher(name: string, status: "full-time" | "part-time"): string {
    const tempId = `${PENDING_PREFIX}${crypto.randomUUID()}`
    setPendingTeachers((prev) => [...prev, { tempId, name, status }])
    return tempId
  }

  function addPendingSubject(name: string): string {
    const tempId = `${PENDING_PREFIX}${crypto.randomUUID()}`
    setPendingSubjects((prev) => [...prev, { tempId, name }])
    return tempId
  }

  function isPendingId(id: string): boolean {
    return id.startsWith(PENDING_PREFIX)
  }

  function updatePendingTeacherStatus(tempId: string, status: "full-time" | "part-time") {
    setPendingTeachers((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, status } : p))
    )
  }

  function getPendingTeacherStatus(tempId: string): "full-time" | "part-time" | undefined {
    return pendingTeachers.find((p) => p.tempId === tempId)?.status
  }

  // === Step Navigation ===
  function canProceedFromSetup(): boolean {
    if (gradeIds.length === 0) return false
    if (!isElective && !subjectId) return false
    return true
  }

  function canProceedFromAssign(): boolean {
    if (isElective) {
      // Need at least 2 options for electives (otherwise it's not really a choice)
      if (assignments.length < 2) return false
      // Electives must have fixed time slots
      if (sharedRestrictions.length === 0) return false
      // Each option needs subject + teacher, and any co-teachers must also have IDs
      return assignments.every((a) => {
        if (!a.subjectId || !a.teacherId) return false
        // Check co-teachers have IDs if any exist
        if (a.coTeachers && a.coTeachers.length > 0) {
          return a.coTeachers.every((ct) => ct.id)
        }
        return true
      })
    } else {
      // Need at least one teacher
      if (assignments.length === 0) return false
      return assignments.every((a) => a.teacherId)
    }
  }

  function goNext() {
    if (step === "setup") {
      // Initialize assignments when moving to step 2
      if (isElective) {
        // Start with 2 empty elective options (electives need at least 2 choices)
        setAssignments([
          { id: crypto.randomUUID(), teacherId: "", teacherName: "", subjectId: "", subjectName: "", restrictions: [] },
          { id: crypto.randomUUID(), teacherId: "", teacherName: "", subjectId: "", subjectName: "", restrictions: [] },
        ])
      } else {
        // Start with 1 empty teacher assignment
        setAssignments([
          { id: crypto.randomUUID(), teacherId: "", teacherName: "", restrictions: [] },
        ])
      }
      setStep("assign")
    } else if (step === "assign") {
      setStep("confirm")
    }
  }

  function goBack() {
    if (step === "assign") {
      setStep("setup")
    } else if (step === "confirm") {
      setStep("assign")
    }
  }

  // === Create Classes (all creation happens here) ===
  async function handleCreate() {
    setIsSubmitting(true)

    try {
      // Collect which pending IDs are actually used in assignments
      const usedTeacherIds = new Set<string>()
      const usedSubjectIds = new Set<string>()

      for (const assignment of assignments) {
        if (assignment.teacherId && isPendingId(assignment.teacherId)) {
          usedTeacherIds.add(assignment.teacherId)
        }
        if (assignment.coTeachers) {
          for (const ct of assignment.coTeachers) {
            if (ct.id && isPendingId(ct.id)) {
              usedTeacherIds.add(ct.id)
            }
          }
        }
        if (isElective && assignment.subjectId && isPendingId(assignment.subjectId)) {
          usedSubjectIds.add(assignment.subjectId)
        }
      }
      // Also check main subject for regular mode
      if (!isElective && subjectId && isPendingId(subjectId)) {
        usedSubjectIds.add(subjectId)
      }

      // Step 1: Create only used pending teachers and build ID map
      const teacherIdMap = new Map<string, string>() // tempId -> realId
      for (const pending of pendingTeachers) {
        if (!usedTeacherIds.has(pending.tempId)) continue
        const created = await onCreateTeacher(pending.name, pending.status)
        if (created) {
          teacherIdMap.set(pending.tempId, created.id)
        } else {
          toast.error(`Failed to create teacher: ${pending.name}`)
          return
        }
      }

      // Step 2: Create only used pending subjects and build ID map
      const subjectIdMap = new Map<string, string>() // tempId -> realId
      for (const pending of pendingSubjects) {
        if (!usedSubjectIds.has(pending.tempId)) continue
        const created = await onCreateSubject(pending.name)
        if (created) {
          subjectIdMap.set(pending.tempId, created.id)
        } else {
          toast.error(`Failed to create subject: ${pending.name}`)
          return
        }
      }

      // Helper to resolve IDs (pending -> real, or keep existing)
      function resolveTeacherId(id: string): string {
        return isPendingId(id) ? (teacherIdMap.get(id) || id) : id
      }
      function resolveSubjectId(id: string): string {
        return isPendingId(id) ? (subjectIdMap.get(id) || id) : id
      }

      // Step 3: Create all classes
      const isRegularCotaught = !isElective && assignments.length > 1
      const createdClasses: ClassEntry[] = []

      for (const assignment of assignments) {
        // Use shared restrictions for electives, per-teacher restrictions for regular
        const restrictions = isElective ? sharedRestrictions : assignment.restrictions

        // Resolve subject ID
        const resolvedSubjectId = isElective
          ? (assignment.subjectId ? resolveSubjectId(assignment.subjectId) : undefined)
          : (subjectId ? resolveSubjectId(subjectId) : undefined)

        // Check if this elective option is co-taught
        const hasCoTeachers = assignment.coTeachers && assignment.coTeachers.length > 0
        const isOptionCotaught = isElective && hasCoTeachers

        // Create class for primary teacher
        const resolvedTeacherId = assignment.teacherId ? resolveTeacherId(assignment.teacherId) : undefined
        const classData: Partial<ClassEntry> = {
          teacher_id: resolvedTeacherId,
          grade_id: gradeIds[0],
          grade_ids: gradeIds,
          subject_id: resolvedSubjectId,
          days_per_week: daysPerWeek,
          is_elective: isElective,
          is_cotaught: isRegularCotaught || isOptionCotaught,
          restrictions,
        }

        const created = await onCreateClass(classData)
        if (created) {
          createdClasses.push(created)
        }

        // Create classes for co-teachers (elective options)
        if (isOptionCotaught && assignment.coTeachers) {
          for (const coTeacher of assignment.coTeachers) {
            if (!coTeacher.id) continue
            const resolvedCoTeacherId = resolveTeacherId(coTeacher.id)
            const coTeacherClassData: Partial<ClassEntry> = {
              teacher_id: resolvedCoTeacherId,
              grade_id: gradeIds[0],
              grade_ids: gradeIds,
              subject_id: resolvedSubjectId,
              days_per_week: daysPerWeek,
              is_elective: isElective,
              is_cotaught: true,
              restrictions,
            }

            const coCreated = await onCreateClass(coTeacherClassData)
            if (coCreated) {
              createdClasses.push(coCreated)
            }
          }
        }
      }

      if (createdClasses.length > 0) {
        const classWord = createdClasses.length === 1 ? "class" : "classes"
        const typeLabel = isElective ? "elective" : (isRegularCotaught ? "co-taught" : "")
        toast.success(`Created ${createdClasses.length} ${typeLabel} ${classWord}`.replace(/\s+/g, ' ').trim())
        onOpenChange(false)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // === Helper Functions ===
  // Calculate total class count including co-teachers
  function getTotalClassCount(): number {
    let count = 0
    for (const assignment of assignments) {
      count++ // Primary teacher
      if (assignment.coTeachers) {
        count += assignment.coTeachers.filter(ct => ct.id).length
      }
    }
    return count
  }

  function getSelectedGradeNames(): string {
    if (gradeIds.length === 0) return ""
    const selected = individualGrades
      .filter((g) => gradeIds.includes(g.id))
      .sort((a, b) => a.sort_order - b.sort_order)

    if (selected.length === 1) {
      return selected[0].display_name
    }
    const first = selected[0].display_name.replace(" Grade", "")
    const last = selected[selected.length - 1].display_name.replace(" Grade", "")
    return `${first}-${last} Grades`
  }

  function formatRestrictionsDisplay(restrictions: Restriction[]): string {
    if (restrictions.length === 0) return "None"

    const parts: string[] = []

    // Show available days first
    const availDays = restrictions.find((r) => r.restriction_type === "available_days")
    if (availDays) {
      parts.push((availDays.value as string[]).join(", "))
    }

    // Then show fixed slots
    const fixedSlots = restrictions.filter((r) => r.restriction_type === "fixed_slot")
    for (const r of fixedSlots) {
      const slot = r.value as { day: string; block: number }
      parts.push(`${slot.day} B${slot.block}`)
    }

    // Show available blocks if present
    const availBlocks = restrictions.find((r) => r.restriction_type === "available_blocks")
    if (availBlocks) {
      parts.push(`Blocks ${(availBlocks.value as number[]).join(", ")}`)
    }

    return parts.join(", ") || "None"
  }

  // Check if a teacher/subject is pending (for UI indication)
  function isTeacherPending(id: string): boolean {
    return isPendingId(id)
  }

  function isSubjectPending(id: string): boolean {
    return isPendingId(id)
  }

  // Does a subject require double periods? (pending subjects are always unflagged)
  function subjectRequiresDouble(id?: string): boolean {
    if (!id) return false
    return allSubjects.find((s) => s.id === id)?.requires_double_periods === true
  }

  // The "Double periods" flag only binds (back-to-back REQUIRED) when every
  // selected grade is 6th and up. Below that — and for unflagged subjects —
  // the scheduler may still pair lessons into doubles, but isn't required to.
  function doubleFlagBinds(): boolean {
    if (gradeIds.length === 0) return false
    return gradeIds.every((id) => {
      const grade = grades.find((g) => g.id === id)
      return grade !== undefined && grade.sort_order >= DOUBLE_REQUIRED_FROM_SORT_ORDER
    })
  }

  // === Render Step Content ===
  function renderSetupStep() {
    const selectedSubjectDouble = !isElective && subjectRequiresDouble(subjectId) && doubleFlagBinds()
    return (
      <div className="space-y-4">
        {/* Mode Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">What are you adding?</Label>
          <div className="space-y-1.5">
            <label
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                !isElective
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-slate-200 hover:border-slate-300"
              )}
            >
              <input
                type="radio"
                name="mode"
                checked={!isElective}
                onChange={() => setIsElective(false)}
              />
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">Regular Class</span>
                <span className="text-xs text-muted-foreground">— one subject, one or more teachers</span>
              </div>
            </label>
            <label
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                isElective
                  ? "border-violet-500 bg-violet-50"
                  : "border-slate-200 hover:border-slate-300"
              )}
            >
              <input
                type="radio"
                name="mode"
                checked={isElective}
                onChange={() => setIsElective(true)}
              />
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">Elective Class</span>
                <span className="text-xs text-muted-foreground">— students choose, fixed time slot</span>
              </div>
            </label>
          </div>
        </div>

        {/* Grade Selection */}
        <div className="space-y-2">
          <div>
            <Label className="text-sm font-medium">Grades</Label>
            <p className="text-xs text-muted-foreground">Which grade levels take this class</p>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="gradeMode"
                checked={!multiGrade}
                onChange={() => {
                  setMultiGrade(false)
                  if (gradeIds.length > 1) setGradeIds([gradeIds[0]])
                }}
              />
              <span className="text-sm">Single Grade</span>
              {!multiGrade && (
                <select
                  value={gradeIds[0] || ""}
                  onChange={(e) => setGradeIds(e.target.value ? [e.target.value] : [])}
                  className="ml-2 text-sm border rounded px-2 py-1"
                >
                  <option value="">Select...</option>
                  {individualGrades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.display_name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className={cn("flex gap-2 cursor-pointer", multiGrade ? "items-start" : "items-center")}>
              <input
                type="radio"
                name="gradeMode"
                checked={multiGrade}
                onChange={() => {
                  setMultiGrade(true)
                  setGradeIds([])
                }}
                className={multiGrade ? "mt-0.5" : ""}
              />
              <div className="flex-1">
                <span className="text-sm">Multiple Grades</span>
                {multiGrade && (
                  <>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Use when grades share the same class at the same time. Otherwise, create separate classes.
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {individualGrades.map((g) => {
                        const isSelected = gradeIds.includes(g.id)
                        const canDeselect = gradeIds.length > 1
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => {
                              if (isSelected && canDeselect) {
                                setGradeIds(gradeIds.filter((id) => id !== g.id))
                              } else if (!isSelected) {
                                setGradeIds([...gradeIds, g.id])
                              }
                            }}
                            className={cn(
                              "px-2 py-0.5 rounded text-xs border transition-colors",
                              isSelected
                                ? "bg-sky-100 border-sky-300 text-sky-700"
                                : "border-slate-200 hover:border-slate-300",
                              isSelected && !canDeselect && "opacity-60"
                            )}
                          >
                            {g.display_name.replace(" Grade", "")}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </label>
          </div>
        </div>

        {/* Subject (Regular mode only) */}
        {!isElective && (
          <div className="space-y-1.5">
            <div>
              <Label className="text-sm font-medium">Subject</Label>
              <p className="text-xs text-muted-foreground">What is being taught</p>
            </div>
            <SubjectSelect
              subjects={allSubjects}
              value={subjectId}
              onChange={(id, name) => {
                setSubjectId(id)
                setSubjectName(name)
              }}
              onCreatePending={(name) => {
                const tempId = addPendingSubject(name)
                setSubjectId(tempId)
                setSubjectName(name)
              }}
              isPending={isSubjectPending}
            />
          </div>
        )}

        {/* Blocks per Week */}
        <div className="space-y-1.5">
          <div>
            <Label className="text-sm font-medium">
              Blocks per Week
              {selectedSubjectDouble && (
                <span
                  title="Double periods required — lessons pair into back-to-back blocks"
                  className="ml-2 px-1 rounded bg-violet-100 text-violet-700 text-[10px] font-semibold cursor-help"
                >
                  2×
                </span>
              )}
            </Label>
            <p className="text-xs text-muted-foreground">How many times per week this class meets</p>
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDaysPerWeek(d)}
                className={cn(
                  "w-7 h-7 rounded border text-xs font-medium transition-colors",
                  daysPerWeek === d
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : "border-slate-200 hover:border-slate-300"
                )}
              >
                {d}
              </button>
            ))}
          </div>
          {selectedSubjectDouble && (
            <p className="text-xs text-violet-600">
              Lessons pair into back-to-back blocks (e.g. 7 lessons = 3 doubles + 1 single)
            </p>
          )}
        </div>
      </div>
    )
  }

  function renderAssignStep() {
    if (isElective) {
      return renderElectiveAssign()
    }
    return renderRegularAssign()
  }

  // Compute combined teacher availability (intersection of all assigned teachers)
  function getCombinedTeacherAvailability(): { days: string[] | null; blocks: number[] | null } {
    const assignedTeacherIds = assignments.map(a => a.teacherId).filter(Boolean)
    if (assignedTeacherIds.length === 0) return { days: null, blocks: null }

    let combinedDays: string[] | null = null
    let combinedBlocks: number[] | null = null

    for (const tid of assignedTeacherIds) {
      const t = teachers.find(t => t.id === tid)
      if (!t) continue
      if (t.available_days) {
        combinedDays = combinedDays
          ? combinedDays.filter(d => t.available_days!.includes(d))
          : [...t.available_days]
      }
      if (t.available_blocks) {
        combinedBlocks = combinedBlocks
          ? combinedBlocks.filter(b => t.available_blocks!.includes(b))
          : [...t.available_blocks]
      }
    }
    return { days: combinedDays, blocks: combinedBlocks }
  }

  // Blocks that are not teachable for one of the selected grades (e.g. that band's lunch block)
  function getLunchBlocks(): number[] {
    if (!template || gradeIds.length === 0) return []
    return blocks.filter((b) =>
      gradeIds.some((gid) => !getTeachableBlocksForGrade(template, gid).includes(b))
    )
  }

  function renderRegularAssign() {
    const isCotaught = assignments.length > 1
    // Use the first assignment's restrictions as the shared restrictions
    const sharedRestrictions = assignments[0]?.restrictions || []

    return (
      <div className="space-y-4">
        {/* Header info */}
        <div className="px-3 py-2 bg-slate-100 rounded-lg">
          <div className="text-sm font-medium">
            {getSelectedGradeNames()} · {subjectName}
            {isSubjectPending(subjectId) && <Badge variant="outline" className="ml-2 text-xs">New</Badge>}
            {" "}· {daysPerWeek} blocks/week
          </div>
        </div>

        {/* Teacher selection label */}
        <div>
          <Label className="text-sm font-medium">Select Teacher</Label>
          <p className="text-xs text-muted-foreground">Who will teach this class</p>
        </div>

        {/* Teacher assignments */}
        <div className="space-y-2">
          {assignments.map((assignment, index) => (
            <div key={assignment.id} className={cn("space-y-2", isCotaught && "p-3 border border-purple-200 bg-purple-50/50 rounded-lg")}>
              {isCotaught && (
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    Teacher {index + 1}
                    <span className="ml-2 text-purple-600 font-normal">(Co-taught)</span>
                  </Label>
                  {index > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setAssignments(assignments.filter((a) => a.id !== assignment.id))
                      }
                      className="h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}

              <TeacherSelect
                teachers={allTeachers}
                value={assignment.teacherId}
                onChange={(id, name) => {
                  setAssignments(
                    assignments.map((a) =>
                      a.id === assignment.id ? { ...a, teacherId: id, teacherName: name } : a
                    )
                  )
                }}
                onCreatePending={(name, status) => {
                  const tempId = addPendingTeacher(name, status)
                  setAssignments(
                    assignments.map((a) =>
                      a.id === assignment.id ? { ...a, teacherId: tempId, teacherName: name } : a
                    )
                  )
                }}
                onUpdatePendingStatus={updatePendingTeacherStatus}
                isPending={isTeacherPending}
                getPendingStatus={getPendingTeacherStatus}
                excludeIds={assignments.filter((a) => a.id !== assignment.id && a.teacherId).map((a) => a.teacherId)}
              />
            </div>
          ))}
        </div>

        {/* Add co-teacher button */}
        <button
          type="button"
          onClick={() =>
            setAssignments([
              ...assignments,
              { id: crypto.randomUUID(), teacherId: "", teacherName: "", restrictions: [] },
            ])
          }
          className="text-xs text-slate-500 hover:text-purple-600 flex items-center gap-1"
        >
          <Plus className="h-3 w-3" />
          Add Co-Teacher
        </button>

        {/* Co-taught indicator */}
        {isCotaught && (
          <div className="flex items-center gap-2 p-2 bg-purple-50 border border-purple-200 rounded text-sm text-purple-700">
            <Users className="h-4 w-4" />
            Co-taught: Both teachers scheduled together
          </div>
        )}

        {/* Restrictions (shared across all teachers) */}
        <div className="p-3 border rounded-lg bg-slate-50 space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Fixed Time Slots</Label>
            <RestrictionEditor
              restrictions={sharedRestrictions}
              onSave={(restrictions) => {
                // Apply restrictions to all assignments
                setAssignments(
                  assignments.map((a) => ({ ...a, restrictions }))
                )
              }}
              teacherAvailableDays={getCombinedTeacherAvailability().days}
              teacherAvailableBlocks={getCombinedTeacherAvailability().blocks}
              blocks={blocks}
              lunchBlocks={getLunchBlocks()}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {sharedRestrictions.length > 0
              ? formatRestrictionsDisplay(sharedRestrictions)
              : "Optional: Fix this class to specific time slots"}
          </p>
        </div>
      </div>
    )
  }

  function renderElectiveAssign() {
    return (
      <div className="space-y-4">
        {/* Header info */}
        <div className="px-3 py-2 bg-slate-100 rounded-lg">
          <div className="text-sm font-medium">
            {getSelectedGradeNames()} · {daysPerWeek} blocks/week · Elective
          </div>
        </div>

        {/* Elective selection label */}
        <div>
          <Label className="text-sm font-medium">Elective Options</Label>
          <p className="text-xs text-muted-foreground">Add at least 2 options — students choose one</p>
        </div>

        {/* Elective options */}
        <div className="space-y-3">
          {assignments.map((assignment, index) => (
            <div key={assignment.id} className="p-2 border rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Option {index + 1}</span>
                  {assignment.coTeachers && assignment.coTeachers.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-purple-600">
                      <Users className="h-3 w-3" />
                      Co-taught
                    </div>
                  )}
                </div>
                {assignments.length > 2 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setAssignments(assignments.filter((a) => a.id !== assignment.id))
                    }
                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Subject</Label>
                  <SubjectSelect
                    subjects={allSubjects}
                    value={assignment.subjectId || ""}
                    onChange={(id, name) => {
                      setAssignments(
                        assignments.map((a) =>
                          a.id === assignment.id
                            ? { ...a, subjectId: id, subjectName: name }
                            : a
                        )
                      )
                    }}
                    onCreatePending={(name) => {
                      const tempId = addPendingSubject(name)
                      setAssignments(
                        assignments.map((a) =>
                          a.id === assignment.id
                            ? { ...a, subjectId: tempId, subjectName: name }
                            : a
                        )
                      )
                    }}
                    isPending={isSubjectPending}
                    excludeIds={assignments
                      .filter((a) => a.id !== assignment.id && a.subjectId)
                      .map((a) => a.subjectId!)}
                  />
                </div>
                <div className="space-y-1 relative">
                  <Label className="text-xs text-muted-foreground">Teacher</Label>
                  <button
                    type="button"
                    onClick={() => {
                      setAssignments(
                        assignments.map((a) =>
                          a.id === assignment.id
                            ? { ...a, coTeachers: [...(a.coTeachers || []), { id: '', name: '' }] }
                            : a
                        )
                      )
                    }}
                    className="absolute top-0 right-0 text-[11px] text-purple-600 hover:text-purple-700"
                  >
                    + Add Co-Teacher
                  </button>
                  <TeacherSelect
                    teachers={allTeachers}
                    value={assignment.teacherId}
                    onChange={(id, name) => {
                      setAssignments(
                        assignments.map((a) =>
                          a.id === assignment.id ? { ...a, teacherId: id, teacherName: name } : a
                        )
                      )
                    }}
                    onCreatePending={(name, status) => {
                      const tempId = addPendingTeacher(name, status)
                      setAssignments(
                        assignments.map((a) =>
                          a.id === assignment.id ? { ...a, teacherId: tempId, teacherName: name } : a
                        )
                      )
                    }}
                    onUpdatePendingStatus={updatePendingTeacherStatus}
                    isPending={isTeacherPending}
                    getPendingStatus={getPendingTeacherStatus}
                    excludeIds={[
                      // Exclude co-teachers in same option
                      ...(assignment.coTeachers?.map(t => t.id) || []),
                      // Exclude all teachers from OTHER options
                      ...assignments
                        .filter(a => a.id !== assignment.id)
                        .flatMap(a => [a.teacherId, ...(a.coTeachers?.map(ct => ct.id) || [])])
                        .filter(Boolean)
                    ]}
                  />
                  {/* Co-teachers */}
                  {assignment.coTeachers?.map((coTeacher, coIdx) => (
                    <div key={coTeacher.id} className="flex items-center gap-1">
                      <div className="flex-1">
                        <TeacherSelect
                        teachers={allTeachers}
                        value={coTeacher.id}
                        onChange={(id, name) => {
                          setAssignments(
                            assignments.map((a) =>
                              a.id === assignment.id
                                ? {
                                    ...a,
                                    coTeachers: a.coTeachers?.map((ct, i) =>
                                      i === coIdx ? { id, name } : ct
                                    ),
                                  }
                                : a
                            )
                          )
                        }}
                        onCreatePending={(name, status) => {
                          const tempId = addPendingTeacher(name, status)
                          setAssignments(
                            assignments.map((a) =>
                              a.id === assignment.id
                                ? {
                                    ...a,
                                    coTeachers: a.coTeachers?.map((ct, i) =>
                                      i === coIdx ? { id: tempId, name } : ct
                                    ),
                                  }
                                : a
                            )
                          )
                        }}
                        onUpdatePendingStatus={updatePendingTeacherStatus}
                        isPending={isTeacherPending}
                        getPendingStatus={getPendingTeacherStatus}
                        excludeIds={[
                          // Exclude primary teacher and other co-teachers in same option
                          assignment.teacherId,
                          ...(assignment.coTeachers?.filter((_, i) => i !== coIdx).map(t => t.id) || []),
                          // Exclude all teachers from OTHER options
                          ...assignments
                            .filter(a => a.id !== assignment.id)
                            .flatMap(a => [a.teacherId, ...(a.coTeachers?.map(ct => ct.id) || [])])
                            .filter(Boolean)
                        ]}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAssignments(
                            assignments.map((a) =>
                              a.id === assignment.id
                                ? { ...a, coTeachers: a.coTeachers?.filter((_, i) => i !== coIdx) }
                                : a
                            )
                          )
                        }}
                        className="h-6 w-6 p-0 text-slate-400 hover:text-red-500"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add option button */}
        <button
          type="button"
          onClick={() =>
            setAssignments([
              ...assignments,
              {
                id: crypto.randomUUID(),
                teacherId: "",
                teacherName: "",
                subjectId: "",
                subjectName: "",
                restrictions: [],
              },
            ])
          }
          className="text-xs text-slate-500 hover:text-violet-600 flex items-center gap-1"
        >
          <Plus className="h-3 w-3" />
          {assignments.length === 1 ? "Add Elective Option" : "Add Another Option"}
        </button>

        {/* Elective explainer */}
        <div className="flex items-center gap-2 p-2 bg-violet-50 border border-violet-200 rounded text-sm text-violet-700">
          <Clock className="h-4 w-4 flex-shrink-0" />
          All options scheduled at the same time — students choose one
        </div>

        {/* Fixed time slots (shared across all electives) */}
        <div className="p-3 border rounded-lg space-y-2 bg-slate-50">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">
              Fixed Time Slots
              <span className="text-red-500 ml-0.5">*</span>
            </Label>
            <RestrictionEditor
              restrictions={sharedRestrictions}
              onSave={setSharedRestrictions}
              teacherAvailableDays={getCombinedTeacherAvailability().days}
              teacherAvailableBlocks={getCombinedTeacherAvailability().blocks}
              blocks={blocks}
              lunchBlocks={getLunchBlocks()}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {sharedRestrictions.length > 0
              ? `All options fixed to: ${formatRestrictionsDisplay(sharedRestrictions)}`
              : "Required: Select time slots so all options are scheduled together"}
          </p>
        </div>
      </div>
    )
  }

  function renderConfirmStep() {
    const isCotaught = !isElective && assignments.length > 1

    // Count only pending items that are actually used in assignments
    const usedPendingTeacherIds = new Set<string>()
    const usedPendingSubjectIds = new Set<string>()

    for (const assignment of assignments) {
      if (assignment.teacherId && isPendingId(assignment.teacherId)) {
        usedPendingTeacherIds.add(assignment.teacherId)
      }
      if (assignment.coTeachers) {
        for (const ct of assignment.coTeachers) {
          if (ct.id && isPendingId(ct.id)) {
            usedPendingTeacherIds.add(ct.id)
          }
        }
      }
      if (isElective && assignment.subjectId && isPendingId(assignment.subjectId)) {
        usedPendingSubjectIds.add(assignment.subjectId)
      }
    }
    if (!isElective && subjectId && isPendingId(subjectId)) {
      usedPendingSubjectIds.add(subjectId)
    }

    const pendingTeacherCount = usedPendingTeacherIds.size
    const pendingSubjectCount = usedPendingSubjectIds.size

    // Get restrictions to display (shared for electives, per-assignment for regular)
    const getRestrictions = (assignment: Assignment) => {
      return isElective ? sharedRestrictions : assignment.restrictions
    }

    // Build flat list of all class rows (including co-teachers)
    const allClassRows: Array<{
      key: string
      teacherId: string
      teacherName: string
      subjectId?: string
      subjectName?: string
      restrictions: Restriction[]
      isCotaughtClass: boolean
    }> = []

    for (const assignment of assignments) {
      // Check if this assignment has co-teachers (for electives) or if regular mode has multiple assignments
      const hasCoTeachers = assignment.coTeachers && assignment.coTeachers.some(ct => ct.id)
      const isThisCotaught = isElective ? !!hasCoTeachers : isCotaught

      // Primary teacher
      allClassRows.push({
        key: `${assignment.id}-primary`,
        teacherId: assignment.teacherId,
        teacherName: assignment.teacherName,
        subjectId: assignment.subjectId,
        subjectName: assignment.subjectName,
        restrictions: getRestrictions(assignment),
        isCotaughtClass: isThisCotaught,
      })
      // Co-teachers
      if (assignment.coTeachers) {
        for (let i = 0; i < assignment.coTeachers.length; i++) {
          const ct = assignment.coTeachers[i]
          if (ct.id) {
            allClassRows.push({
              key: `${assignment.id}-co-${i}`,
              teacherId: ct.id,
              teacherName: ct.name,
              subjectId: assignment.subjectId,
              subjectName: assignment.subjectName,
              restrictions: getRestrictions(assignment),
              isCotaughtClass: true,
            })
          }
        }
      }
    }

    const totalClassCount = allClassRows.length

    return (
      <div className="space-y-4">
        {/* Summary header */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Creating {totalClassCount} class{totalClassCount > 1 ? "es" : ""}</span>
            {isElective && (
              <Badge variant="secondary" className="bg-violet-100 text-violet-700">
                Elective
              </Badge>
            )}
            {isCotaught && (
              <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                <Users className="h-3 w-3 mr-1" />
                Co-taught
              </Badge>
            )}
          </div>
        </div>

        {/* Preview table matching Classes page structure */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left font-medium text-slate-500 px-3 py-2 w-[120px]">Teacher</th>
                <th className="text-left font-medium text-slate-500 px-3 py-2 w-[70px]">Grade</th>
                <th className="text-left font-medium text-slate-500 px-3 py-2 w-[80px]">Subject</th>
                <th className="text-left font-medium text-slate-500 px-3 py-2 w-[55px]">Blocks</th>
                <th className="text-left font-medium text-slate-500 px-3 py-2">Restrictions</th>
              </tr>
            </thead>
            <tbody>
              {allClassRows.map((row) => (
                  <tr key={row.key} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {row.teacherName || <span className="text-slate-400">—</span>}
                        {row.teacherId && isTeacherPending(row.teacherId) && (
                          <Badge variant="outline" className="text-xs py-0 h-4">New</Badge>
                        )}
                        {row.isCotaughtClass && (
                          <span className="text-xs text-purple-600">(co)</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {getSelectedGradeNames().replace(' Grade', '')}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {isElective ? (
                          <>
                            {row.subjectName || <span className="text-slate-400">—</span>}
                            {row.subjectId && isSubjectPending(row.subjectId) && (
                              <Badge variant="outline" className="text-xs py-0 h-4">New</Badge>
                            )}
                          </>
                        ) : (
                          <>
                            {subjectName}
                            {isSubjectPending(subjectId) && (
                              <Badge variant="outline" className="text-xs py-0 h-4">New</Badge>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {daysPerWeek}
                      {subjectRequiresDouble(isElective ? row.subjectId : subjectId) && doubleFlagBinds() && (
                        <span
                          title="Double periods required — lessons pair into back-to-back blocks"
                          className="ml-1 px-1 rounded bg-violet-100 text-violet-700 text-[10px] font-semibold cursor-help"
                        >
                          2×
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.restrictions.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.restrictions
                            .filter(r => r.restriction_type === "available_days")
                            .map((r, i) => (
                              <Badge
                                key={`avail-${i}`}
                                variant="secondary"
                                className="text-xs font-normal py-0 h-5 bg-sky-100 text-sky-700 hover:bg-sky-100"
                              >
                                {(r.value as string[]).join(", ")}
                              </Badge>
                            ))}
                          {row.restrictions
                            .filter(r => r.restriction_type === "fixed_slot")
                            .map((r, i) => {
                              const slot = r.value as { day: string; block: number }
                              return (
                                <Badge
                                  key={`fixed-${i}`}
                                  variant="secondary"
                                  className="text-xs font-normal py-0 h-5 bg-violet-100 text-violet-700 hover:bg-violet-100"
                                >
                                  {slot.day} B{slot.block}
                                </Badge>
                              )
                            })}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pending items summary */}
        {(pendingTeacherCount > 0 || pendingSubjectCount > 0) && (
          <div className="text-sm text-muted-foreground">
            Will also create:
            {pendingTeacherCount > 0 && (
              <span className="ml-1">
                {pendingTeacherCount} new teacher{pendingTeacherCount > 1 ? "s" : ""}
              </span>
            )}
            {pendingTeacherCount > 0 && pendingSubjectCount > 0 && <span>,</span>}
            {pendingSubjectCount > 0 && (
              <span className="ml-1">
                {pendingSubjectCount} new subject{pendingSubjectCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Class</DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center gap-2 text-sm pt-2">
              <span className={cn(
                "flex items-center gap-1.5",
                step === "setup" ? "text-foreground font-medium" : "text-muted-foreground"
              )}>
                <span className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium",
                  step === "setup" ? "bg-primary text-primary-foreground" : "bg-slate-200 text-slate-500"
                )}>1</span>
                Class
              </span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className={cn(
                "flex items-center gap-1.5",
                step === "assign" ? "text-foreground font-medium" : "text-muted-foreground"
              )}>
                <span className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium",
                  step === "assign" ? "bg-primary text-primary-foreground" : "bg-slate-200 text-slate-500"
                )}>2</span>
                {isElective ? "Subject/Teacher" : "Teacher"}
              </span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className={cn(
                "flex items-center gap-1.5",
                step === "confirm" ? "text-foreground font-medium" : "text-muted-foreground"
              )}>
                <span className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium",
                  step === "confirm" ? "bg-primary text-primary-foreground" : "bg-slate-200 text-slate-500"
                )}>3</span>
                Review
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {step === "setup" && renderSetupStep()}
          {step === "assign" && renderAssignStep()}
          {step === "confirm" && renderConfirmStep()}
        </div>

        {/* Footer */}
        <div className="flex justify-between pt-2">
          <div>
            {step !== "setup" && (
              <Button variant="outline" onClick={goBack} disabled={isSubmitting}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            {step !== "confirm" ? (
              <Button
                onClick={goNext}
                disabled={step === "setup" ? !canProceedFromSetup() : !canProceedFromAssign()}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleCreate} disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  `Create ${getTotalClassCount()} Class${getTotalClassCount() > 1 ? "es" : ""}`
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// === Sub-components ===

interface SubjectSelectProps {
  subjects: Subject[]
  value: string
  onChange: (id: string, name: string) => void
  onCreatePending: (name: string) => void
  isPending: (id: string) => boolean
  excludeIds?: string[]
}

function SubjectSelect({ subjects, value, onChange, onCreatePending, isPending, excludeIds = [] }: SubjectSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedSubject = subjects.find((s) => s.id === value)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const filtered = subjects
    .filter((s) => !excludeIds.includes(s.id))
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))

  const showCreate =
    search.trim() &&
    !subjects.some((s) => s.name.toLowerCase() === search.toLowerCase())

  function handleCreate() {
    if (!search.trim()) return
    onCreatePending(search.trim())
    setSearch("")
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          value={open ? search : selectedSubject?.name || ""}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Select or type to create..."
          className="h-9"
        />
        {selectedSubject && isPending(selectedSubject.id) && (
          <Badge variant="outline" className="absolute right-2 top-1/2 -translate-y-1/2 text-xs">
            New
          </Badge>
        )}
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-auto">
          {filtered.map((subject) => (
            <div
              key={subject.id}
              onClick={() => {
                onChange(subject.id, subject.name)
                setSearch("")
                setOpen(false)
              }}
              className={cn(
                "px-3 py-2 cursor-pointer hover:bg-accent text-sm flex items-center justify-between",
                subject.id === value && "bg-accent"
              )}
            >
              <span>{subject.name}</span>
              {isPending(subject.id) && (
                <Badge variant="outline" className="text-xs">New</Badge>
              )}
            </div>
          ))}
          {showCreate && (
            <div
              onClick={handleCreate}
              className="px-3 py-2 cursor-pointer hover:bg-accent text-sm text-primary border-t"
            >
              Create &quot;{search}&quot;
            </div>
          )}
          {filtered.length === 0 && !showCreate && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No subjects found</div>
          )}
        </div>
      )}
    </div>
  )
}

interface TeacherSelectProps {
  teachers: Teacher[]
  value: string
  onChange: (id: string, name: string) => void
  onCreatePending: (name: string, status: "full-time" | "part-time") => void
  onUpdatePendingStatus?: (id: string, status: "full-time" | "part-time") => void
  isPending: (id: string) => boolean
  getPendingStatus?: (id: string) => "full-time" | "part-time" | undefined
  excludeIds?: string[]
  placeholder?: string
}

function TeacherSelect({ teachers, value, onChange, onCreatePending, onUpdatePendingStatus, isPending, getPendingStatus, excludeIds = [], placeholder = "Select or type to create..." }: TeacherSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedTeacher = teachers.find((t) => t.id === value)
  const pendingStatus = value && isPending(value) && getPendingStatus ? getPendingStatus(value) : undefined

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const filtered = teachers
    .filter((t) => !excludeIds.includes(t.id))
    .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))

  const showCreate =
    search.trim() &&
    !teachers.some((t) => t.name.toLowerCase() === search.toLowerCase())

  function handleCreate() {
    if (!search.trim()) return
    onCreatePending(search.trim(), "full-time")
    setSearch("")
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          value={open ? search : selectedTeacher?.name || ""}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={cn("h-9", selectedTeacher && isPending(selectedTeacher.id) ? "pr-32" : "")}
        />
        {selectedTeacher && isPending(selectedTeacher.id) && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {onUpdatePendingStatus && (
              <select
                value={pendingStatus || "full-time"}
                onChange={(e) => {
                  e.stopPropagation()
                  onUpdatePendingStatus(selectedTeacher.id, e.target.value as "full-time" | "part-time")
                }}
                onClick={(e) => e.stopPropagation()}
                className="text-xs border rounded px-1 py-0.5 bg-white text-muted-foreground cursor-pointer hover:border-slate-400"
              >
                <option value="full-time">full-time</option>
                <option value="part-time">part-time</option>
              </select>
            )}
            <Badge variant="outline" className="text-xs">
              New
            </Badge>
          </div>
        )}
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-auto">
          {filtered.map((teacher) => (
            <div
              key={teacher.id}
              onClick={() => {
                onChange(teacher.id, teacher.name)
                setSearch("")
                setOpen(false)
              }}
              className={cn(
                "px-3 py-2 cursor-pointer hover:bg-accent text-sm flex items-center justify-between",
                teacher.id === value && "bg-accent"
              )}
            >
              <span>
                {teacher.name}
                {!isPending(teacher.id) && (
                  <span className="text-muted-foreground ml-1 text-xs">({teacher.status})</span>
                )}
              </span>
              {isPending(teacher.id) && (
                <Badge variant="outline" className="text-xs">New</Badge>
              )}
            </div>
          ))}
          {showCreate && (
            <div
              onClick={handleCreate}
              className="px-3 py-2 cursor-pointer hover:bg-accent text-sm text-primary border-t"
            >
              Create &quot;{search}&quot;
            </div>
          )}
          {filtered.length === 0 && !showCreate && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No teachers found</div>
          )}
        </div>
      )}
    </div>
  )
}

interface RestrictionEditorProps {
  restrictions: Restriction[]
  onSave: (restrictions: Restriction[]) => void
  teacherAvailableDays?: string[] | null
  teacherAvailableBlocks?: number[] | null
  blocks?: number[]
  lunchBlocks?: number[]
}

function RestrictionEditor({ restrictions, onSave, teacherAvailableDays, teacherAvailableBlocks, blocks = DEFAULT_BLOCKS, lunchBlocks = [] }: RestrictionEditorProps) {
  const [open, setOpen] = useState(false)
  const [fixedSlots, setFixedSlots] = useState<{ day: string; block: number }[]>([])
  const [availableDaysOnly, setAvailableDaysOnly] = useState<string[]>([])

  useEffect(() => {
    // Load fixed slots
    const fixed = restrictions.filter((r) => r.restriction_type === "fixed_slot")
    setFixedSlots(fixed.map((f) => f.value as { day: string; block: number }))

    // Load available days
    const availDays = restrictions.find((r) => r.restriction_type === "available_days")
    setAvailableDaysOnly(availDays ? (availDays.value as string[]) : [])
  }, [restrictions, open])

  // Blocks the class can actually be pinned to (template blocks minus lunch)
  const selectableBlocks = blocks.filter((b) => !lunchBlocks.includes(b))

  function handleSave() {
    const newRestrictions: Restriction[] = []

    // Check which days have all selectable blocks selected (should become available_days)
    const daysWithAllBlocks: string[] = []
    DAYS.forEach((day) => {
      const blocksForDay = fixedSlots.filter((s) => s.day === day).map((s) => s.block)
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
    fixedSlots.forEach((slot) => {
      if (!daysWithAllBlocks.includes(slot.day)) {
        newRestrictions.push({
          restriction_type: "fixed_slot",
          value: slot,
        })
      }
    })

    onSave(newRestrictions)
    setOpen(false)
  }

  function handleClear() {
    setFixedSlots([])
    setAvailableDaysOnly([])
  }

  // Count restrictions for badge
  const fixedSlotCount = restrictions.filter((r) => r.restriction_type === "fixed_slot").length
  const hasAvailDays = restrictions.some((r) => r.restriction_type === "available_days")
  const totalCount = fixedSlotCount + (hasAvailDays ? 1 : 0)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 px-2 gap-1">
          <Settings2 className="h-4 w-4" />
          {totalCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {totalCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
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
                        setFixedSlots(fixedSlots.filter((s) => newAvailDays.includes(s.day)))
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
            <table className="text-xs border rounded-md overflow-hidden border-separate border-spacing-0">
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
                        const isExplicitlySelected = fixedSlots.some(
                          (s) => s.day === day && s.block === block
                        )
                        const isDayInAvailable = availableDaysOnly.includes(day)
                        const dayHasExplicitSlots = fixedSlots.some((s) => s.day === day)
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
                                  const newSlots = [
                                    ...fixedSlots.filter((s) => s.day !== day),
                                    ...otherBlocks.map((b) => ({ day, block: b }))
                                  ]
                                  setFixedSlots(newSlots)
                                } else if (isExplicitlySelected) {
                                  // Explicitly selected - remove it
                                  setFixedSlots(fixedSlots.filter((s) => !(s.day === day && s.block === block)))
                                } else {
                                  // Not selected - add it
                                  setFixedSlots([...fixedSlots, { day, block }])
                                }
                              } else {
                                // Day not in available days (no days selected = all available)
                                if (isExplicitlySelected) {
                                  setFixedSlots(fixedSlots.filter((s) => !(s.day === day && s.block === block)))
                                } else {
                                  setFixedSlots([...fixedSlots, { day, block }])
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

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
            >
              Clear
            </Button>
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
