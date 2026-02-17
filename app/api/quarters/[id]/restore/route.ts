import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Restore the quarter
    const [data] = await sql`
      UPDATE quarters
      SET deleted_at = NULL
      WHERE id = ${id}
      RETURNING *
    `

    if (!data) {
      return NextResponse.json({ error: "Quarter not found" }, { status: 404 })
    }

    // Cascade restore classes belonging to this quarter
    const restoredClasses = await sql`
      UPDATE classes
      SET deleted_at = NULL
      WHERE quarter_id = ${id} AND deleted_at IS NOT NULL
      RETURNING id
    `
    const classIds = restoredClasses.map((c: { id: string }) => c.id)

    // Cascade restore restrictions for these classes
    if (classIds.length > 0) {
      await sql`
        UPDATE restrictions
        SET deleted_at = NULL
        WHERE class_id = ANY(${classIds}::uuid[]) AND deleted_at IS NOT NULL
      `
    }

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
