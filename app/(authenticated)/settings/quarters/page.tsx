"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Trash2, Loader2, ArrowLeft, RotateCcw, ChevronDown, Archive, Check, Copy, LayoutGrid, AlertTriangle } from "lucide-react"
import Link from "next/link"
import toast from "@/lib/toast"
import type { TimetableTemplate } from "@/lib/types"

interface Quarter {
  id: string
  name: string
  year: number
  quarter_num: number
  is_active: boolean
  timetable_template_id?: string | null
}

interface ArchivedQuarter {
  id: string
  name: string
  deleted_at: string
}

export default function QuartersSettingsPage() {
  const [quarters, setQuarters] = useState<Quarter[]>([])
  const [loading, setLoading] = useState(true)
  const [archivedQuarters, setArchivedQuarters] = useState<ArchivedQuarter[]>([])
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TimetableTemplate[]>([])
  // Pending block-format change awaiting confirmation
  const [pendingFormatChange, setPendingFormatChange] = useState<{
    quarter: Quarter
    templateId: string
  } | null>(null)

  // New quarter form state
  const [isCreating, setIsCreating] = useState(false)
  const [newYear, setNewYear] = useState(new Date().getFullYear())
  const [newQuarterNum, setNewQuarterNum] = useState(1)
  const [copyFromQuarterId, setCopyFromQuarterId] = useState<string>("")
  const [newTemplateId, setNewTemplateId] = useState<string>("") // "" = inherit
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    loadQuarters()
    loadArchivedQuarters()
    loadTemplates()
  }, [])

  useEffect(() => {
    if (quarters.length > 0) {
      // Default to most recent quarter for copying
      if (!copyFromQuarterId) {
        setCopyFromQuarterId(quarters[0].id)
      }
    }
  }, [quarters])

  // Set defaults for next quarter based on active quarter
  function setNextQuarterDefaults() {
    const active = quarters.find((q) => q.is_active)
    if (active) {
      // Calculate next quarter
      if (active.quarter_num >= 4) {
        setNewYear(active.year + 1)
        setNewQuarterNum(1)
      } else {
        setNewYear(active.year)
        setNewQuarterNum(active.quarter_num + 1)
      }
    } else {
      // No active quarter, default to current school year Q1
      const now = new Date()
      // School year starts in fall, so if we're past August, use current year
      const schoolYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
      setNewYear(schoolYear)
      setNewQuarterNum(1)
    }
  }

  async function loadQuarters() {
    try {
      const res = await fetch("/api/quarters")
      if (res.ok) {
        const data = await res.json()
        setQuarters(data)
      }
    } catch (error) {
      toast.error("Failed to load quarters")
    } finally {
      setLoading(false)
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

  async function loadTemplates() {
    try {
      const res = await fetch("/api/timetable-templates")
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) setTemplates(data)
      }
    } catch (error) {
      console.error("Failed to load timetable templates:", error)
    }
  }

  // Resolve a quarter's block format the same way the API does: its assigned
  // template, falling back to the oldest template for pre-format quarters.
  function resolveTemplate(quarter: Quarter | null | undefined): TimetableTemplate | null {
    if (!quarter) return null
    return (
      templates.find((t) => t.id === quarter.timetable_template_id) ??
      templates[0] ??
      null
    )
  }

  async function confirmFormatChange() {
    if (!pendingFormatChange) return
    const { quarter, templateId } = pendingFormatChange
    try {
      const res = await fetch(`/api/quarters/${quarter.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timetable_template_id: templateId }),
      })
      if (res.ok) {
        setQuarters((prev) =>
          prev.map((q) =>
            q.id === quarter.id ? { ...q, timetable_template_id: templateId } : q
          )
        )
        toast.success("Block format updated")
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to update block format")
      }
    } catch (error) {
      toast.error("Failed to update block format")
    } finally {
      setPendingFormatChange(null)
    }
  }

  async function activateQuarter(id: string) {
    setActivatingId(id)
    try {
      const res = await fetch(`/api/quarters/${id}/activate`, { method: "PUT" })
      if (res.ok) {
        setQuarters((prev) =>
          prev.map((q) => ({ ...q, is_active: q.id === id }))
        )
        toast.success("Quarter activated")
      } else {
        toast.error("Failed to activate quarter")
      }
    } catch (error) {
      toast.error("Failed to activate quarter")
    } finally {
      setActivatingId(null)
    }
  }

  async function archiveQuarter(id: string) {
    try {
      const res = await fetch(`/api/quarters/${id}`, { method: "DELETE" })
      if (res.ok) {
        setQuarters((prev) => prev.filter((q) => q.id !== id))
        loadArchivedQuarters()
        toast.success("Quarter archived")
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
        const restored = await res.json()
        setQuarters((prev) => [...prev, restored].sort((a, b) => {
          if (a.year !== b.year) return b.year - a.year
          return b.quarter_num - a.quarter_num
        }))
        setArchivedQuarters((prev) => prev.filter((q) => q.id !== id))
        toast.success("Quarter restored")
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
    setCreating(true)
    try {
      const res = await fetch("/api/quarters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: newYear,
          quarter_num: newQuarterNum,
          copy_from_quarter_id: copyFromQuarterId || undefined,
          // Omitted when "" — the API inherits from the copy source / most recent quarter
          timetable_template_id: newTemplateId || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const classesCopied = data.classes_copied || 0
        const restrictionsCopied = data.restrictions_copied || 0
        if (classesCopied > 0) {
          toast.success(`Quarter created with ${classesCopied} classes and ${restrictionsCopied} restrictions copied`)
        } else {
          toast.success("Quarter created")
        }
        setIsCreating(false)
        loadQuarters()
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="max-w-4xl mx-auto p-8">
        <div className="mb-6">
          <Link
            href="/classes"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Classes
          </Link>
          <h1 className="text-3xl font-bold mb-2">Quarters</h1>
          <p className="text-muted-foreground">
            Manage academic quarters. Each quarter has its own set of classes. The active quarter is used throughout the app.
          </p>
        </div>

        {/* Quarters List */}
        <div className="mb-8">
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[100px]">Year</TableHead>
                  <TableHead className="w-[100px]">Quarter</TableHead>
                  <TableHead className="w-[170px]">Block Format</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quarters.map((quarter) => {
                  // Can archive any quarter except the active one
                  const canArchive = !quarter.is_active
                  const resolvedTemplate = resolveTemplate(quarter)

                  return (
                    <TableRow key={quarter.id}>
                      <TableCell className="font-medium">
                        {quarter.name}
                      </TableCell>
                      <TableCell>{quarter.year}</TableCell>
                      <TableCell>Q{quarter.quarter_num}</TableCell>
                      <TableCell>
                        {templates.length > 1 ? (
                          <select
                            value={resolvedTemplate?.id || ""}
                            onChange={(e) => {
                              const templateId = e.target.value
                              if (templateId && templateId !== resolvedTemplate?.id) {
                                setPendingFormatChange({ quarter, templateId })
                              }
                            }}
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          >
                            {templates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {resolvedTemplate?.name || "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {quarter.is_active ? (
                          <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                            <Check className="h-4 w-4" />
                            Active
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => activateQuarter(quarter.id)}
                            disabled={activatingId === quarter.id}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {activatingId === quarter.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Activate"
                            )}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        {canArchive ? (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Archive quarter?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will archive {quarter.name} and all its classes. It can be restored later
                                  from the archived section.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => archiveQuarter(quarter.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Archive
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 cursor-not-allowed"
                                disabled
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground/50" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Cannot archive active quarter</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}

                {/* Add new quarter row */}
                <TableRow>
                  <TableCell colSpan={6}>
                    {isCreating ? (
                      <div className="space-y-3 py-2">
                        <div className="flex gap-2 items-center">
                          <select
                            value={newYear}
                            onChange={(e) => setNewYear(parseInt(e.target.value))}
                            className="w-28 h-8 rounded-md border border-input bg-background px-2 text-sm"
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
                            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value={1}>Q1 Fall</option>
                            <option value={2}>Q2 Winter</option>
                            <option value={3}>Q3 Spring</option>
                            <option value={4}>Q4 Summer</option>
                          </select>
                        </div>
                        {quarters.length > 0 && (
                          <div className="flex items-center gap-2">
                            <Copy className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Copy classes from:</span>
                            <select
                              value={copyFromQuarterId}
                              onChange={(e) => setCopyFromQuarterId(e.target.value)}
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
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
                        {templates.length > 0 && (() => {
                          // The template the API will use if none is chosen explicitly:
                          // inherited from the copy source, else from the most recent quarter
                          const inheritedTemplate = copyFromQuarterId
                            ? resolveTemplate(quarters.find((q) => q.id === copyFromQuarterId))
                            : resolveTemplate(quarters[0]) ?? templates[0] ?? null
                          const effectiveTemplate = newTemplateId
                            ? templates.find((t) => t.id === newTemplateId) ?? null
                            : inheritedTemplate
                          const sourceQuarter = quarters.find((q) => q.id === copyFromQuarterId)
                          const sourceTemplate = resolveTemplate(sourceQuarter)
                          const crossFormatCopy =
                            !!sourceQuarter &&
                            !!effectiveTemplate &&
                            !!sourceTemplate &&
                            sourceTemplate.id !== effectiveTemplate.id
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Block format:</span>
                                <select
                                  value={newTemplateId}
                                  onChange={(e) => setNewTemplateId(e.target.value)}
                                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                                >
                                  <option value="">
                                    Inherit{inheritedTemplate ? ` (${inheritedTemplate.name})` : ""}
                                  </option>
                                  {templates.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {crossFormatCopy && (
                                <div className="flex items-start gap-2 max-w-xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                  <span>
                                    <span className="font-medium">{sourceQuarter!.name}</span> uses the{" "}
                                    <span className="font-medium">{sourceTemplate!.name}</span> format, but the
                                    new quarter will use <span className="font-medium">{effectiveTemplate!.name}</span>.
                                    Block-based restrictions (fixed slots, block ranges) will be copied with
                                    their old block numbers — review them after creating the quarter.
                                  </span>
                                </div>
                              )}
                            </>
                          )
                        })()}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={createQuarter}
                            disabled={creating}
                          >
                            {creating ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                {copyFromQuarterId ? "Copying..." : "Creating..."}
                              </>
                            ) : (
                              "Create Quarter"
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setNextQuarterDefaults()
                          setNewTemplateId("")
                          setIsCreating(true)
                        }}
                        className="text-muted-foreground"
                      >
                        + Add new quarter
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Block format change confirmation */}
        <AlertDialog
          open={!!pendingFormatChange}
          onOpenChange={(open) => {
            if (!open) setPendingFormatChange(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change block format?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingFormatChange && (
                  <>
                    This switches {pendingFormatChange.quarter.name} to the{" "}
                    <span className="font-medium">
                      {templates.find((t) => t.id === pendingFormatChange.templateId)?.name}
                    </span>{" "}
                    format. New schedule generations will use the new format. Existing
                    saved schedules keep their own block data, but schedule pages and
                    timetables for this quarter will display using the new format — so
                    switching is best done before generating schedules, not after.
                    Block-based restrictions (fixed slots, block ranges) keep their
                    current block numbers and should be reviewed.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmFormatChange}>
                Change Format
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Archived Quarters Section */}
        <Collapsible
          open={archivedOpen}
          onOpenChange={setArchivedOpen}
          className="mt-6"
        >
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <Archive className="h-4 w-4" />
              <span>Archived Quarters ({archivedQuarters.length})</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${archivedOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            {archivedQuarters.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 px-2">No archived quarters</p>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-[200px]">Archived</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archivedQuarters.map((quarter) => (
                      <TableRow key={quarter.id}>
                        <TableCell className="text-muted-foreground">
                          {quarter.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(quarter.deleted_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => restoreQuarter(quarter.id)}
                            disabled={restoringId === quarter.id}
                            className="flex items-center gap-1"
                          >
                            {restoringId === quarter.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                            Restore
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </TooltipProvider>
  )
}
