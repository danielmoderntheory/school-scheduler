"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, AlertTriangle, Check } from "lucide-react"

interface Grade {
  id: string
  name: string
  display_name: string
  sort_order: number
}

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
  const [multiSelect, setMultiSelect] = useState(selectedIds.length > 1)
  const containerRef = useRef<HTMLDivElement>(null)

  // Filter to only individual grades (K-11)
  const individualGrades = grades
    .filter(g => g.sort_order >= 0 && g.sort_order <= 11)
    .sort((a, b) => a.sort_order - b.sort_order)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Sync multiSelect state with selectedIds
  useEffect(() => {
    if (selectedIds.length > 1 && !multiSelect) {
      setMultiSelect(true)
    }
  }, [selectedIds.length, multiSelect])

  const selectedGrades = individualGrades
    .filter(g => selectedIds.includes(g.id))
    .sort((a, b) => a.sort_order - b.sort_order)

  // Format display string
  function formatDisplay(): string {
    if (selectedGrades.length === 0) return placeholder

    if (selectedGrades.length === 1) {
      const base = selectedGrades[0].display_name
      return isElective ? `${base} Elective` : base
    }

    // For multiple grades, show range like "1st-3rd Grades"
    const first = selectedGrades[0].display_name.replace(' Grade', '')
    const last = selectedGrades[selectedGrades.length - 1].display_name.replace(' Grade', '')
    const range = `${first}-${last} Grades`

    return isElective ? `${range} Elective` : range
  }

  function handleSingleGradeChange(gradeId: string) {
    onChange([gradeId], isElective)
  }

  function toggleGrade(gradeId: string) {
    if (selectedIds.includes(gradeId)) {
      // Don't allow less than 1 grade
      if (selectedIds.length > 1) {
        onChange(selectedIds.filter(id => id !== gradeId), isElective)
      }
    } else {
      onChange([...selectedIds, gradeId], isElective)
    }
  }

  function handleMultiSelectToggle(enabled: boolean) {
    setMultiSelect(enabled)
    if (enabled) {
      // Switch to multi-select: keep current or default to first two
      if (selectedIds.length < 2) {
        const first = individualGrades[0]?.id
        const second = individualGrades[1]?.id
        onChange([first, second].filter(Boolean), isElective)
      }
    } else {
      // Switch to single: keep first selected
      const firstId = selectedIds[0] || individualGrades[0]?.id
      onChange(firstId ? [firstId] : [], isElective)
    }
  }

  function handleElectiveToggle(enabled: boolean) {
    onChange(selectedIds, enabled)
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
        <div className="absolute z-50 top-full left-0 mt-1 bg-popover border rounded-md shadow-lg p-3 min-w-[280px]">
          {/* Grade Selection Mode */}
          <div className="space-y-3">
            {/* Single Grade */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="gradeType"
                checked={!multiSelect}
                onChange={() => handleMultiSelectToggle(false)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">Single Grade</div>
                {!multiSelect && (
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

            {/* Multiple Grades */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="gradeType"
                checked={multiSelect}
                onChange={() => handleMultiSelectToggle(true)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">Multiple Grades</div>
                <div className="text-xs text-muted-foreground">For combined small classes</div>
                {multiSelect && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {individualGrades.map(g => {
                      const isSelected = selectedIds.includes(g.id)
                      const canDeselect = selectedIds.length > 1
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => toggleGrade(g.id)}
                          className={cn(
                            "px-2 py-0.5 rounded text-xs border transition-colors",
                            isSelected
                              ? "bg-sky-100 border-sky-300 text-sky-700"
                              : "border-slate-200 hover:border-slate-300",
                            isSelected && !canDeselect && "opacity-60"
                          )}
                        >
                          {g.display_name.replace(' Grade', '')}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </label>

            {/* Elective Checkbox */}
            <div className="border-t pt-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <div
                  onClick={() => handleElectiveToggle(!isElective)}
                  className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center mt-0.5 transition-colors",
                    isElective
                      ? "bg-violet-600 border-violet-600"
                      : "border-slate-300 hover:border-slate-400"
                  )}
                >
                  {isElective && <Check className="h-3 w-3 text-white" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">Elective</div>
                  <div className="text-xs text-muted-foreground">
                    Students choose from options, counts once per slot
                  </div>
                </div>
              </label>

              {/* Elective warnings/status */}
              {isElective && !hasRestrictions && (
                <div className="mt-2 flex items-start gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>Select restricted blocks so all elective options align</span>
                </div>
              )}
              {isElective && hasRestrictions && (
                <div className="mt-2 text-xs text-emerald-600">
                  ✓ Time slot set
                </div>
              )}
            </div>

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

  const sorted = [...grades].sort((a, b) => a.sort_order - b.sort_order)

  if (sorted.length === 1) {
    const base = sorted[0].display_name
    return isElective ? `${base} Elective` : base
  }

  // Show range for multiple grades like "1st-3rd Grades"
  const first = sorted[0].name.replace(' Grade', '')
  const last = sorted[sorted.length - 1].name.replace(' Grade', '')
  const range = `${first}-${last} Grades`

  return isElective ? `${range} Elective` : range
}
