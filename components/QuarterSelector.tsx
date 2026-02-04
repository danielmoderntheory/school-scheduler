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
import { ChevronDown, Plus, Check, Copy, Trash2 } from "lucide-react"
import toast from "@/lib/toast"

interface Quarter {
  id: string
  name: string
  year: number
  quarter_num: number
  is_active: boolean
}

export function QuarterSelector() {
  const [quarters, setQuarters] = useState<Quarter[]>([])
  const [activeQuarter, setActiveQuarter] = useState<Quarter | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newYear, setNewYear] = useState(new Date().getFullYear())
  const [newQuarterNum, setNewQuarterNum] = useState(1)
  const [copyFromQuarterId, setCopyFromQuarterId] = useState<string>("")
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    loadQuarters()
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

  async function deleteQuarter(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) {
      return
    }

    try {
      const res = await fetch(`/api/quarters/${id}`, { method: "DELETE" })
      if (res.ok) {
        toast.success("Quarter deleted")
        loadQuarters()
        // If we deleted the active quarter, reload the page
        if (activeQuarter?.id === id) {
          window.location.href = "/classes"
        }
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to delete quarter")
      }
    } catch (error) {
      toast.error("Failed to delete quarter")
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
            <button
              onClick={(e) => {
                e.stopPropagation()
                deleteQuarter(quarter.id, quarter.name)
              }}
              className="p-2 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              title="Delete quarter"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {quarters.length > 0 && <DropdownMenuSeparator />}
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
  )
}
