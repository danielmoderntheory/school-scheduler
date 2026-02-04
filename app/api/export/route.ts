import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { generateXLSX, generateCSV } from "@/lib/export"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const generationId = searchParams.get("generation_id")
  const optionNum = parseInt(searchParams.get("option") || "1")
  const format = searchParams.get("format") || "xlsx"

  if (!generationId) {
    return NextResponse.json({ error: "generation_id is required" }, { status: 400 })
  }

  // Fetch the generation, timetable template, and grades in parallel
  const [generationResult, templateResult, gradesResult] = await Promise.all([
    supabase
      .from("schedule_generations")
      .select("*")
      .eq("id", generationId)
      .single(),
    supabase
      .from("timetable_templates")
      .select("*")
      .limit(1)
      .single(),
    supabase
      .from("grades")
      .select("id, name, display_name, sort_order, homeroom_teachers")
      .order("sort_order"),
  ])

  const { data: generation, error } = generationResult

  if (error || !generation) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 })
  }

  const options = generation.options as Array<unknown>
  if (!options || optionNum < 1 || optionNum > options.length) {
    return NextResponse.json({ error: "Invalid option number" }, { status: 400 })
  }

  const option = options[optionNum - 1] as Parameters<typeof generateXLSX>[0]
  const shortId = generationId.slice(0, 8)

  const exportMetadata = {
    scheduleId: `Rev ${optionNum} - ${shortId}`,
    generatedAt: generation.generated_at,
    timetableTemplate: templateResult.data || undefined,
    grades: gradesResult.data || undefined,
  }

  if (format === "csv") {
    const csv = generateCSV(option, exportMetadata)
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="schedule-rev-${optionNum}-${shortId}.csv"`,
      },
    })
  }

  // Default to XLSX
  const xlsx = generateXLSX(option, exportMetadata)
  return new NextResponse(xlsx, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-rev-${optionNum}-${shortId}.xlsx"`,
    },
  })
}
