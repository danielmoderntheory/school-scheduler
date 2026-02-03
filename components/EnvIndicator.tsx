"use client"

import { useState } from "react"



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
    <div className="fixed bottom-0 left-0 z-50 no-print">
      <div
        className={`bg-white/80 border-t border-r ${borderColor} rounded-tr-md overflow-hidden transition-all duration-200 ${expanded ? 'w-36' : 'w-auto'}`}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center hover:bg-muted/50 transition-colors ${expanded ? 'gap-1.5 px-2 py-1 w-full text-left' : 'flex-col gap-0.5 px-1 py-1.5'}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          <span className={`text-[10px] font-medium text-muted-foreground ${expanded ? '' : 'writing-mode-vertical'}`}
            style={expanded ? undefined : { writingMode: 'vertical-lr', textOrientation: 'mixed', letterSpacing: '0.05em' }}
          >{envLabel}</span>
        </button>

        {expanded && (
          <div className="px-2 pb-1.5 space-y-0.5 border-t border-muted">
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
