import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  // Skip auth check if no password is configured
  const appPassword = process.env.APP_PASSWORD
  if (!appPassword) {
    return NextResponse.next()
  }

  // Skip auth for login page and auth API
  if (
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/api/auth")
  ) {
    return NextResponse.next()
  }

  // Check for auth cookie
  const authCookie = request.cookies.get("auth")
  if (!authCookie || authCookie.value !== "authenticated") {
    // Redirect to login with return URL
    const loginUrl = new URL("/login", request.url)
    const returnTo = request.nextUrl.pathname + request.nextUrl.search
    if (returnTo && returnTo !== "/") {
      loginUrl.searchParams.set("returnTo", returnTo)
    }
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)",
  ],
}
