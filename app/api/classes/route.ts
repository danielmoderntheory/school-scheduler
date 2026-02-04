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
  // All FKs are nullable to support draft/incomplete classes
  const insertData: {
    quarter_id: string
    teacher_id?: string | null
    subject_id?: string | null
    days_per_week: number
    grade_id?: string | null
    grade_ids?: string[] | null
    is_elective?: boolean
    is_cotaught?: boolean
  } = {
    quarter_id: body.quarter_id,
    teacher_id: body.teacher_id || null,
    subject_id: body.subject_id || null,
    days_per_week: body.days_per_week || 1,
    is_elective: body.is_elective || false,
    is_cotaught: body.is_cotaught || false,
  }

  if (body.grade_ids && Array.isArray(body.grade_ids) && body.grade_ids.length > 0) {
    insertData.grade_ids = body.grade_ids
    // Also set grade_id to first grade for backward compatibility
    insertData.grade_id = body.grade_ids[0]
  } else if (body.grade_id) {
    insertData.grade_id = body.grade_id
    insertData.grade_ids = [body.grade_id]
  } else {
    insertData.grade_id = null
    insertData.grade_ids = null
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

  // Create restrictions if provided
  if (body.restrictions && Array.isArray(body.restrictions) && body.restrictions.length > 0) {
    const restrictionsToInsert = body.restrictions.map((r: { restriction_type: string; value: unknown }) => ({
      class_id: data.id,
      restriction_type: r.restriction_type,
      value: r.value,
    }))

    const { data: restrictionsData, error: restrictionsError } = await supabase
      .from("restrictions")
      .insert(restrictionsToInsert)
      .select()

    if (!restrictionsError && restrictionsData) {
      data.restrictions = restrictionsData
    }
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
