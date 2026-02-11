import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase-admin"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params

  const { data, error } = await supabase
    .from("restrictions")
    .select("*")
    .eq("class_id", classId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params
  const body = await request.json()

  // Delete existing restrictions
  await supabase.from("restrictions").delete().eq("class_id", classId)

  // Insert new restrictions
  const restrictions = body.restrictions || []

  if (restrictions.length > 0) {
    const { error } = await supabase.from("restrictions").insert(
      restrictions.map((r: { restriction_type: string; value: unknown }) => ({
        class_id: classId,
        restriction_type: r.restriction_type,
        value: r.value,
      }))
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // Touch the parent class to update its updated_at (trigger sets the actual value)
  await supabase.from("classes").update({ updated_at: new Date().toISOString() }).eq("id", classId)

  // Return updated restrictions
  const { data, error } = await supabase
    .from("restrictions")
    .select("*")
    .eq("class_id", classId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
