import * as XLSX from "xlsx"
import type { ScheduleOption, TeacherSchedule, GradeSchedule } from "./types"

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
const BLOCKS = [1, 2, 3, 4, 5]

export function generateXLSX(option: ScheduleOption): Blob {
  const workbook = XLSX.utils.book_new()

  // Summary sheet
  const summaryData = [
    ["Schedule Generation Summary"],
    [],
    ["Option", option.optionNumber],
    ["Back-to-Back Issues", option.backToBackIssues],
    ["Study Halls Placed", `${option.studyHallsPlaced}/5`],
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
    ...option.teacherStats.map((stat) => [
      stat.teacher,
      stat.status,
      stat.teaching,
      stat.studyHall,
      stat.open,
      stat.backToBackIssues,
    ]),
  ]
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary")

  // Teacher schedules sheet
  const teacherData: (string | number)[][] = []
  Object.entries(option.teacherSchedules).forEach(([teacher, schedule]) => {
    teacherData.push([teacher])
    teacherData.push(["", ...DAYS])
    BLOCKS.forEach((block) => {
      const row: (string | number)[] = [`Block ${block}`]
      DAYS.forEach((day) => {
        const entry = schedule[day]?.[block]
        if (entry) {
          row.push(`${entry[0]} - ${entry[1]}`)
        } else {
          row.push("")
        }
      })
      teacherData.push(row)
    })
    teacherData.push([])
  })
  const teacherSheet = XLSX.utils.aoa_to_sheet(teacherData)
  XLSX.utils.book_append_sheet(workbook, teacherSheet, "Teacher Schedules")

  // Grade schedules sheet
  const gradeData: (string | number)[][] = []
  Object.entries(option.gradeSchedules).forEach(([grade, schedule]) => {
    gradeData.push([grade])
    gradeData.push(["", ...DAYS])
    BLOCKS.forEach((block) => {
      const row: (string | number)[] = [`Block ${block}`]
      DAYS.forEach((day) => {
        const entry = schedule[day]?.[block]
        if (entry) {
          row.push(`${entry[0]} - ${entry[1]}`)
        } else {
          row.push("")
        }
      })
      gradeData.push(row)
    })
    gradeData.push([])
  })
  const gradeSheet = XLSX.utils.aoa_to_sheet(gradeData)
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
  lines.push(`Study Halls Placed: ${option.studyHallsPlaced}/5`)
  lines.push("")

  // Teacher schedules
  lines.push("TEACHER SCHEDULES")
  lines.push("")
  Object.entries(option.teacherSchedules).forEach(([teacher, schedule]) => {
    lines.push(teacher)
    lines.push(["", ...DAYS].join(","))
    BLOCKS.forEach((block) => {
      const row: string[] = [`Block ${block}`]
      DAYS.forEach((day) => {
        const entry = schedule[day]?.[block]
        if (entry) {
          row.push(`"${entry[0]} - ${entry[1]}"`)
        } else {
          row.push("")
        }
      })
      lines.push(row.join(","))
    })
    lines.push("")
  })

  // Grade schedules
  lines.push("GRADE SCHEDULES")
  lines.push("")
  Object.entries(option.gradeSchedules).forEach(([grade, schedule]) => {
    lines.push(grade)
    lines.push(["", ...DAYS].join(","))
    BLOCKS.forEach((block) => {
      const row: string[] = [`Block ${block}`]
      DAYS.forEach((day) => {
        const entry = schedule[day]?.[block]
        if (entry) {
          row.push(`"${entry[0]} - ${entry[1]}"`)
        } else {
          row.push("")
        }
      })
      lines.push(row.join(","))
    })
    lines.push("")
  })

  return lines.join("\n")
}
