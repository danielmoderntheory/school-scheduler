import { NextRequest, NextResponse } from "next/server"

// Check if user is authenticated
export async function GET(request: NextRequest) {
  const authCookie = request.cookies.get("auth")
  const isAuthenticated = authCookie?.value === "authenticated"
  return NextResponse.json({ isAuthenticated })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { password } = body

  const appPassword = process.env.APP_PASSWORD

  if (!appPassword) {
    // No password configured, allow access
    const response = NextResponse.json({ success: true })
    response.cookies.set("auth", "authenticated", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    return response
  }

  if (password !== appPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 })
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set("auth", "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })

  return response
}

export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete("auth")
  return response
}
