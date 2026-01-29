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
import { Trash2, Loader2, GripVertical, ArrowLeft } from "lucide-react"
import Link from "next/link"
import toast from "react-hot-toast"

interface Grade {
  id: string
  name: string
  display_name: string
  sort_order: number
}

export default function GradesSettingsPage() {
  const [grades, setGrades] = useState<Grade[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [newGradeName, setNewGradeName] = useState("")
  const newGradeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadGrades()
  }, [])

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

  async function deleteGrade(id: string) {
    try {
      const res = await fetch(`/api/grades/${id}`, { method: "DELETE" })
      if (res.ok) {
        setGrades((prev) => prev.filter((g) => g.id !== id))
        toast.success("Grade deleted")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to delete grade")
      }
    } catch (error) {
      toast.error("Failed to delete grade")
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
                <TableHead className="w-[50px]">Order</TableHead>
                <TableHead className="w-[150px]">Name</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grades.map((grade) => (
                <TableRow key={grade.id}>
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
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete grade?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete {grade.display_name}.
                            Grades used in classes cannot be deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteGrade(grade.id)}
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
              {/* Add new grade row */}
              <TableRow>
                <TableCell colSpan={4}>
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
