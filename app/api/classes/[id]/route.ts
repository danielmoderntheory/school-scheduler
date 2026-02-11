import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase-admin"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if (body.teacher_id !== undefined) updates.teacher_id = body.teacher_id
  if (body.subject_id !== undefined) updates.subject_id = body.subject_id
  if (body.days_per_week !== undefined) updates.days_per_week = body.days_per_week
  if (body.is_elective !== undefined) updates.is_elective = body.is_elective
  if (body.is_cotaught !== undefined) updates.is_cotaught = body.is_cotaught

  // Handle grade_ids (new) or grade_id (legacy)
  if (body.grade_ids !== undefined && Array.isArray(body.grade_ids)) {
    updates.grade_ids = body.grade_ids
    // Also update grade_id for backward compatibility
    updates.grade_id = body.grade_ids.length > 0 ? body.grade_ids[0] : null
  } else if (body.grade_id !== undefined) {
    updates.grade_id = body.grade_id
    updates.grade_ids = body.grade_id ? [body.grade_id] : []
  }

  const { data, error } = await supabase
    .from("classes")
    .update(updates)
    .eq("id", id)
    .select(`
      *,
      teacher:teachers(id, name, status),
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

  // Fetch grades for the grade_ids
  if (data.grade_ids && data.grade_ids.length > 0) {
    const { data: gradesData } = await supabase
      .from("grades")
      .select("id, name, display_name, sort_order")
      .in("id", data.grade_ids)

    data.grades = gradesData?.sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order) || []
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
