import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  // Skip auth check if no passwords are configured
  const viewPassword = process.env.APP_VIEW_PASSWORD
  const adminPassword = process.env.APP_ADMIN_PASSWORD
  if (!viewPassword && !adminPassword) {
    return NextResponse.next()
  }

  // Skip auth for login page, no-access page, and auth API
  if (
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/no-access") ||
    request.nextUrl.pathname.startsWith("/api/auth")
  ) {
    return NextResponse.next()
  }

  // Allow unauthenticated access to shared schedule pages (public view mode)
  // Match /history/[uuid] pattern for both page and API
  // Also allow read-only access to grades and timetable templates (needed for timetable view)
  const isHistoryDetailPage = request.nextUrl.pathname.match(/^\/history\/[a-f0-9-]+$/i)
  const isHistoryDetailApi = request.nextUrl.pathname.match(/^\/api\/history\/[a-f0-9-]+$/i)
  const isPublicReadApi = request.nextUrl.pathname === "/api/timetable-templates" || request.nextUrl.pathname === "/api/grades"
  if (isHistoryDetailPage || isHistoryDetailApi || (isPublicReadApi && request.method === "GET")) {
    // Allow access but don't set auth - page will detect public view mode
    return NextResponse.next()
  }

  // Check for auth cookie (accepts "admin" or "readonly")
  const authCookie = request.cookies.get("auth")
  const validAuthValues = ["admin", "readonly"]
  if (!authCookie || !validAuthValues.includes(authCookie.value)) {
    // Redirect to login with return URL
    const loginUrl = new URL("/login", request.url)
    const returnTo = request.nextUrl.pathname + request.nextUrl.search
    if (returnTo && returnTo !== "/") {
      loginUrl.searchParams.set("returnTo", returnTo)
    }
    return NextResponse.redirect(loginUrl)
  }

  // Check if readonly user is trying to access admin-only pages
  const authValue = authCookie.value
  const isReadonly = authValue === "readonly"

  if (isReadonly) {
    // Readonly users can only access /history/[id] pages (specific schedule links)
    const isHistoryDetailPage = request.nextUrl.pathname.match(/^\/history\/[a-f0-9-]+$/i)
    const isApiExport = request.nextUrl.pathname.startsWith("/api/export") // Allow exports

    if (!isHistoryDetailPage && !isApiExport) {
      // Redirect readonly users to no-access page
      return NextResponse.redirect(new URL("/no-access", request.url))
    }
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
