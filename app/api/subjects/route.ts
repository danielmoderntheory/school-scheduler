import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET() {
  try {
    const data = await sql`
      SELECT * FROM subjects
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
      INSERT INTO subjects (name)
      VALUES (${body.name})
      RETURNING *
    `
    return NextResponse.json(data)
  } catch (error) {
    const { message, code } = formatDbError(error)
    if (code === "23505") {
      // Subject already exists, return existing one
      try {
        const [existing] = await sql`
          SELECT * FROM subjects
          WHERE name = ${body.name}
        `
        return NextResponse.json(existing)
      } catch {
        return NextResponse.json({ error: message }, { status: 500 })
      }
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
