import { NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

export async function GET() {
  try {
    const data = await sql`
      SELECT * FROM rules
      ORDER BY rule_type, priority
    `
    return NextResponse.json(data)
  } catch (error) {
    const { message } = formatDbError(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
