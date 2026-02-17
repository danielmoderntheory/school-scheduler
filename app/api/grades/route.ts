import { NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET() {
  try {
    const data = await sql`
      SELECT * FROM grades
      WHERE deleted_at IS NULL
      ORDER BY sort_order
    `
    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, display_name, sort_order } = body

  if (!name || !display_name) {
    return NextResponse.json(
      { error: "Name and display_name are required" },
      { status: 400 }
    )
  }

  try {
    // Get max sort_order if not provided
    let order = sort_order
    if (order === undefined) {
      const [maxData] = await sql`
        SELECT sort_order FROM grades
        ORDER BY sort_order DESC
        LIMIT 1
      `
      order = maxData ? maxData.sort_order + 1 : 0
    }

    const [data] = await sql`
      INSERT INTO grades (name, display_name, sort_order)
      VALUES (
        ${name.toLowerCase().replace(/\s+/g, "-")},
        ${display_name},
        ${order}
      )
      RETURNING *
    `

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
