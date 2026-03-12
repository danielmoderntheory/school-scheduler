import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  // Handle grade_ids (new) or grade_id (legacy)
  let gradeId = body.grade_id
  let gradeIds = body.grade_ids

  if (body.grade_ids !== undefined && Array.isArray(body.grade_ids)) {
    gradeIds = body.grade_ids
    gradeId = body.grade_ids.length > 0 ? body.grade_ids[0] : null
  } else if (body.grade_id !== undefined) {
    gradeId = body.grade_id
    gradeIds = body.grade_id ? [body.grade_id] : []
  }

  try {
    const [data] = await sql`
      UPDATE classes
      SET
        teacher_id = COALESCE(${body.teacher_id ?? null}, teacher_id),
        subject_id = COALESCE(${body.subject_id ?? null}, subject_id),
        days_per_week = COALESCE(${body.days_per_week ?? null}, days_per_week),
        is_elective = COALESCE(${body.is_elective ?? null}, is_elective),
        is_cotaught = COALESCE(${body.is_cotaught ?? null}, is_cotaught),
        grade_id = COALESCE(${gradeId ?? null}, grade_id),
        grade_ids = COALESCE(${gradeIds ?? null}, grade_ids)
      WHERE id = ${id}
      RETURNING *
    `

    if (!data) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 })
    }

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

    // Fetch restrictions
    const restrictions = await sql`
      SELECT * FROM restrictions WHERE class_id = ${data.id}
    `

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
      return NextResponse.json(
        { error: "This class assignment already exists" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Soft delete: set deleted_at instead of actually deleting
    await sql`UPDATE classes SET deleted_at = NOW() WHERE id = ${id}`
    return NextResponse.json({ success: true })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
