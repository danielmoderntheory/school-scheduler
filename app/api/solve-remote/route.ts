import { NextRequest, NextResponse } from "next/server"

// Extend Vercel function timeout (Pro plan: up to 300s, Hobby: 10s max)
export const maxDuration = 300

/**
 * Proxy to the OR-Tools solver (local or Cloud Run).
 *
 * This route forwards scheduling requests to the Python backend
 * and returns the results to the frontend.
 *
 * Set SCHEDULER_API_URL to:
 * - http://localhost:8080 for local development
 * - https://your-cloud-run-url for production
 */

const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL

interface SolveRequest {
  teachers: Array<{
    name: string
    status: string
    canSuperviseStudyHall?: boolean
  }>
  classes: Array<{
    teacher: string
    grade: string
    grades?: string[]  // New: array of grade names
    gradeDisplay?: string
    subject: string
    daysPerWeek: number
    isElective?: boolean  // Electives skip grade conflicts
    isCotaught?: boolean  // Co-taught classes scheduled together
    availableDays?: string[]
    availableBlocks?: number[]
    fixedSlots?: [string, number][]
  }>
  numOptions?: number
  numAttempts?: number
  maxTimeSeconds?: number
  // Partial regeneration parameters
  lockedTeachers?: Record<string, Record<string, Record<number, [string, string] | null>>>
  teachersNeedingStudyHalls?: string[]
  startSeed?: number
  skipTopSolutions?: number
  randomizeScoring?: boolean
  skipStudyHalls?: boolean
  // Rules
  rules?: Array<{
    rule_key: string
    enabled: boolean
    config?: Record<string, unknown>
  }>
  // Grade list for grade schedule initialization
  grades?: string[]
}

export async function POST(request: NextRequest) {
  if (!SCHEDULER_API_URL) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'SCHEDULER_API_URL environment variable not configured',
        options: []
      },
      { status: 500 }
    )
  }

  try {
    const body: SolveRequest = await request.json()

    // Forward request to Cloud Run backend
    const response = await fetch(`${SCHEDULER_API_URL}/solve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        teachers: body.teachers,
        classes: body.classes,
        rules: body.rules,
        numOptions: body.numOptions || 3,
        numAttempts: body.numAttempts || 150,
        maxTimeSeconds: body.maxTimeSeconds || 280,
        // Partial regeneration parameters
        lockedTeachers: body.lockedTeachers,
        teachersNeedingStudyHalls: body.teachersNeedingStudyHalls,
        startSeed: body.startSeed || 0,
        skipTopSolutions: body.skipTopSolutions || 0,
        randomizeScoring: body.randomizeScoring || false,
        skipStudyHalls: body.skipStudyHalls || false,
        // Grade list for grade schedule initialization
        grades: body.grades,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Solver API error:', response.status, errorText)
      return NextResponse.json(
        {
          status: 'error',
          message: `Solver API returned ${response.status}: ${errorText}`,
          options: []
        },
        { status: response.status }
      )
    }

    const result = await response.json()
    return NextResponse.json(result)

  } catch (error) {
    console.error('Error calling solver API:', error)
    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error calling solver',
        options: []
      },
      { status: 500 }
    )
  }
}
