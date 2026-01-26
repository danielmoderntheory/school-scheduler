import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const quarterId = searchParams.get("quarter_id")

  let query = supabase
    .from("classes")
    .select(`
      *,
      teacher:teachers(id, name),
      grade:grades(id, name, display_name),
      subject:subjects(id, name),
      restrictions(*)
    `)
    .order("created_at")

  if (quarterId) {
    query = query.eq("quarter_id", quarterId)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  const { data, error } = await supabase
    .from("classes")
    .insert({
      quarter_id: body.quarter_id,
      teacher_id: body.teacher_id,
      grade_id: body.grade_id,
      subject_id: body.subject_id,
      days_per_week: body.days_per_week || 1,
    })
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
