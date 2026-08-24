"use client"

import { TimetableRow } from "@/lib/types"
import { GradeSchedule } from "@/lib/types"
import { DAYS } from "@/lib/types"
import { resolveGradeCellDisplay } from "@/lib/schedule-utils"

interface GradeTimetableProps {
  gradeName: string
  gradeId: string
  homeroomTeachers?: string
  templateRows: TimetableRow[]
  gradeSchedule: GradeSchedule
  // Block number each NON-block row stands in for, keyed by row sort_order
  // (from getMaskedBlockByRowForGrade): a grade's Lunch row occupies the block
  // window it sits out, and K-5's End of Day Meeting sits inside the Block 9
  // window they surrendered. Labels those rows B5/B9 so the block numbers do
  // not appear to skip. Rows with no entry (morning meeting, mid-morning
  // break) are genuinely blockless. Absent = no block labels on those rows.
  maskedBlockByRow?: Record<number, number>
}

export function GradeTimetable({
  gradeName,
  gradeId,
  homeroomTeachers,
  templateRows,
  gradeSchedule,
  maskedBlockByRow,
}: GradeTimetableProps) {
  function getCellContent(day: string, blockNumber: number): { subject: string; teacher: string } | null {
    return resolveGradeCellDisplay(gradeSchedule[day]?.[blockNumber] ?? null)
  }

  // Safety net: find schedule entries whose block has no matching row in this
  // grade's resolved template rows. Without this, such entries would be
  // silently dropped from the timetable view. Only blocks with visible content
  // (a class or study hall on at least one day) are surfaced.
  const templateBlockNumbers = new Set(
    templateRows
      .filter((row) => row.type === "block" && typeof row.blockNumber === "number")
      .map((row) => row.blockNumber as number)
  )
  const orphanBlocks: number[] = (() => {
    const found = new Set<number>()
    for (const day of DAYS) {
      const daySchedule = gradeSchedule[day]
      if (!daySchedule) continue
      for (const key of Object.keys(daySchedule)) {
        const blockNumber = Number(key)
        if (!Number.isFinite(blockNumber) || templateBlockNumbers.has(blockNumber)) continue
        if (getCellContent(day, blockNumber)) found.add(blockNumber)
      }
    }
    return [...found].sort((a, b) => a - b)
  })()

  return (
    <div data-card-name={gradeName} className="border rounded-lg overflow-hidden bg-white print-break-inside-avoid flex flex-col">
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
              // Break/transition: compact merged row. When the window stands in
              // for a block the grade sits out (its Lunch, K-5's End of Day
              // Meeting), the label column carries that block number so the
              // numbering reads continuously down the card.
              const maskedBlock = maskedBlockByRow?.[row.sort_order]
              return (
                <tr key={`${row.sort_order}-${idx}`} className={`border-b last:border-b-0 ${row.type === "break" ? "bg-slate-50" : "bg-amber-50/40"}`}>
                  <td className="py-1 px-1.5 text-xs text-muted-foreground whitespace-nowrap border-r">
                    {row.time}
                  </td>
                  {maskedBlock !== undefined && (
                    <td className="py-1 px-1.5 text-xs text-muted-foreground/60 font-semibold whitespace-nowrap border-r uppercase tracking-wide">
                      B{maskedBlock}
                    </td>
                  )}
                  <td
                    colSpan={maskedBlock !== undefined ? 5 : 6}
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
                <td
                  title={`Block ${row.blockNumber}`}
                  className="py-2 px-1.5 font-semibold align-top text-xs border-r whitespace-nowrap bg-sky-50/70 text-slate-700 uppercase tracking-wide"
                >
                  {/* Block number, matching the schedule grids' B{n} headers.
                      Not a period count: P would number each grade's own
                      blocks, so the same window reads differently per grade
                      (Block 6 is the 5th teaching block for K-3rd but the 6th
                      for high school). Custom row labels win; only default
                      "Block N" labels are shortened. */}
                  {/^block\s*\d+$/i.test(row.label.trim()) ? `B${row.blockNumber}` : row.label}
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
          {/* Fallback rows for schedule entries with no matching template row */}
          {orphanBlocks.map((blockNumber) => (
            <tr key={`orphan-${blockNumber}`} className="border-b last:border-b-0 bg-red-50/40">
              <td className="py-2 px-1.5 text-xs text-red-600 whitespace-nowrap align-top border-r">
                —
              </td>
              <td
                className="py-2 px-1.5 font-semibold align-top text-xs border-r whitespace-nowrap bg-red-50 text-red-700 uppercase tracking-wide"
                title={`Block ${blockNumber} has scheduled classes but no matching row in this grade's timetable template`}
              >
                Block {blockNumber} — no timetable row
              </td>
              {DAYS.map((day, i) => {
                const content = getCellContent(day, blockNumber)
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
          ))}
        </tbody>
      </table>
    </div>
  )
}
