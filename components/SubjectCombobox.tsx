"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface Subject {
  id: string
  name: string
}

interface SubjectComboboxProps {
  subjects: Subject[]
  value: string | null
  onChange: (subjectId: string, subjectName: string) => void
  onCreateSubject: (name: string) => Promise<Subject>
}

export function SubjectCombobox({
  subjects,
  value,
  onChange,
  onCreateSubject,
}: SubjectComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
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

  const filtered = subjects.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  )

  const showCreate =
    search.trim() &&
    !subjects.some((s) => s.name.toLowerCase() === search.toLowerCase())

  async function handleCreate() {
    if (!search.trim() || creating) return
    setCreating(true)
    try {
      const newSubject = await onCreateSubject(search.trim())
      onChange(newSubject.id, newSubject.name)
      setSearch("")
      setOpen(false)
    } finally {
      setCreating(false)
    }
  }

  function handleSelect(subject: Subject) {
    onChange(subject.id, subject.name)
    setSearch("")
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={open ? search : selectedSubject?.name || ""}
        onChange={(e) => {
          setSearch(e.target.value)
          if (!open) setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Select subject..."
        className="h-8"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-auto">
          {filtered.map((subject) => (
            <div
              key={subject.id}
              onClick={() => handleSelect(subject)}
              className={cn(
                "px-3 py-2 cursor-pointer hover:bg-accent text-sm",
                subject.id === value && "bg-accent"
              )}
            >
              {subject.name}
            </div>
          ))}
          {showCreate && (
            <div
              onClick={handleCreate}
              className="px-3 py-2 cursor-pointer hover:bg-accent text-sm text-primary border-t"
            >
              {creating ? "Creating..." : `Create "${search}"`}
            </div>
          )}
          {filtered.length === 0 && !showCreate && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No subjects found
            </div>
          )}
        </div>
      )}
    </div>
  )
}
