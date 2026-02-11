import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase-admin"
import { TEACHER_STATUS_FULL_TIME } from "@/lib/schedule-utils"

export async function GET() {
  const { data, error } = await supabase
    .from("teachers")
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
    .from("teachers")
    .insert({
      name: body.name,
      status: body.status || TEACHER_STATUS_FULL_TIME,
      can_supervise_study_hall: body.can_supervise_study_hall || false,
      notes: body.notes || null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A teacher with this name already exists" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
