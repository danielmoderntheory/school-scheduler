import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

interface ClassRow {
  id: string
  quarter_id: string
  teacher_id: string | null
  grade_id: string | null
  subject_id: string | null
  days_per_week: number
  is_elective: boolean
  is_cotaught: boolean
  grade_ids: string[] | null
  created_at: string
  updated_at: string
  teacher_name: string | null
  teacher_status: string | null
  grade_name: string | null
  grade_display_name: string | null
  subject_name: string | null
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const quarterId = searchParams.get("quarter_id")

  try {
    // Fetch classes with teacher, grade, and subject info via JOINs
    const classes = quarterId
      ? await sql`
          SELECT
            c.*,
            t.name as teacher_name,
            t.status as teacher_status,
            g.name as grade_name,
            g.display_name as grade_display_name,
            s.name as subject_name
          FROM classes c
          LEFT JOIN teachers t ON c.teacher_id = t.id
          LEFT JOIN grades g ON c.grade_id = g.id
          LEFT JOIN subjects s ON c.subject_id = s.id
          WHERE c.quarter_id = ${quarterId}
          ORDER BY c.created_at
        `
      : await sql`
          SELECT
            c.*,
            t.name as teacher_name,
            t.status as teacher_status,
            g.name as grade_name,
            g.display_name as grade_display_name,
            s.name as subject_name
          FROM classes c
          LEFT JOIN teachers t ON c.teacher_id = t.id
          LEFT JOIN grades g ON c.grade_id = g.id
          LEFT JOIN subjects s ON c.subject_id = s.id
          ORDER BY c.created_at
        `

    // Get all class IDs for restrictions query
    const classIds = classes.map((c: ClassRow) => c.id)

    // Fetch restrictions for all classes
    const restrictions = classIds.length > 0
      ? await sql`
          SELECT * FROM restrictions
          WHERE class_id = ANY(${classIds})
        `
      : []

    // Build restrictions map
    const restrictionsMap = new Map<string, unknown[]>()
    for (const r of restrictions) {
      const list = restrictionsMap.get(r.class_id) || []
      list.push(r)
      restrictionsMap.set(r.class_id, list)
    }

    // Collect all unique grade_ids for multi-grade lookup
    const allGradeIds = new Set<string>()
    classes.forEach((cls: ClassRow) => {
      if (cls.grade_ids && Array.isArray(cls.grade_ids)) {
        cls.grade_ids.forEach((id: string) => allGradeIds.add(id))
      }
    })

    // Fetch all grades if needed
    let gradesMap = new Map<string, { id: string; name: string; display_name: string; sort_order: number }>()
    if (allGradeIds.size > 0) {
      const gradesData = await sql`
        SELECT id, name, display_name, sort_order
        FROM grades
        WHERE id = ANY(${Array.from(allGradeIds)})
      `
      gradesMap = new Map(gradesData.map((g: { id: string; name: string; display_name: string; sort_order: number }) => [g.id, g]))
    }

    // Transform to match expected format
    const data = classes.map((c: ClassRow) => ({
      id: c.id,
      quarter_id: c.quarter_id,
      teacher_id: c.teacher_id,
      grade_id: c.grade_id,
      subject_id: c.subject_id,
      days_per_week: c.days_per_week,
      is_elective: c.is_elective,
      is_cotaught: c.is_cotaught,
      grade_ids: c.grade_ids,
      created_at: c.created_at,
      updated_at: c.updated_at,
      teacher: c.teacher_id ? { id: c.teacher_id, name: c.teacher_name, status: c.teacher_status } : null,
      grade: c.grade_id ? { id: c.grade_id, name: c.grade_name, display_name: c.grade_display_name } : null,
      subject: c.subject_id ? { id: c.subject_id, name: c.subject_name } : null,
      restrictions: restrictionsMap.get(c.id) || [],
      grades: c.grade_ids
        ? c.grade_ids
            .map((id: string) => gradesMap.get(id))
            .filter(Boolean)
            .sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0))
        : [],
    }))

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Support both grade_id (single, legacy) and grade_ids (array, new)
  let gradeId: string | null = null
  let gradeIds: string[] | null = null

  if (body.grade_ids && Array.isArray(body.grade_ids) && body.grade_ids.length > 0) {
    gradeIds = body.grade_ids
    gradeId = body.grade_ids[0]
  } else if (body.grade_id) {
    gradeId = body.grade_id
    gradeIds = [body.grade_id]
  }

  try {
    const [data] = await sql`
      INSERT INTO classes (
        quarter_id, teacher_id, grade_id, subject_id,
        days_per_week, grade_ids, is_elective, is_cotaught
      )
      VALUES (
        ${body.quarter_id},
        ${body.teacher_id || null},
        ${gradeId},
        ${body.subject_id || null},
        ${body.days_per_week || 1},
        ${gradeIds},
        ${body.is_elective || false},
        ${body.is_cotaught || false}
      )
      RETURNING *
    `

    // Fetch related data
    let teacher = null
    let grade = null
    let subject = null

    if (data.teacher_id) {
      const [t] = await sql`SELECT id, name, status FROM teachers WHERE id = ${data.teacher_id}`
      teacher = t
    }
    if (data.grade_id) {
      const [g] = await sql`SELECT id, name, display_name FROM grades WHERE id = ${data.grade_id}`
      grade = g
    }
    if (data.subject_id) {
      const [s] = await sql`SELECT id, name FROM subjects WHERE id = ${data.subject_id}`
      subject = s
    }

    // Create restrictions if provided
    let restrictions: unknown[] = []
    if (body.restrictions && Array.isArray(body.restrictions) && body.restrictions.length > 0) {
      for (const r of body.restrictions) {
        const [inserted] = await sql`
          INSERT INTO restrictions (class_id, restriction_type, value)
          VALUES (${data.id}, ${r.restriction_type}, ${JSON.stringify(r.value)})
          RETURNING *
        `
        restrictions.push(inserted)
      }
    }

    // Fetch grades for the grade_ids
    let grades: unknown[] = []
    if (data.grade_ids && data.grade_ids.length > 0) {
      grades = await sql`
        SELECT id, name, display_name, sort_order
        FROM grades
        WHERE id = ANY(${data.grade_ids})
        ORDER BY sort_order
      `
    }

    return NextResponse.json({
      ...data,
      teacher,
      grade,
      subject,
      restrictions,
      grades,
    })
  } catch (error) {
    const { message, code } = formatDbError(error)
    if (code === "23505") {
      // Look up the conflicting class to provide better error message
      try {
        const [existing] = await sql`
          SELECT c.*, t.name as teacher_name, g.display_name as grade_display, s.name as subject_name
          FROM classes c
          LEFT JOIN teachers t ON c.teacher_id = t.id
          LEFT JOIN grades g ON c.grade_id = g.id
          LEFT JOIN subjects s ON c.subject_id = s.id
          WHERE c.quarter_id = ${body.quarter_id}
            AND c.teacher_id = ${body.teacher_id || null}
            AND c.grade_id = ${gradeId}
            AND c.subject_id = ${body.subject_id || null}
        `
        if (existing) {
          const details = [
            existing.teacher_name || 'No teacher',
            existing.grade_display || 'No grade',
            existing.subject_name || 'No subject'
          ].join(' + ')
          return NextResponse.json(
            { error: `Class already exists: ${details}` },
            { status: 400 }
          )
        }
      } catch {
        // Fall back to generic message if lookup fails
      }
      return NextResponse.json(
        { error: "This class assignment already exists" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
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

  try {
    await sql`
      DELETE FROM classes
      WHERE quarter_id = ${quarterId}
    `
    return NextResponse.json({ success: true })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
