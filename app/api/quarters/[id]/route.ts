import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"
import { formatQuarterName } from "@/lib/types"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  try {
    // Auto-regenerate name when year or quarter_num changes
    let name = body.name
    if (body.year !== undefined || body.quarter_num !== undefined) {
      // Fetch current values for fields not being updated
      const [current] = await sql`
        SELECT year, quarter_num FROM quarters WHERE id = ${id}
      `
      if (current) {
        const year = body.year ?? current.year
        const quarterNum = body.quarter_num ?? current.quarter_num
        name = formatQuarterName(quarterNum, year)
      }
    }

    const [data] = await sql`
      UPDATE quarters
      SET
        name = COALESCE(${name ?? null}, name),
        year = COALESCE(${body.year ?? null}, year),
        quarter_num = COALESCE(${body.quarter_num ?? null}, quarter_num),
        start_date = COALESCE(${body.start_date ?? null}, start_date),
        end_date = COALESCE(${body.end_date ?? null}, end_date)
      WHERE id = ${id}
      RETURNING *
    `

    if (!data) {
      return NextResponse.json({ error: "Quarter not found" }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Check if quarter has classes
    const classes = await sql`
      SELECT id FROM classes
      WHERE quarter_id = ${id}
      LIMIT 1
    `

    if (classes.length > 0) {
      return NextResponse.json(
        { error: "Cannot archive quarter with classes. Delete classes first." },
        { status: 400 }
      )
    }

    // Soft delete: set deleted_at instead of actually deleting
    await sql`
      UPDATE quarters
      SET deleted_at = NOW()
      WHERE id = ${id}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
