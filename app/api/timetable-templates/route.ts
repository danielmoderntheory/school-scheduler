import { NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET() {
  try {
    const data = await sql`
      SELECT * FROM timetable_templates
      WHERE deleted_at IS NULL
      ORDER BY created_at
    `
    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, rows } = body

  if (!name) {
    return NextResponse.json(
      { error: "Name is required" },
      { status: 400 }
    )
  }

  try {
    const [data] = await sql`
      INSERT INTO timetable_templates (name, rows)
      VALUES (${name}, ${JSON.stringify(rows || [])})
      RETURNING *
    `
    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
