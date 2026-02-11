import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase-admin"

export async function GET() {
  const { data, error } = await supabase
    .from("subjects")
    .select("*")
    .is("deleted_at", null)
    .order("name")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  const { data, error } = await supabase
    .from("subjects")
    .insert({ name: body.name })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      // Subject already exists, return existing one
      const { data: existing } = await supabase
        .from("subjects")
        .select("*")
        .eq("name", body.name)
        .single()
      return NextResponse.json(existing)
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
