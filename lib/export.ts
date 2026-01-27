import XLSX from "xlsx-js-style"
import type { ScheduleOption, TeacherSchedule, GradeSchedule } from "./types"

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
const BLOCKS = [1, 2, 3, 4, 5]

// Sort grades: Kindergarten first, then by grade number
function gradeSort(a: string, b: string): number {
  if (a.includes("Kindergarten")) return -1
  if (b.includes("Kindergarten")) return 1
  // Extract numeric part for comparison (e.g., "1st Grade" -> 1)
  const aNum = parseInt(a.match(/(\d+)/)?.[1] || "99")
  const bNum = parseInt(b.match(/(\d+)/)?.[1] || "99")
  return aNum - bNum
}

// Convert grade string to number for sorting (K=0, 1st=1, etc.)
function gradeToNum(grade: string): number {
  if (grade.toLowerCase().includes("kindergarten") || grade === "K") return 0
  const match = grade.match(/(\d+)/)
  return match ? parseInt(match[1]) : 99
}

// Analyze a teacher's schedule to find their primary teaching grade(s)
// Primary = grades they teach more than 30% of the time
function analyzeTeacherGrades(schedule: TeacherSchedule): { primaryGrade: number; hasPrimary: boolean; gradeSpread: number } {
  const gradeCounts = new Map<number, number>()
  let totalTeaching = 0

  for (const day of Object.values(schedule)) {
    for (const entry of Object.values(day as Record<number, [string, string] | null>)) {
      if (entry && entry[0] && entry[1] !== "OPEN" && entry[1] !== "Study Hall") {
        totalTeaching++
        const gradeStr = entry[0]

        // Parse grades from the entry
        const grades: number[] = []
        const rangeMatch = gradeStr.match(/(\d+)(?:st|nd|rd|th)?[-–](\d+)/)
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1])
          const end = parseInt(rangeMatch[2])
          for (let i = start; i <= end; i++) grades.push(i)
        } else {
          grades.push(gradeToNum(gradeStr))
        }

        // Count each grade (split credit for combined grades)
        const creditPerGrade = 1 / grades.length
        for (const g of grades) {
          if (g < 99) {
            gradeCounts.set(g, (gradeCounts.get(g) || 0) + creditPerGrade)
          }
        }
      }
    }
  }

  if (totalTeaching === 0) {
    return { primaryGrade: 99, hasPrimary: false, gradeSpread: 0 }
  }

  // Find grades that make up >30% of teaching
  const primaryGrades: number[] = []
  for (const [grade, count] of gradeCounts) {
    if (count / totalTeaching >= 0.30) {
      primaryGrades.push(grade)
    }
  }

  // Sort primary grades to get the lowest
  primaryGrades.sort((a, b) => a - b)

  return {
    primaryGrade: primaryGrades.length > 0 ? primaryGrades[0] : 99,
    hasPrimary: primaryGrades.length > 0,
    gradeSpread: gradeCounts.size
  }
}

// Sort teachers by primary grade (same logic as history view)
function sortTeachers(
  entries: [string, TeacherSchedule][],
  teacherStats: ScheduleOption["teacherStats"]
): [string, TeacherSchedule][] {
  return entries.sort(([teacherA, scheduleA], [teacherB, scheduleB]) => {
    const statA = teacherStats.find(s => s.teacher === teacherA)
    const statB = teacherStats.find(s => s.teacher === teacherB)
    const infoA = analyzeTeacherGrades(scheduleA)
    const infoB = analyzeTeacherGrades(scheduleB)

    // 1. Full-time before part-time (part-time at bottom)
    if (statA?.status === 'full-time' && statB?.status !== 'full-time') return -1
    if (statA?.status !== 'full-time' && statB?.status === 'full-time') return 1

    // 2. Teachers with a primary grade before those without
    if (infoA.hasPrimary && !infoB.hasPrimary) return -1
    if (!infoA.hasPrimary && infoB.hasPrimary) return 1

    // 3. Sort by primary grade (Kindergarten first)
    if (infoA.primaryGrade !== infoB.primaryGrade) {
      return infoA.primaryGrade - infoB.primaryGrade
    }

    // 4. Sort by grade spread (fewer grades = more focused = higher)
    if (infoA.gradeSpread !== infoB.gradeSpread) {
      return infoA.gradeSpread - infoB.gradeSpread
    }

    // 5. Alphabetical
    return teacherA.localeCompare(teacherB)
  })
}

// Format schedule cell: "Grade - Subject" or just "OPEN" (no dash)
function formatCell(entry: [string, string] | null | undefined): string {
  if (!entry) return ""
  // OPEN blocks have no grade info
  if (entry[1] === "OPEN") return "OPEN"
  // Study Hall should show the grade
  if (entry[1] === "Study Hall") {
    return entry[0] ? `${entry[0]} - Study Hall` : "Study Hall"
  }
  // If first part is empty, just show subject
  if (!entry[0]) return entry[1]
  return `${entry[0]} - ${entry[1]}`
}

// Style definitions
const styles = {
  // Title style - dark blue background, white bold text
  title: {
    fill: { fgColor: { rgb: "1E40AF" } },
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 },
    alignment: { horizontal: "left" },
  },
  // Section header - medium blue background, white bold text
  sectionHeader: {
    fill: { fgColor: { rgb: "3B82F6" } },
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
    alignment: { horizontal: "left" },
  },
  // Table header - light blue background, dark text
  tableHeader: {
    fill: { fgColor: { rgb: "DBEAFE" } },
    font: { bold: true, color: { rgb: "1E3A8A" } },
    alignment: { horizontal: "center" },
    border: {
      bottom: { style: "thin", color: { rgb: "93C5FD" } },
    },
  },
  // Name row (teacher/grade name) - slate background
  nameRow: {
    fill: { fgColor: { rgb: "475569" } },
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
    alignment: { horizontal: "left" },
  },
  // Day header row - light slate
  dayHeader: {
    fill: { fgColor: { rgb: "E2E8F0" } },
    font: { bold: true, color: { rgb: "334155" } },
    alignment: { horizontal: "center" },
    border: {
      bottom: { style: "thin", color: { rgb: "CBD5E1" } },
    },
  },
  // Block label - very light background
  blockLabel: {
    fill: { fgColor: { rgb: "F8FAFC" } },
    font: { bold: true, color: { rgb: "64748B" } },
    alignment: { horizontal: "left" },
    border: {
      right: { style: "thin", color: { rgb: "E2E8F0" } },
    },
  },
  // Schedule cell - white with light border
  scheduleCell: {
    fill: { fgColor: { rgb: "FFFFFF" } },
    alignment: { horizontal: "center" },
    border: {
      bottom: { style: "thin", color: { rgb: "F1F5F9" } },
      right: { style: "thin", color: { rgb: "F1F5F9" } },
    },
  },
  // Data row - alternating
  dataRowEven: {
    fill: { fgColor: { rgb: "FFFFFF" } },
    alignment: { horizontal: "left" },
  },
  dataRowOdd: {
    fill: { fgColor: { rgb: "F8FAFC" } },
    alignment: { horizontal: "left" },
  },
}

// Helper to apply style to a cell
function applyStyle(sheet: XLSX.WorkSheet, cellRef: string, style: object) {
  if (!sheet[cellRef]) sheet[cellRef] = { v: "" }
  sheet[cellRef].s = style
}

// Helper to apply style to a range of cells in a row
function applyRowStyle(sheet: XLSX.WorkSheet, row: number, startCol: number, endCol: number, style: object) {
  for (let col = startCol; col <= endCol; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: col })
    applyStyle(sheet, cellRef, style)
  }
}

export function generateXLSX(option: ScheduleOption): Blob {
  const workbook = XLSX.utils.book_new()

  // Get sorted teacher order (same as schedule view)
  const sortedTeacherOrder = sortTeachers(Object.entries(option.teacherSchedules), option.teacherStats)
    .map(([teacher]) => teacher)

  // Sort teacher stats to match the teacher schedule order
  const sortedStats = [...option.teacherStats].sort((a, b) => {
    const indexA = sortedTeacherOrder.indexOf(a.teacher)
    const indexB = sortedTeacherOrder.indexOf(b.teacher)
    // Teachers not in schedule go to the end
    if (indexA === -1 && indexB === -1) return a.teacher.localeCompare(b.teacher)
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexA - indexB
  })

  // Summary sheet
  const summaryData = [
    ["Schedule Generation Summary"],
    [],
    ["Option", option.optionNumber],
    ["Back-to-Back Issues", option.backToBackIssues],
    ["Study Halls Placed", `${option.studyHallsPlaced}/${option.studyHallAssignments?.length || 0}`],
    [],
    ["Study Hall Assignments"],
    ["Grade Group", "Teacher", "Day", "Block"],
    ...option.studyHallAssignments.map((sh) => [
      sh.group,
      sh.teacher || "Not placed",
      sh.day || "-",
      sh.block || "-",
    ]),
    [],
    ["Teacher Statistics"],
    ["Teacher", "Status", "Teaching", "Study Hall", "Open", "BTB Issues"],
    ...sortedStats
      .map((stat) => [
        stat.teacher,
        stat.status,
        stat.teaching,
        stat.studyHall,
        stat.open,
        stat.backToBackIssues,
      ]),
  ]
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)

  // Apply summary styles
  applyRowStyle(summarySheet, 0, 0, 5, styles.title) // Title row
  applyRowStyle(summarySheet, 6, 0, 3, styles.sectionHeader) // Study Hall Assignments header
  applyRowStyle(summarySheet, 7, 0, 3, styles.tableHeader) // Study Hall table header

  // Style study hall data rows
  const studyHallDataStart = 8
  const studyHallDataEnd = studyHallDataStart + option.studyHallAssignments.length
  for (let row = studyHallDataStart; row < studyHallDataEnd; row++) {
    const style = (row - studyHallDataStart) % 2 === 0 ? styles.dataRowEven : styles.dataRowOdd
    applyRowStyle(summarySheet, row, 0, 3, style)
  }

  // Teacher Statistics section
  const teacherStatsHeaderRow = studyHallDataEnd + 1
  applyRowStyle(summarySheet, teacherStatsHeaderRow, 0, 5, styles.sectionHeader)
  applyRowStyle(summarySheet, teacherStatsHeaderRow + 1, 0, 5, styles.tableHeader)

  // Style teacher stats data rows
  for (let i = 0; i < option.teacherStats.length; i++) {
    const row = teacherStatsHeaderRow + 2 + i
    const style = i % 2 === 0 ? styles.dataRowEven : styles.dataRowOdd
    applyRowStyle(summarySheet, row, 0, 5, style)
  }

  // Set column widths for summary
  summarySheet["!cols"] = [
    { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }
  ]

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary")

  // Teacher schedules sheet
  const teacherData: (string | number)[][] = []
  const teacherRowInfo: { type: "name" | "header" | "block" | "empty"; row: number }[] = []

  // Sort teachers by primary grade (same as history view)
  const sortedTeachers = sortTeachers(Object.entries(option.teacherSchedules), option.teacherStats)

  sortedTeachers.forEach(([teacher, schedule]) => {
    teacherRowInfo.push({ type: "name", row: teacherData.length })
    teacherData.push([teacher])

    teacherRowInfo.push({ type: "header", row: teacherData.length })
    teacherData.push(["", ...DAYS])

    BLOCKS.forEach((block) => {
      teacherRowInfo.push({ type: "block", row: teacherData.length })
      const row: (string | number)[] = [`Block ${block}`]
      DAYS.forEach((day) => {
        row.push(formatCell(schedule[day]?.[block]))
      })
      teacherData.push(row)
    })

    teacherRowInfo.push({ type: "empty", row: teacherData.length })
    teacherData.push([])
  })

  const teacherSheet = XLSX.utils.aoa_to_sheet(teacherData)

  // Apply teacher schedule styles
  teacherRowInfo.forEach(({ type, row }) => {
    if (type === "name") {
      applyRowStyle(teacherSheet, row, 0, 5, styles.nameRow)
    } else if (type === "header") {
      applyRowStyle(teacherSheet, row, 0, 5, styles.dayHeader)
    } else if (type === "block") {
      applyStyle(teacherSheet, XLSX.utils.encode_cell({ r: row, c: 0 }), styles.blockLabel)
      for (let col = 1; col <= 5; col++) {
        applyStyle(teacherSheet, XLSX.utils.encode_cell({ r: row, c: col }), styles.scheduleCell)
      }
    }
  })

  // Set column widths for teacher schedules
  teacherSheet["!cols"] = [
    { wch: 10 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }
  ]

  XLSX.utils.book_append_sheet(workbook, teacherSheet, "Teacher Schedules")

  // Grade schedules sheet
  const gradeData: (string | number)[][] = []
  const gradeRowInfo: { type: "name" | "header" | "block" | "empty"; row: number }[] = []

  // Sort grades: Kindergarten first, then by grade number
  const sortedGrades = Object.entries(option.gradeSchedules).sort(([a], [b]) => gradeSort(a, b))

  sortedGrades.forEach(([grade, schedule]) => {
    gradeRowInfo.push({ type: "name", row: gradeData.length })
    gradeData.push([grade])

    gradeRowInfo.push({ type: "header", row: gradeData.length })
    gradeData.push(["", ...DAYS])

    BLOCKS.forEach((block) => {
      gradeRowInfo.push({ type: "block", row: gradeData.length })
      const row: (string | number)[] = [`Block ${block}`]
      DAYS.forEach((day) => {
        row.push(formatCell(schedule[day]?.[block]))
      })
      gradeData.push(row)
    })

    gradeRowInfo.push({ type: "empty", row: gradeData.length })
    gradeData.push([])
  })

  const gradeSheet = XLSX.utils.aoa_to_sheet(gradeData)

  // Apply grade schedule styles
  gradeRowInfo.forEach(({ type, row }) => {
    if (type === "name") {
      applyRowStyle(gradeSheet, row, 0, 5, styles.nameRow)
    } else if (type === "header") {
      applyRowStyle(gradeSheet, row, 0, 5, styles.dayHeader)
    } else if (type === "block") {
      applyStyle(gradeSheet, XLSX.utils.encode_cell({ r: row, c: 0 }), styles.blockLabel)
      for (let col = 1; col <= 5; col++) {
        applyStyle(gradeSheet, XLSX.utils.encode_cell({ r: row, c: col }), styles.scheduleCell)
      }
    }
  })

  // Set column widths for grade schedules
  gradeSheet["!cols"] = [
    { wch: 10 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }
  ]

  XLSX.utils.book_append_sheet(workbook, gradeSheet, "Grade Schedules")

  // Generate blob
  const xlsxData = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
  return new Blob([xlsxData], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

export function generateCSV(option: ScheduleOption): string {
  const lines: string[] = []

  // Header
  lines.push(`Schedule Option ${option.optionNumber}`)
  lines.push(`Back-to-Back Issues: ${option.backToBackIssues}`)
  lines.push(`Study Halls Placed: ${option.studyHallsPlaced}/${option.studyHallAssignments?.length || 0}`)
  lines.push("")

  // Teacher schedules
  lines.push("TEACHER SCHEDULES")
  lines.push("")
  sortTeachers(Object.entries(option.teacherSchedules), option.teacherStats).forEach(([teacher, schedule]) => {
    lines.push(teacher)
    lines.push(["", ...DAYS].join(","))
    BLOCKS.forEach((block) => {
      const row: string[] = [`Block ${block}`]
      DAYS.forEach((day) => {
        const cell = formatCell(schedule[day]?.[block])
        row.push(cell ? `"${cell}"` : "")
      })
      lines.push(row.join(","))
    })
    lines.push("")
  })

  // Grade schedules
  lines.push("GRADE SCHEDULES")
  lines.push("")
  Object.entries(option.gradeSchedules).sort(([a], [b]) => gradeSort(a, b)).forEach(([grade, schedule]) => {
    lines.push(grade)
    lines.push(["", ...DAYS].join(","))
    BLOCKS.forEach((block) => {
      const row: string[] = [`Block ${block}`]
      DAYS.forEach((day) => {
        const cell = formatCell(schedule[day]?.[block])
        row.push(cell ? `"${cell}"` : "")
      })
      lines.push(row.join(","))
    })
    lines.push("")
  })

  return lines.join("\n")
}
