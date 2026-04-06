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
import { Loader2, Trash2, Download, Star, ChevronRight, ChevronDown, RotateCcw } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import toast from "@/lib/toast"

interface Generation {
  id: string
  quarter_id: string
  generated_at: string
  selected_option: number | null
  notes: string | null
  is_starred: boolean
  deleted_at: string | null
  options?: unknown[]
  quarter: { id: string; name: string }
}

const PAGE_SIZE = 10

export default function HistoryPage() {
  const [generations, setGenerations] = useState<Generation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [showDeleted, setShowDeleted] = useState(false)
  // Separate display limits for starred and recent
  const [starredDisplayCount, setStarredDisplayCount] = useState(PAGE_SIZE)
  const [recentDisplayCount, setRecentDisplayCount] = useState(PAGE_SIZE)

  useEffect(() => {
    loadGenerations()
  }, [showDeleted])

  async function loadGenerations() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        summary: "true",
        limit: String(PAGE_SIZE * 2),
      })
      if (showDeleted) params.set("show_deleted", "true")

      const res = await fetch(`/api/history?${params}`)
      if (res.ok) {
        const data = await res.json()
        setGenerations(data)
        setHasMore(data.length >= PAGE_SIZE * 2)
      }
    } catch (error) {
      toast.error("Failed to load history")
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return

    setLoadingMore(true)
    try {
      const oldestSchedule = generations[generations.length - 1]
      const params = new URLSearchParams({
        summary: "true",
        limit: String(PAGE_SIZE),
        before: oldestSchedule?.generated_at || "",
      })
      if (showDeleted) params.set("show_deleted", "true")

      const res = await fetch(`/api/history?${params}`)
      if (res.ok) {
        const moreData = await res.json()
        if (moreData.length > 0) {
          setGenerations(prev => [...prev, ...moreData])
          // Also increase display counts so newly fetched items are visible
          setRecentDisplayCount(prev => prev + PAGE_SIZE)
          setStarredDisplayCount(prev => prev + PAGE_SIZE)
          setHasMore(moreData.length >= PAGE_SIZE)
        } else {
          setHasMore(false)
        }
      }
    } catch (error) {
      toast.error("Failed to load more")
    } finally {
      setLoadingMore(false)
    }
  }

  async function deleteGeneration(id: string) {
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" })
      if (res.ok) {
        if (showDeleted) {
          // Update the item to show its deleted state
          setGenerations((prev) => prev.map((g) =>
            g.id === id ? { ...g, deleted_at: new Date().toISOString() } : g
          ))
        } else {
          // Remove from list since we're not showing deleted items
          setGenerations((prev) => prev.filter((g) => g.id !== id))
        }
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

  async function undeleteGeneration(id: string) {
    try {
      const res = await fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undelete" }),
      })
      if (res.ok) {
        setGenerations((prev) => prev.map((g) => g.id === id ? { ...g, deleted_at: null } : g))
        toast.success("Schedule restored")
      } else {
        toast.error("Failed to restore schedule")
      }
    } catch (error) {
      toast.error("Failed to restore schedule")
    }
  }

  function getOptionLabel(gen: Generation) {
    if (!gen.selected_option) return null
    const letter = String.fromCharCode(64 + gen.selected_option) // 1→A, 2→B, 3→C
    return `Revision ${letter}`
  }

  // Starred are always non-deleted, recent includes deleted when showDeleted is true
  const starredGenerations = generations.filter(g => g.is_starred && !g.deleted_at)
  const nonStarredGenerations = generations.filter(g => !g.is_starred && !g.deleted_at)
  const deletedGenerations = generations.filter(g => g.deleted_at)
  // Combine non-starred and deleted for the recent list, sorted by generated_at
  const recentGenerations = showDeleted
    ? [...nonStarredGenerations, ...deletedGenerations].sort(
        (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
      )
    : nonStarredGenerations

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
            id="show-deleted"
            checked={showDeleted}
            onCheckedChange={(checked) => setShowDeleted(checked === true)}
          />
          <label
            htmlFor="show-deleted"
            className="text-sm text-muted-foreground cursor-pointer"
          >
            Show deleted
          </label>
        </div>
      </div>

      {generations.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No schedules generated yet.</p>
          <Link href="/classes">
            <Button className="mt-4">Generate Schedule</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Starred Schedules Section */}
          {starredGenerations.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Star className="h-5 w-5 text-sky-500 fill-sky-500" />
                Starred Schedules
                {starredGenerations.length > starredDisplayCount && (
                  <span className="text-sm font-normal text-slate-400">
                    (showing {starredDisplayCount} of {starredGenerations.length})
                  </span>
                )}
              </h2>
              <div className="space-y-2">
                {starredGenerations.slice(0, starredDisplayCount).map((gen) => (
                  <div
                    key={gen.id}
                    className="flex items-center gap-4 py-3 px-4 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 transition-colors group"
                  >
                    <Star className="h-4 w-4 text-sky-500 fill-sky-500 flex-shrink-0" />
                    <Link href={`/history/${gen.id}`} className="flex-1 min-w-0 flex items-center gap-4">
                      <Badge variant="outline" className="border-sky-300 text-sky-700">{gen.quarter?.name}</Badge>
                      {getOptionLabel(gen) && (
                        <span className="text-xs font-medium text-sky-700">{getOptionLabel(gen)}</span>
                      )}
                      <span className="text-sm text-muted-foreground">
                        {new Date(gen.generated_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      {gen.notes && (
                        <span className="text-sm text-slate-600 truncate flex-1" title={gen.notes}>
                          - {gen.notes}
                        </span>
                      )}
                    </Link>
                    <div className="flex gap-1 flex-shrink-0">
                      <a
                        href={`/api/export?generation_id=${gen.id}&option=${gen.selected_option || 1}&format=xlsx`}
                        download
                      >
                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-sky-200">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-sky-200">
                            <Trash2 className="h-4 w-4 text-sky-600 hover:text-sky-800" />
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
                      <ChevronRight className="h-4 w-4 text-sky-400 group-hover:text-sky-600" />
                    </Link>
                  </div>
                ))}
              </div>
              {starredGenerations.length > starredDisplayCount && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 text-sky-600 hover:text-sky-700 hover:bg-sky-50"
                  onClick={() => setStarredDisplayCount(prev => prev + PAGE_SIZE)}
                >
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Load more starred
                </Button>
              )}
            </div>
          )}

          {/* Recent Schedules Section (includes deleted when showDeleted is true) */}
          {recentGenerations.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3 text-slate-600 flex items-center gap-2">
                Recent Schedules
                {recentGenerations.length > recentDisplayCount && (
                  <span className="text-sm font-normal text-slate-400">
                    (showing {recentDisplayCount} of {recentGenerations.length})
                  </span>
                )}
              </h2>
              <div className="space-y-2">
                {recentGenerations.slice(0, recentDisplayCount).map((gen) => {
                  const isDeleted = !!gen.deleted_at
                  return (
                    <div
                      key={gen.id}
                      className={`flex items-center gap-4 py-3 px-4 rounded-lg border transition-colors group ${
                        isDeleted
                          ? "border-red-200 bg-red-50/50 opacity-60"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <Link href={`/history/${gen.id}`} className="flex-1 min-w-0 flex items-center gap-4">
                        <Badge variant="outline" className={isDeleted ? "border-red-300 text-red-600" : ""}>
                          {gen.quarter?.name}
                        </Badge>
                        {getOptionLabel(gen) && (
                          <span className={`text-xs font-medium ${isDeleted ? "text-red-500" : "text-slate-500"}`}>
                            {getOptionLabel(gen)}
                          </span>
                        )}
                        <span className={`text-sm ${isDeleted ? "text-red-400" : "text-muted-foreground"}`}>
                          {new Date(gen.generated_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        {isDeleted && (
                          <span className="text-xs text-red-400 italic">deleted</span>
                        )}
                        {gen.notes && (
                          <span className={`text-sm truncate flex-1 ${isDeleted ? "text-red-500" : "text-slate-600"}`} title={gen.notes}>
                            - {gen.notes}
                          </span>
                        )}
                      </Link>
                      <div className="flex gap-1 flex-shrink-0">
                        {isDeleted ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-red-100"
                            onClick={() => undeleteGeneration(gen.id)}
                            title="Restore schedule"
                          >
                            <RotateCcw className="h-4 w-4 text-red-500" />
                          </Button>
                        ) : (
                          <>
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
                                    This schedule will be moved to deleted. You can restore it later by checking &quot;Show deleted&quot;.
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
                          </>
                        )}
                      </div>
                      <Link href={`/history/${gen.id}`}>
                        <ChevronRight className={`h-4 w-4 ${isDeleted ? "text-red-300" : "text-slate-300 group-hover:text-slate-500"}`} />
                      </Link>
                    </div>
                  )
                })}
              </div>
              {/* Load more button - either from local display limit or fetch more from API */}
              {recentGenerations.length > recentDisplayCount ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 text-slate-600 hover:text-slate-700"
                  onClick={() => setRecentDisplayCount(prev => prev + PAGE_SIZE)}
                >
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Load more
                </Button>
              ) : hasMore ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 text-slate-600 hover:text-slate-700"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-1" />
                      Load more schedules
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          )}

          {/* Load more from API when we've shown all loaded recent schedules but there might be more */}
          {recentGenerations.length === 0 && hasMore && (
            <div className="text-center pt-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-600 hover:text-slate-700"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-1" />
                    Load more schedules
                  </>
                )}
              </Button>
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

          {recentGenerations.length === 0 && starredGenerations.length > 0 && !hasMore && (
            <div className="text-center py-6 text-muted-foreground">
              <p className="text-sm">All schedules are starred!</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
