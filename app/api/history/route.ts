import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const quarterId = searchParams.get("quarter_id")

  let query = supabase
    .from("schedule_generations")
    .select(`
      id,
      quarter_id,
      generated_at,
      selected_option,
      notes,
      quarter:quarters(id, name)
    `)
    .order("generated_at", { ascending: false })

  if (quarterId) {
    query = query.eq("quarter_id", quarterId)
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
        classes_snapshot: body.classes_snapshot || [],
      },
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
