import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { formatQuarterName } from "@/lib/types"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if (body.year !== undefined) updates.year = body.year
  if (body.quarter_num !== undefined) updates.quarter_num = body.quarter_num
  if (body.start_date !== undefined) updates.start_date = body.start_date
  if (body.end_date !== undefined) updates.end_date = body.end_date

  // Auto-regenerate name when year or quarter_num changes
  if (body.year !== undefined || body.quarter_num !== undefined) {
    // Fetch current values for fields not being updated
    const { data: current } = await supabase.from("quarters").select("year, quarter_num").eq("id", id).single()
    if (current) {
      const year = body.year ?? current.year
      const quarterNum = body.quarter_num ?? current.quarter_num
      updates.name = formatQuarterName(quarterNum, year)
    }
  } else if (body.name !== undefined) {
    updates.name = body.name
  }

  const { data, error } = await supabase
    .from("quarters")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Check if quarter has classes
  const { data: classes } = await supabase
    .from("classes")
    .select("id")
    .eq("quarter_id", id)
    .limit(1)

  if (classes && classes.length > 0) {
    return NextResponse.json(
      { error: "Cannot archive quarter with classes. Delete classes first." },
      { status: 400 }
    )
  }

  // Soft delete: set deleted_at instead of actually deleting
  const { error } = await supabase
    .from("quarters")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
