"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { RefreshCw, AlertTriangle, Check, Ban, X, ArrowLeftRight, Pencil } from "lucide-react"
import type { TeacherSchedule, GradeSchedule, FloatingBlock, PendingPlacement, ValidationError, CellLocation, OpenBlockLabels } from "@/lib/types"
import { BLOCK_TYPE_OPEN, isOpenBlock, isStudyHall, isScheduledClass, isFullTime, getOpenBlockAt, getOpenBlockLabel } from "@/lib/schedule-utils"
import { formatGradeDisplayCompact, isClassElective, isClassCotaught, type ClassSnapshotEntry } from "@/lib/grade-utils"

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
  // Selection mode props (regen mode)
  showCheckbox?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
  // Exclude mode props (study hall mode)
  showExcludeCheckbox?: boolean
  isExcluded?: boolean
  isExclusionLocked?: boolean // Can't be un-excluded (ineligible by rule)
  onToggleExclude?: () => void
  // Swap mode props
  swapMode?: boolean
  manualStudyHallMode?: boolean // Manual study hall placement - enables cell clicking
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
  autoFixedBlockIds?: string[]  // Our placements that have conflicts (amber)
  movedBlockerCells?: Array<{ teacher: string; day: string; block: number }>  // Cells where blockers were moved to (cyan)
  classesSnapshot?: ClassSnapshotEntry[]  // For elective detection
  onPickUp?: (location: CellLocation) => void
  onPlace?: (location: CellLocation) => void
  onUnplace?: (blockId: string) => void
  onDeselect?: () => void
  // OPEN block label props
  openBlockLabels?: OpenBlockLabels  // Custom labels for OPEN blocks
  showOpenLabels?: boolean  // Whether to display labels on OPEN blocks
  onOpenLabelChange?: (teacher: string, openIndex: number, label: string | undefined) => void  // Callback when label changes
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
  showExcludeCheckbox,
  isExcluded,
  isExclusionLocked,
  onToggleExclude,
  swapMode,
  manualStudyHallMode,
  selectedCell,
  validTargets = [],
  highlightedCells = [],
  onCellClick,
  freeformMode,
  floatingBlocks = [],
  pendingPlacements = [],
  selectedFloatingBlock,
  validationErrors = [],
  autoFixedBlockIds = [],
  movedBlockerCells = [],
  classesSnapshot,
  onPickUp,
  onPlace,
  onUnplace,
  onDeselect,
  openBlockLabels,
  showOpenLabels,
  onOpenLabelChange,
}: ScheduleGridProps) {
  // State for OPEN block label editing dropdown
  const [labelDropdownCell, setLabelDropdownCell] = useState<{ day: string; block: number; openIndex: number } | null>(null)
  const [labelDropdownPos, setLabelDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const [labelSearch, setLabelSearch] = useState("")
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)

  // Close label dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(event.target as Node)) {
        setLabelDropdownCell(null)
        setLabelDropdownPos(null)
        setLabelSearch("")
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Focus input when dropdown opens
  useEffect(() => {
    if (labelDropdownCell && labelInputRef.current) {
      labelInputRef.current.focus()
    }
  }, [labelDropdownCell])
  // Returns [primary, secondary, isMultiple] where isMultiple indicates multiple entries (electives)
  function getCellContent(day: string, block: number): { entry: [string, string] | null; isMultiple: boolean } {
    const raw = schedule[day]?.[block]
    if (!raw) return { entry: null, isMultiple: false }

    // Handle array format for grade schedules (electives): [[teacher, subject], ...]
    if (Array.isArray(raw) && raw.length > 0) {
      if (Array.isArray(raw[0])) {
        // New format: array of arrays
        const entries = raw as unknown as [string, string][]
        // Filter to actual classes (not OPEN or Study Hall)
        const classEntries = entries.filter(([, subject]) => isScheduledClass(subject))
        if (classEntries.length > 1) {
          // Multiple classes at same time = Elective period
          return { entry: ["", "Elective"], isMultiple: true }
        }
        // Single entry or only OPEN/Study Hall - return first
        return { entry: entries[0], isMultiple: false }
      }
      // Old format: single tuple [string, string]
      return { entry: raw as [string, string], isMultiple: false }
    }

    return { entry: null, isMultiple: false }
  }

  function getCellType(entry: [string, string] | null): "study-hall" | "open" | "class" | "empty" {
    if (!entry) return "empty"
    const [, subject] = entry
    if (isOpenBlock(subject)) return "open"
    if (isStudyHall(subject)) return "study-hall"
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

  function isMovedBlockerCell(day: string, block: number): boolean {
    if (type !== "teacher") return false
    return movedBlockerCells.some(c =>
      c.teacher === name && c.day === day && c.block === block
    )
  }

  function isValidFreeformTarget(day: string, block: number): boolean {
    if (!freeformMode || !selectedFloatingBlock) return false
    if (type !== "teacher") return false
    // Picked-up cells are valid targets (they're essentially empty now)
    if (isPickedUpCell(day, block)) return true
    const { entry } = getCellContent(day, block)
    const cellType = getCellType(entry)
    // Can place on OPEN cells or swap with classes/study halls
    return cellType === "open" || cellType === "empty" || cellType === "class" || cellType === "study-hall"
  }

  function getCellClass(entry: [string, string] | null, day: string, block: number): string {
    const baseClass = (() => {
      if (!entry) return "bg-muted/30"
      const [, subject] = entry
      if (isOpenBlock(subject)) return "bg-gray-100 text-gray-500"
      if (isStudyHall(subject)) return "bg-blue-100 text-blue-800"
      if (subject === "Elective") return "bg-purple-50"
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

      // Error styling — placed blocks keep the green ring (placed) + red background (conflict)
      if (error) {
        if (placement) {
          return cn("bg-red-100 ring-2 ring-inset ring-green-400 cursor-pointer")
        }
        return cn(baseClass, "ring-2 ring-inset ring-red-500 bg-red-100")
      }

      // Pending placement styling - use the block's natural color with a ring
      if (placement) {
        const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
        const placedBlockIsStudyHall = isStudyHall(placedBlock?.subject)
        const placementBg = placedBlockIsStudyHall ? "bg-blue-100" : "bg-green-50"
        const isAutoFixed = autoFixedBlockIds.includes(placement.blockId)
        // If a block is selected, this is a valid target
        if (selectedFloatingBlock) {
          return cn(placementBg, "ring-2 ring-inset ring-emerald-400 cursor-pointer hover:ring-emerald-500")
        }
        // Auto-fixed blocks get amber ring to distinguish from manual placements
        if (isAutoFixed) {
          return cn(placementBg, "ring-2 ring-inset ring-amber-400 cursor-pointer")
        }
        return cn(placementBg, "ring-2 ring-inset ring-green-400 cursor-pointer")
      }

      // Moved blocker cell styling - amber with pulse to show auto-moved classes
      if (isMovedBlockerCell(day, block)) {
        return cn(baseClass, "ring-2 ring-inset ring-amber-400 animate-pulse")
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

    // Manual study hall placement styling
    if (manualStudyHallMode && type === "teacher") {
      // Valid placement targets (when a group is selected)
      if (isValidTarget(day, block)) {
        return cn(baseClass, "ring-2 ring-inset ring-emerald-500 bg-emerald-100 cursor-pointer hover:bg-emerald-200")
      }
      // Placed study halls are clickable to remove
      if (entry && isStudyHall(entry[1])) {
        return cn(baseClass, "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-300")
      }
    }

    return baseClass
  }

  function handleCellClick(day: string, block: number) {
    // Handle freeform mode
    if (freeformMode && type === "teacher") {
      const { entry } = getCellContent(day, block)
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

    if (!(swapMode || manualStudyHallMode) || !onCellClick) return

    const { entry } = getCellContent(day, block)
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
      data-card-name={name}
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
                isFullTime(status)
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
        {showExcludeCheckbox && type === "teacher" && (
          <label
            className={cn(
              "flex items-center gap-1.5 no-print",
              isExclusionLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            )}
            title={isExclusionLocked ? "Ineligible for study hall supervision (by rule or teacher setting)" : undefined}
          >
            <Ban className={cn("h-3 w-3", isExcluded ? "text-violet-600" : "text-muted-foreground")} />
            <span className={cn("text-xs", isExcluded ? "text-violet-600" : "text-muted-foreground")}>Exclude</span>
            <Checkbox
              checked={isExcluded}
              onCheckedChange={isExclusionLocked ? undefined : onToggleExclude}
              disabled={isExclusionLocked}
              className="data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600"
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
                const { entry, isMultiple } = getCellContent(day, block)
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
                    {(() => {
                      // Check if this class is an elective or co-taught
                      // Teacher view: name=teacher, displayPrimary=grade, displaySecondary=subject
                      // Grade view: name=grade, displayPrimary=teacher, displaySecondary=subject
                      const teacherName = type === "teacher" ? name : displayPrimary
                      const subjectName = displaySecondary
                      const isRegularClass = isScheduledClass(subjectName) && !isStudyHall(subjectName)
                      const isElective = isRegularClass && isClassElective(teacherName, subjectName, classesSnapshot)
                      const isCotaught = isRegularClass && isClassCotaught(teacherName, subjectName, classesSnapshot)

                      if (placement) {
                        // Show the placed block's content
                        const placedBlock = floatingBlocks.find(b => b.id === placement.blockId)
                        const isTransferredPlacement = placedBlock?.transferredTo || (placedBlock && placement.teacher !== placedBlock.sourceTeacher)
                        return (
                          <div className="max-w-full overflow-visible relative">
                            {isTransferredPlacement && <ArrowLeftRight className="absolute top-0 left-0 h-2.5 w-2.5 text-teal-500 z-10" />}
                            <div className="font-medium text-xs leading-tight truncate" title={displayPrimary}>
                              {formatGradeDisplayCompact(displayPrimary)}
                            </div>
                            <div className="text-[10px] leading-tight text-muted-foreground truncate" title={displaySecondary}>
                              {displaySecondary}
                            </div>
                          </div>
                        )
                      }
                      if (pickedUp) {
                        return (
                          <div className="text-[10px] text-indigo-400 italic">
                            moved
                          </div>
                        )
                      }
                      if (isOpenBlock(displaySecondary)) {
                        // OPEN cells - check for custom label
                        const openBlockInfo = type === "teacher" ? getOpenBlockAt(schedule as TeacherSchedule, day, block) : null
                        const label = openBlockInfo && showOpenLabels
                          ? getOpenBlockLabel(openBlockLabels, name, openBlockInfo.openIndex, openBlockInfo.type)
                          : undefined
                        const displayText = label || BLOCK_TYPE_OPEN
                        const isDropdownOpen = labelDropdownCell?.day === day && labelDropdownCell?.block === block

                        // If label editing is enabled, show clickable cell with dropdown
                        if (type === "teacher" && onOpenLabelChange && openBlockInfo) {
                          return (
                            <div className="relative">
                              <span
                                className={cn(
                                  "cursor-pointer hover:underline text-center inline-flex items-center gap-1",
                                  label
                                    ? "text-[11px] text-slate-700 font-semibold leading-[1.2]"
                                    : "text-xs text-muted-foreground"
                                )}
                                style={label ? { maxWidth: '100%', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden', wordBreak: 'break-word' } : undefined}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  setLabelDropdownPos({
                                    top: rect.bottom + 4,
                                    left: rect.left + rect.width / 2
                                  })
                                  setLabelDropdownCell({ day, block, openIndex: openBlockInfo.openIndex })
                                  setLabelSearch("")
                                }}
                              >
                                {displayText}
                                {!label && <Pencil className="h-2.5 w-2.5 text-muted-foreground/50" />}
                              </span>
                              {isDropdownOpen && labelDropdownPos && (
                                <div
                                  ref={labelDropdownRef}
                                  className="fixed z-[100] bg-popover border rounded-lg shadow-xl w-[240px] -translate-x-1/2"
                                  style={{
                                    top: labelDropdownPos.top,
                                    left: labelDropdownPos.left,
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* Header with X button */}
                                  <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 rounded-t-lg">
                                    <span className="text-xs font-medium text-muted-foreground">Label</span>
                                    <button
                                      onClick={() => {
                                        setLabelDropdownCell(null)
                                        setLabelDropdownPos(null)
                                        setLabelSearch("")
                                      }}
                                      className="p-0.5 rounded hover:bg-muted"
                                    >
                                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                                    </button>
                                  </div>
                                  {/* Input */}
                                  <div className="p-2">
                                    <Input
                                      ref={labelInputRef}
                                      value={labelSearch}
                                      onChange={(e) => setLabelSearch(e.target.value)}
                                      placeholder="Type or select..."
                                      className="h-8 text-sm"
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && labelSearch.trim()) {
                                          onOpenLabelChange(name, openBlockInfo.openIndex, labelSearch.trim())
                                          setLabelDropdownCell(null)
                                          setLabelDropdownPos(null)
                                          setLabelSearch("")
                                        } else if (e.key === "Escape") {
                                          setLabelDropdownCell(null)
                                          setLabelDropdownPos(null)
                                          setLabelSearch("")
                                        }
                                      }}
                                    />
                                  </div>
                                  {/* Options */}
                                  <div className="max-h-40 overflow-auto border-t">
                                    {/* Available labels */}
                                    {(openBlockLabels?.availableLabels || [])
                                      .filter(l => l.toLowerCase().includes(labelSearch.toLowerCase()))
                                      .map((availLabel) => (
                                        <div
                                          key={availLabel}
                                          onClick={() => {
                                            onOpenLabelChange(name, openBlockInfo.openIndex, availLabel)
                                            setLabelDropdownCell(null)
                                            setLabelDropdownPos(null)
                                            setLabelSearch("")
                                          }}
                                          className={cn(
                                            "px-3 py-1.5 cursor-pointer hover:bg-accent text-sm flex items-center gap-2",
                                            label === availLabel && "bg-accent"
                                          )}
                                        >
                                          <div className={cn(
                                            "w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                                            label === availLabel ? "border-primary" : "border-muted-foreground/40"
                                          )}>
                                            {label === availLabel && (
                                              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                            )}
                                          </div>
                                          <span>{availLabel}</span>
                                        </div>
                                      ))}
                                    {/* Create new option */}
                                    {labelSearch.trim() && !openBlockLabels?.availableLabels?.some(
                                      l => l.toLowerCase() === labelSearch.toLowerCase()
                                    ) && (
                                      <div
                                        onClick={() => {
                                          onOpenLabelChange(name, openBlockInfo.openIndex, labelSearch.trim())
                                          setLabelDropdownCell(null)
                                          setLabelDropdownPos(null)
                                          setLabelSearch("")
                                        }}
                                        className="px-3 py-1.5 cursor-pointer hover:bg-accent text-sm text-primary border-t flex items-center gap-2"
                                      >
                                        <div className="w-3.5 h-3.5 rounded-full border-2 border-primary/40 flex-shrink-0" />
                                        <span>Create &quot;{labelSearch.trim()}&quot;</span>
                                      </div>
                                    )}
                                    {/* No labels yet message */}
                                    {(!openBlockLabels?.availableLabels || openBlockLabels.availableLabels.length === 0) && !labelSearch.trim() && (
                                      <div className="px-3 py-2 text-xs text-muted-foreground">
                                        Type to create a label
                                      </div>
                                    )}
                                  </div>
                                  {/* Clear option at bottom - only show if there's a label set */}
                                  {label && (
                                    <div
                                      onClick={() => {
                                        onOpenLabelChange(name, openBlockInfo.openIndex, undefined)
                                        setLabelDropdownCell(null)
                                        setLabelDropdownPos(null)
                                        setLabelSearch("")
                                      }}
                                      className="px-3 py-1.5 cursor-pointer hover:bg-red-50 text-xs text-muted-foreground border-t"
                                    >
                                      Clear label
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        }

                        // Read-only display (or grade view)
                        return (
                          <span
                            className={cn(
                              "text-center",
                              label
                                ? "text-[11px] text-slate-700 font-semibold leading-[1.2]"
                                : "text-xs text-muted-foreground"
                            )}
                            style={label ? { maxWidth: '100%', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden', wordBreak: 'break-word' } : undefined}
                          >
                            {displayText}
                          </span>
                        )
                      }
                      if (isMultiple) {
                        // Multiple entries (electives) - show just "Elective" or "Multiple"
                        return (
                          <div className="max-w-full overflow-hidden">
                            <div className="font-medium text-xs leading-tight text-purple-700">
                              {displaySecondary}
                            </div>
                          </div>
                        )
                      }
                      if (hasContent) {
                        return (
                          <div className="max-w-full overflow-hidden">
                            <div className="font-medium text-xs leading-tight truncate flex items-center justify-center" title={type === "teacher" ? displayPrimary : displaySecondary}>
                              <span className="truncate">{type === "teacher" ? formatGradeDisplayCompact(displayPrimary) : displaySecondary}</span>
                              {isElective && <span className="text-purple-500 ml-1 text-[10px] flex-shrink-0">EL</span>}
                            </div>
                            <div className="text-[10px] leading-tight text-muted-foreground truncate flex items-center justify-center" title={type === "teacher" ? displaySecondary : displayPrimary}>
                              <span className="truncate">{type === "teacher" ? displaySecondary : displayPrimary}</span>
                              {isCotaught && <span className="text-teal-500 ml-1 flex-shrink-0">CO</span>}
                            </div>
                          </div>
                        )
                      }
                      return <span className="text-xs text-muted-foreground">-</span>
                    })()}
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
