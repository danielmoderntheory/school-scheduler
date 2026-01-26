"use client"

import { useState, useEffect } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Settings2 } from "lucide-react"

const DAYS = ["Mon", "Tues", "Wed", "Thurs", "Fri"]
const BLOCKS = [1, 2, 3, 4, 5]

interface Restriction {
  id?: string
  restriction_type: "fixed_slot" | "available_days" | "available_blocks"
  value: unknown
}

interface RestrictionPopoverProps {
  restrictions: Restriction[]
  onSave: (restrictions: Restriction[]) => void
}

export function RestrictionPopover({ restrictions, onSave }: RestrictionPopoverProps) {
  const [open, setOpen] = useState(false)
  const [availableDays, setAvailableDays] = useState<string[]>(DAYS)
  const [availableBlocks, setAvailableBlocks] = useState<number[]>(BLOCKS)
  const [fixedSlots, setFixedSlots] = useState<{ day: string; block: number }[]>([])

  useEffect(() => {
    // Parse existing restrictions
    const days = restrictions.find((r) => r.restriction_type === "available_days")
    const blocks = restrictions.find((r) => r.restriction_type === "available_blocks")
    const fixed = restrictions.filter((r) => r.restriction_type === "fixed_slot")

    if (days) setAvailableDays(days.value as string[])
    if (blocks) setAvailableBlocks(blocks.value as number[])
    if (fixed.length > 0) {
      setFixedSlots(fixed.map((f) => f.value as { day: string; block: number }))
    }
  }, [restrictions])

  function handleSave() {
    const newRestrictions: Restriction[] = []

    // Only add restrictions if they differ from defaults
    if (availableDays.length < DAYS.length) {
      newRestrictions.push({
        restriction_type: "available_days",
        value: availableDays,
      })
    }

    if (availableBlocks.length < BLOCKS.length) {
      newRestrictions.push({
        restriction_type: "available_blocks",
        value: availableBlocks,
      })
    }

    fixedSlots.forEach((slot) => {
      newRestrictions.push({
        restriction_type: "fixed_slot",
        value: slot,
      })
    })

    onSave(newRestrictions)
    setOpen(false)
  }

  function toggleDay(day: string) {
    setAvailableDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  function toggleBlock(block: number) {
    setAvailableBlocks((prev) =>
      prev.includes(block) ? prev.filter((b) => b !== block) : [...prev, block]
    )
  }

  function toggleFixedSlot(day: string, block: number) {
    const exists = fixedSlots.some((s) => s.day === day && s.block === block)
    if (exists) {
      setFixedSlots((prev) =>
        prev.filter((s) => !(s.day === day && s.block === block))
      )
    } else {
      setFixedSlots((prev) => [...prev, { day, block }])
    }
  }

  const restrictionCount = restrictions.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 gap-1">
          <Settings2 className="h-4 w-4" />
          {restrictionCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {restrictionCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
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
                    checked={availableDays.includes(day)}
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
                    checked={availableBlocks.includes(block)}
                    onCheckedChange={() => toggleBlock(block)}
                  />
                  <span className="text-xs">{block}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Fixed Slots</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Click cells to pin this class to specific time slots
            </p>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted">
                    <th className="p-1 border-r"></th>
                    {BLOCKS.map((b) => (
                      <th key={b} className="p-1 text-center border-r last:border-r-0">
                        {b}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((day) => (
                    <tr key={day} className="border-t">
                      <td className="p-1 border-r font-medium bg-muted">
                        {day.slice(0, 3)}
                      </td>
                      {BLOCKS.map((block) => {
                        const isFixed = fixedSlots.some(
                          (s) => s.day === day && s.block === block
                        )
                        return (
                          <td
                            key={block}
                            onClick={() => toggleFixedSlot(day, block)}
                            className={`p-1 text-center border-r last:border-r-0 cursor-pointer hover:bg-muted/50 ${
                              isFixed ? "bg-primary text-primary-foreground" : ""
                            }`}
                          >
                            {isFixed && "X"}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAvailableDays(DAYS)
                setAvailableBlocks(BLOCKS)
                setFixedSlots([])
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
