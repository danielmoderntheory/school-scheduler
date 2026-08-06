import { NextRequest, NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"
import { generateXLSX, generateCSV } from "@/lib/export"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const generationId = searchParams.get("generation_id")
  const optionNum = parseInt(searchParams.get("option") || "1")
  const format = searchParams.get("format") || "xlsx"

  if (!generationId) {
    return NextResponse.json({ error: "generation_id is required" }, { status: 400 })
  }

  try {
    // Fetch the generation, its quarter's timetable template, and grades in parallel.
    // The template resolves through the generation's quarter (per-quarter block
    // formats), falling back to the oldest template for pre-format quarters.
    const [generations, templates, grades] = await Promise.all([
      sql`SELECT * FROM schedule_generations WHERE id = ${generationId}`,
      sql`
        SELECT t.* FROM timetable_templates t
        WHERE t.deleted_at IS NULL
          AND t.id = COALESCE(
            (SELECT q.timetable_template_id FROM quarters q
             WHERE q.id = (SELECT g.quarter_id FROM schedule_generations g WHERE g.id = ${generationId})),
            (SELECT t2.id FROM timetable_templates t2
             WHERE t2.deleted_at IS NULL ORDER BY t2.created_at LIMIT 1)
          )
      `,
      sql`SELECT id, name, display_name, sort_order, homeroom_teachers FROM grades ORDER BY sort_order`,
    ])

    const generation = generations[0]

    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 })
    }

    const options = generation.options as Array<unknown>
    if (!options || optionNum < 1 || optionNum > options.length) {
      return NextResponse.json({ error: "Invalid option number" }, { status: 400 })
    }

    const option = options[optionNum - 1] as Parameters<typeof generateXLSX>[0] & { label?: string }
    const shortId = generationId.slice(0, 8)

    // Use letter label (A, B, C) if available, otherwise fall back to number
    const revisionLabel = option.label || String(optionNum)
    const filenameSafeLabel = revisionLabel.toLowerCase()

    const exportMetadata = {
      scheduleId: `Revision ${revisionLabel} - ${shortId}`,
      generatedAt: generation.generated_at,
      timetableTemplate: templates[0] || undefined,
      grades: grades || undefined,
    }

    if (format === "csv") {
      const csv = generateCSV(option, exportMetadata)
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="schedule-${filenameSafeLabel}-${shortId}.csv"`,
        },
      })
    }

    // Default to XLSX
    const xlsx = generateXLSX(option, exportMetadata)
    return new NextResponse(xlsx, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="schedule-${filenameSafeLabel}-${shortId}.xlsx"`,
      },
    })
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
