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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Trash2, Loader2, ArrowLeft, RotateCcw, ChevronDown, Archive, GripVertical } from "lucide-react"
import Link from "next/link"
import toast from "@/lib/toast"

interface Grade {
  id: string
  name: string
  display_name: string
  sort_order: number
  homeroom_teachers?: string
}

interface ArchiveStatus {
  entityId: string
  canArchive: boolean
  reason?: string
}

interface ArchivedGrade {
  id: string
  name: string
  deleted_at: string
}

export default function GradesSettingsPage() {
  const [grades, setGrades] = useState<Grade[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [newGradeName, setNewGradeName] = useState("")
  const newGradeRef = useRef<HTMLInputElement>(null)
  const [archiveStatus, setArchiveStatus] = useState<Map<string, ArchiveStatus>>(new Map())
  const [archiveStatusLoaded, setArchiveStatusLoaded] = useState(false)
  const [archivedGrades, setArchivedGrades] = useState<ArchivedGrade[]>([])
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  useEffect(() => {
    loadGrades()
    loadArchivedGrades()
  }, [])

  useEffect(() => {
    if (grades.length > 0) {
      loadArchiveStatus()
    }
  }, [grades])

  async function loadGrades() {
    try {
      const res = await fetch("/api/grades")
      if (res.ok) {
        const data = await res.json()
        setGrades(data)
      }
    } catch (error) {
      toast.error("Failed to load grades")
    } finally {
      setLoading(false)
    }
  }

  async function loadArchiveStatus() {
    try {
      const ids = grades.map((g) => g.id).join(",")
      const res = await fetch(`/api/archive-status?type=grade&ids=${ids}`)
      if (res.ok) {
        const data: ArchiveStatus[] = await res.json()
        const statusMap = new Map<string, ArchiveStatus>()
        for (const status of data) {
          statusMap.set(status.entityId, status)
        }
        setArchiveStatus(statusMap)
      }
    } catch (error) {
      console.error("Failed to load archive status:", error)
    } finally {
      setArchiveStatusLoaded(true)
    }
  }

  async function loadArchivedGrades() {
    try {
      const res = await fetch("/api/archived?type=grade")
      if (res.ok) {
        const data = await res.json()
        setArchivedGrades(data)
      }
    } catch (error) {
      console.error("Failed to load archived grades:", error)
    }
  }

  async function updateGrade(id: string, field: string, value: unknown) {
    setSavingId(id)
    try {
      const res = await fetch(`/api/grades/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        const updated = await res.json()
        setGrades((prev) =>
          prev.map((g) => (g.id === id ? updated : g))
        )
        toast.success("Saved")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to save")
      }
    } catch (error) {
      toast.error("Failed to save")
    } finally {
      setSavingId(null)
    }
  }

  async function createGrade() {
    if (!newGradeName.trim()) return

    try {
      const res = await fetch("/api/grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newGradeName.trim().toLowerCase().replace(/\s+/g, "-"),
          display_name: newGradeName.trim(),
        }),
      })
      if (res.ok) {
        const newGrade = await res.json()
        setGrades((prev) => [...prev, newGrade].sort((a, b) => a.sort_order - b.sort_order))
        setNewGradeName("")
        toast.success("Grade added")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to add grade")
      }
    } catch (error) {
      toast.error("Failed to add grade")
    }
  }

  async function archiveGrade(id: string) {
    try {
      const res = await fetch(`/api/grades/${id}`, { method: "DELETE" })
      if (res.ok) {
        setGrades((prev) => prev.filter((g) => g.id !== id))
        loadArchivedGrades()
        toast.success("Grade archived")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to archive grade")
      }
    } catch (error) {
      toast.error("Failed to archive grade")
    }
  }

  async function restoreGrade(id: string) {
    setRestoringId(id)
    try {
      const res = await fetch(`/api/grades/${id}/restore`, { method: "POST" })
      if (res.ok) {
        const restored = await res.json()
        setGrades((prev) => [...prev, restored].sort((a, b) => a.sort_order - b.sort_order))
        setArchivedGrades((prev) => prev.filter((g) => g.id !== id))
        toast.success("Grade restored")
      } else {
        toast.error("Failed to restore grade")
      }
    } catch (error) {
      toast.error("Failed to restore grade")
    } finally {
      setRestoringId(null)
    }
  }

  async function handleDrop(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return

    // Reorder locally
    const sorted = [...grades].sort((a, b) => a.sort_order - b.sort_order)
    const [moved] = sorted.splice(fromIdx, 1)
    const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx
    sorted.splice(insertAt, 0, moved)

    // Renumber sort_order sequentially
    const renumbered = sorted.map((grade, i) => ({ ...grade, sort_order: i }))
    setGrades(renumbered)

    // Save each grade's new sort_order
    try {
      await Promise.all(
        renumbered.map((grade, i) =>
          fetch(`/api/grades/${grade.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sort_order: i }),
          })
        )
      )
      toast.success("Order saved")
    } catch (error) {
      toast.error("Failed to save order")
      loadGrades() // Reload on error
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="max-w-4xl mx-auto p-8">
        <div className="mb-6">
          <Link
            href="/classes"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Classes
          </Link>
          <h1 className="text-3xl font-bold mb-2">Grades</h1>
          <p className="text-muted-foreground">
            Manage the grade levels available for classes. Individual grades are used when creating classes.
          </p>
        </div>

        {/* Individual Grades */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Individual Grades</h2>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead className="w-[50px]">Order</TableHead>
                  <TableHead className="w-[150px]">Name</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Homeroom Teachers</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grades.map((grade, displayIdx) => {
                  const status = archiveStatus.get(grade.id)
                  const canArchive = archiveStatusLoaded && status?.canArchive !== false

                  return (
                    <TableRow
                      key={grade.id}
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
                          const row = (e.target as HTMLElement).closest("tr")
                          if (row) e.dataTransfer.setDragImage(row, 0, 0)
                        }}
                        className="cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {grade.sort_order}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {grade.name}
                      </TableCell>
                      <TableCell>
                        <EditableText
                          value={grade.display_name}
                          onSave={(value) => updateGrade(grade.id, "display_name", value)}
                          saving={savingId === grade.id}
                        />
                      </TableCell>
                      <TableCell>
                        <EditableText
                          value={grade.homeroom_teachers || ""}
                          onSave={(value) => updateGrade(grade.id, "homeroom_teachers", value || null)}
                          saving={savingId === grade.id}
                          placeholder="e.g. Ms. Smith, Mr. Jones"
                        />
                      </TableCell>
                      <TableCell>
                        {canArchive ? (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Archive grade?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will archive {grade.display_name}. It can be restored later
                                  from the archived section.
                                  Grades used in classes cannot be archived.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => archiveGrade(grade.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Archive
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 cursor-not-allowed"
                                disabled
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground/50" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{status?.reason || "Cannot archive"}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {/* Add new grade row */}
                <TableRow>
                  <TableCell colSpan={6}>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        createGrade()
                      }}
                      className="flex items-center gap-2"
                    >
                      <Input
                        ref={newGradeRef}
                        value={newGradeName}
                        onChange={(e) => setNewGradeName(e.target.value)}
                        placeholder="Add new grade (e.g. 12th Grade)..."
                        className="max-w-[250px] h-8"
                      />
                      {newGradeName.trim() && (
                        <Button type="submit" size="sm" variant="secondary">
                          Add
                        </Button>
                      )}
                    </form>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Archived Grades Section */}
        {archivedGrades.length > 0 && (
          <Collapsible
            open={archivedOpen}
            onOpenChange={setArchivedOpen}
            className="mt-6"
          >
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
                <Archive className="h-4 w-4" />
                <span>Archived Grades ({archivedGrades.length})</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${archivedOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-[200px]">Archived</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archivedGrades.map((grade) => (
                      <TableRow key={grade.id}>
                        <TableCell className="text-muted-foreground">
                          {grade.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(grade.deleted_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => restoreGrade(grade.id)}
                            disabled={restoringId === grade.id}
                            className="flex items-center gap-1"
                          >
                            {restoringId === grade.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                            Restore
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </TooltipProvider>
  )
}

interface EditableTextProps {
  value: string
  onSave: (value: string) => void
  saving?: boolean
  placeholder?: string
}

function EditableText({ value, onSave, saving, placeholder }: EditableTextProps) {
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
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : value ? (
        <span>{value}</span>
      ) : (
        <span className="text-muted-foreground">{placeholder}</span>
      )}
    </div>
  )
}
