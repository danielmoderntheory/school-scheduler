import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { TEACHER_STATUS_FULL_TIME } from "@/lib/schedule-utils"

interface ClassSnapshot {
  teacher_id: string
  teacher_name: string
  grade_id: string
  grade_name: string
  grade_display_name: string
  subject_id: string
  subject_name: string
  days_per_week: number
  restrictions: Array<{
    restriction_type: string
    value: unknown
  }>
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { mode, new_quarter_name } = body // mode: 'overwrite' | 'new_quarter'

  // Get the generation with classes snapshot
  const { data: generation, error: fetchError } = await supabase
    .from("schedule_generations")
    .select("*, quarter:quarters(*)")
    .eq("id", id)
    .single()

  if (fetchError || !generation) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 })
  }

  const classesSnapshot = generation.stats?.classes_snapshot as ClassSnapshot[] | undefined

  if (!classesSnapshot || classesSnapshot.length === 0) {
    return NextResponse.json(
      { error: "No classes snapshot found for this generation" },
      { status: 400 }
    )
  }

  let targetQuarterId: string

  if (mode === "new_quarter") {
    // Create a new quarter
    const quarterName = new_quarter_name || `${generation.quarter?.name} (restored)`

    // Parse year and quarter from original
    const year = generation.quarter?.year || new Date().getFullYear()
    const quarterNum = generation.quarter?.quarter || 1

    // Find a unique quarter number for this year
    const { data: existingQuarters } = await supabase
      .from("quarters")
      .select("quarter")
      .eq("year", year)

    const usedQuarters = existingQuarters?.map((q) => q.quarter) || []
    let newQuarterNum = quarterNum
    while (usedQuarters.includes(newQuarterNum) && newQuarterNum <= 4) {
      newQuarterNum++
    }
    if (newQuarterNum > 4) {
      // Try next year
      const nextYear = year + 1
      newQuarterNum = 1
    }

    const { data: newQuarter, error: quarterError } = await supabase
      .from("quarters")
      .insert({
        name: quarterName,
        year: year,
        quarter: newQuarterNum <= 4 ? newQuarterNum : 1,
        is_active: false,
      })
      .select()
      .single()

    if (quarterError) {
      return NextResponse.json({ error: quarterError.message }, { status: 500 })
    }

    targetQuarterId = newQuarter.id
  } else {
    // Overwrite current quarter
    targetQuarterId = generation.quarter_id

    // Delete existing classes for this quarter
    const { error: deleteError } = await supabase
      .from("classes")
      .delete()
      .eq("quarter_id", targetQuarterId)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }
  }

  // Ensure all teachers exist
  const teacherIds = new Map<string, string>()
  for (const cls of classesSnapshot) {
    if (!teacherIds.has(cls.teacher_name)) {
      // Check if teacher exists
      const { data: existingTeacher } = await supabase
        .from("teachers")
        .select("id")
        .eq("name", cls.teacher_name)
        .single()

      if (existingTeacher) {
        teacherIds.set(cls.teacher_name, existingTeacher.id)
      } else {
        // Create teacher
        const { data: newTeacher, error } = await supabase
          .from("teachers")
          .insert({ name: cls.teacher_name, status: TEACHER_STATUS_FULL_TIME })
          .select()
          .single()

        if (newTeacher) {
          teacherIds.set(cls.teacher_name, newTeacher.id)
        }
      }
    }
  }

  // Ensure all subjects exist
  const subjectIds = new Map<string, string>()
  for (const cls of classesSnapshot) {
    if (!subjectIds.has(cls.subject_name)) {
      const { data: existingSubject } = await supabase
        .from("subjects")
        .select("id")
        .eq("name", cls.subject_name)
        .single()

      if (existingSubject) {
        subjectIds.set(cls.subject_name, existingSubject.id)
      } else {
        const { data: newSubject } = await supabase
          .from("subjects")
          .insert({ name: cls.subject_name })
          .select()
          .single()

        if (newSubject) {
          subjectIds.set(cls.subject_name, newSubject.id)
        }
      }
    }
  }

  // Get all grades (they should already exist)
  const { data: grades } = await supabase.from("grades").select("id, name")
  const gradeIds = new Map(grades?.map((g) => [g.name, g.id]) || [])

  // Insert classes
  const classInserts = classesSnapshot.map((cls) => ({
    quarter_id: targetQuarterId,
    teacher_id: teacherIds.get(cls.teacher_name),
    grade_id: gradeIds.get(cls.grade_name) || cls.grade_id,
    subject_id: subjectIds.get(cls.subject_name),
    days_per_week: cls.days_per_week,
  }))

  const { data: insertedClasses, error: insertError } = await supabase
    .from("classes")
    .insert(classInserts)
    .select()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Insert restrictions
  for (let i = 0; i < classesSnapshot.length; i++) {
    const cls = classesSnapshot[i]
    const insertedClass = insertedClasses[i]

    if (cls.restrictions && cls.restrictions.length > 0 && insertedClass) {
      const restrictionInserts = cls.restrictions.map((r) => ({
        class_id: insertedClass.id,
        restriction_type: r.restriction_type,
        value: r.value,
      }))

      await supabase.from("restrictions").insert(restrictionInserts)
    }
  }

  // If new quarter, activate it
  if (mode === "new_quarter") {
    // Deactivate all quarters
    await supabase.from("quarters").update({ is_active: false }).neq("id", "")
    // Activate new quarter
    await supabase.from("quarters").update({ is_active: true }).eq("id", targetQuarterId)
  }

  return NextResponse.json({
    success: true,
    quarter_id: targetQuarterId,
    classes_count: insertedClasses.length,
  })
}
