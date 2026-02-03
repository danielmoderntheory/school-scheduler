import { NextRequest, NextResponse } from "next/server"

// Auth roles: "admin" (full access) or "readonly" (view only)
export type AuthRole = "admin" | "readonly" | null

// Check if user is authenticated and get their role
export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get("auth")
  const value = authCookie?.value

  // Check for valid auth values (admin or readonly only)
  const isAuthenticated = value === "admin" || value === "readonly"
  const role: AuthRole = value === "admin" ? "admin"
    : (value === "readonly" ? "readonly" : null)

  return NextResponse.json({ isAuthenticated, role })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { password } = body

  const readonlyPassword = process.env.APP_VIEW_PASSWORD
  const adminPassword = process.env.APP_ADMIN_PASSWORD

  // If no passwords configured, allow admin access
  if (!readonlyPassword && !adminPassword) {
    const response = NextResponse.json({ success: true, role: "admin" })
    response.cookies.set("auth", "admin", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    return response
  }

  // Check admin password first (if configured)
  if (adminPassword && password === adminPassword) {
    const response = NextResponse.json({ success: true, role: "admin" })
    response.cookies.set("auth", "admin", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    return response
  }

  // Check readonly password (if configured)
  if (readonlyPassword && password === readonlyPassword) {
    const response = NextResponse.json({ success: true, role: "readonly" })
    response.cookies.set("auth", "readonly", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    return response
  }

  return NextResponse.json({ error: "Invalid password" }, { status: 401 })
}

export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete("auth")
  return response
}
