import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

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
  const { searchParams } = request.nextUrl
  const force = searchParams.get("force") === "true"

  try {
    // 1. Fetch the generation to get its quarter_id
    const generations = await sql`
      SELECT sg.*, q.id as quarter_id_ref, q.name as quarter_name
      FROM schedule_generations sg
      LEFT JOIN quarters q ON sg.quarter_id = q.id
      WHERE sg.id = ${generationId}
    `

    const generation = generations[0]

    if (!generation) {
      return NextResponse.json(
        { error: "Generation not found" },
        { status: 404 }
      )
    }

    // Check if already fully migrated (has all 4 snapshots)
    const stats = generation.stats || {}
    const hasAllSnapshots =
      stats.classes_snapshot?.length > 0 &&
      stats.teachers_snapshot?.length > 0 &&
      stats.grades_snapshot?.length > 0 &&
      stats.rules_snapshot?.length > 0

    if (hasAllSnapshots && !force) {
      return NextResponse.json({
        message: "Already migrated",
        stats_keys: Object.keys(stats),
      })
    }

    const quarterId = generation.quarter_id

    // 2. Fetch all required data for snapshots
    const [classes, teachers, grades, rules] = await Promise.all([
      sql`
        SELECT
          c.id, c.days_per_week, c.is_elective, c.grade_ids,
          t.id as teacher_id, t.name as teacher_name,
          g.id as grade_id, g.name as grade_name, g.display_name as grade_display_name,
          s.id as subject_id, s.name as subject_name
        FROM classes c
        LEFT JOIN teachers t ON c.teacher_id = t.id
        LEFT JOIN grades g ON c.grade_id = g.id
        LEFT JOIN subjects s ON c.subject_id = s.id
        WHERE c.quarter_id = ${quarterId}
      `,
      sql`
        SELECT id, name, status, can_supervise_study_hall
        FROM teachers
        ORDER BY name
      `,
      sql`
        SELECT id, name, display_name, sort_order
        FROM grades
        ORDER BY sort_order
      `,
      sql`
        SELECT id, rule_key, enabled, config
        FROM rules
      `,
    ])

    // Fetch restrictions for all classes
    const classIds = classes.map((c: { id: string }) => c.id)
    const restrictions = classIds.length > 0
      ? await sql`
          SELECT id, class_id, restriction_type, value
          FROM restrictions
          WHERE class_id = ANY(${classIds})
        `
      : []

    // Build restrictions map
    const restrictionsMap = new Map<string, Array<{ restriction_type: string; value: unknown }>>()
    for (const r of restrictions) {
      const list = restrictionsMap.get(r.class_id) || []
      list.push({ restriction_type: r.restriction_type, value: r.value })
      restrictionsMap.set(r.class_id, list)
    }

    // 3. Build snapshots
    const gradesMap = new Map(grades.map((g: { id: string; name: string; display_name: string }) => [g.id, g]))

    const classesSnapshot = classes.map((c: {
      id: string
      days_per_week: number
      is_elective: boolean
      grade_ids: string[] | null
      teacher_id: string | null
      teacher_name: string | null
      grade_id: string | null
      grade_name: string | null
      grade_display_name: string | null
      subject_id: string | null
      subject_name: string | null
    }) => {
      const gradeIds = c.grade_ids?.length
        ? c.grade_ids
        : c.grade_id
          ? [c.grade_id]
          : []

      const gradesArray = gradeIds
        .map((gid: string) => {
          const g = gradesMap.get(gid)
          return g ? { id: g.id, name: g.name, display_name: g.display_name } : null
        })
        .filter(Boolean)

      return {
        teacher_id: c.teacher_id || null,
        teacher_name: c.teacher_name || null,
        grade_id: c.grade_id || null,
        grade_ids: gradeIds,
        grades: gradesArray,
        is_elective: c.is_elective || false,
        subject_id: c.subject_id || null,
        subject_name: c.subject_name || null,
        days_per_week: c.days_per_week,
        restrictions: restrictionsMap.get(c.id) || [],
      }
    })

    const rulesSnapshot = rules.map((r: { rule_key: string; enabled: boolean; config: unknown }) => ({
      rule_key: r.rule_key,
      enabled: r.enabled,
      config: r.config || null,
    }))

    const teachersSnapshot = teachers.map((t: { id: string; name: string; status: string; can_supervise_study_hall: boolean }) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      canSuperviseStudyHall: t.can_supervise_study_hall,
    }))

    const gradesSnapshot = grades.map((g: { id: string; name: string; display_name: string }) => ({
      id: g.id,
      name: g.name,
      display_name: g.display_name,
    }))

    // 4. Merge with existing stats
    const existingStats = generation.stats || {}
    const newStats = {
      ...existingStats,
      quarter_name: generation.quarter_name || null,
      classes_snapshot: classesSnapshot,
      rules_snapshot: rulesSnapshot,
      teachers_snapshot: teachersSnapshot,
      grades_snapshot: gradesSnapshot,
    }

    // 5. Update the generation record
    await sql`
      UPDATE schedule_generations
      SET stats = ${JSON.stringify(newStats)}
      WHERE id = ${generationId}
    `

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
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
