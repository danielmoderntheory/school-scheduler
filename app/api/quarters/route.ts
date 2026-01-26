import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET() {
  const { data, error } = await supabase
    .from("quarters")
    .select("*")
    .order("year", { ascending: false })
    .order("quarter_num", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Check if any quarters exist
  const { data: existing } = await supabase
    .from("quarters")
    .select("id")
    .limit(1)

  const isFirst = !existing || existing.length === 0

  const name = `Q${body.quarter_num} ${body.year}`

  const { data, error } = await supabase
    .from("quarters")
    .insert({
      name,
      year: body.year,
      quarter_num: body.quarter_num,
      is_active: isFirst, // Auto-activate first quarter
    })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This quarter already exists" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
