import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Deactivate all quarters first
  const { error: deactivateError } = await supabase
    .from("quarters")
    .update({ is_active: false })
    .neq("id", "00000000-0000-0000-0000-000000000000") // Match all rows

  if (deactivateError) {
    return NextResponse.json({ error: deactivateError.message }, { status: 500 })
  }

  // Activate the selected quarter
  const { data, error } = await supabase
    .from("quarters")
    .update({ is_active: true })
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
