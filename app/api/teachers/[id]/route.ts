import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  // Build dynamic update query
  const updates: string[] = []
  const values: unknown[] = []

  if (body.name !== undefined) {
    updates.push("name")
    values.push(body.name)
  }
  if (body.status !== undefined) {
    updates.push("status")
    values.push(body.status)
  }
  if (body.can_supervise_study_hall !== undefined) {
    updates.push("can_supervise_study_hall")
    values.push(body.can_supervise_study_hall)
  }
  if (body.notes !== undefined) {
    updates.push("notes")
    values.push(body.notes)
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 })
  }

  try {
    // Use conditional updates with COALESCE pattern
    const [data] = await sql`
      UPDATE teachers
      SET
        name = COALESCE(${body.name ?? null}, name),
        status = COALESCE(${body.status ?? null}, status),
        can_supervise_study_hall = COALESCE(${body.can_supervise_study_hall ?? null}, can_supervise_study_hall),
        notes = ${body.notes !== undefined ? body.notes : null}
      WHERE id = ${id}
      RETURNING *
    `

    if (!data) {
      return NextResponse.json({ error: "Teacher not found" }, { status: 404 })
    }

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Soft delete: set deleted_at instead of actually deleting
    await sql`
      UPDATE teachers
      SET deleted_at = NOW()
      WHERE id = ${id}
    `
    return NextResponse.json({ success: true })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
