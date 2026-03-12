import { NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  try {
    const [data] = await sql`
      UPDATE subjects
      SET name = COALESCE(${body.name ?? null}, name)
      WHERE id = ${id}
      RETURNING *
    `

    if (!data) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 })
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
    // Check if subject is used in any active classes (not soft-deleted)
    const classes = await sql`
      SELECT id FROM classes
      WHERE subject_id = ${id} AND deleted_at IS NULL
      LIMIT 1
    `

    if (classes.length > 0) {
      return NextResponse.json(
        { error: "Cannot archive subject that is used in classes" },
        { status: 400 }
      )
    }

    // Soft delete: set deleted_at instead of actually deleting
    await sql`
      UPDATE subjects
      SET deleted_at = NOW()
      WHERE id = ${id}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
