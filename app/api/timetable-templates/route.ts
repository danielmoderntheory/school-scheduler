import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET(request: NextRequest) {
  const quarterId = request.nextUrl.searchParams.get("quarter_id")

  try {
    if (quarterId) {
      // Resolve the single template for a quarter: its assigned template,
      // falling back to the oldest template (the original 5-block format)
      // for quarters that predate per-quarter formats.
      const data = await sql`
        SELECT t.* FROM timetable_templates t
        WHERE t.deleted_at IS NULL
          AND t.id = COALESCE(
            (SELECT q.timetable_template_id FROM quarters q WHERE q.id = ${quarterId}),
            (SELECT t2.id FROM timetable_templates t2
             WHERE t2.deleted_at IS NULL ORDER BY t2.created_at LIMIT 1)
          )
      `
      return NextResponse.json(data)
    }

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
