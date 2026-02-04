"use client"

import { TimetableRow } from "@/lib/types"
import { GradeSchedule } from "@/lib/types"
import { DAYS } from "@/lib/types"

interface GradeTimetableProps {
  gradeName: string
  gradeId: string
  homeroomTeachers?: string
  templateRows: TimetableRow[]
  gradeSchedule: GradeSchedule
}

export function GradeTimetable({
  gradeName,
  gradeId,
  homeroomTeachers,
  templateRows,
  gradeSchedule,
}: GradeTimetableProps) {
  function getCellContent(day: string, blockNumber: number): string {
    const entry = gradeSchedule[day]?.[blockNumber]
    if (!entry) return ""
    // entry is [teacher, subject] — for grade timetable, show "subject (teacher)"
    if (Array.isArray(entry) && Array.isArray(entry[0])) {
      // Multiple entries (electives) — show combined
      const entries = entry as unknown as [string, string][]
      return entries.map(([teacher, subject]) => `${subject} (${teacher})`).join(" / ")
    }
    const [teacher, subject] = entry as [string, string]
    if (!subject || subject === "OPEN") return ""
    return `${subject} (${teacher})`
  }

  return (
    <div className="border rounded-lg overflow-hidden print-break-inside-avoid">
      {/* Header */}
      <div className="bg-muted/50 px-3 py-2 border-b">
        <h3 className="font-semibold text-sm">{gradeName}</h3>
        {homeroomTeachers && (
          <p className="text-xs text-muted-foreground">
            Homeroom Teachers: {homeroomTeachers}
          </p>
        )}
      </div>

      {/* Timetable */}
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="p-1.5 text-left text-xs font-medium w-[200px]"></th>
            {DAYS.map((day) => (
              <th key={day} className="p-1.5 text-center text-xs font-medium">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templateRows.map((row, idx) => {
            const isBlock = row.type === "block" && row.blockNumber
            return (
              <tr
                key={`${row.sort_order}-${idx}`}
                className={`border-b last:border-b-0 ${
                  row.type === "break"
                    ? "bg-slate-50"
                    : row.type === "transition"
                      ? "bg-amber-50/50"
                      : ""
                }`}
              >
                {/* Time + Label column */}
                <td className="p-1.5 text-xs">
                  <span className="text-muted-foreground">{row.time}</span>{" "}
                  <span className={row.type === "block" ? "font-medium" : ""}>
                    {row.label}
                  </span>
                </td>

                {/* Day columns */}
                {isBlock ? (
                  DAYS.map((day) => {
                    const content = getCellContent(day, row.blockNumber!)
                    return (
                      <td
                        key={day}
                        className="p-1.5 text-xs text-center font-medium"
                      >
                        {content}
                      </td>
                    )
                  })
                ) : (
                  // Non-block rows: span all day columns with empty/gray cells
                  DAYS.map((day) => (
                    <td
                      key={day}
                      className={`p-1.5 ${
                        row.type === "break"
                          ? "bg-slate-50"
                          : row.type === "transition"
                            ? "bg-amber-50/50"
                            : ""
                      }`}
                    />
                  ))
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
