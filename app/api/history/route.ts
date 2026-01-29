import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const quarterId = searchParams.get("quarter_id")
  const starredOnly = searchParams.get("starred_only") === "true"
  const limit = searchParams.get("limit")

  let query = supabase
    .from("schedule_generations")
    .select(`
      id,
      quarter_id,
      generated_at,
      selected_option,
      notes,
      is_starred,
      options,
      quarter:quarters(id, name)
    `)
    // Order by starred first, then by date
    .order("is_starred", { ascending: false })
    .order("generated_at", { ascending: false })

  if (quarterId) {
    query = query.eq("quarter_id", quarterId)
  }

  // Optionally filter to starred only
  if (starredOnly) {
    query = query.eq("is_starred", true)
  }

  if (limit) {
    query = query.limit(parseInt(limit))
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  const { data, error } = await supabase
    .from("schedule_generations")
    .insert({
      quarter_id: body.quarter_id,
      options: body.options,
      selected_option: body.selected_option || 1,
      notes: body.notes || null,
      stats: {
        backToBackIssues: body.options[0]?.backToBackIssues || 0,
        studyHallsPlaced: body.options[0]?.studyHallsPlaced || 0,
        quarter_name: body.quarter_name || null,
        classes_snapshot: body.classes_snapshot || [],
        rules_snapshot: body.rules_snapshot || [],
        teachers_snapshot: body.teachers_snapshot || [],
        grades_snapshot: body.grades_snapshot || [],
        allSolutions: body.allSolutions || [], // Store all solutions for alternative browsing
      },
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
