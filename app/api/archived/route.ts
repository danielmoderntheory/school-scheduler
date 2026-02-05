import { NextRequest, NextResponse } from "next/server"
import { getArchivedEntities } from "@/lib/archive-utils"

/**
 * GET /api/archived?type=teacher|grade|subject|quarter|timetable_template
 *
 * Get all archived entities of a given type
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const entityType = searchParams.get("type")

  const validTypes = ["teacher", "grade", "subject", "quarter", "timetable_template"]
  if (!entityType || !validTypes.includes(entityType)) {
    return NextResponse.json(
      { error: `Invalid or missing 'type' parameter. Must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    )
  }

  try {
    const archived = await getArchivedEntities(
      entityType as "teacher" | "grade" | "subject" | "quarter" | "timetable_template"
    )
    return NextResponse.json(archived)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
