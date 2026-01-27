import { NextResponse } from "next/server"

/**
 * Returns the current solver configuration.
 * Used by the UI to show which solver is being used.
 */
export async function GET() {
  const url = process.env.SCHEDULER_API_URL || ""
  const isLocal = url.includes("localhost") || url.includes("127.0.0.1")

  return NextResponse.json({
    url,
    isLocal,
    environment: isLocal ? "local" : "production",
  })
}
