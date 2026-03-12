"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Star, Eye, Calendar, ArrowRight, History, Plus } from "lucide-react"

interface Quarter {
  id: string
  name: string
  is_active: boolean
}

interface HistoryItem {
  id: string
  generated_at: string
  selected_option: number | null
  studyHallsPlaced?: number
  backToBackIssues?: number
  classesCount?: number
  teachersCount?: number
  is_starred: boolean
  notes: string | null
  quarter: { id: string; name: string }
}

function getOptionLabel(selectedOption: number | null): string | null {
  if (!selectedOption) return null
  return `Revision ${selectedOption}`
}

const PAGE_SIZE = 10

export default function SchedulesPage() {
  const [quarters, setQuarters] = useState<Quarter[]>([])
  const [schedules, setSchedules] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filterQuarterId, setFilterQuarterId] = useState<string>("all")

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [quartersRes, historyRes] = await Promise.all([
        fetch("/api/quarters"),
        fetch(`/api/history?summary=true&limit=${PAGE_SIZE}`),
      ])

      const [quartersData, historyData] = await Promise.all([
        quartersRes.json(),
        historyRes.json(),
      ])

      setQuarters(quartersData)
      setSchedules(historyData)
    } catch (error) {
      console.error("Failed to load data:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Filter schedules by quarter
  const filteredSchedules = filterQuarterId === "all"
    ? schedules
    : schedules.filter((s) => s.quarter?.id === filterQuarterId)

  // Separate starred and non-starred
  const starredSchedules = filteredSchedules.filter((s) => s.is_starred)
  const recentSchedules = filteredSchedules.filter((s) => !s.is_starred)

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Schedules</h1>
        <p className="text-muted-foreground">
          View and manage generated schedules across all quarters
        </p>
      </div>

      {/* Actions Bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Select value={filterQuarterId} onValueChange={setFilterQuarterId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by quarter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Quarters</SelectItem>
              {quarters.map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  {q.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filterQuarterId !== "all" && (
            <span className="text-sm text-muted-foreground">
              {filteredSchedules.length} schedule{filteredSchedules.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <Link href="/classes">
          <Button className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
            <Plus className="h-4 w-4" />
            New Schedule
          </Button>
        </Link>
      </div>

      {/* Content */}
      {schedules.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-slate-50">
          <Calendar className="h-12 w-12 mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-medium mb-2">No schedules yet</h3>
          <p className="text-muted-foreground mb-4">
            Generate your first schedule from the Class Setup page
          </p>
          <Link href="/classes">
            <Button className="gap-2">
              Go to Class Setup
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      ) : filteredSchedules.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-slate-50">
          <p className="text-muted-foreground">
            No schedules found for this quarter
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Starred Schedules */}
          {starredSchedules.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Star className="h-4 w-4 text-sky-500" />
                Starred Schedules
              </h2>
              <div className="space-y-2">
                {starredSchedules.map((item) => (
                  <ScheduleCard key={item.id} item={item} starred />
                ))}
              </div>
            </div>
          )}

          {/* Recent Schedules */}
          {recentSchedules.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                Recent Schedules
              </h2>
              <div className="space-y-2">
                {recentSchedules.slice(0, 5).map((item) => (
                  <ScheduleCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* View All Link */}
          <div className="text-center pt-4">
            <Link href="/history" className="text-sm text-sky-600 hover:text-sky-700 flex items-center justify-center gap-1">
              <History className="h-4 w-4" />
              View Full History
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function ScheduleCard({ item, starred = false }: { item: HistoryItem; starred?: boolean }) {
  return (
    <Link
      href={`/history/${item.id}`}
      className={`flex items-center gap-4 py-3 px-4 rounded-lg border transition-colors group ${
        starred
          ? "bg-sky-50 border-sky-200 hover:bg-sky-100"
          : "bg-white hover:bg-slate-50"
      }`}
    >
      {starred && (
        <Star className="h-4 w-4 text-sky-500 fill-sky-500 flex-shrink-0" />
      )}
      <Badge
        variant="outline"
        className={starred ? "border-sky-300 text-sky-700" : ""}
      >
        {item.quarter?.name || "Unknown"}
      </Badge>
      {getOptionLabel(item.selected_option) && (
        <span className={`text-xs font-medium ${starred ? "text-sky-700" : "text-slate-500"}`}>
          {getOptionLabel(item.selected_option)}
        </span>
      )}
      <span className="text-sm text-muted-foreground">
        {new Date(item.generated_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
      {item.classesCount !== undefined && item.classesCount > 0 && (
        <span className="text-xs text-slate-500">
          {item.classesCount} classes
        </span>
      )}
      {item.teachersCount !== undefined && item.teachersCount > 0 && (
        <span className="text-xs text-slate-500">
          {item.teachersCount} teachers
        </span>
      )}
      {item.notes && (
        <span
          className="text-sm text-slate-600 truncate flex-1"
          title={item.notes}
        >
          - {item.notes}
        </span>
      )}
      <Eye
        className={`h-4 w-4 ml-auto flex-shrink-0 ${
          starred
            ? "text-sky-400 group-hover:text-sky-600"
            : "text-slate-300 group-hover:text-slate-500"
        }`}
      />
    </Link>
  )
}
