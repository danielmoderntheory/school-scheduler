import { NextResponse } from "next/server"

/**
 * Health check proxy to warm up Cloud Run container.
 * Called before solve requests to avoid cold start timeouts.
 */

const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL

export async function GET() {
  if (!SCHEDULER_API_URL) {
    return NextResponse.json({ status: 'error', message: 'SCHEDULER_API_URL not configured' }, { status: 500 })
  }

  try {
    const response = await fetch(`${SCHEDULER_API_URL}/health`, {
      method: 'GET',
      // Short timeout - we just want to wake it up
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      return NextResponse.json({ status: 'unhealthy', code: response.status }, { status: 502 })
    }

    const data = await response.json()
    return NextResponse.json({ status: 'healthy', upstream: data })
  } catch (error) {
    console.error('Health check failed:', error)
    return NextResponse.json(
      { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    )
  }
}
