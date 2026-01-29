"use client"

import { useState } from "react"
import { ChevronRight, ChevronLeft } from "lucide-react"

export function EnvIndicator() {
  const [expanded, setExpanded] = useState(false)

  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV
  const gitBranch = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF
  const gitSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const solverUrl = process.env.NEXT_PUBLIC_SCHEDULER_API_URL

  const isProduction = vercelEnv === "production"
  const isPreview = vercelEnv === "preview"

  // Determine database environment based on Vercel env
  const dbEnv = isProduction ? "prod" : "staging"

  // Extract solver info - show OR-Tools for cloud run
  const solver = solverUrl?.includes("run.app") ? "OR-Tools" : "local"

  const envLabel = isProduction ? "prod" : isPreview ? "preview" : "dev"

  const dotColor = isProduction
    ? "bg-green-500"
    : isPreview
      ? "bg-amber-500"
      : "bg-blue-500"

  const borderColor = isProduction
    ? "border-green-200"
    : isPreview
      ? "border-amber-200"
      : "border-blue-200"

  return (
    <div className="fixed bottom-4 left-4 z-50 no-print">
      <div
        className={`bg-white border ${borderColor} rounded-lg shadow-sm overflow-hidden transition-all duration-200 ${expanded ? 'w-48' : 'w-auto'}`}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/50 transition-colors"
        >
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-xs font-medium text-muted-foreground">{envLabel}</span>
          {expanded ? (
            <ChevronLeft className="h-3 w-3 text-muted-foreground ml-auto" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="px-3 pb-2 space-y-1 border-t border-muted">
            <div className="pt-2 text-[11px] text-muted-foreground space-y-0.5">
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
                <span>database</span>
                <span className="font-mono text-foreground">{dbEnv}</span>
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
