import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET() {
  const { data, error } = await supabase
    .from("grades")
    .select("*")
    .order("sort_order")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, display_name, sort_order } = body

  if (!name || !display_name) {
    return NextResponse.json(
      { error: "Name and display_name are required" },
      { status: 400 }
    )
  }

  // Get max sort_order if not provided
  let order = sort_order
  if (order === undefined) {
    const { data: maxData } = await supabase
      .from("grades")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
    order = maxData && maxData.length > 0 ? maxData[0].sort_order + 1 : 0
  }

  const { data, error } = await supabase
    .from("grades")
    .insert({
      name: name.toLowerCase().replace(/\s+/g, "-"),
      display_name,
      sort_order: order,
      is_combined: false,
      combined_grades: null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
