"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { ShieldAlert } from "lucide-react"

export function EnvIndicator() {
  const [expanded, setExpanded] = useState(false)
  const pathname = usePathname()

  // Don't show on public pages (login, not-found, etc.)
  const publicPaths = ["/login", "/not-found", "/error"]
  const isPublicPage = publicPaths.some(p => pathname?.startsWith(p)) || pathname === "/"

  // Also hide if not authenticated (no pathname means we're on a public route)
  if (isPublicPage && !pathname?.includes("/history") && !pathname?.includes("/teachers") && !pathname?.includes("/classes") && !pathname?.includes("/generate") && !pathname?.includes("/rules") && !pathname?.includes("/quarters")) {
    return null
  }

  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV
  const gitBranch = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF
  const gitSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  const solverUrl = process.env.NEXT_PUBLIC_SCHEDULER_API_URL || process.env.NEXT_PUBLIC_SOLVER_URL
  // Optional: explicitly set database environment (e.g., "production", "staging", "local")
  const supabaseEnv = process.env.NEXT_PUBLIC_SUPABASE_ENV

  const isProduction = vercelEnv === "production"
  const isPreview = vercelEnv === "preview"
  const isLocalDev = !vercelEnv || vercelEnv === "development"

  // Determine database environment from explicit env var
  // NEXT_PUBLIC_SUPABASE_ENV should be set to: "production", "preview", or "staging"
  let dbEnv: string
  let isProductionDb = false

  const envLower = supabaseEnv?.toLowerCase()
  if (envLower === "production" || envLower === "prod") {
    dbEnv = "prod"
    isProductionDb = true
  } else if (envLower === "preview") {
    dbEnv = "preview"
    isProductionDb = false
  } else if (envLower === "staging" || envLower === "dev" || envLower === "local") {
    dbEnv = "staging"
    isProductionDb = false
  } else if (isProduction) {
    // Vercel production deployment without explicit env - assume prod db
    dbEnv = "prod"
    isProductionDb = true
  } else {
    // Local dev or Vercel preview without explicit env - assume staging (safe default)
    dbEnv = "staging"
    isProductionDb = false
  }

  // DANGER: Local dev using production database
  const isLocalWithProdDb = isLocalDev && isProductionDb

  // Extract solver info - show OR-Tools for cloud run
  const solver = solverUrl?.includes("run.app") ? "OR-Tools" : "local"

  const envLabel = isProduction ? "prod" : isPreview ? "preview" : "dev"

  // Dot color for non-warning states
  const dotColor = isProduction
    ? "bg-green-500"
    : isPreview
      ? "bg-amber-500"
      : "bg-blue-500"

  const borderColor = isLocalWithProdDb
    ? "border-red-300"
    : isProduction
      ? "border-green-200"
      : isPreview
        ? "border-amber-200"
        : "border-blue-200"

  const bgColor = isLocalWithProdDb
    ? "bg-red-50/90"
    : "bg-white/80"

  return (
    <div className="fixed top-0 left-0 z-50 no-print">
      <div
        className={`${bgColor} border-b border-r ${borderColor} rounded-br-md overflow-hidden transition-all duration-200 ${expanded ? 'w-44' : 'w-auto'}`}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center hover:bg-muted/50 transition-colors ${expanded ? 'gap-1.5 px-2 py-1 w-full text-left' : 'flex-col gap-0.5 px-1 py-1.5'}`}
        >
          {isLocalWithProdDb ? (
            <ShieldAlert className={`w-3.5 h-3.5 text-red-500 ${expanded ? '' : 'my-0.5'}`} />
          ) : (
            <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          )}
          <span
            className={`text-[10px] font-medium ${isLocalWithProdDb ? 'text-red-600' : 'text-muted-foreground'} ${expanded ? '' : 'writing-mode-vertical'}`}
            style={expanded ? undefined : { writingMode: 'vertical-lr', textOrientation: 'mixed', letterSpacing: '0.05em' }}
          >
            {envLabel}
          </span>
        </button>

        {expanded && (
          <div className="px-2 pb-1.5 space-y-0.5 border-t border-muted">
            {isLocalWithProdDb && (
              <div className="pt-1.5 pb-1 text-[10px] text-red-600 font-medium border-b border-red-200 mb-1">
                Local dev using PRODUCTION database
              </div>
            )}
            <div className="pt-1.5 text-[10px] text-muted-foreground space-y-0.5">
              {gitBranch && (
                <div className="flex justify-between">
                  <span>branch</span>
                  <span className="font-medium text-foreground">{gitBranch}</span>
                </div>
              )}
              {gitSha && (
                <div className="flex justify-between">
                  <span>commit</span>
                  <span className="font-mono text-foreground">{gitSha.slice(0, 7)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>db</span>
                <span className={`font-mono ${isLocalWithProdDb ? 'text-red-600 font-semibold' : 'text-foreground'}`}>
                  {dbEnv}
                </span>
              </div>
              <div className="flex justify-between">
                <span>solver</span>
                <span className="font-medium text-foreground">{solver}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
