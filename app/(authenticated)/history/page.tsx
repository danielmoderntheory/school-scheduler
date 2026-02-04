"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { Loader2, Trash2, Download, Star, ChevronRight } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import toast from "@/lib/toast"

interface Generation {
  id: string
  quarter_id: string
  generated_at: string
  selected_option: number | null
  notes: string | null
  is_starred: boolean
  options?: unknown[]
  quarter: { id: string; name: string }
}

export default function HistoryPage() {
  const [generations, setGenerations] = useState<Generation[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    loadGenerations()
  }, [showAll])

  async function loadGenerations() {
    try {
      const res = await fetch("/api/history")
      if (res.ok) {
        const data = await res.json()
        setGenerations(data)
      }
    } catch (error) {
      toast.error("Failed to load history")
    } finally {
      setLoading(false)
    }
  }

  async function deleteGeneration(id: string) {
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" })
      if (res.ok) {
        setGenerations((prev) => prev.filter((g) => g.id !== id))
        toast.success("Schedule deleted")
      } else {
        toast.error("Failed to delete schedule")
      }
    } catch (error) {
      toast.error("Failed to delete schedule")
    }
  }

  async function unstarGeneration(id: string) {
    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_starred: false }),
      })
      if (res.ok) {
        setGenerations((prev) => prev.map((g) => g.id === id ? { ...g, is_starred: false } : g))
        toast.success("Schedule unstarred")
      } else {
        toast.error("Failed to unstar schedule")
      }
    } catch (error) {
      toast.error("Failed to unstar schedule")
    }
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleString()
  }

  function getOptionLabel(gen: Generation) {
    if (!gen.selected_option) return null
    const optionsCount = Array.isArray(gen.options) ? gen.options.length : 1
    if (gen.selected_option === 1 && optionsCount === 1) return "Primary"
    if (gen.selected_option === 1) return "Primary"
    return `Revision ${gen.selected_option}`
  }

  const starredGenerations = generations.filter(g => g.is_starred)
  const nonStarredGenerations = generations.filter(g => !g.is_starred)

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Schedule History</h1>
          <p className="text-muted-foreground">
            View and export previously generated schedules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-all"
            checked={showAll}
            onCheckedChange={(checked) => setShowAll(checked === true)}
          />
          <label
            htmlFor="show-all"
            className="text-sm text-muted-foreground cursor-pointer"
          >
            Show non-starred schedules
          </label>
        </div>
      </div>

      {generations.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No schedules generated yet.</p>
          <Link href="/generate">
            <Button className="mt-4">Generate Schedule</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Starred Schedules Section */}
          {starredGenerations.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
                Starred Schedules
              </h2>
              <div className="space-y-2">
                {starredGenerations.map((gen) => (
                  <div
                    key={gen.id}
                    className="flex items-center gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors"
                  >
                    <Star className="h-5 w-5 text-amber-500 fill-amber-500 flex-shrink-0" />
                    <Link href={`/history/${gen.id}`} className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge variant="outline" className="bg-white">{gen.quarter?.name}</Badge>
                        {getOptionLabel(gen) && (
                          <span className="text-xs font-medium text-amber-700">{getOptionLabel(gen)}</span>
                        )}
                        <span className="text-xs text-amber-600">
                          {formatDate(gen.generated_at)}
                        </span>
                        {gen.notes && (
                          <span className="text-sm text-amber-800 truncate max-w-[300px]" title={gen.notes}>
                            — {gen.notes}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="flex gap-1 flex-shrink-0">
                      <a
                        href={`/api/export?generation_id=${gen.id}&option=${gen.selected_option || 1}&format=xlsx`}
                        download
                      >
                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-amber-200">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-amber-200">
                            <Trash2 className="h-4 w-4 text-amber-600 hover:text-amber-800" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Unstar this schedule?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove the star from this schedule. The schedule will still be accessible.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => unstarGeneration(gen.id)}>
                              Unstar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <Link href={`/history/${gen.id}`}>
                      <ChevronRight className="h-5 w-5 text-amber-400" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Non-starred Schedules Section */}
          {showAll && nonStarredGenerations.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 text-slate-600">
                Recent Schedules
              </h2>
              <div className="space-y-2">
                {nonStarredGenerations.map((gen) => (
                  <div
                    key={gen.id}
                    className="flex items-center gap-3 p-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <Star className="h-5 w-5 text-slate-300 flex-shrink-0" />
                    <Link href={`/history/${gen.id}`} className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge variant="outline">{gen.quarter?.name}</Badge>
                        {getOptionLabel(gen) && (
                          <span className="text-xs font-medium text-slate-500">{getOptionLabel(gen)}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDate(gen.generated_at)}
                        </span>
                        <span className="text-xs text-slate-300">{gen.id.slice(0, 8)}</span>
                        {gen.notes && (
                          <span className="text-sm text-slate-500 truncate max-w-[300px]" title={gen.notes}>
                            — {gen.notes}
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="flex gap-1 flex-shrink-0">
                      <a
                        href={`/api/export?generation_id=${gen.id}&option=${gen.selected_option || 1}&format=xlsx`}
                        download
                      >
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete this generated schedule.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteGeneration(gen.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <Link href={`/history/${gen.id}`}>
                      <ChevronRight className="h-5 w-5 text-slate-400" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty states */}
          {starredGenerations.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
              <Star className="h-8 w-8 mx-auto mb-2 text-slate-300" />
              <p>No starred schedules yet.</p>
              <p className="text-sm mt-1">Star a schedule to keep it easily accessible.</p>
            </div>
          )}

          {showAll && nonStarredGenerations.length === 0 && starredGenerations.length > 0 && (
            <div className="text-center py-6 text-muted-foreground">
              <p className="text-sm">All schedules are starred!</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
