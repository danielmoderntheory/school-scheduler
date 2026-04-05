import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const knownFields = ['name', 'status', 'can_supervise_study_hall', 'notes', 'available_days', 'available_blocks']
  const hasUpdates = knownFields.some(f => body[f] !== undefined)

  if (!hasUpdates) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 })
  }

  try {
    // Update each field individually to avoid overwriting unrelated fields.
    // The COALESCE pattern doesn't work for nullable fields (notes, JSONB),
    // and CASE WHEN with parameterized booleans isn't reliable with Neon.
    if (body.name !== undefined) {
      await sql`UPDATE teachers SET name = ${body.name} WHERE id = ${id}`
    }
    if (body.status !== undefined) {
      await sql`UPDATE teachers SET status = ${body.status} WHERE id = ${id}`
    }
    if (body.can_supervise_study_hall !== undefined) {
      await sql`UPDATE teachers SET can_supervise_study_hall = ${body.can_supervise_study_hall} WHERE id = ${id}`
    }
    if (body.notes !== undefined) {
      await sql`UPDATE teachers SET notes = ${body.notes} WHERE id = ${id}`
    }
    if (body.available_days !== undefined) {
      const json = body.available_days ? JSON.stringify(body.available_days) : null
      await sql`UPDATE teachers SET available_days = ${json} WHERE id = ${id}`
    }
    if (body.available_blocks !== undefined) {
      const json = body.available_blocks ? JSON.stringify(body.available_blocks) : null
      await sql`UPDATE teachers SET available_blocks = ${json} WHERE id = ${id}`
    }

    const [data] = await sql`SELECT * FROM teachers WHERE id = ${id}`
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
