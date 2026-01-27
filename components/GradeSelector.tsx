"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, AlertTriangle } from "lucide-react"

interface Grade {
  id: string
  name: string
  display_name: string
  sort_order: number
}

type GradeType = "single" | "merged" | "elective"

interface GradeSelectorProps {
  grades: Grade[]
  selectedIds: string[]
  isElective: boolean
  onChange: (ids: string[], isElective: boolean) => void
  hasRestrictions?: boolean
  placeholder?: string
  compact?: boolean
}

export function GradeSelector({
  grades,
  selectedIds,
  isElective,
  onChange,
  hasRestrictions = false,
  placeholder = "Select grade",
  compact = false,
}: GradeSelectorProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Filter to only individual grades (K-11)
  const individualGrades = grades
    .filter(g => g.sort_order >= 0 && g.sort_order <= 11)
    .sort((a, b) => a.sort_order - b.sort_order)

  // Upper grades for electives (6th-11th)
  const upperGrades = individualGrades.filter(g => g.sort_order >= 6)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const selectedGrades = individualGrades
    .filter(g => selectedIds.includes(g.id))
    .sort((a, b) => a.sort_order - b.sort_order)

  // Determine current type based on selection
  function getCurrentType(): GradeType {
    if (isElective) return "elective"
    if (selectedGrades.length <= 1) return "single"
    return "merged"
  }

  const currentType = getCurrentType()

  // Format display string - always show actual grades
  function formatDisplay(): string {
    if (selectedGrades.length === 0) return placeholder

    if (isElective) {
      return "6th-11th Elective"
    }

    if (selectedGrades.length === 1) {
      return selectedGrades[0].display_name
    }

    // For merged grades, show range like "6th-7th"
    const first = selectedGrades[0].name.replace(' Grade', '')
    const last = selectedGrades[selectedGrades.length - 1].name.replace(' Grade', '')
    return `${first}-${last}`
  }

  function handleTypeChange(type: GradeType) {
    if (type === "single") {
      // Keep first selected grade or pick first available
      const firstId = selectedIds[0] || individualGrades[0]?.id
      onChange(firstId ? [firstId] : [], false)
    } else if (type === "merged") {
      // Default to first two grades if not enough selected
      if (selectedIds.length < 2) {
        const first = individualGrades[0]?.id
        const second = individualGrades[1]?.id
        onChange([first, second].filter(Boolean), false)
      } else {
        onChange(selectedIds, false)
      }
    } else if (type === "elective") {
      // Auto-select 6th-11th
      const upperIds = upperGrades.map(g => g.id)
      onChange(upperIds, true)
    }
  }

  function handleSingleGradeChange(gradeId: string) {
    onChange([gradeId], false)
    setOpen(false)
  }

  function toggleMergedGrade(gradeId: string) {
    if (selectedIds.includes(gradeId)) {
      // Don't allow less than 2 for merged
      if (selectedIds.length > 2) {
        onChange(selectedIds.filter(id => id !== gradeId), false)
      }
    } else {
      onChange([...selectedIds, gradeId], false)
    }
  }

  const showElectiveWarning = isElective && !hasRestrictions

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 rounded cursor-pointer hover:bg-muted text-sm text-left",
          compact ? "h-6 px-2" : "h-8 px-3 border",
          !selectedIds.length && "text-muted-foreground",
          showElectiveWarning && "border-amber-400 bg-amber-50"
        )}
      >
        <span className="truncate flex-1">{formatDisplay()}</span>
        {showElectiveWarning && (
          <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
        )}
        <ChevronDown className={cn(
          "h-3 w-3 text-muted-foreground transition-transform flex-shrink-0",
          open && "rotate-180"
        )} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-popover border rounded-md shadow-lg p-3 min-w-[260px]">
          {/* Grade Type Selection */}
          <div className="space-y-2">
            {/* Single Grade */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="gradeType"
                checked={currentType === "single"}
                onChange={() => handleTypeChange("single")}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">Single Grade</div>
                {currentType === "single" && (
                  <select
                    value={selectedIds[0] || ""}
                    onChange={(e) => handleSingleGradeChange(e.target.value)}
                    className="mt-1 w-full text-sm border rounded px-2 py-1"
                  >
                    {individualGrades.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.display_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>

            {/* Merged Grades */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="gradeType"
                checked={currentType === "merged"}
                onChange={() => handleTypeChange("merged")}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">Merged Grades</div>
                <div className="text-xs text-muted-foreground">For combined small classes</div>
                {currentType === "merged" && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {individualGrades.map(g => {
                      const isSelected = selectedIds.includes(g.id)
                      const canDeselect = selectedIds.length > 2
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => toggleMergedGrade(g.id)}
                          className={cn(
                            "px-2 py-0.5 rounded text-xs border transition-colors",
                            isSelected
                              ? "bg-sky-100 border-sky-300 text-sky-700"
                              : "border-slate-200 hover:border-slate-300",
                            isSelected && !canDeselect && "opacity-60"
                          )}
                        >
                          {g.name.replace(' Grade', '')}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </label>

            {/* Elective */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="gradeType"
                checked={currentType === "elective"}
                onChange={() => handleTypeChange("elective")}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">Elective (6th-11th)</div>
                <div className="text-xs text-muted-foreground">Optional class, students pick one</div>
                {currentType === "elective" && !hasRestrictions && (
                  <div className="mt-2 flex items-start gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <span>Electives require restricted availability (fixed day/block)</span>
                  </div>
                )}
                {currentType === "elective" && hasRestrictions && (
                  <div className="mt-2 text-xs text-emerald-600">
                    Restrictions set
                  </div>
                )}
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper to format grade display for table columns
export function formatGradeDisplay(
  grades: Array<{ name: string; display_name: string; sort_order: number }>,
  isElective: boolean
): string {
  if (!grades || grades.length === 0) return "—"

  if (isElective) {
    return "6th-11th Elective"
  }

  const sorted = [...grades].sort((a, b) => a.sort_order - b.sort_order)

  if (sorted.length === 1) {
    return sorted[0].display_name
  }

  // Show range for merged grades
  const first = sorted[0].name.replace(' Grade', '')
  const last = sorted[sorted.length - 1].name.replace(' Grade', '')
  return `${first}-${last}`
}
