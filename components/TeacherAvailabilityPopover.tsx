"use client"

import { useState, useEffect } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { CalendarClock } from "lucide-react"

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
const BLOCKS = [1, 2, 3, 4, 5]

interface TeacherAvailabilityPopoverProps {
  availableDays: string[] | null
  availableBlocks: number[] | null
  onSave: (days: string[] | null, blocks: number[] | null) => void
}

export function TeacherAvailabilityPopover({
  availableDays,
  availableBlocks,
  onSave,
}: TeacherAvailabilityPopoverProps) {
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState<string[]>(DAYS)
  const [blocks, setBlocks] = useState<number[]>(BLOCKS)

  useEffect(() => {
    setDays(availableDays ?? DAYS)
    setBlocks(availableBlocks ?? BLOCKS)
  }, [availableDays, availableBlocks])

  function toggleDay(day: string) {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  function toggleBlock(block: number) {
    setBlocks((prev) =>
      prev.includes(block) ? prev.filter((b) => b !== block) : [...prev, block]
    )
  }

  function handleSave() {
    // Normalize: full selection → null (no restriction)
    const saveDays = days.length < DAYS.length ? days : null
    const saveBlocks = blocks.length < BLOCKS.length ? blocks : null
    onSave(saveDays, saveBlocks)
    setOpen(false)
  }

  // Count restrictions for badge
  const restrictionCount =
    (availableDays ? 1 : 0) + (availableBlocks ? 1 : 0)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 gap-1">
          <CalendarClock className="h-4 w-4" />
          {restrictionCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {restrictionCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Available Days</Label>
            <div className="flex gap-2 mt-2">
              {DAYS.map((day) => (
                <label
                  key={day}
                  className="flex items-center gap-1 cursor-pointer"
                >
                  <Checkbox
                    checked={days.includes(day)}
                    onCheckedChange={() => toggleDay(day)}
                  />
                  <span className="text-xs">{day.slice(0, 3)}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Available Blocks</Label>
            <div className="flex gap-2 mt-2">
              {BLOCKS.map((block) => (
                <label
                  key={block}
                  className="flex items-center gap-1 cursor-pointer"
                >
                  <Checkbox
                    checked={blocks.includes(block)}
                    onCheckedChange={() => toggleBlock(block)}
                  />
                  <span className="text-xs">{block}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDays(DAYS)
                setBlocks(BLOCKS)
              }}
            >
              Clear
            </Button>
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
