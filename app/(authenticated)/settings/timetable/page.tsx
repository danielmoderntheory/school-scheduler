"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Trash2, Loader2, ArrowLeft, Plus, GripVertical } from "lucide-react"
import Link from "next/link"
import toast from "@/lib/toast"
import { TimetableRow, TimetableRowType, TimetableTemplate } from "@/lib/types"

interface GradeData {
  id: string
  name: string
  display_name: string
  sort_order: number
}

export default function TimetableSettingsPage() {
  const [template, setTemplate] = useState<TimetableTemplate | null>(null)
  const [grades, setGrades] = useState<GradeData[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [templatesRes, gradesRes] = await Promise.all([
        fetch("/api/timetable-templates"),
        fetch("/api/grades"),
      ])
      const templates = await templatesRes.json()
      const gradesData = await gradesRes.json()
      setGrades(gradesData)
      if (templates.length > 0) {
        setTemplate(templates[0])
      }
    } catch {
      toast.error("Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  async function saveRows(rows: TimetableRow[]) {
    if (!template) return
    setSaving(true)
    try {
      const res = await fetch(`/api/timetable-templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      })
      if (res.ok) {
        const updated = await res.json()
        setTemplate(updated)
        toast.success("Saved")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to save")
      }
    } catch {
      toast.error("Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function createTemplate() {
    setSaving(true)
    try {
      const res = await fetch("/api/timetable-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Default", rows: [] }),
      })
      if (res.ok) {
        const created = await res.json()
        setTemplate(created)
        toast.success("Template created")
      } else {
        toast.error("Failed to create template")
      }
    } catch {
      toast.error("Failed to create template")
    } finally {
      setSaving(false)
    }
  }

  function updateRow(index: number, field: keyof TimetableRow, value: unknown) {
    if (!template) return
    const newRows = [...template.rows]
    newRows[index] = { ...newRows[index], [field]: value }
    // Clear blockNumber when type changes away from block
    if (field === "type" && value !== "block") {
      delete newRows[index].blockNumber
    }
    setTemplate({ ...template, rows: newRows })
    saveRows(newRows)
  }

  function addRow() {
    if (!template) return
    const maxOrder = template.rows.reduce(
      (max, r) => Math.max(max, r.sort_order),
      0
    )
    const newRow: TimetableRow = {
      sort_order: maxOrder + 1,
      time: "",
      label: "",
      type: "transition",
    }
    const newRows = [...template.rows, newRow]
    setTemplate({ ...template, rows: newRows })
    saveRows(newRows)
  }

  function deleteRow(index: number) {
    if (!template) return
    const newRows = template.rows.filter((_, i) => i !== index)
    setTemplate({ ...template, rows: newRows })
    saveRows(newRows)
  }

  function toggleGradeScope(rowIndex: number, gradeId: string) {
    if (!template) return
    const row = template.rows[rowIndex]
    const currentIds = row.grade_ids || []
    const newIds = currentIds.includes(gradeId)
      ? currentIds.filter((id) => id !== gradeId)
      : [...currentIds, gradeId]
    updateRow(rowIndex, "grade_ids", newIds.length > 0 ? newIds : undefined)
  }

  function clearGradeScope(rowIndex: number) {
    updateRow(rowIndex, "grade_ids", undefined)
  }

  function handleDrop(fromDisplayIdx: number, toDisplayIdx: number) {
    if (!template || fromDisplayIdx === toDisplayIdx) return
    const sorted = [...template.rows].sort((a, b) => a.sort_order - b.sort_order)
    const [moved] = sorted.splice(fromDisplayIdx, 1)
    // When dragging down, removing the source shifts indices below it up by one
    const insertAt = fromDisplayIdx < toDisplayIdx ? toDisplayIdx - 1 : toDisplayIdx
    sorted.splice(insertAt, 0, moved)
    // Renumber sort_order sequentially
    const renumbered = sorted.map((row, i) => ({ ...row, sort_order: i + 1 }))
    setTemplate({ ...template, rows: renumbered })
    saveRows(renumbered)
  }

  const sortedRows = template
    ? [...template.rows].sort((a, b) => a.sort_order - b.sort_order)
    : []

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!template) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <div className="mb-6">
          <Link
            href="/classes"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Classes
          </Link>
          <h1 className="text-3xl font-bold mb-2">Timetable Template</h1>
          <p className="text-muted-foreground mb-4">
            No timetable template exists yet. Create one to define the daily structure.
          </p>
          <Button onClick={createTemplate} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Template
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="mb-6">
        <Link
          href="/classes"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Classes
        </Link>
        <h1 className="text-3xl font-bold mb-2">Timetable Template</h1>
        <p className="text-muted-foreground">
          Define the daily structure for grade timetables — times, breaks, blocks, and transitions.
          Block rows map to schedule blocks 1-5.
        </p>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead className="w-[50px]">#</TableHead>
              <TableHead className="w-[160px]">Time</TableHead>
              <TableHead>Label</TableHead>
              <TableHead className="w-[130px]">Type</TableHead>
              <TableHead className="w-[80px]">Block #</TableHead>
              <TableHead className="w-[140px]">Grades</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row, displayIdx) => {
              // Find actual index in template.rows array
              const actualIdx = template.rows.indexOf(row)
              const gradeIds = row.grade_ids || []
              const scopedGradeNames = gradeIds
                .map((id) => grades.find((g) => g.id === id)?.display_name)
                .filter(Boolean)

              return (
                <TableRow
                  key={`${row.sort_order}-${displayIdx}`}
                  draggable={dragIdx !== null}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOverIdx(displayIdx)
                  }}
                  onDragLeave={() => setDragOverIdx(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragIdx !== null) handleDrop(dragIdx, displayIdx)
                    setDragIdx(null)
                    setDragOverIdx(null)
                  }}
                  onDragEnd={() => {
                    setDragIdx(null)
                    setDragOverIdx(null)
                  }}
                  className={
                    dragOverIdx === displayIdx && dragIdx !== displayIdx
                      ? "border-t-2 border-t-blue-400"
                      : dragIdx === displayIdx
                        ? "opacity-50"
                        : ""
                  }
                >
                  <TableCell
                    draggable
                    onDragStart={(e) => {
                      setDragIdx(displayIdx)
                      e.dataTransfer.effectAllowed = "move"
                      // Set drag image to the whole row
                      const row = (e.target as HTMLElement).closest("tr")
                      if (row) e.dataTransfer.setDragImage(row, 0, 0)
                    }}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.sort_order}
                  </TableCell>
                  <TableCell>
                    <EditableText
                      value={row.time}
                      onSave={(val) => updateRow(actualIdx, "time", val)}
                      placeholder="e.g. 8:20-9:20"
                    />
                  </TableCell>
                  <TableCell>
                    <EditableText
                      value={row.label}
                      onSave={(val) => updateRow(actualIdx, "label", val)}
                      placeholder="e.g. Block 1"
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={row.type}
                      onValueChange={(val) =>
                        updateRow(actualIdx, "type", val as TimetableRowType)
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="block">block</SelectItem>
                        <SelectItem value="break">break</SelectItem>
                        <SelectItem value="transition">transition</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {row.type === "block" ? (
                      <Input
                        type="number"
                        min={1}
                        max={5}
                        value={row.blockNumber || ""}
                        onChange={(e) =>
                          updateRow(
                            actualIdx,
                            "blockNumber",
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                        }
                        onWheel={(e) => (e.target as HTMLInputElement).blur()}
                        className="h-8 w-16"
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <GradeScopePopover
                      grades={grades}
                      selectedIds={gradeIds}
                      scopedNames={scopedGradeNames as string[]}
                      onToggle={(gradeId) => toggleGradeScope(actualIdx, gradeId)}
                      onClear={() => clearGradeScope(actualIdx)}
                    />
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete row?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove &quot;{row.label || "this row"}&quot; from the
                            timetable template.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteRow(actualIdx)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              )
            })}
            {/* Add row */}
            <TableRow>
              <TableCell colSpan={8}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addRow}
                  className="gap-1.5 text-muted-foreground"
                >
                  <Plus className="h-4 w-4" />
                  Add Row
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {saving && (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </div>
      )}
    </div>
  )
}

// --- EditableText (same pattern as grades page) ---

interface EditableTextProps {
  value: string
  onSave: (value: string) => void
  placeholder?: string
}

function EditableText({ value, onSave, placeholder }: EditableTextProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  useEffect(() => {
    setEditValue(value)
  }, [value])

  function handleBlur() {
    setEditing(false)
    if (editValue !== value) {
      onSave(editValue)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleBlur()
    }
    if (e.key === "Escape") {
      setEditValue(value)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="h-8"
      />
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="min-h-[32px] px-3 py-1 -mx-3 -my-1 rounded cursor-text hover:bg-muted/50 flex items-center"
    >
      {value ? (
        <span>{value}</span>
      ) : (
        <span className="text-muted-foreground">{placeholder}</span>
      )}
    </div>
  )
}

// --- Grade scope popover ---

interface GradeScopePopoverProps {
  grades: GradeData[]
  selectedIds: string[]
  scopedNames: string[]
  onToggle: (gradeId: string) => void
  onClear: () => void
}

function GradeScopePopover({
  grades,
  selectedIds,
  scopedNames,
  onToggle,
  onClear,
}: GradeScopePopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="min-h-[32px] px-3 py-1 rounded hover:bg-muted/50 text-left w-full">
          {scopedNames.length === 0 ? (
            <span className="text-muted-foreground">All</span>
          ) : (
            <span>{scopedNames.join(", ")}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">Grade Scope</span>
            {selectedIds.length > 0 && (
              <button
                onClick={onClear}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Reset to All
              </button>
            )}
          </div>
          {grades.map((grade) => (
            <label
              key={grade.id}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Checkbox
                checked={selectedIds.includes(grade.id)}
                onCheckedChange={() => onToggle(grade.id)}
              />
              <span className="text-sm">{grade.display_name}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
