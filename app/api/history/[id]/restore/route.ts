import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"
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

  try {
    // Get the generation with quarter info
    const generations = await sql`
      SELECT sg.*, q.id as quarter_id_ref, q.name as quarter_name, q.year as quarter_year, q.quarter_num
      FROM schedule_generations sg
      LEFT JOIN quarters q ON sg.quarter_id = q.id
      WHERE sg.id = ${id}
    `

    const generation = generations[0]

    if (!generation) {
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
      const quarterName = new_quarter_name || `${generation.quarter_name} (restored)`

      // Parse year and quarter from original
      const year = generation.quarter_year || new Date().getFullYear()
      const quarterNum = generation.quarter_num || 1

      // Find a unique quarter number for this year
      const existingQuarters = await sql`
        SELECT quarter_num FROM quarters WHERE year = ${year}
      `

      const usedQuarters = existingQuarters.map((q: { quarter_num: number }) => q.quarter_num)
      let newQuarterNum = quarterNum
      while (usedQuarters.includes(newQuarterNum) && newQuarterNum <= 4) {
        newQuarterNum++
      }
      if (newQuarterNum > 4) {
        newQuarterNum = 1
      }

      // Inherit the source quarter's block format so restored 9-block
      // generations don't land in a quarter that resolves to the 5-block fallback
      const [sourceQuarter] = await sql`
        SELECT timetable_template_id FROM quarters WHERE id = ${generation.quarter_id}
      `

      const [newQuarter] = await sql`
        INSERT INTO quarters (name, year, quarter_num, is_active, timetable_template_id)
        VALUES (${quarterName}, ${year}, ${newQuarterNum <= 4 ? newQuarterNum : 1}, false, ${sourceQuarter?.timetable_template_id ?? null})
        RETURNING *
      `

      targetQuarterId = newQuarter.id
    } else {
      // Overwrite current quarter
      targetQuarterId = generation.quarter_id

      // Delete existing classes for this quarter
      await sql`DELETE FROM classes WHERE quarter_id = ${targetQuarterId}`
    }

    // Ensure all teachers exist
    const teacherIds = new Map<string, string>()
    for (const cls of classesSnapshot) {
      if (!teacherIds.has(cls.teacher_name)) {
        // Check if teacher exists
        const existingTeachers = await sql`
          SELECT id FROM teachers WHERE name = ${cls.teacher_name}
        `

        if (existingTeachers.length > 0) {
          teacherIds.set(cls.teacher_name, existingTeachers[0].id)
        } else {
          // Create teacher
          const [newTeacher] = await sql`
            INSERT INTO teachers (name, status)
            VALUES (${cls.teacher_name}, ${TEACHER_STATUS_FULL_TIME})
            RETURNING id
          `
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
        const existingSubjects = await sql`
          SELECT id FROM subjects WHERE name = ${cls.subject_name}
        `

        if (existingSubjects.length > 0) {
          subjectIds.set(cls.subject_name, existingSubjects[0].id)
        } else {
          const [newSubject] = await sql`
            INSERT INTO subjects (name)
            VALUES (${cls.subject_name})
            RETURNING id
          `
          if (newSubject) {
            subjectIds.set(cls.subject_name, newSubject.id)
          }
        }
      }
    }

    // Get all grades (they should already exist)
    const grades = await sql`SELECT id, name FROM grades`
    const gradeIds = new Map(grades.map((g: { id: string; name: string }) => [g.name, g.id]))

    // Insert classes and collect their IDs
    const insertedClasses: Array<{ id: string }> = []
    for (const cls of classesSnapshot) {
      const [inserted] = await sql`
        INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week)
        VALUES (
          ${targetQuarterId},
          ${teacherIds.get(cls.teacher_name) || null},
          ${gradeIds.get(cls.grade_name) || cls.grade_id || null},
          ${subjectIds.get(cls.subject_name) || null},
          ${cls.days_per_week}
        )
        RETURNING id
      `
      insertedClasses.push(inserted)
    }

    // Insert restrictions
    for (let i = 0; i < classesSnapshot.length; i++) {
      const cls = classesSnapshot[i]
      const insertedClass = insertedClasses[i]

      if (cls.restrictions && cls.restrictions.length > 0 && insertedClass) {
        for (const r of cls.restrictions) {
          await sql`
            INSERT INTO restrictions (class_id, restriction_type, value)
            VALUES (${insertedClass.id}, ${r.restriction_type}, ${JSON.stringify(r.value)})
          `
        }
      }
    }

    // If new quarter, activate it
    if (mode === "new_quarter") {
      // Deactivate all quarters
      await sql`UPDATE quarters SET is_active = false`
      // Activate new quarter
      await sql`UPDATE quarters SET is_active = true WHERE id = ${targetQuarterId}`
    }

    return NextResponse.json({
      success: true,
      quarter_id: targetQuarterId,
      classes_count: insertedClasses.length,
    })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
