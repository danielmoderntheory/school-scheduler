"use client"

import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { ChevronDown, Plus, Check, Copy, Loader2 } from "lucide-react"
import toast from "@/lib/toast"
import type { Quarter } from "@/lib/hooks/useQuarterSelection"

interface LocalQuarterSelectorProps {
  quarters: Quarter[]
  selectedQuarter: Quarter | null
  onSelectQuarter: (id: string) => void
  onQuarterCreated: () => Promise<unknown>
}

export function LocalQuarterSelector({
  quarters,
  selectedQuarter,
  onSelectQuarter,
  onQuarterCreated,
}: LocalQuarterSelectorProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newYear, setNewYear] = useState(new Date().getFullYear())
  const [newQuarterNum, setNewQuarterNum] = useState(1)
  const [copyFromQuarterId, setCopyFromQuarterId] = useState<string>("")
  const [isOpen, setIsOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  // Set defaults for next quarter based on selected quarter
  function setNextQuarterDefaults() {
    if (selectedQuarter) {
      // Calculate next quarter
      if (selectedQuarter.quarter_num >= 4) {
        setNewYear(selectedQuarter.year + 1)
        setNewQuarterNum(1)
      } else {
        setNewYear(selectedQuarter.year)
        setNewQuarterNum(selectedQuarter.quarter_num + 1)
      }
    } else {
      // No selected quarter, default to current school year Q1
      const now = new Date()
      // School year starts in fall, so if we're past August, use current year
      const schoolYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
      setNewYear(schoolYear)
      setNewQuarterNum(1)
    }
    // Default to most recent quarter for copying (first in list, sorted by created_at desc)
    if (quarters.length > 0) {
      setCopyFromQuarterId(quarters[0].id)
    }
  }

  function handleSelectQuarter(id: string) {
    onSelectQuarter(id)
    setIsOpen(false)
  }

  async function createQuarter() {
    setCreating(true)
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
        const restrictionsCopied = data.restrictions_copied || 0
        if (classesCopied > 0) {
          toast.success(
            `Quarter created with ${classesCopied} classes and ${restrictionsCopied} restrictions copied`
          )
        } else {
          toast.success("Quarter created")
        }
        setIsCreating(false)
        setIsOpen(false)

        // Refetch quarters and then select the new one
        await onQuarterCreated()

        // Select the newly created quarter after refetch completes
        if (data.id) {
          onSelectQuarter(data.id)
        }
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to create quarter")
      }
    } catch (error) {
      toast.error("Failed to create quarter")
    } finally {
      setCreating(false)
    }
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 min-w-[130px] justify-between">
          {selectedQuarter ? selectedQuarter.name : "Select Quarter"}
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {quarters.map((quarter) => (
          <DropdownMenuItem
            key={quarter.id}
            onClick={() => handleSelectQuarter(quarter.id)}
            className="flex items-center justify-between gap-3"
          >
            {quarter.name}
            {selectedQuarter?.id === quarter.id && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        {quarters.length > 0 && <DropdownMenuSeparator />}

        {isCreating ? (
          <div className="p-2 space-y-2">
            <div className="flex gap-2">
              <select
                value={newYear}
                onChange={(e) => setNewYear(parseInt(e.target.value))}
                className="w-24 h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {Array.from({ length: 10 }, (_, i) => {
                  const year = new Date().getFullYear() - 2 + i
                  return (
                    <option key={year} value={year}>
                      {year}-{String(year + 1).slice(-2)}
                    </option>
                  )
                })}
              </select>
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
                disabled={creating}
              >
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    {copyFromQuarterId ? "Copying..." : "Creating..."}
                  </>
                ) : (
                  "Create"
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsCreating(false)}
                disabled={creating}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault()
              setNextQuarterDefaults()
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
