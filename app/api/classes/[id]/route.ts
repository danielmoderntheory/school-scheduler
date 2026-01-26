import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if (body.teacher_id !== undefined) updates.teacher_id = body.teacher_id
  if (body.grade_id !== undefined) updates.grade_id = body.grade_id
  if (body.subject_id !== undefined) updates.subject_id = body.subject_id
  if (body.days_per_week !== undefined) updates.days_per_week = body.days_per_week

  const { data, error } = await supabase
    .from("classes")
    .update(updates)
    .eq("id", id)
    .select(`
      *,
      teacher:teachers(id, name),
      grade:grades(id, name, display_name),
      subject:subjects(id, name),
      restrictions(*)
    `)
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This class assignment already exists" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { error } = await supabase.from("classes").delete().eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
