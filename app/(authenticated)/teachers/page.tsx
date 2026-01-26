"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { Trash2, Loader2 } from "lucide-react"
import toast from "react-hot-toast"

interface Teacher {
  id: string
  name: string
  status: "full-time" | "part-time"
  can_supervise_study_hall: boolean
  notes: string | null
}

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [newTeacherName, setNewTeacherName] = useState("")
  const newTeacherRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadTeachers()
  }, [])

  async function loadTeachers() {
    try {
      const res = await fetch("/api/teachers")
      if (res.ok) {
        const data = await res.json()
        setTeachers(data)
      }
    } catch (error) {
      toast.error("Failed to load teachers")
    } finally {
      setLoading(false)
    }
  }

  async function updateTeacher(id: string, field: string, value: unknown) {
    setSavingId(id)
    try {
      const res = await fetch(`/api/teachers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        const updated = await res.json()
        setTeachers((prev) =>
          prev.map((t) => (t.id === id ? updated : t))
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

  async function createTeacher() {
    if (!newTeacherName.trim()) return

    try {
      const res = await fetch("/api/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeacherName.trim() }),
      })
      if (res.ok) {
        const newTeacher = await res.json()
        setTeachers((prev) => [...prev, newTeacher].sort((a, b) => a.name.localeCompare(b.name)))
        setNewTeacherName("")
        toast.success("Teacher added")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to add teacher")
      }
    } catch (error) {
      toast.error("Failed to add teacher")
    }
  }

  async function deleteTeacher(id: string) {
    try {
      const res = await fetch(`/api/teachers/${id}`, { method: "DELETE" })
      if (res.ok) {
        setTeachers((prev) => prev.filter((t) => t.id !== id))
        toast.success("Teacher deleted")
      } else {
        toast.error("Failed to delete teacher")
      }
    } catch (error) {
      toast.error("Failed to delete teacher")
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
    <div className="max-w-6xl mx-auto p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Teachers</h1>
        <p className="text-muted-foreground">
          Click any cell to edit. Changes save automatically on blur.
        </p>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[250px]">Name</TableHead>
              <TableHead className="w-[150px]">Status</TableHead>
              <TableHead className="w-[120px]">Study Hall</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teachers.map((teacher) => (
              <TableRow key={teacher.id}>
                <TableCell>
                  <EditableText
                    value={teacher.name}
                    onSave={(value) => updateTeacher(teacher.id, "name", value)}
                    saving={savingId === teacher.id}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={teacher.status}
                    onValueChange={(value) =>
                      updateTeacher(teacher.id, "status", value)
                    }
                  >
                    <SelectTrigger className="h-8 w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full-time">Full-time</SelectItem>
                      <SelectItem value="part-time">Part-time</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={teacher.can_supervise_study_hall}
                    onCheckedChange={(checked) =>
                      updateTeacher(
                        teacher.id,
                        "can_supervise_study_hall",
                        checked
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <EditableText
                    value={teacher.notes || ""}
                    onSave={(value) =>
                      updateTeacher(teacher.id, "notes", value || null)
                    }
                    saving={savingId === teacher.id}
                    placeholder="Add notes..."
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
                        <AlertDialogTitle>Delete teacher?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete {teacher.name} and all
                          their associated classes.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteTeacher(teacher.id)}
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
            {/* Add new teacher row */}
            <TableRow>
              <TableCell colSpan={5}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    createTeacher()
                  }}
                  className="flex items-center gap-2"
                >
                  <Input
                    ref={newTeacherRef}
                    value={newTeacherName}
                    onChange={(e) => setNewTeacherName(e.target.value)}
                    placeholder="Add new teacher..."
                    className="max-w-[250px] h-8"
                  />
                  {newTeacherName.trim() && (
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
