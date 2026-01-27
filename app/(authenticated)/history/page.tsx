"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { Loader2, Trash2, Eye, Download, Check } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import toast from "react-hot-toast"

interface Generation {
  id: string
  quarter_id: string
  generated_at: string
  selected_option: number | null
  notes: string | null
  is_saved: boolean
  quarter: { id: string; name: string }
}

export default function HistoryPage() {
  const [generations, setGenerations] = useState<Generation[]>([])
  const [loading, setLoading] = useState(true)
  const [showUnsaved, setShowUnsaved] = useState(false)

  useEffect(() => {
    loadGenerations()
  }, [showUnsaved])

  async function loadGenerations() {
    try {
      const url = showUnsaved ? "/api/history?include_unsaved=true" : "/api/history"
      const res = await fetch(url)
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

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleString()
  }

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
            id="show-unsaved"
            checked={showUnsaved}
            onCheckedChange={(checked) => setShowUnsaved(checked === true)}
          />
          <label
            htmlFor="show-unsaved"
            className="text-sm text-muted-foreground cursor-pointer"
          >
            Show all (including unsaved)
          </label>
        </div>
      </div>

      {generations.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No schedules generated yet.</p>
          <Link href="/generate">
            <Button className="mt-4">Generate a Schedule</Button>
          </Link>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Status</TableHead>
                <TableHead>Quarter</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead>Selected Option</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-[150px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {generations.map((gen) => (
                <TableRow key={gen.id}>
                  <TableCell>
                    {gen.is_saved ? (
                      <Badge className="bg-emerald-500 gap-1">
                        <Check className="h-3 w-3" />
                        Saved
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unsaved</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{gen.quarter?.name}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(gen.generated_at)}</TableCell>
                  <TableCell>
                    {gen.selected_option ? (
                      <Badge>Option {gen.selected_option}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Not selected</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {gen.notes || (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Link href={`/history/${gen.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
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
                            <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
