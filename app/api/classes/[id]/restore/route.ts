import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const [data] = await sql`
      UPDATE classes
      SET deleted_at = NULL
      WHERE id = ${id}
      RETURNING id
    `

    if (!data) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
