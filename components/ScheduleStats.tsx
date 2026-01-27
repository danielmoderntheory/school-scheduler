"use client"

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
import { Info, AlertTriangle, ChevronDown } from "lucide-react"
import type { TeacherStat, StudyHallAssignment } from "@/lib/types"

interface ScheduleStatsProps {
  stats: TeacherStat[]
  studyHallAssignments: StudyHallAssignment[]
  backToBackIssues: number
  studyHallsPlaced: number
  unscheduledClasses?: number
  totalClasses?: number
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
  backToBackIssues,
  studyHallsPlaced,
  unscheduledClasses = 0,
  totalClasses = 0,
}: ScheduleStatsProps) {
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
  const teachersWithBTB = sortedStats.filter(s => s.backToBackIssues > 0)
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
      message: `${unscheduledClasses} class session(s) could not be scheduled. Check for conflicting restrictions.`
    })
  }

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

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Summary Stats - Always visible */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Classes Scheduled */}
          <div className={`border rounded-lg p-4 ${unscheduledClasses > 0 ? 'border-red-300 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className="text-sm text-slate-600">
              Classes Scheduled
              <InfoTooltip text="Total class sessions successfully placed in the schedule. Each class with 3 days/week counts as 3 sessions." />
            </div>
            <div className="text-2xl font-bold">
              {totalClasses - unscheduledClasses}/{totalClasses}
              {unscheduledClasses > 0 && (
                <Badge variant="destructive" className="ml-2 text-xs">
                  {unscheduledClasses} Missing!
                </Badge>
              )}
              {unscheduledClasses === 0 && totalClasses > 0 && (
                <Badge className="ml-2 text-xs bg-emerald-500">All Set</Badge>
              )}
            </div>
          </div>

          {/* Study Halls */}
          <div
            className={`border rounded-lg p-4 ${studyHallsPlaced < 6 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'} ${studyHallsPlaced < 6 ? 'cursor-pointer hover:border-amber-300' : ''}`}
            onClick={studyHallsPlaced < 6 ? () => scrollToSection('study-hall-section') : undefined}
          >
            <div className="text-sm text-slate-600">
              Study Halls Placed
              <InfoTooltip text="Study hall supervision slots assigned to eligible full-time teachers. Grades 6-11 each need one study hall per week (6 total)." />
            </div>
            <div className="text-2xl font-bold">
              {studyHallsPlaced}/6
              {studyHallsPlaced >= 6 && (
                <Badge className="ml-2 text-xs bg-emerald-500">Complete</Badge>
              )}
              {studyHallsPlaced < 6 && (
                <Badge variant="outline" className="ml-2 text-xs border-amber-400 text-amber-700">
                  {6 - studyHallsPlaced} Missing
                </Badge>
              )}
            </div>
            {studyHallsPlaced < 6 && (
              <div className="text-xs text-amber-600 mt-1">Click for details</div>
            )}
          </div>

          {/* Back-to-Back Open */}
          <div
            className={`border rounded-lg p-4 ${backToBackIssues > 0 ? 'border-amber-100 bg-amber-50/50 cursor-pointer hover:border-amber-200' : 'border-slate-200 bg-slate-50'}`}
            onClick={backToBackIssues > 0 ? () => scrollToSection('teacher-util-section') : undefined}
          >
            <div className="text-sm text-slate-600">
              Back-to-Back Open
              <InfoTooltip text="Number of times a full-time teacher has consecutive open (unassigned) blocks. Ideally minimized but not critical - the schedule is still valid." />
            </div>
            <div className="text-2xl font-bold text-slate-700">
              {backToBackIssues}
              <span className="text-sm font-normal text-slate-500 ml-1">
                {backToBackIssues === 1 ? 'issue' : 'issues'}
              </span>
            </div>
            {backToBackIssues > 0 && (
              <div className="text-xs text-amber-600 mt-1">Click to see which teachers</div>
            )}
          </div>

          {/* Avg Open Blocks - Full-time teachers only */}
          <div
            className="border rounded-lg p-4 border-slate-200 bg-slate-50 cursor-pointer hover:border-slate-300"
            onClick={() => scrollToSection('teacher-util-section')}
          >
            <div className="text-sm text-slate-600">
              Avg Open Blocks
              <InfoTooltip text="Average number of unassigned blocks per full-time teacher. Lower means teachers are busier. Teachers with many open blocks could take on more classes." />
            </div>
            <div className="text-2xl font-bold text-slate-700">
              {fullTimeTeachers.length > 0
                ? (fullTimeTeachers.reduce((sum, t) => sum + t.open, 0) / fullTimeTeachers.length).toFixed(1)
                : 0}
              <span className="text-sm font-normal text-slate-500 ml-1">
                / 25
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">Full-time teachers only</div>
          </div>
        </div>

        {/* Issues & Suggestions - Only show if there are issues */}
        {issues.length > 0 && (
          <div className="border border-amber-200 rounded-lg bg-amber-50/50 p-4">
            <h3 className="font-medium text-amber-800 mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Notes & Suggestions
            </h3>
            <ul className="space-y-1.5">
              {issues.map((issue, i) => (
                <li key={i} className={`text-sm ${issue.type === 'warning' ? 'text-amber-800' : 'text-amber-700'}`}>
                  {issue.type === 'warning' ? '• ' : '• '}
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Detailed Tables - Collapsed */}
        <details id="stats-details" className="group border border-slate-200 rounded-lg p-3 bg-slate-50/50">
          <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-800">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            Study Hall & Teacher Details
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
                            stat.status === "full-time"
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
