"use client"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { TeacherSchedule, GradeSchedule } from "@/lib/types"

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
const BLOCKS = [1, 2, 3, 4, 5]

interface ScheduleGridProps {
  schedule: TeacherSchedule | GradeSchedule
  type: "teacher" | "grade"
  name: string
  status?: string
}

export function ScheduleGrid({ schedule, type, name, status }: ScheduleGridProps) {
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
    <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
      <div className="bg-slate-50 px-3 py-2 font-medium border-b flex items-center justify-between">
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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-2 text-left w-16"></th>
            {DAYS.map((day) => (
              <th key={day} className="p-2 text-center font-medium">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map((block) => (
            <tr key={block} className="border-b last:border-b-0">
              <td className="p-2 font-medium text-muted-foreground bg-muted/30">
                Block {block}
              </td>
              {DAYS.map((day) => {
                const entry = getCellContent(day, block)
                const [primary, secondary] = entry || ["", ""]
                return (
                  <td
                    key={day}
                    className={cn(
                      "p-2 text-center border-l",
                      getCellClass(entry)
                    )}
                  >
                    {entry ? (
                      <div>
                        <div className="font-medium text-xs truncate">
                          {type === "teacher" ? primary : secondary}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
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
