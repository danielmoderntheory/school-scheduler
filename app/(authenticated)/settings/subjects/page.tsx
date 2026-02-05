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
import { Trash2, Loader2, ArrowLeft, RotateCcw, ChevronDown, Archive } from "lucide-react"
import Link from "next/link"
import toast from "@/lib/toast"

interface Subject {
  id: string
  name: string
}

interface ArchiveStatus {
  entityId: string
  canArchive: boolean
  reason?: string
}

interface ArchivedSubject {
  id: string
  name: string
  deleted_at: string
}

export default function SubjectsSettingsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [newSubjectName, setNewSubjectName] = useState("")
  const newSubjectRef = useRef<HTMLInputElement>(null)
  const [archiveStatus, setArchiveStatus] = useState<Map<string, ArchiveStatus>>(new Map())
  const [archiveStatusLoaded, setArchiveStatusLoaded] = useState(false)
  const [archivedSubjects, setArchivedSubjects] = useState<ArchivedSubject[]>([])
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  useEffect(() => {
    loadSubjects()
    loadArchivedSubjects()
  }, [])

  useEffect(() => {
    if (subjects.length > 0) {
      loadArchiveStatus()
    }
  }, [subjects])

  async function loadSubjects() {
    try {
      const res = await fetch("/api/subjects")
      if (res.ok) {
        const data = await res.json()
        setSubjects(data)
      }
    } catch (error) {
      toast.error("Failed to load subjects")
    } finally {
      setLoading(false)
    }
  }

  async function loadArchiveStatus() {
    try {
      const ids = subjects.map((s) => s.id).join(",")
      const res = await fetch(`/api/archive-status?type=subject&ids=${ids}`)
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

  async function loadArchivedSubjects() {
    try {
      const res = await fetch("/api/archived?type=subject")
      if (res.ok) {
        const data = await res.json()
        setArchivedSubjects(data)
      }
    } catch (error) {
      console.error("Failed to load archived subjects:", error)
    }
  }

  async function updateSubject(id: string, field: string, value: unknown) {
    setSavingId(id)
    try {
      const res = await fetch(`/api/subjects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        const updated = await res.json()
        setSubjects((prev) =>
          prev.map((s) => (s.id === id ? updated : s)).sort((a, b) => a.name.localeCompare(b.name))
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

  async function createSubject() {
    if (!newSubjectName.trim()) return

    try {
      const res = await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSubjectName.trim() }),
      })
      if (res.ok) {
        const newSubject = await res.json()
        setSubjects((prev) => [...prev, newSubject].sort((a, b) => a.name.localeCompare(b.name)))
        setNewSubjectName("")
        toast.success("Subject added")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to add subject")
      }
    } catch (error) {
      toast.error("Failed to add subject")
    }
  }

  async function archiveSubject(id: string) {
    try {
      const res = await fetch(`/api/subjects/${id}`, { method: "DELETE" })
      if (res.ok) {
        setSubjects((prev) => prev.filter((s) => s.id !== id))
        loadArchivedSubjects()
        toast.success("Subject archived")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to archive subject")
      }
    } catch (error) {
      toast.error("Failed to archive subject")
    }
  }

  async function restoreSubject(id: string) {
    setRestoringId(id)
    try {
      const res = await fetch(`/api/subjects/${id}/restore`, { method: "POST" })
      if (res.ok) {
        const restored = await res.json()
        setSubjects((prev) => [...prev, restored].sort((a, b) => a.name.localeCompare(b.name)))
        setArchivedSubjects((prev) => prev.filter((s) => s.id !== id))
        toast.success("Subject restored")
      } else {
        toast.error("Failed to restore subject")
      }
    } catch (error) {
      toast.error("Failed to restore subject")
    } finally {
      setRestoringId(null)
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
          <h1 className="text-3xl font-bold mb-2">Subjects</h1>
          <p className="text-muted-foreground">
            Manage subjects that can be assigned to classes. You can also create subjects
            directly from the Classes page.
          </p>
        </div>

        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject Name</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((subject) => {
                const status = archiveStatus.get(subject.id)
                const canArchive = archiveStatusLoaded && status?.canArchive !== false

                return (
                  <TableRow key={subject.id}>
                    <TableCell>
                      <EditableText
                        value={subject.name}
                        onSave={(value) => updateSubject(subject.id, "name", value)}
                        saving={savingId === subject.id}
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
                              <AlertDialogTitle>Archive subject?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will archive &quot;{subject.name}&quot;. It can be restored later
                                from the archived section.
                                Subjects used in classes cannot be archived.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => archiveSubject(subject.id)}
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
              {/* Add new subject row */}
              <TableRow>
                <TableCell colSpan={2}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      createSubject()
                    }}
                    className="flex items-center gap-2"
                  >
                    <Input
                      ref={newSubjectRef}
                      value={newSubjectName}
                      onChange={(e) => setNewSubjectName(e.target.value)}
                      placeholder="Add new subject..."
                      className="max-w-[300px] h-8"
                    />
                    {newSubjectName.trim() && (
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

        <div className="mt-4 text-sm text-muted-foreground">
          {subjects.length} subject{subjects.length !== 1 ? "s" : ""} total
        </div>

        {/* Archived Subjects Section */}
        {archivedSubjects.length > 0 && (
          <Collapsible
            open={archivedOpen}
            onOpenChange={setArchivedOpen}
            className="mt-6"
          >
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
                <Archive className="h-4 w-4" />
                <span>Archived Subjects ({archivedSubjects.length})</span>
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
                    {archivedSubjects.map((subject) => (
                      <TableRow key={subject.id}>
                        <TableCell className="text-muted-foreground">
                          {subject.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(subject.deleted_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => restoreSubject(subject.id)}
                            disabled={restoringId === subject.id}
                            className="flex items-center gap-1"
                          >
                            {restoringId === subject.id ? (
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
