import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase-admin"

export async function GET() {
  const { data, error } = await supabase
    .from("rules")
    .select("*")
    .order("rule_type")
    .order("priority")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
