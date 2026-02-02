"use client"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { RefreshCw, AlertTriangle, Check } from "lucide-react"
import type { TeacherSchedule, GradeSchedule, FloatingBlock, PendingPlacement, ValidationError, CellLocation } from "@/lib/types"

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
const BLOCKS = [1, 2, 3, 4, 5]

export type { CellLocation }

interface ScheduleGridProps {
  schedule: TeacherSchedule | GradeSchedule
  type: "teacher" | "grade"
  name: string
  status?: string
  // Change indicator: 'pending' = changes will be applied, 'applied' = changes have been applied in preview
  changeStatus?: 'pending' | 'applied'
  // Selection mode props
  showCheckbox?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
  // Swap mode props
  swapMode?: boolean
  selectedCell?: CellLocation | null
  validTargets?: CellLocation[]
  highlightedCells?: CellLocation[]
  onCellClick?: (location: CellLocation, cellType: "study-hall" | "open" | "class") => void
  // Freeform mode props
  freeformMode?: boolean
  floatingBlocks?: FloatingBlock[]
  pendingPlacements?: PendingPlacement[]
  selectedFloatingBlock?: string | null
  validationErrors?: ValidationError[]
  onPickUp?: (location: CellLocation) => void
  onPlace?: (location: CellLocation) => void
  onUnplace?: (blockId: string) => void
  onDeselect?: () => void
  // For grade view: detect elective slots (multiple teachers at same slot)
  allTeacherSchedules?: Record<string, TeacherSchedule>
}

export function ScheduleGrid({
  schedule,
  type,
  name,
  status,
  changeStatus,
  showCheckbox,
  isSelected,
  onToggleSelect,
  swapMode,
  selectedCell,
  validTargets = [],
  highlightedCells = [],
  onCellClick,
  freeformMode,
  floatingBlocks = [],
  pendingPlacements = [],
  selectedFloatingBlock,
  validationErrors = [],
  onPickUp,
  onPlace,
  onUnplace,
  onDeselect,
  allTeacherSchedules,
}: ScheduleGridProps) {
  // Get cell content - handles both teacher schedules (single entry) and grade schedules (array)
  function getCellContent(day: string, block: number): [string, string] | null {
    const raw = schedule[day]?.[block]
    if (!raw) return null

    if (type === "grade") {
      // Grade schedule: array format [[teacher, subject], ...]
      // Return first entry for display (we handle multiple separately)
      if (Array.isArray(raw) && raw.length > 0) {
        // Check if it's array of arrays (new format) or single tuple (old format)
        if (Array.isArray(raw[0])) {
          return raw[0] as [string, string]
        }
        // Old format: single tuple
        return raw as unknown as [string, string]
      }
      return null
    }

    // Teacher schedule: single entry format [grade, subject]
    return raw as [string, string]
  }

  // Get all entries for a grade schedule slot (for elective detection)
  function getGradeSlotEntries(day: string, block: number): [string, string][] {
    if (type !== "grade") return []
    const raw = schedule[day]?.[block]
    if (!raw) return []

    // New format: array of arrays
    if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
      return raw as [string, string][]
    }
    // Old format: single tuple - wrap in array
    if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'string') {
      return [raw as unknown as [string, string]]
    }
    return []
  }

  // For grade view: check if this slot has multiple entries (elective slot)
  function isElectiveSlot(day: string, block: number): boolean {
    if (type !== "grade") return false
    const entries = getGradeSlotEntries(day, block)
    return entries.length > 1
  }

  function getCellType(entry: [string, string] | null): "study-hall" | "open" | "class" | "empty" {
    if (!entry) return "empty"
    const [, subject] = entry
    if (subject === "OPEN") return "open"
    if (subject === "Study Hall") return "study-hall"
    return "class"
  }

  function isValidTarget(day: string, block: number): boolean {
    if (type === "grade") {
      return validTargets.some(t => t.grade === name && t.day === day && t.block === block)
    }
    return validTargets.some(t => t.teacher === name && t.day === day && t.block === block)
  }

  function isSelectedCell(day: string, block: number): boolean {
    if (type === "grade") {
      return selectedCell?.grade === name && selectedCell?.day === day && selectedCell?.block === block
    }
    return selectedCell?.teacher === name && selectedCell?.day === day && selectedCell?.block === block
  }

  function isHighlightedCell(day: string, block: number): boolean {
    if (type === "grade") {
      return highlightedCells.some(c => c.grade === name && c.day === day && c.block === block)
    }
    return highlightedCells.some(c => c.teacher === name && c.day === day && c.block === block)
  }

  // Freeform mode helpers
  function isPickedUpCell(day: string, block: number): boolean {
    if (type !== "teacher") return false
    return floatingBlocks.some(b =>
      b.sourceTeacher === name && b.sourceDay === day && b.sourceBlock === block
    )
  }

  function hasPendingPlacement(day: string, block: number): PendingPlacement | undefined {
    if (type !== "teacher") return undefined
    return pendingPlacements.find(p =>
      p.teacher === name && p.day === day && p.block === block
    )
  }

  function hasValidationError(day: string, block: number): ValidationError | undefined {
    if (type !== "teacher") return undefined
    return validationErrors.find(e =>
      e.cells.some(c => c.teacher === name && c.day === day && c.block === block)
    )
  }

  function isValidFreeformTarget(day: string, block: number): boolean {
    if (!freeformMode || !selectedFloatingBlock) return false
    if (type !== "teacher") return false
    // Picked-up cells are valid targets (they're essentially empty now)
    if (isPickedUpCell(day, block)) return true
    const entry = getCellContent(day, block)
    const cellType = getCellType(entry)
    // Can place on OPEN cells or swap with classes/study halls
    return cellType === "open" || cellType === "empty" || cellType === "class" || cellType === "study-hall"
  }

  function getCellClass(entry: [string, string] | null, day: string, block: number): string {
    const baseClass = (() => {
      if (!entry) return "bg-muted/30"
      const [, subject] = entry
      if (subject === "OPEN") return "bg-gray-100 text-gray-500"
      if (subject === "Study Hall") return "bg-blue-100 text-blue-800"
      return "bg-green-50"
    })()

    // Add highlight animation for cells that just received swapped content
    if (isHighlightedCell(day, block)) {
      return cn(baseClass, "ring-2 ring-inset ring-violet-500 animate-pulse-highlight")
    }

    // Freeform mode styling
    if (freeformMode && type === "teacher") {
      const error = hasValidationError(day, block)
      const placement = hasPendingPlacement(day, block)
      const pickedUp = isPickedUpCell(day, block)

      // Error styling takes priority
      if (error) {
        return cn(baseClass, "ring-2 ring-inset ring-red-500 bg-red-100")
      }

      // Pending placement styling - use the block's natural color with a ring
      if (placement) {
        const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
        const isStudyHall = placedBlock?.subject === "Study Hall"
        const placementBg = isStudyHall ? "bg-blue-100" : "bg-green-50"
        // If a block is selected, this is a valid target
        if (selectedFloatingBlock) {
          return cn(placementBg, "ring-2 ring-inset ring-emerald-400 cursor-pointer hover:ring-emerald-500")
        }
        return cn(placementBg, "ring-2 ring-inset ring-indigo-400 cursor-pointer")
      }

      // Picked-up cell ghost styling - light indigo dashed
      if (pickedUp) {
        // If a block is selected, show as valid target
        if (selectedFloatingBlock) {
          return cn("bg-emerald-50 border-2 border-dashed border-emerald-400 cursor-pointer hover:bg-emerald-100")
        }
        return cn("bg-indigo-50 border-2 border-dashed border-indigo-300")
      }

      // Clickable cells - classes, study halls, and OPEN slots (when block selected)
      const cellType = getCellType(entry)
      if (cellType === "class" || cellType === "study-hall") {
        return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-300")
      }
      if (selectedFloatingBlock && (cellType === "open" || cellType === "empty")) {
        return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-300")
      }

      return baseClass
    }

    // Add swap mode styling
    if (swapMode) {
      if (isSelectedCell(day, block)) {
        return cn(baseClass, "ring-2 ring-inset ring-amber-500 bg-amber-100")
      }
      if (isValidTarget(day, block)) {
        return cn(baseClass, "ring-2 ring-inset ring-emerald-500 bg-emerald-100 cursor-pointer hover:bg-emerald-200")
      }
      // Clickable cells depend on view type
      const cellType = getCellType(entry)
      if (type === "teacher") {
        // Teacher view: can click study halls, open blocks, and classes
        if (cellType === "study-hall" || cellType === "open" || cellType === "class") {
          return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-slate-300")
        }
      } else if (type === "grade") {
        // Grade view: can click classes and study halls
        if (cellType === "class" || cellType === "study-hall") {
          return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-slate-300")
        }
      }
    }

    return baseClass
  }

  function handleCellClick(day: string, block: number) {
    // Handle freeform mode
    if (freeformMode && type === "teacher") {
      const entry = getCellContent(day, block)
      const cellType = getCellType(entry)
      const [grade, subject] = entry || ["", ""]
      const placement = hasPendingPlacement(day, block)

      // If clicking on a placed block (and no floating block selected), unplace it
      if (placement && !selectedFloatingBlock && onUnplace) {
        onUnplace(placement.blockId)
        return
      }

      // If a floating block is selected
      if (selectedFloatingBlock) {
        // Clicking a placed block - unplace it first, then place selected there
        if (placement && onUnplace && onPlace) {
          onUnplace(placement.blockId)
          onPlace({ teacher: name, day, block, grade, subject })
          return
        }

        // Clicking a picked-up cell or OPEN slot - place the block there
        if (isPickedUpCell(day, block) || cellType === "open" || cellType === "empty") {
          if (onPlace) {
            onPlace({ teacher: name, day, block, grade, subject })
          }
          return
        }

        // Clicking a class or study hall - place selected block there, pick up what's there
        if ((cellType === "class" || cellType === "study-hall") && onPlace && onPickUp) {
          // First place the floating block here
          onPlace({ teacher: name, day, block, grade, subject })
          // Then pick up what was there (this will be handled by the parent)
          return
        }

        return
      }

      // No block selected - clicking a class or study hall picks it up
      if ((cellType === "class" || cellType === "study-hall") && onPickUp) {
        onPickUp({ teacher: name, day, block, grade, subject })
        return
      }

      return
    }

    if (!swapMode || !onCellClick) return

    const entry = getCellContent(day, block)
    const cellType = getCellType(entry)

    if (type === "teacher") {
      // Teacher view: can click study halls, open blocks, classes, or valid targets
      if (cellType === "study-hall" || cellType === "open" || cellType === "class" || isValidTarget(day, block)) {
        const [grade, subject] = entry || ["", ""]
        onCellClick({ teacher: name, day, block, grade, subject }, cellType === "empty" ? "open" : cellType)
      }
    } else if (type === "grade") {
      // Grade view: can click classes, study halls, or valid targets
      if (cellType === "class" || cellType === "study-hall" || isValidTarget(day, block)) {
        const [teacher, subject] = entry || ["", ""]
        onCellClick({ grade: name, day, block, teacher, subject }, cellType === "empty" ? "open" : cellType)
      }
    }
  }

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden bg-white shadow-sm transition-all schedule-card",
        isSelected && "ring-2 ring-sky-500 border-sky-500"
      )}
    >
      <div
        className={cn(
          "px-3 py-2 font-medium border-b flex items-center justify-between",
          isSelected ? "bg-sky-50" : changeStatus === 'pending' ? "bg-amber-50" : changeStatus === 'applied' ? "bg-emerald-50" : "bg-slate-50"
        )}
      >
        <div className="flex items-center gap-2">
          {changeStatus === 'pending' && (
            <div className="flex items-center gap-1 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Changed</span>
            </div>
          )}
          {changeStatus === 'applied' && (
            <div className="flex items-center gap-1 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-xs font-medium">
              <Check className="h-3.5 w-3.5" />
              <span>Updated</span>
            </div>
          )}
          <span>{name}</span>
          {status && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                status === "full-time"
                  ? "border-sky-400 text-sky-700 bg-sky-50"
                  : "border-slate-300 text-slate-500"
              )}
            >
              {status}
            </Badge>
          )}
        </div>
        {showCheckbox && type === "teacher" && (
          <label className="flex items-center gap-1.5 cursor-pointer no-print">
            <RefreshCw className={cn("h-3 w-3", isSelected ? "text-sky-600" : "text-muted-foreground")} />
            <span className={cn("text-xs", isSelected ? "text-sky-600" : "text-muted-foreground")}>Regenerate</span>
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelect}
              className="data-[state=checked]:bg-sky-600 data-[state=checked]:border-sky-600"
            />
          </label>
        )}
      </div>
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-1.5 text-left w-8 text-xs"></th>
            {DAYS.map((day) => (
              <th key={day} className="p-1.5 text-center font-medium text-xs">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map((block) => (
            <tr key={block} className="border-b last:border-b-0">
              <td className="p-1.5 font-medium text-muted-foreground bg-muted/30 whitespace-nowrap text-xs">
                B{block}
              </td>
              {DAYS.map((day) => {
                const entry = getCellContent(day, block)
                const [primary, secondary] = entry || ["", ""]

                // In freeform mode, check for pending placements or picked-up state
                const placement = freeformMode && type === "teacher" ? hasPendingPlacement(day, block) : undefined
                const pickedUp = freeformMode && type === "teacher" && isPickedUpCell(day, block)
                const error = freeformMode && type === "teacher" ? hasValidationError(day, block) : undefined

                // Get display content - show placed block's content if there's a placement
                let displayPrimary = primary
                let displaySecondary = secondary
                let hasContent = !!entry

                if (placement) {
                  const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
                  if (placedBlock) {
                    displayPrimary = placedBlock.grade
                    displaySecondary = placedBlock.subject
                    hasContent = true
                  }
                }

                return (
                  <td
                    key={day}
                    onClick={() => handleCellClick(day, block)}
                    className={cn(
                      "p-1 text-center border-l overflow-hidden transition-all",
                      getCellClass(entry, day, block)
                    )}
                    title={error ? error.message : undefined}
                  >
                    {placement ? (
                      // Show the placed block's content
                      <div className="max-w-full overflow-hidden">
                        <div className="font-medium text-xs leading-tight truncate" title={displayPrimary}>
                          {displayPrimary.replace(' Grade', '').replace('Kindergarten', 'K')}
                        </div>
                        <div className="text-[10px] leading-tight text-muted-foreground truncate" title={displaySecondary}>
                          {displaySecondary}
                        </div>
                      </div>
                    ) : pickedUp ? (
                      <div className="text-[10px] text-indigo-400 italic">
                        moved
                      </div>
                    ) : displaySecondary === "OPEN" ? (
                      // OPEN cells just show "OPEN" without grade
                      <span className="text-xs text-muted-foreground">OPEN</span>
                    ) : hasContent ? (
                      <div className="max-w-full overflow-hidden">
                        {type === "grade" && isElectiveSlot(day, block) ? (
                          // Elective slot - show "Elective" as subject with same styling as regular classes
                          <>
                            <div className="font-medium text-xs leading-tight truncate" title="Elective (multiple options)">
                              Elective
                            </div>
                            <div className="text-[10px] leading-tight text-muted-foreground truncate" title={displayPrimary}>
                              {displayPrimary}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-xs leading-tight truncate" title={type === "teacher" ? displayPrimary : displaySecondary}>
                              {type === "teacher" ? displayPrimary.replace(' Grade', '').replace('Kindergarten', 'K') : displaySecondary}
                            </div>
                            <div className="text-[10px] leading-tight text-muted-foreground truncate" title={type === "teacher" ? displaySecondary : displayPrimary}>
                              {type === "teacher" ? displaySecondary : displayPrimary}
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
