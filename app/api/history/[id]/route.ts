import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase-admin"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data, error } = await supabase
    .from("schedule_generations")
    .select(`
      *,
      quarter:quarters(id, name)
    `)
    .eq("id", id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if (body.selected_option !== undefined) updates.selected_option = body.selected_option
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.is_starred !== undefined) updates.is_starred = body.is_starred
  if (body.options !== undefined) updates.options = body.options
  if (body.stats !== undefined) updates.stats = body.stats

  const { data, error } = await supabase
    .from("schedule_generations")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { error } = await supabase.from("schedule_generations").delete().eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
