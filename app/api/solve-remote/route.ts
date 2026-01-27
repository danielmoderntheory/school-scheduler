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
    availableDays?: string[]
    availableBlocks?: number[]
    fixedSlots?: [string, number][]
  }>
  numOptions?: number
  numAttempts?: number
  maxTimeSeconds?: number
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
        numOptions: body.numOptions || 3,
        numAttempts: body.numAttempts || 150,
        maxTimeSeconds: body.maxTimeSeconds || 280,
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
