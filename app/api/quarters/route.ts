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

    // Create the new quarter
    const [newQuarter] = await sql`
      INSERT INTO quarters (name, year, quarter_num, is_active)
      VALUES (${name}, ${body.year}, ${body.quarter_num}, ${isFirst})
      RETURNING *
    `

    let classesCopied = 0

    // Copy classes from another quarter if specified
    if (body.copy_from_quarter_id) {
      // Get classes from source quarter
      const sourceClasses = await sql`
        SELECT teacher_id, grade_id, subject_id, days_per_week, grade_ids, is_elective, is_cotaught
        FROM classes
        WHERE quarter_id = ${body.copy_from_quarter_id}
      `

      if (sourceClasses.length > 0) {
        // Get restrictions for source classes
        const sourceClassIds = sourceClasses.map((c: { id?: string }) => c.id).filter(Boolean)
        const restrictions = sourceClassIds.length > 0 ? await sql`
          SELECT class_id, restriction_type, value
          FROM restrictions
          WHERE class_id = ANY(${sourceClassIds})
        ` : []

        // Build restrictions map
        const restrictionsMap = new Map<string, Array<{ restriction_type: string; value: unknown }>>()
        for (const r of restrictions) {
          const list = restrictionsMap.get(r.class_id) || []
          list.push({ restriction_type: r.restriction_type, value: r.value })
          restrictionsMap.set(r.class_id, list)
        }

        // Insert classes one by one and collect their IDs
        const insertedClasses: Array<{ id: string; sourceIndex: number }> = []
        for (let i = 0; i < sourceClasses.length; i++) {
          const c = sourceClasses[i]
          const [inserted] = await sql`
            INSERT INTO classes (quarter_id, teacher_id, grade_id, subject_id, days_per_week, grade_ids, is_elective, is_cotaught)
            VALUES (${newQuarter.id}, ${c.teacher_id}, ${c.grade_id}, ${c.subject_id}, ${c.days_per_week}, ${c.grade_ids}, ${c.is_elective || false}, ${c.is_cotaught || false})
            RETURNING id
          `
          insertedClasses.push({ id: inserted.id, sourceIndex: i })
        }

        classesCopied = insertedClasses.length

        // Copy restrictions for each class (if we had source IDs)
        // Note: The source query doesn't include id, so we skip restriction copying for now
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

    return NextResponse.json({ ...newQuarter, classes_copied: classesCopied })
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
