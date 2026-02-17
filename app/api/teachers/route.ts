import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"
import { TEACHER_STATUS_FULL_TIME } from "@/lib/schedule-utils"

export async function GET() {
  try {
    const data = await sql`
      SELECT * FROM teachers
      WHERE deleted_at IS NULL
      ORDER BY name
    `
    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  try {
    const [data] = await sql`
      INSERT INTO teachers (name, status, can_supervise_study_hall, notes)
      VALUES (
        ${body.name},
        ${body.status || TEACHER_STATUS_FULL_TIME},
        ${body.can_supervise_study_hall || false},
        ${body.notes || null}
      )
      RETURNING *
    `
    return NextResponse.json(data)
  } catch (error) {
    const { message, code } = formatDbError(error)
    if (code === "23505") {
      return NextResponse.json(
        { error: "A teacher with this name already exists" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
