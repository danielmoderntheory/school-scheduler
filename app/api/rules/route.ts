import { NextResponse } from "next/server"
import { sql, formatDbError } from "@/lib/db"

// This route has no request input, so Next.js would otherwise freeze its
// response at build time and rule changes wouldn't show until the next deploy.
export const dynamic = "force-dynamic"

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
