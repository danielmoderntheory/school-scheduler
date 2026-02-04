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
import { Trash2, Loader2, ArrowLeft } from "lucide-react"
import Link from "next/link"
import toast from "@/lib/toast"

interface Subject {
  id: string
  name: string
}

export default function SubjectsSettingsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [newSubjectName, setNewSubjectName] = useState("")
  const newSubjectRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadSubjects()
  }, [])

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

  async function deleteSubject(id: string) {
    try {
      const res = await fetch(`/api/subjects/${id}`, { method: "DELETE" })
      if (res.ok) {
        setSubjects((prev) => prev.filter((s) => s.id !== id))
        toast.success("Subject deleted")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to delete subject")
      }
    } catch (error) {
      toast.error("Failed to delete subject")
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
            {subjects.map((subject) => (
              <TableRow key={subject.id}>
                <TableCell>
                  <EditableText
                    value={subject.name}
                    onSave={(value) => updateSubject(subject.id, "name", value)}
                    saving={savingId === subject.id}
                  />
                </TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete subject?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete "{subject.name}".
                          Subjects used in classes cannot be deleted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteSubject(subject.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
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
    </div>
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
