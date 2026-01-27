import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const quarterId = searchParams.get("quarter_id")

  let query = supabase
    .from("classes")
    .select(`
      *,
      teacher:teachers(id, name, status),
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

  // If classes have grade_ids, fetch the grades for each class
  if (data && data.length > 0) {
    // Collect all unique grade_ids
    const allGradeIds = new Set<string>()
    data.forEach((cls: { grade_ids?: string[] }) => {
      if (cls.grade_ids && Array.isArray(cls.grade_ids)) {
        cls.grade_ids.forEach((id: string) => allGradeIds.add(id))
      }
    })

    if (allGradeIds.size > 0) {
      // Fetch all grades in one query
      const { data: gradesData } = await supabase
        .from("grades")
        .select("id, name, display_name, sort_order")
        .in("id", Array.from(allGradeIds))

      const gradesMap = new Map(gradesData?.map((g: { id: string; name: string; display_name: string; sort_order: number }) => [g.id, g]) || [])

      // Add grades array to each class
      data.forEach((cls: { grade_ids?: string[]; grades?: unknown[] }) => {
        if (cls.grade_ids && Array.isArray(cls.grade_ids)) {
          cls.grades = cls.grade_ids
            .map((id: string) => gradesMap.get(id))
            .filter((g): g is { id: string; name: string; display_name: string; sort_order: number } => !!g)
            .sort((a, b) => a.sort_order - b.sort_order)
        }
      })
    }
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Support both grade_id (single, legacy) and grade_ids (array, new)
  const insertData: {
    quarter_id: string
    teacher_id: string
    subject_id: string
    days_per_week: number
    grade_id?: string
    grade_ids?: string[]
    is_elective?: boolean
  } = {
    quarter_id: body.quarter_id,
    teacher_id: body.teacher_id,
    subject_id: body.subject_id,
    days_per_week: body.days_per_week || 1,
    is_elective: body.is_elective || false,
  }

  if (body.grade_ids && Array.isArray(body.grade_ids) && body.grade_ids.length > 0) {
    insertData.grade_ids = body.grade_ids
    // Also set grade_id to first grade for backward compatibility
    insertData.grade_id = body.grade_ids[0]
  } else if (body.grade_id) {
    insertData.grade_id = body.grade_id
    insertData.grade_ids = [body.grade_id]
  }

  const { data, error } = await supabase
    .from("classes")
    .insert(insertData)
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

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const quarterId = searchParams.get("quarter_id")

  if (!quarterId) {
    return NextResponse.json(
      { error: "quarter_id is required" },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from("classes")
    .delete()
    .eq("quarter_id", quarterId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
