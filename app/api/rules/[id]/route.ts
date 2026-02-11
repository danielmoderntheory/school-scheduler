import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase-admin"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if (body.enabled !== undefined) updates.enabled = body.enabled
  if (body.priority !== undefined) updates.priority = body.priority
  if (body.config !== undefined) updates.config = body.config

  const { data, error } = await supabase
    .from("rules")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
