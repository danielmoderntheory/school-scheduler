import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const { data, error } = await supabase
    .from("grades")
    .update(body)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Check if grade is used in any classes
  const { data: classes } = await supabase
    .from("classes")
    .select("id")
    .eq("grade_id", id)
    .limit(1)

  if (classes && classes.length > 0) {
    return NextResponse.json(
      { error: "Cannot archive grade that is used in classes" },
      { status: 400 }
    )
  }

  // Soft delete: set deleted_at instead of actually deleting
  const { error } = await supabase
    .from("grades")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
