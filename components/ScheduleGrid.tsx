"use client"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { RefreshCw } from "lucide-react"
import type { TeacherSchedule, GradeSchedule } from "@/lib/types"

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
const BLOCKS = [1, 2, 3, 4, 5]

interface ScheduleGridProps {
  schedule: TeacherSchedule | GradeSchedule
  type: "teacher" | "grade"
  name: string
  status?: string
  // Selection mode props
  showCheckbox?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
}

export function ScheduleGrid({
  schedule,
  type,
  name,
  status,
  showCheckbox,
  isSelected,
  onToggleSelect,
}: ScheduleGridProps) {
  function getCellContent(day: string, block: number): [string, string] | null {
    return schedule[day]?.[block] || null
  }

  function getCellClass(entry: [string, string] | null): string {
    if (!entry) return "bg-muted/30"
    const [, subject] = entry
    if (subject === "OPEN") return "bg-gray-100 text-gray-500"
    if (subject === "Study Hall") return "bg-blue-100 text-blue-800"
    return "bg-green-50"
  }

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden bg-white shadow-sm transition-all",
        isSelected && "ring-2 ring-sky-500 border-sky-500"
      )}
    >
      <div
        className={cn(
          "px-3 py-2 font-medium border-b flex items-center justify-between",
          isSelected ? "bg-sky-50" : "bg-slate-50"
        )}
      >
        <div className="flex items-center gap-2">
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
          <label className="flex items-center gap-1.5 cursor-pointer">
            <RefreshCw className={cn("h-3 w-3", isSelected ? "text-sky-600" : "text-muted-foreground")} />
            <span className={cn("text-xs", isSelected ? "text-sky-600" : "text-muted-foreground")}>Regen</span>
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
            <th className="p-1.5 text-left w-14 text-xs"></th>
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
                return (
                  <td
                    key={day}
                    className={cn(
                      "p-1 text-center border-l overflow-hidden",
                      getCellClass(entry)
                    )}
                  >
                    {entry ? (
                      <div className="max-w-full overflow-hidden">
                        <div className="font-medium text-xs leading-tight truncate" title={type === "teacher" ? primary : secondary}>
                          {type === "teacher" ? primary.replace(' Grade', '').replace('Kindergarten', 'K') : secondary}
                        </div>
                        <div className="text-[10px] leading-tight text-muted-foreground truncate" title={type === "teacher" ? secondary : primary}>
                          {type === "teacher" ? secondary : primary}
                        </div>
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
