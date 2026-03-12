import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const quarterId = searchParams.get("quarter_id")

  if (!quarterId) {
    return NextResponse.json({ error: "quarter_id is required" }, { status: 400 })
  }

  try {
    const classes = await sql`
      SELECT
        c.id,
        c.deleted_at,
        t.name as teacher_name,
        s.name as subject_name,
        g.display_name as grade_display_name,
        c.grade_ids
      FROM classes c
      LEFT JOIN teachers t ON c.teacher_id = t.id
      LEFT JOIN subjects s ON c.subject_id = s.id
      LEFT JOIN grades g ON c.grade_id = g.id
      WHERE c.quarter_id = ${quarterId}
        AND c.deleted_at IS NOT NULL
      ORDER BY c.deleted_at DESC
      LIMIT 20
    `

    // Fetch grade names for multi-grade classes
    const allGradeIds = new Set<string>()
    classes.forEach((c: { grade_ids?: string[] }) => {
      if (c.grade_ids && Array.isArray(c.grade_ids)) {
        c.grade_ids.forEach((id: string) => allGradeIds.add(id))
      }
    })

    let gradesMap = new Map<string, string>()
    if (allGradeIds.size > 0) {
      const gradesData = await sql`
        SELECT id, display_name
        FROM grades
        WHERE id = ANY(${Array.from(allGradeIds)})
      `
      gradesMap = new Map(gradesData.map((g: { id: string; display_name: string }) => [g.id, g.display_name]))
    }

    // Format the response
    const data = classes.map((c: {
      id: string
      deleted_at: string
      teacher_name: string | null
      subject_name: string | null
      grade_display_name: string | null
      grade_ids: string[] | null
    }) => {
      let gradeDisplay = c.grade_display_name || ""
      if (c.grade_ids && c.grade_ids.length > 1) {
        gradeDisplay = c.grade_ids.map(id => gradesMap.get(id) || "").filter(Boolean).join(", ")
      }
      return {
        id: c.id,
        deleted_at: c.deleted_at,
        description: [c.teacher_name, gradeDisplay, c.subject_name].filter(Boolean).join(" • ") || "Incomplete class"
      }
    })

    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
