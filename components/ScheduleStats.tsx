"use client"

import { useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Info, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react"
import type { TeacherStat, StudyHallAssignment, GradeSchedule, TeacherSchedule } from "@/lib/types"
import { isOccupiedBlock, isFullTime } from "@/lib/schedule-utils"
import { parseGradeDisplayToNames } from "@/lib/grade-utils"

interface ValidationIssue {
  type: 'grade_conflict' | 'subject_conflict' | 'other'
  message: string
}

interface ScheduleStatsProps {
  stats: TeacherStat[]
  studyHallAssignments: StudyHallAssignment[]
  gradeSchedules?: Record<string, GradeSchedule>
  teacherSchedules?: Record<string, TeacherSchedule>
  backToBackIssues: number
  studyHallsPlaced: number
  unscheduledClasses?: number
  totalClasses?: number
  defaultExpanded?: boolean
  validationIssues?: ValidationIssue[]  // Grade conflicts, subject conflicts, etc.
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 cursor-help inline-block ml-1" />
      </TooltipTrigger>
      <TooltipContent className="max-w-[250px]">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function ScheduleStats({
  stats,
  studyHallAssignments,
  gradeSchedules,
  teacherSchedules,
  backToBackIssues,
  studyHallsPlaced,
  unscheduledClasses = 0,
  totalClasses = 0,
  defaultExpanded = true,
  validationIssues = [],
}: ScheduleStatsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  // Calculate grade coverage from teacherSchedules (more accurate than gradeSchedules)
  // Teacher schedules are the source of truth - gradeSchedules can miss entries when
  // multiple classes share a slot (electives, study halls, etc.)
  const DAYS = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri']
  const BLOCKS = [1, 2, 3, 4, 5]
  const BLOCKS_PER_WEEK = 25

  let totalGrades = 0
  let gradesFullCount = 0
  let totalBlocksScheduled = 0
  let totalBlocksAvailable = 0

  // Track grades with gaps for detailed reporting
  type GradeGapInfo = {
    grade: string
    filledCount: number
    missingSlots: Array<{ day: string; block: number }>
  }
  const gradesWithGaps: GradeGapInfo[] = []

  // Get grade list from gradeSchedules (still needed to know which grades exist)
  const gradeNames = gradeSchedules ? Object.keys(gradeSchedules) : []
  totalGrades = gradeNames.length
  totalBlocksAvailable = totalGrades * BLOCKS_PER_WEEK

  if (teacherSchedules && gradeNames.length > 0) {
    // Build a set of filled slots per grade from teacher schedules
    // Key: "grade|day|block", Value: true if any class is scheduled
    const filledSlots: Record<string, Set<string>> = {}
    for (const grade of gradeNames) {
      filledSlots[grade] = new Set()
    }

    // Use shared helper for grade parsing (imported from @/lib/grade-utils)
    const parseGradeDisplay = (gradeDisplay: string) => parseGradeDisplayToNames(gradeDisplay, gradeNames)

    // Iterate through all teacher schedules
    for (const teacher of Object.keys(teacherSchedules)) {
      const schedule = teacherSchedules[teacher]
      for (const day of DAYS) {
        for (const block of BLOCKS) {
          const entry = schedule?.[day]?.[block]
          if (entry && entry[1] && isOccupiedBlock(entry[1])) {
            const gradeDisplay = entry[0]
            const subject = entry[1]

            // Parse which grades this entry applies to
            const targetGrades = parseGradeDisplay(gradeDisplay)

            // Mark slot as filled for each target grade
            for (const grade of targetGrades) {
              const slotKey = `${day}|${block}`
              filledSlots[grade].add(slotKey)
            }
          }
        }
      }
    }

    // Count total filled slots and grades that are full, track gaps
    for (const grade of gradeNames) {
      const filledCount = filledSlots[grade].size
      totalBlocksScheduled += filledCount
      if (filledCount >= BLOCKS_PER_WEEK) {
        gradesFullCount++
      } else {
        // Find which slots are missing
        const missingSlots: Array<{ day: string; block: number }> = []
        for (const day of DAYS) {
          for (const block of BLOCKS) {
            const slotKey = `${day}|${block}`
            if (!filledSlots[grade].has(slotKey)) {
              missingSlots.push({ day, block })
            }
          }
        }
        gradesWithGaps.push({ grade, filledCount, missingSlots })
      }
    }
  } else if (gradeSchedules) {
    // Fallback to gradeSchedules if teacherSchedules not provided
    for (const grade of gradeNames) {
      const schedule = gradeSchedules[grade]
      let filledBlocks = 0
      const missingSlots: Array<{ day: string; block: number }> = []

      for (const day of DAYS) {
        for (const block of BLOCKS) {
          const entry = schedule?.[day]?.[block]
          // Count as filled if it's not empty and not OPEN
          if (entry && entry[1] && isOccupiedBlock(entry[1])) {
            filledBlocks++
            totalBlocksScheduled++
          } else {
            missingSlots.push({ day, block })
          }
        }
      }

      if (filledBlocks >= BLOCKS_PER_WEEK) {
        gradesFullCount++
      } else {
        gradesWithGaps.push({ grade, filledCount: filledBlocks, missingSlots })
      }
    }
  }
  // Sort stats: full-time teachers first, then by utilization
  const sortedStats = [...stats].sort((a, b) => {
    if (a.status === 'full-time' && b.status !== 'full-time') return -1
    if (a.status !== 'full-time' && b.status === 'full-time') return 1
    return b.totalUsed - a.totalUsed
  })

  // Function to open details and scroll to section
  const scrollToSection = (sectionId: string) => {
    const details = document.getElementById('stats-details') as HTMLDetailsElement
    if (details) {
      details.open = true
      // Small delay to let details open
      setTimeout(() => {
        const section = document.getElementById(sectionId)
        section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }

  // Calculate issues for suggestions
  const unplacedStudyHalls = studyHallAssignments.filter(sh => !sh.teacher)
  const teachersWithBTB = sortedStats.filter(s => s.backToBackIssues > 0 && s.status === 'full-time')
  const fullTimeTeachers = sortedStats.filter(s => s.status === 'full-time')

  // Calculate utilization for full-time teachers only
  const avgUtilization = fullTimeTeachers.length > 0
    ? Math.round((fullTimeTeachers.reduce((sum, s) => sum + s.totalUsed, 0) / fullTimeTeachers.length / 25) * 100)
    : 0

  // Find full-time teachers with most open blocks (candidates for more classes)
  const ftWithOpenBlocks = fullTimeTeachers
    .filter(t => t.open > 0)
    .sort((a, b) => b.open - a.open)

  // Calculate average open blocks for full-time teachers
  const avgOpenBlocks = fullTimeTeachers.length > 0
    ? fullTimeTeachers.reduce((sum, t) => sum + t.open, 0) / fullTimeTeachers.length
    : 0

  // Find the busiest full-time teacher (fewest open blocks)
  const minOpenBlocks = fullTimeTeachers.length > 0
    ? Math.min(...fullTimeTeachers.map(t => t.open))
    : 0

  // Teachers with 3+ more open blocks than the busiest teacher - they could take more classes
  const underutilizedTeachers = ftWithOpenBlocks.filter(t => t.open >= minOpenBlocks + 3)

  // Identify potential issues
  const issues: { type: 'warning' | 'info'; message: string }[] = []

  if (unscheduledClasses > 0) {
    issues.push({
      type: 'warning',
      message: `${unscheduledClasses} block${unscheduledClasses !== 1 ? 's' : ''} could not be scheduled. Check for conflicting restrictions.`
    })
  }

  // Sort grades with gaps by grade order for display
  const sortedGradesWithGaps = [...gradesWithGaps].sort((a, b) => {
    const aNum = a.grade.toLowerCase().includes('kindergarten') ? 0 : parseInt(a.grade.match(/(\d+)/)?.[1] || '99')
    const bNum = b.grade.toLowerCase().includes('kindergarten') ? 0 : parseInt(b.grade.match(/(\d+)/)?.[1] || '99')
    return aNum - bNum
  })

  // Note: Grade gaps now shown in separate section, not in suggestions

  if (unplacedStudyHalls.length > 0) {
    const groups = unplacedStudyHalls.map(sh => sh.group).join(', ')
    issues.push({
      type: 'warning',
      message: `Study halls not placed for: ${groups}. Need more full-time teachers with open blocks.`
    })
  }

  if (teachersWithBTB.length > 0) {
    const names = teachersWithBTB.slice(0, 8).map(t => t.teacher).join(', ')
    const more = teachersWithBTB.length > 8 ? ` +${teachersWithBTB.length - 8} more` : ''
    issues.push({
      type: 'info',
      message: `Back-to-back open blocks: ${names}${more}. This is a soft constraint - schedule is still valid.`
    })
  }

  if (underutilizedTeachers.length > 0) {
    const names = underutilizedTeachers.slice(0, 8).map(t => `${t.teacher} (${t.open} open)`).join(', ')
    const more = underutilizedTeachers.length > 8 ? ` +${underutilizedTeachers.length - 8} more` : ''
    issues.push({
      type: 'info',
      message: `Consider assigning more classes to: ${names}${more}.`
    })
  }

  // High average open blocks (more than half the week free)
  if (avgOpenBlocks > 12 && fullTimeTeachers.length > 0) {
    issues.push({
      type: 'info',
      message: `Full-time teachers average ${avgOpenBlocks.toFixed(1)} open blocks. Consider adding more classes or adjusting staffing.`
    })
  }

  // Add validation issues (grade conflicts, subject conflicts, etc.)
  // These are hard errors that need to be fixed
  const gradeConflicts = validationIssues.filter(i => i.type === 'grade_conflict')
  const subjectConflicts = validationIssues.filter(i => i.type === 'subject_conflict')
  const otherIssues = validationIssues.filter(i => i.type === 'other')

  if (gradeConflicts.length > 0) {
    issues.unshift({
      type: 'warning',
      message: `⚠️ ${gradeConflicts.length} grade conflict${gradeConflicts.length !== 1 ? 's' : ''} - some grades have multiple classes at the same time. Use Freeform or Regen to fix.`
    })
  }

  if (subjectConflicts.length > 0) {
    issues.unshift({
      type: 'warning',
      message: `⚠️ ${subjectConflicts.length} subject conflict${subjectConflicts.length !== 1 ? 's' : ''} - same subject appears twice on same day for some grades.`
    })
  }

  for (const issue of otherIssues) {
    issues.unshift({
      type: 'warning',
      message: `⚠️ ${issue.message}`
    })
  }

  // Compact stat item for collapsed view
  const totalStudyHallsExpected = studyHallAssignments.length
  const blocksStatus = totalBlocksAvailable > 0 && totalBlocksScheduled < totalBlocksAvailable ? 'warning' : 'ok'
  const gradesStatus = totalGrades > 0 && gradesFullCount < totalGrades ? 'warning' : 'ok'
  const studyHallStatus = studyHallsPlaced < totalStudyHallsExpected ? 'warning' : 'ok'
  const hasValidationErrors = validationIssues.length > 0
  const hasIssues = unscheduledClasses > 0 || blocksStatus === 'warning' || gradesStatus === 'warning' || studyHallStatus === 'warning' || hasValidationErrors

  // Separate counts for display: validation errors (hard) vs notes (soft/info)
  const validationErrorCount = validationIssues.length
  const noteCount = issues.length - validationErrorCount  // issues includes validation errors now

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Collapsible header - matches Study Hall & Teacher Details styling */}
        {/* On screen: clickable, shows expanded/collapsed state */}
        {/* On print: always shows collapsed inline summary */}
        <div
          className="border border-slate-200 rounded-lg bg-slate-50/50"
        >
          <div
            className="p-3 cursor-pointer print:cursor-default"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-800 print:hover:text-slate-600">
              <ChevronDown className={`h-4 w-4 transition-transform no-print ${!expanded ? '-rotate-90' : ''}`} />
              Schedule Summary
              {/* Show inline stats when collapsed OR when printing */}
              <span className={`contents ${expanded ? 'hidden print:contents' : ''}`}>
                <span className="text-slate-300 ml-2">—</span>
                <span className={`font-normal text-slate-500 flex items-center gap-1.5 ${blocksStatus === 'warning' ? 'text-amber-600 font-medium' : ''}`}>
                  <span className={`w-1.5 h-1.5 rounded-sm ${blocksStatus === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                  {totalBlocksScheduled}/{totalBlocksAvailable} Blocks
                </span>
                <span className="text-slate-300">|</span>
                <span className={`font-normal text-slate-500 flex items-center gap-1.5 ${gradesStatus === 'warning' ? 'text-amber-600 font-medium' : ''}`}>
                  <span className={`w-1.5 h-1.5 rounded-sm ${gradesStatus === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                  {gradesFullCount}/{totalGrades} Grades Full
                </span>
                <span className="text-slate-300">|</span>
                <span className={`font-normal text-slate-500 flex items-center gap-1.5 ${studyHallStatus === 'warning' ? 'text-amber-600 font-medium' : ''}`}>
                  <span className={`w-1.5 h-1.5 rounded-sm ${studyHallStatus === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                  {studyHallsPlaced}/{totalStudyHallsExpected} Study Halls
                </span>
                {/* Show validation errors (red) separately from notes (grey) */}
                {validationErrorCount > 0 && (
                  <span className="text-xs font-medium text-red-600 ml-1">
                    ({validationErrorCount} conflict{validationErrorCount !== 1 ? 's' : ''})
                  </span>
                )}
                {noteCount > 0 && (
                  <span className="text-xs font-normal text-slate-400 ml-1">
                    ({noteCount} suggestion{noteCount !== 1 ? 's' : ''})
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Summary Stats - Shown when expanded, inside the container */}
          {expanded && (
          <div className="grid grid-cols-2 gap-3 px-3 pb-3 print-stats md:flex md:flex-wrap">
          {/* Blocks Scheduled */}
          <div className={`border rounded-lg p-3 md:flex-1 md:min-w-0 ${
            totalBlocksScheduled < totalBlocksAvailable
              ? 'border-amber-300 bg-amber-50'
              : 'border-emerald-200 bg-emerald-50'
          }`}>
            <div className="text-sm text-slate-600">
              Blocks
              <InfoTooltip text="Total class and study hall blocks placed in the schedule across all grades." />
            </div>
            <div className="text-lg font-bold">
              {totalBlocksScheduled}/{totalBlocksAvailable}
              {totalBlocksScheduled >= totalBlocksAvailable && totalBlocksAvailable > 0 && (
                <Badge className="ml-2 text-xs bg-emerald-500">All Filled</Badge>
              )}
              {totalBlocksScheduled < totalBlocksAvailable && (
                <Badge variant="outline" className="ml-2 text-xs border-amber-400 text-amber-600">
                  {totalBlocksAvailable - totalBlocksScheduled} Open
                </Badge>
              )}
            </div>
          </div>

          {/* Grades Full */}
          <div
            className={`border rounded-lg p-3 md:flex-1 md:min-w-0 ${gradesStatus === 'warning' ? 'border-amber-300 bg-amber-50 cursor-pointer hover:border-amber-400' : 'border-emerald-200 bg-emerald-50'}`}
            onClick={gradesStatus === 'warning' ? () => scrollToSection('grade-gaps-section') : undefined}
          >
            <div className="text-sm text-slate-600">
              Grades Full
              <InfoTooltip text="Number of grades with all 25 blocks filled (no empty slots)." />
            </div>
            <div className="text-xl font-bold">
              {gradesFullCount}/{totalGrades}
              {gradesStatus === 'warning' && (
                <Badge variant="outline" className="ml-2 text-xs border-amber-400 text-amber-600">
                  {totalGrades - gradesFullCount} Gap{totalGrades - gradesFullCount !== 1 ? 's' : ''}
                </Badge>
              )}
              {gradesFullCount === totalGrades && totalGrades > 0 && (
                <Badge className="ml-2 text-xs bg-emerald-500">All Full</Badge>
              )}
            </div>
            {gradesStatus === 'warning' && (
              <div className="text-xs text-amber-600 mt-1 no-print">Click for details</div>
            )}
          </div>

          {/* Study Halls */}
          <div
            className={`border rounded-lg p-3 md:flex-1 md:min-w-0 cursor-pointer ${studyHallsPlaced < totalStudyHallsExpected ? 'border-amber-200 bg-amber-50 hover:border-amber-300' : 'border-emerald-200 bg-emerald-50 hover:border-emerald-300'}`}
            onClick={() => scrollToSection('study-hall-section')}
          >
            <div className="text-sm text-slate-600">
              Study Halls
              <InfoTooltip text="Study hall supervision slots assigned to eligible teachers based on configured study hall grades." />
            </div>
            <div className="text-xl font-bold">
              {studyHallsPlaced}/{totalStudyHallsExpected}
              {studyHallsPlaced >= totalStudyHallsExpected && totalStudyHallsExpected > 0 && (
                <Badge className="ml-2 text-xs bg-emerald-500">Complete</Badge>
              )}
              {studyHallsPlaced < totalStudyHallsExpected && (
                <Badge variant="outline" className="ml-2 text-xs border-amber-400 text-amber-700">
                  {totalStudyHallsExpected - studyHallsPlaced} Missing
                </Badge>
              )}
            </div>
            <div className={`text-xs mt-1 no-print ${studyHallsPlaced < totalStudyHallsExpected ? 'text-amber-600' : 'text-slate-500'}`}>
              Click to see study halls
            </div>
          </div>

          {/* Back-to-Back Open */}
          <div
            className={`border rounded-lg p-3 md:flex-1 md:min-w-0 ${backToBackIssues > 0 ? 'border-amber-100 bg-amber-50/50 cursor-pointer hover:border-amber-200' : 'border-slate-200 bg-slate-50'}`}
            onClick={backToBackIssues > 0 ? () => scrollToSection('teacher-util-section') : undefined}
          >
            <div className="text-sm text-slate-600">
              Back-to-Back
              <InfoTooltip text="Number of times a full-time teacher has consecutive open (unassigned) blocks. Ideally minimized but not critical - the schedule is still valid." />
            </div>
            <div className="text-xl font-bold text-slate-700">
              {backToBackIssues}
              <span className="text-sm font-normal text-slate-500 ml-1">
                {backToBackIssues === 1 ? 'issue' : 'issues'}
              </span>
            </div>
            {backToBackIssues > 0 && (
              <div className="text-xs text-amber-600 mt-1 no-print">Click to see teachers</div>
            )}
          </div>

          {/* Avg Open Blocks - Full-time teachers only */}
          <div
            className="border rounded-lg p-3 md:flex-shrink md:min-w-0 border-slate-200 bg-slate-50 cursor-pointer hover:border-slate-300"
            onClick={() => scrollToSection('teacher-util-section')}
          >
            <div className="text-sm text-slate-600">
              Avg Open
              <InfoTooltip text="Average number of unassigned blocks per full-time teacher. Lower means teachers are busier. Teachers with many open blocks could take on more classes." />
            </div>
            <div className="text-xl font-bold text-slate-700">
              {fullTimeTeachers.length > 0
                ? (fullTimeTeachers.reduce((sum, t) => sum + t.open, 0) / fullTimeTeachers.length).toFixed(1)
                : 0}
              <span className="text-sm font-normal text-slate-500 ml-1">
                / 25
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">Full-time only</div>
          </div>
        </div>
          )}

          {/* Conflicts Section - Urgent issues that need fixing */}
          {validationIssues.length > 0 && expanded && (
            <div className="border border-red-200 rounded-lg bg-red-50/50 p-3 mx-3 mb-3 no-print">
              <h4 className="text-sm font-medium text-red-800 mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Conflicts ({validationIssues.length})
              </h4>
              <ul className="space-y-1">
                {gradeConflicts.length > 0 && (
                  <li className="text-sm text-red-700">
                    • <span className="font-medium">{gradeConflicts.length} grade conflict{gradeConflicts.length !== 1 ? 's'  : ''}</span> — some grades have multiple classes at the same time
                  </li>
                )}
                {subjectConflicts.length > 0 && (
                  <li className="text-sm text-red-700">
                    • <span className="font-medium">{subjectConflicts.length} subject conflict{subjectConflicts.length !== 1 ? 's' : ''}</span> — same subject appears twice on same day
                  </li>
                )}
                {otherIssues.length > 0 && otherIssues.map((issue, i) => (
                  <li key={i} className="text-sm text-red-700">• {issue.message}</li>
                ))}
              </ul>
              <p className="text-xs text-red-600 mt-2">
                Use <span className="font-medium">Freeform</span> or <span className="font-medium">Regen</span> mode to fix these issues.
              </p>
            </div>
          )}

          {/* Grade Gaps Section - Shows which grades have empty slots */}
          {sortedGradesWithGaps.length > 0 && expanded && (
            <div id="grade-gaps-section" className="border border-amber-200 rounded-lg bg-amber-50/50 p-3 mx-3 mb-3 no-print">
              <h4 className="text-sm font-medium text-amber-800 mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Grade Gaps ({sortedGradesWithGaps.reduce((sum, g) => sum + g.missingSlots.length, 0)} empty slot{sortedGradesWithGaps.reduce((sum, g) => sum + g.missingSlots.length, 0) !== 1 ? 's' : ''})
              </h4>
              <ul className="space-y-1">
                {sortedGradesWithGaps.map((g) => (
                  <li key={g.grade} className="text-sm text-amber-700">
                    • <span className="font-medium">{g.grade}</span> — {g.missingSlots.map(s => `${s.day} B${s.block}`).join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions Section - Informational, not urgent */}
          {noteCount > 0 && expanded && (
            <div className="border border-slate-200 rounded-lg bg-slate-50 p-3 mx-3 mb-3 no-print">
              <h4 className="text-sm font-medium text-slate-600 mb-2 flex items-center gap-2">
                <Info className="h-4 w-4" />
                Suggestions ({noteCount})
              </h4>
              <ul className="space-y-1">
                {issues.filter(i => !i.message.startsWith('⚠️')).map((issue, i) => (
                  <li key={i} className="text-sm text-slate-600">
                    • {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Detailed Tables - Collapsed */}
        <details id="stats-details" className="group border border-slate-200 rounded-lg p-3 bg-slate-50/50">
          <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-800">
            <ChevronDown className="h-4 w-4 transition-transform -rotate-90 group-open:rotate-0 no-print" />
            Study Hall & Teacher Details
            <span className="font-normal text-slate-500 group-open:hidden">
              — {sortedStats.filter(s => s.status === 'full-time').length} full-time, {sortedStats.filter(s => s.status !== 'full-time').length} part-time teachers
            </span>
          </summary>

          <div className="mt-3 space-y-4">
            {/* Study Hall Assignments - Compact inline list */}
            <div id="study-hall-section">
              <h3 className="font-semibold mb-2 text-xs text-slate-500 uppercase tracking-wide">Study Hall Assignments</h3>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
                {studyHallAssignments.map((sh) => (
                  <div
                    key={sh.group}
                    className={`border rounded px-2 py-1.5 ${
                      sh.teacher ? "bg-blue-50 border-blue-200" : "bg-red-50 border-red-200"
                    }`}
                  >
                    <div className="font-medium text-xs">{sh.group.replace(' Grade', '')}</div>
                    {sh.teacher ? (
                      <div className="text-[10px] text-muted-foreground truncate" title={`${sh.teacher} - ${sh.day} B${sh.block}`}>
                        {sh.teacher.split(' ')[0]} • {sh.day?.slice(0,3)} B{sh.block}
                      </div>
                    ) : (
                      <div className="text-[10px] text-destructive">Not placed</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Teacher Utilization Table - Compact */}
            <div id="teacher-util-section">
              <h3 className="font-semibold mb-2 text-xs text-slate-500 uppercase tracking-wide">Teacher Utilization</h3>
              <div className="border rounded-lg overflow-hidden bg-white">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="py-2 px-2">Teacher</TableHead>
                      <TableHead className="py-2 px-2">Status</TableHead>
                      <TableHead className="text-center py-2 px-2">Teaching</TableHead>
                      <TableHead className="text-center py-2 px-2">Study Hall</TableHead>
                      <TableHead className="text-center py-2 px-2">Open</TableHead>
                      <TableHead className="text-center py-2 px-2">BTB Open</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedStats.map((stat) => (
                      <TableRow key={stat.teacher} className="hover:bg-slate-50">
                        <TableCell className="font-medium py-1.5 px-2">{stat.teacher}</TableCell>
                        <TableCell className="py-1.5 px-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            isFullTime(stat.status)
                              ? "bg-sky-100 text-sky-700"
                              : "bg-slate-100 text-slate-600"
                          }`}>
                            {stat.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-center py-1.5 px-2">{stat.teaching}</TableCell>
                        <TableCell className="text-center py-1.5 px-2">{stat.studyHall}</TableCell>
                        <TableCell className="text-center py-1.5 px-2">{stat.open}</TableCell>
                        <TableCell className="text-center py-1.5 px-2">
                          {stat.backToBackIssues > 0 ? (
                            <span className="text-amber-600 font-medium">{stat.backToBackIssues}</span>
                          ) : (
                            <span className="text-slate-300">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </details>
      </div>
    </TooltipProvider>
  )
}
