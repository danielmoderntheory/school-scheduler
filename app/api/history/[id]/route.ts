import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const searchParams = request.nextUrl.searchParams

  // `view` param indicates public/lite mode (e.g., ?view=timetable)
  const viewParam = searchParams.get("view")
  const isLiteMode = !!viewParam

  try {
    let row

    if (isLiteMode) {
      // Lightweight query for public view - only load selected option, skip stats
      const [result] = await sql`
        SELECT
          sg.id, sg.quarter_id, sg.generated_at, sg.selected_option,
          sg.notes, sg.is_starred, sg.is_saved, sg.deleted_at,
          sg.options->((sg.selected_option - 1)::int) as selected_schedule,
          q.id as quarter_id_ref,
          q.name as quarter_name
        FROM schedule_generations sg
        LEFT JOIN quarters q ON sg.quarter_id = q.id
        WHERE sg.id = ${id}
      `
      if (result) {
        // Wrap the single option in an array to maintain compatibility
        // Set selected_option to 1 since we only return one option at index 0
        row = {
          ...result,
          options: result.selected_schedule ? [result.selected_schedule] : [],
          selected_option: 1,
          stats: null, // Not needed for public view
        }
        delete row.selected_schedule
      }
    } else {
      // Full query for admin editing
      const [result] = await sql`
        SELECT
          sg.*,
          q.id as quarter_id_ref,
          q.name as quarter_name
        FROM schedule_generations sg
        LEFT JOIN quarters q ON sg.quarter_id = q.id
        WHERE sg.id = ${id}
      `
      row = result
    }

    if (!row) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 })
    }

    // Transform to match expected format
    const data = {
      ...row,
      quarter: row.quarter_id_ref ? { id: row.quarter_id_ref, name: row.quarter_name } : null,
    }
    delete data.quarter_id_ref
    delete data.quarter_name

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  try {
    const [data] = await sql`
      UPDATE schedule_generations
      SET
        selected_option = COALESCE(${body.selected_option ?? null}, selected_option),
        notes = COALESCE(${body.notes ?? null}, notes),
        is_starred = COALESCE(${body.is_starred ?? null}, is_starred),
        options = COALESCE(${body.options ? JSON.stringify(body.options) : null}, options),
        stats = COALESCE(${body.stats ? JSON.stringify(body.stats) : null}, stats)
      WHERE id = ${id}
      RETURNING *
    `

    if (!data) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 })
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
    // Soft delete - set deleted_at timestamp
    await sql`UPDATE schedule_generations SET deleted_at = NOW() WHERE id = ${id}`
    return NextResponse.json({ success: true })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  try {
    // Undelete - clear deleted_at timestamp
    if (body.action === "undelete") {
      await sql`UPDATE schedule_generations SET deleted_at = NULL WHERE id = ${id}`
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
