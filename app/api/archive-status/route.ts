import { NextRequest, NextResponse } from "next/server"
import { checkArchiveStatus, type ArchiveEntityType } from "@/lib/archive-utils"

/**
 * GET /api/archive-status?type=teacher&ids=id1,id2,...
 *
 * Check if entities can be safely archived (not used in current quarter schedules)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const entityType = searchParams.get("type") as ArchiveEntityType | null
  const idsParam = searchParams.get("ids")

  if (!entityType || !["teacher", "grade", "subject"].includes(entityType)) {
    return NextResponse.json(
      { error: "Invalid or missing 'type' parameter. Must be 'teacher', 'grade', or 'subject'" },
      { status: 400 }
    )
  }

  if (!idsParam) {
    return NextResponse.json(
      { error: "Missing 'ids' parameter" },
      { status: 400 }
    )
  }

  const ids = idsParam.split(",").filter(Boolean)

  if (ids.length === 0) {
    return NextResponse.json([])
  }

  try {
    const results = await checkArchiveStatus(entityType, ids)
    return NextResponse.json(results)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
