import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

/**
 * One-time migration endpoint to add snapshot data to an old schedule generation.
 * This should be called once per generation that needs migration.
 *
 * POST /api/history/[id]/migrate-snapshot
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: generationId } = await params

  // 1. Fetch the generation to get its quarter_id
  const { data: generation, error: genError } = await supabase
    .from("schedule_generations")
    .select("*, quarter:quarters(id, name)")
    .eq("id", generationId)
    .single()

  if (genError || !generation) {
    return NextResponse.json(
      { error: "Generation not found: " + genError?.message },
      { status: 404 }
    )
  }

  // Check if already migrated
  if (generation.stats?.classes_snapshot?.length > 0) {
    return NextResponse.json({
      message: "Already migrated",
      stats_keys: Object.keys(generation.stats || {}),
    })
  }

  const quarterId = generation.quarter_id

  // 2. Fetch all required data for snapshots
  const [classesRes, teachersRes, gradesRes, rulesRes] = await Promise.all([
    supabase
      .from("classes")
      .select(
        `
        id,
        days_per_week,
        is_elective,
        grade_ids,
        teacher:teachers(id, name),
        grade:grades(id, name, display_name),
        subject:subjects(id, name),
        restrictions(id, restriction_type, value)
      `
      )
      .eq("quarter_id", quarterId),

    supabase
      .from("teachers")
      .select("id, name, status, can_supervise_study_hall")
      .order("name"),

    supabase
      .from("grades")
      .select("id, name, display_name, sort_order")
      .order("sort_order"),

    supabase.from("rules").select("id, rule_key, enabled, config"),
  ])

  if (classesRes.error || teachersRes.error || gradesRes.error || rulesRes.error) {
    return NextResponse.json(
      {
        error: "Failed to fetch data",
        details: {
          classes: classesRes.error?.message,
          teachers: teachersRes.error?.message,
          grades: gradesRes.error?.message,
          rules: rulesRes.error?.message,
        },
      },
      { status: 500 }
    )
  }

  const classes = classesRes.data || []
  const teachers = teachersRes.data || []
  const grades = gradesRes.data || []
  const rules = rulesRes.data || []

  // 3. Build snapshots
  const gradesMap = new Map(grades.map((g) => [g.id, g]))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const classesSnapshot = classes.map((c: any) => {
    const gradeIds = c.grade_ids?.length
      ? c.grade_ids
      : c.grade?.id
        ? [c.grade.id]
        : []

    const gradesArray = gradeIds
      .map((gid: string) => {
        const g = gradesMap.get(gid)
        return g ? { id: g.id, name: g.name, display_name: g.display_name } : null
      })
      .filter(Boolean)

    return {
      teacher_id: c.teacher?.id || null,
      teacher_name: c.teacher?.name || null,
      grade_id: c.grade?.id || null,
      grade_ids: gradeIds,
      grades: gradesArray,
      is_elective: c.is_elective || false,
      subject_id: c.subject?.id || null,
      subject_name: c.subject?.name || null,
      days_per_week: c.days_per_week,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      restrictions: (c.restrictions || []).map((r: any) => ({
        restriction_type: r.restriction_type,
        value: r.value,
      })),
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rulesSnapshot = rules.map((r: any) => ({
    rule_key: r.rule_key,
    enabled: r.enabled,
    config: r.config || null,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teachersSnapshot = teachers.map((t: any) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    canSuperviseStudyHall: t.can_supervise_study_hall,
  }))

  const gradesSnapshot = grades.map((g) => ({
    id: g.id,
    name: g.name,
    display_name: g.display_name,
  }))

  // 4. Merge with existing stats
  const existingStats = generation.stats || {}
  const newStats = {
    ...existingStats,
    quarter_name: generation.quarter?.name || null,
    classes_snapshot: classesSnapshot,
    rules_snapshot: rulesSnapshot,
    teachers_snapshot: teachersSnapshot,
    grades_snapshot: gradesSnapshot,
  }

  // 5. Update the generation record
  const { error: updateError } = await supabase
    .from("schedule_generations")
    .update({ stats: newStats })
    .eq("id", generationId)

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update: " + updateError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    message: "Successfully migrated schedule snapshot",
    counts: {
      classes: classesSnapshot.length,
      teachers: teachersSnapshot.length,
      grades: gradesSnapshot.length,
      rules: rulesSnapshot.length,
    },
  })
}
