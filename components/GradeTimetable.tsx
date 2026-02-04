"use client"

import { TimetableRow } from "@/lib/types"
import { GradeSchedule } from "@/lib/types"
import { DAYS } from "@/lib/types"
import { isOpenBlock, isStudyHall } from "@/lib/schedule-utils"

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
  function getCellContent(day: string, blockNumber: number): { subject: string; teacher: string } | null {
    const entry = gradeSchedule[day]?.[blockNumber]
    if (!entry) return null
    // Multiple entries (electives)
    if (Array.isArray(entry) && Array.isArray(entry[0])) {
      const entries = entry as unknown as [string, string][]
      const subjects = entries.map(([, subject]) => subject).join(" / ")
      const teachers = entries.map(([teacher]) => teacher).join(", ")
      return { subject: subjects, teacher: teachers }
    }
    const [teacher, subject] = entry as [string, string]
    if (!subject || isOpenBlock(subject)) return null
    if (isStudyHall(subject)) return { subject: "Study Hall", teacher }
    return { subject, teacher }
  }

  return (
    <div className="border rounded-lg overflow-hidden print-break-inside-avoid flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 font-medium border-b bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{gradeName}</span>
          {homeroomTeachers && (
            <span className="text-xs font-normal text-muted-foreground">
              Homeroom: {homeroomTeachers}
            </span>
          )}
        </div>
      </div>

      {/* Timetable */}
      <table className="w-full text-sm border-collapse flex-1">
        <thead>
          <tr className="border-b">
            <th className="py-2 px-1.5 text-left text-xs font-medium text-muted-foreground border-r whitespace-nowrap bg-slate-100/80">Time</th>
            <th className="py-2 px-1.5 text-left text-xs font-medium text-muted-foreground border-r whitespace-nowrap bg-slate-100/80"></th>
            {DAYS.map((day, i) => (
              <th key={day} className={`py-2 px-2 text-center text-xs font-semibold text-slate-700 border-r last:border-r-0 bg-slate-100/80 uppercase tracking-wide`} style={{ width: '17%' }}>
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templateRows.map((row, idx) => {
            const isBlock = row.type === "block" && row.blockNumber

            if (!isBlock) {
              // Break/transition: compact merged row
              return (
                <tr key={`${row.sort_order}-${idx}`} className={`border-b last:border-b-0 ${row.type === "break" ? "bg-slate-50" : "bg-amber-50/40"}`}>
                  <td className="py-1 px-1.5 text-xs text-muted-foreground whitespace-nowrap border-r">
                    {row.time}
                  </td>
                  <td
                    colSpan={6}
                    className="py-1 px-2 text-xs text-muted-foreground italic"
                  >
                    {row.label}
                  </td>
                </tr>
              )
            }

            // Block row: schedule content
            return (
              <tr key={`${row.sort_order}-${idx}`} className="border-b last:border-b-0">
                <td className="py-2 px-1.5 text-xs text-muted-foreground whitespace-nowrap align-top border-r">
                  {row.time}
                </td>
                <td className="py-2 px-1.5 font-semibold align-top text-xs border-r whitespace-nowrap bg-sky-50/70 text-slate-700 uppercase tracking-wide">
                  {row.label}
                </td>
                {DAYS.map((day, i) => {
                  const content = getCellContent(day, row.blockNumber!)
                  return (
                    <td key={day} className={`py-2 px-1 text-center align-top border-r last:border-r-0 ${i % 2 === 1 ? "bg-slate-50/50" : ""}`}>
                      {content ? (
                        <div>
                          <div className="text-xs font-medium">{content.subject}</div>
                          <div className="text-[11px] text-muted-foreground leading-tight">{content.teacher}</div>
                        </div>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
