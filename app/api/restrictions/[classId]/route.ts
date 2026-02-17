import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params

  try {
    const data = await sql`
      SELECT * FROM restrictions
      WHERE class_id = ${classId}
    `
    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params
  const body = await request.json()

  try {
    // Delete existing restrictions
    await sql`DELETE FROM restrictions WHERE class_id = ${classId}`

    // Insert new restrictions
    const restrictions = body.restrictions || []

    if (restrictions.length > 0) {
      for (const r of restrictions) {
        await sql`
          INSERT INTO restrictions (class_id, restriction_type, value)
          VALUES (${classId}, ${r.restriction_type}, ${JSON.stringify(r.value)})
        `
      }
    }

    // Touch the parent class to update its updated_at (trigger sets the actual value)
    await sql`
      UPDATE classes
      SET updated_at = NOW()
      WHERE id = ${classId}
    `

    // Return updated restrictions
    const data = await sql`
      SELECT * FROM restrictions
      WHERE class_id = ${classId}
    `

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
