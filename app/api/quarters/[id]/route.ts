import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.year !== undefined) updates.year = body.year
  if (body.quarter_num !== undefined) updates.quarter_num = body.quarter_num
  if (body.start_date !== undefined) updates.start_date = body.start_date
  if (body.end_date !== undefined) updates.end_date = body.end_date

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
      { error: "Cannot delete quarter with classes. Delete classes first." },
      { status: 400 }
    )
  }

  const { error } = await supabase.from("quarters").delete().eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
