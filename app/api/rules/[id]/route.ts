import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  try {
    const [data] = await sql`
      UPDATE rules
      SET
        enabled = COALESCE(${body.enabled ?? null}, enabled),
        priority = COALESCE(${body.priority ?? null}, priority),
        config = COALESCE(${body.config ? JSON.stringify(body.config) : null}, config)
      WHERE id = ${id}
      RETURNING *
    `

    if (!data) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
