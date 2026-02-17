import { NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const [data] = await sql`
      SELECT * FROM timetable_templates
      WHERE id = ${id}
    `

    if (!data) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  try {
    const [data] = await sql`
      UPDATE timetable_templates
      SET
        name = COALESCE(${body.name ?? null}, name),
        rows = COALESCE(${body.rows ? JSON.stringify(body.rows) : null}, rows)
      WHERE id = ${id}
      RETURNING *
    `

    if (!data) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Soft delete: set deleted_at instead of actually deleting
    await sql`
      UPDATE timetable_templates
      SET deleted_at = NOW()
      WHERE id = ${id}
    `
    return NextResponse.json({ success: true })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
