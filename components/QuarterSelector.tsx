"use client"

import { useState, useEffect } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ChevronDown, Plus, Check, Copy, Trash2, RotateCcw, Archive } from "lucide-react"
import toast from "@/lib/toast"

interface Quarter {
  id: string
  name: string
  year: number
  quarter_num: number
  is_active: boolean
}

interface ArchivedQuarter {
  id: string
  name: string
  deleted_at: string
}

export function QuarterSelector() {
  const [quarters, setQuarters] = useState<Quarter[]>([])
  const [activeQuarter, setActiveQuarter] = useState<Quarter | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newYear, setNewYear] = useState(new Date().getFullYear())
  const [newQuarterNum, setNewQuarterNum] = useState(1)
  const [copyFromQuarterId, setCopyFromQuarterId] = useState<string>("")
  const [isOpen, setIsOpen] = useState(false)
  const [archivedQuarters, setArchivedQuarters] = useState<ArchivedQuarter[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  useEffect(() => {
    loadQuarters()
    loadArchivedQuarters()
  }, [])

  async function loadQuarters() {
    try {
      const res = await fetch("/api/quarters")
      if (res.ok) {
        const data = await res.json()
        setQuarters(data)
        const active = data.find((q: Quarter) => q.is_active)
        setActiveQuarter(active || null)
        // Default to most recent quarter for copying (first in list, sorted by created_at desc)
        if (data.length > 0) {
          setCopyFromQuarterId(data[0].id)
        }
      }
    } catch (error) {
      console.error("Failed to load quarters:", error)
    }
  }

  async function loadArchivedQuarters() {
    try {
      const res = await fetch("/api/archived?type=quarter")
      if (res.ok) {
        const data = await res.json()
        setArchivedQuarters(data)
      }
    } catch (error) {
      console.error("Failed to load archived quarters:", error)
    }
  }

  async function activateQuarter(id: string) {
    try {
      const res = await fetch(`/api/quarters/${id}/activate`, { method: "PUT" })
      if (res.ok) {
        toast.success("Quarter activated")
        // Redirect to classes page (full reload to ensure fresh data)
        window.location.href = "/classes"
      }
    } catch (error) {
      toast.error("Failed to activate quarter")
    }
    setIsOpen(false)
  }

  async function archiveQuarter(id: string, name: string) {
    if (!confirm(`Archive "${name}"? You can restore it later from the archived section.`)) {
      return
    }

    try {
      const res = await fetch(`/api/quarters/${id}`, { method: "DELETE" })
      if (res.ok) {
        toast.success("Quarter archived")
        loadQuarters()
        loadArchivedQuarters()
        // If we archived the active quarter, reload the page
        if (activeQuarter?.id === id) {
          window.location.href = "/classes"
        }
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to archive quarter")
      }
    } catch (error) {
      toast.error("Failed to archive quarter")
    }
  }

  async function restoreQuarter(id: string) {
    setRestoringId(id)
    try {
      const res = await fetch(`/api/quarters/${id}/restore`, { method: "POST" })
      if (res.ok) {
        toast.success("Quarter restored")
        loadQuarters()
        loadArchivedQuarters()
      } else {
        toast.error("Failed to restore quarter")
      }
    } catch (error) {
      toast.error("Failed to restore quarter")
    } finally {
      setRestoringId(null)
    }
  }

  async function createQuarter() {
    try {
      const res = await fetch("/api/quarters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: newYear,
          quarter_num: newQuarterNum,
          copy_from_quarter_id: copyFromQuarterId || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const classesCopied = data.classes_copied || 0
        if (classesCopied > 0) {
          toast.success(`Quarter created with ${classesCopied} classes copied`)
        } else {
          toast.success("Quarter created")
        }
        setIsCreating(false)
        // Redirect to classes page (full reload to ensure fresh data)
        window.location.href = "/classes"
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to create quarter")
      }
    } catch (error) {
      toast.error("Failed to create quarter")
    }
  }

  return (
    <TooltipProvider>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="min-w-[150px] justify-between">
            {activeQuarter ? activeQuarter.name : "Select Quarter"}
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {quarters.map((quarter) => (
            <div key={quarter.id} className="flex items-center group">
              <DropdownMenuItem
                onClick={() => activateQuarter(quarter.id)}
                className="flex-1 flex items-center justify-between"
              >
                {quarter.name}
                {quarter.is_active && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      archiveQuarter(quarter.id, quarter.name)
                    }}
                    className="p-2 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                    title="Archive quarter"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Archive quarter</p>
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
          {quarters.length > 0 && <DropdownMenuSeparator />}

          {/* Archived Quarters Section */}
          {archivedQuarters.length > 0 && (
            <>
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault()
                  setShowArchived(!showArchived)
                }}
                className="text-muted-foreground"
              >
                <Archive className="mr-2 h-4 w-4" />
                Archived ({archivedQuarters.length})
                <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${showArchived ? "rotate-180" : ""}`} />
              </DropdownMenuItem>
              {showArchived && (
                <div className="bg-muted/50 py-1">
                  {archivedQuarters.map((quarter) => (
                    <div key={quarter.id} className="flex items-center px-2 py-1">
                      <span className="flex-1 text-sm text-muted-foreground truncate">
                        {quarter.name}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          restoreQuarter(quarter.id)
                        }}
                        disabled={restoringId === quarter.id}
                        className="p-1 hover:text-foreground text-muted-foreground transition-colors"
                        title="Restore quarter"
                      >
                        <RotateCcw className={`h-3.5 w-3.5 ${restoringId === quarter.id ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <DropdownMenuSeparator />
            </>
          )}

          {isCreating ? (
            <div className="p-2 space-y-2">
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={newYear}
                  onChange={(e) => setNewYear(parseInt(e.target.value))}
                  className="w-20 h-8"
                  min={2020}
                  max={2100}
                />
                <select
                  value={newQuarterNum}
                  onChange={(e) => setNewQuarterNum(parseInt(e.target.value))}
                  className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value={1}>Q1 Fall</option>
                  <option value={2}>Q2 Winter</option>
                  <option value={3}>Q3 Spring</option>
                  <option value={4}>Q4 Summer</option>
                </select>
              </div>
              {quarters.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Copy className="h-3 w-3" />
                    Copy classes from
                  </label>
                  <select
                    value={copyFromQuarterId}
                    onChange={(e) => setCopyFromQuarterId(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Don&apos;t copy</option>
                    {quarters.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={createQuarter}
                >
                  Create
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsCreating(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault()
                setIsCreating(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Quarter
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
}
