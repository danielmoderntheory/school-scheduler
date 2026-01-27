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

  // Fetch the generation
  const { data: generation, error } = await supabase
    .from("schedule_generations")
    .select("*")
    .eq("id", generationId)
    .single()

  if (error || !generation) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 })
  }

  const options = generation.options as Array<unknown>
  if (!options || optionNum < 1 || optionNum > options.length) {
    return NextResponse.json({ error: "Invalid option number" }, { status: 400 })
  }

  const option = options[optionNum - 1] as Parameters<typeof generateXLSX>[0]

  if (format === "csv") {
    const csv = generateCSV(option)
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="schedule-option-${optionNum}.csv"`,
      },
    })
  }

  // Default to XLSX
  const xlsx = generateXLSX(option, {
    scheduleId: generationId,
    generatedAt: generation.generated_at,
  })
  return new NextResponse(xlsx, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="schedule-option-${optionNum}.xlsx"`,
    },
  })
}
