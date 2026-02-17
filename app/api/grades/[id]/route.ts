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
      UPDATE grades
      SET
        name = COALESCE(${body.name ?? null}, name),
        display_name = COALESCE(${body.display_name ?? null}, display_name),
        sort_order = COALESCE(${body.sort_order ?? null}, sort_order),
        homeroom_teachers = COALESCE(${body.homeroom_teachers ?? null}, homeroom_teachers)
      WHERE id = ${id}
      RETURNING *
    `

    if (!data) {
      return NextResponse.json({ error: "Grade not found" }, { status: 404 })
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
    // Check if grade is used in any classes
    const classes = await sql`
      SELECT id FROM classes
      WHERE grade_id = ${id}
      LIMIT 1
    `

    if (classes.length > 0) {
      return NextResponse.json(
        { error: "Cannot archive grade that is used in classes" },
        { status: 400 }
      )
    }

    // Soft delete: set deleted_at instead of actually deleting
    await sql`
      UPDATE grades
      SET deleted_at = NOW()
      WHERE id = ${id}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
