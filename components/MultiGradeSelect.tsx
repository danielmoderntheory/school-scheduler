"use client"

import { useState, useRef, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, AlertTriangle } from "lucide-react"

interface Grade {
  id: string
  name: string
  display_name: string
  sort_order: number
}

interface MultiGradeSelectProps {
  grades: Grade[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  compact?: boolean
}

// Quick select presets
const PRESETS = [
  { label: "K-5", filter: (g: Grade) => g.sort_order <= 5 },
  { label: "6-8", filter: (g: Grade) => g.sort_order >= 6 && g.sort_order <= 8 },
  { label: "9-11", filter: (g: Grade) => g.sort_order >= 9 && g.sort_order <= 11 },
  { label: "6-11", filter: (g: Grade) => g.sort_order >= 6 && g.sort_order <= 11 },
]

export function MultiGradeSelect({
  grades,
  selectedIds,
  onChange,
  placeholder = "Select grades",
  compact = false,
}: MultiGradeSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Filter to only individual grades (not combined)
  const individualGrades = grades
    .filter(g => g.sort_order <= 11) // Only K-11
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

  const selectedGrades = individualGrades.filter(g => selectedIds.includes(g.id))
  const showWarning = selectedIds.length >= 3

  function toggleGrade(id: string) {
    if (selectedIds.includes(id)) {
      // Don't allow deselecting the last grade
      if (selectedIds.length > 1) {
        onChange(selectedIds.filter(i => i !== id))
      }
    } else {
      onChange([...selectedIds, id])
    }
  }

  function applyPreset(preset: typeof PRESETS[0]) {
    const ids = individualGrades.filter(preset.filter).map(g => g.id)
    onChange(ids)
  }

  function formatSelectedDisplay(): string {
    if (selectedGrades.length === 0) return placeholder

    // Check if selection matches a common pattern
    const sortedOrders = selectedGrades.map(g => g.sort_order).sort((a, b) => a - b)
    const isContiguous = sortedOrders.every((v, i) =>
      i === 0 || v === sortedOrders[i - 1] + 1
    )

    if (selectedGrades.length === 1) {
      return selectedGrades[0].display_name
    }

    if (isContiguous && selectedGrades.length > 2) {
      const first = selectedGrades[0]
      const last = selectedGrades[selectedGrades.length - 1]
      // Use short names for range display
      const firstName = first.name.replace(' Grade', '')
      const lastName = last.name.replace(' Grade', '')
      return `${firstName}-${lastName}`
    }

    // Just show count for non-contiguous selections
    return `${selectedGrades.length} grades`
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 rounded cursor-pointer hover:bg-muted text-sm text-left",
          compact ? "h-6 px-2" : "h-8 px-3 border",
          !selectedIds.length && "text-muted-foreground"
        )}
      >
        <span className="truncate flex-1">{formatSelectedDisplay()}</span>
        {showWarning && (
          <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
        )}
        <ChevronDown className={cn(
          "h-3 w-3 text-muted-foreground transition-transform flex-shrink-0",
          open && "rotate-180"
        )} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-popover border rounded-md shadow-lg p-2 min-w-[280px]">
          {/* Warning message */}
          {showWarning && (
            <div className="flex items-start gap-2 p-2 mb-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                This class will block {selectedGrades.length} grades from having
                other classes at the same time.
              </span>
            </div>
          )}

          {/* Quick select presets */}
          <div className="mb-2 pb-2 border-b">
            <div className="text-xs text-muted-foreground mb-1.5">Quick select:</div>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map(preset => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Grade checkboxes */}
          <div className="grid grid-cols-3 gap-1 max-h-[200px] overflow-auto">
            {individualGrades.map(grade => {
              const isSelected = selectedIds.includes(grade.id)
              return (
                <button
                  key={grade.id}
                  type="button"
                  onClick={() => toggleGrade(grade.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors text-left",
                    isSelected
                      ? "bg-sky-100 text-sky-700 hover:bg-sky-200"
                      : "hover:bg-muted"
                  )}
                >
                  <div className={cn(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0",
                    isSelected ? "bg-sky-500 border-sky-500" : "border-slate-300"
                  )}>
                    {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <span className="truncate">
                    {grade.display_name.replace(' Grade', '')}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Selected summary */}
          {selectedGrades.length > 0 && (
            <div className="mt-2 pt-2 border-t">
              <div className="flex flex-wrap gap-1">
                {selectedGrades.map(g => {
                  const canRemove = selectedGrades.length > 1
                  return (
                    <Badge
                      key={g.id}
                      variant="secondary"
                      className={cn(
                        "text-xs py-0 h-5",
                        canRemove && "cursor-pointer hover:bg-destructive/20"
                      )}
                      onClick={() => canRemove && toggleGrade(g.id)}
                    >
                      {g.display_name.replace(' Grade', '')}
                      {canRemove && <span className="ml-1 text-muted-foreground">×</span>}
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
