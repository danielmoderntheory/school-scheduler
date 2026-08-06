import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"
import { formatQuarterName } from "@/lib/types"

export async function GET() {
  try {
    const data = await sql`
      SELECT * FROM quarters
      WHERE deleted_at IS NULL
      ORDER BY year DESC, quarter_num DESC
    `
    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  try {
    // Check if any quarters exist
    const existing = await sql`
      SELECT id FROM quarters
      LIMIT 1
    `

    const isFirst = existing.length === 0
    const name = formatQuarterName(body.quarter_num, body.year)

    // Resolve the block format (timetable template) for the new quarter:
    // explicit choice -> inherited from the copy-source quarter -> carried over
    // from the most recently created quarter. Falls back to NULL (oldest template).
    let templateId: string | null = body.timetable_template_id ?? null
    if (!templateId) {
      const inheritFrom = body.copy_from_quarter_id
        ? sql`SELECT timetable_template_id FROM quarters
              WHERE id = ${body.copy_from_quarter_id}`
        : sql`SELECT timetable_template_id FROM quarters
              WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`
      const [source] = await inheritFrom
      templateId = source?.timetable_template_id ?? null
    }

    // Create the new quarter
    const [newQuarter] = await sql`
      INSERT INTO quarters (name, year, quarter_num, is_active, timetable_template_id)
      VALUES (${name}, ${body.year}, ${body.quarter_num}, ${isFirst}, ${templateId})
      RETURNING *
    `

    let classesCopied = 0
    let restrictionsCopied = 0

    // Copy classes from another quarter if specified
    if (body.copy_from_quarter_id) {
      // Get classes from source quarter (include id for restriction mapping)
      // Filter out soft-deleted classes
      const sourceClasses = await sql`
        SELECT id, teacher_id, grade_id, subject_id, days_per_week, grade_ids, is_elective, is_cotaught
        FROM classes
        WHERE quarter_id = ${body.copy_from_quarter_id} AND deleted_at IS NULL
      `

      if (sourceClasses.length > 0) {
        // Get restrictions for source classes
        const sourceClassIds = sourceClasses.map((c: { id: string }) => c.id)
        const restrictions = await sql`
          SELECT class_id, restriction_type, value
          FROM restrictions
          WHERE class_id = ANY(${sourceClassIds})
        `

        // Build restrictions map by source class id
        const restrictionsMap = new Map<string, Array<{ restriction_type: string; value: unknown }>>()
        for (const r of restrictions) {
          const list = restrictionsMap.get(r.class_id) || []
          list.push({ restriction_type: r.restriction_type, value: r.value })
          restrictionsMap.set(r.class_id, list)
        }

        // Insert all classes in a batch using unnest for better performance
        const teacherIds = sourceClasses.map((c: { teacher_id: string }) => c.teacher_id)
        const gradeIds = sourceClasses.map((c: { grade_id: string }) => c.grade_id)
        const subjectIds = sourceClasses.map((c: { subject_id: string }) => c.subject_id)
        const daysPerWeek = sourceClasses.map((c: { days_per_week: number }) => c.days_per_week)
        // Encode uuid[] arrays as text for unnest (PostgreSQL can't unnest 2D arrays properly)
        const gradeIdsTexts = sourceClasses.map((c: { grade_ids: string[] | null }) =>
          c.grade_ids ? `{${c.grade_ids.join(',')}}` : null
        )
        const isElectives = sourceClasses.map((c: { is_elective: boolean }) => c.is_elective || false)
        const isCotaughts = sourceClasses.map((c: { is_cotaught: boolean }) => c.is_cotaught || false)

        const insertedClasses = await sql`
          INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week, grade_ids, is_elective, is_cotaught)
          SELECT
            ${newQuarter.id},
            unnest(${teacherIds}::uuid[]),
            unnest(${gradeIds}::uuid[]),
            unnest(${subjectIds}::uuid[]),
            unnest(${daysPerWeek}::int[]),
            unnest(${gradeIdsTexts}::text[])::uuid[],
            unnest(${isElectives}::boolean[]),
            unnest(${isCotaughts}::boolean[])
          RETURNING id
        `

        classesCopied = insertedClasses.length

        // Build mapping from source class index to new class id
        // (insertedClasses are returned in the same order as the unnest arrays)
        const classIdMapping = new Map<string, string>()
        for (let i = 0; i < sourceClasses.length; i++) {
          classIdMapping.set(sourceClasses[i].id, insertedClasses[i].id)
        }

        // Copy restrictions for each class using batch insert
        const restrictionInserts: Array<{ class_id: string; restriction_type: string; value: string }> = []
        for (const [sourceClassId, classRestrictions] of restrictionsMap) {
          const newClassId = classIdMapping.get(sourceClassId)
          if (newClassId) {
            for (const r of classRestrictions) {
              restrictionInserts.push({
                class_id: newClassId,
                restriction_type: r.restriction_type,
                value: JSON.stringify(r.value),
              })
            }
          }
        }

        if (restrictionInserts.length > 0) {
          const rClassIds = restrictionInserts.map(r => r.class_id)
          const rTypes = restrictionInserts.map(r => r.restriction_type)
          const rValues = restrictionInserts.map(r => r.value)

          await sql`
            INSERT INTO restrictions (class_id, restriction_type, value)
            SELECT
              unnest(${rClassIds}::uuid[]),
              unnest(${rTypes}::text[]),
              unnest(${rValues}::jsonb[])
          `
          restrictionsCopied = restrictionInserts.length
        }
      }
    }

    // Activate the new quarter if not first
    if (!isFirst) {
      // Deactivate all other quarters
      await sql`
        UPDATE quarters
        SET is_active = false
        WHERE id != ${newQuarter.id}
      `

      // Activate the new one
      await sql`
        UPDATE quarters
        SET is_active = true
        WHERE id = ${newQuarter.id}
      `
    }

    return NextResponse.json({ ...newQuarter, classes_copied: classesCopied, restrictions_copied: restrictionsCopied })
  } catch (error) {
    const { message, code } = formatDbError(error)
    if (code === "23505") {
      return NextResponse.json(
        { error: "This quarter already exists" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
